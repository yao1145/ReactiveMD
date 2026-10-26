import { useCallback, useEffect, useRef, useState } from 'react';
import { validateImageManifest, type ImageAsset } from './image-assets';

// Binary-sized resources live beside drafts in IndexedDB, not localStorage.
function storage(key: string, value?: readonly ImageAsset[]): Promise<ImageAsset[]> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('reactive-md-images', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('documents');
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Image storage is blocked.'));
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('documents', value ? 'readwrite' : 'readonly');
      const store = tx.objectStore('documents');
      const operation = value ? store.put(value, key) : store.get(key);
      tx.oncomplete = () => {
        db.close();
        try { resolve(value ? [...value] : validateImageManifest(operation.result ?? [])); }
        catch (error) { reject(error); }
      };
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}

export function useDocumentImages(key: string) {
  const [state, setState] = useState<{ key: string; assets: ImageAsset[]; ready: boolean }>({ key, assets: [], ready: false });
  const [storageError, setStorageError] = useState(false);
  const currentKey = useRef(key);
  currentKey.current = key;
  const cache = useRef(new Map<string, ImageAsset[]>());
  const writes = useRef(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    setStorageError(false);
    if (cache.current.has(key)) {
      setState({ key, assets: cache.current.get(key)!, ready: true });
      return;
    }
    storage(key).then(assets => {
      if (cancelled) return;
      cache.current.set(key, assets);
      setState({ key, assets, ready: true });
    }).catch(() => {
      if (cancelled) return;
      setState({ key, assets: [], ready: true });
      setStorageError(true);
    });
    return () => { cancelled = true; };
  }, [key]);

  const replace = useCallback((assets: ImageAsset[]) => {
    if (currentKey.current !== key) return;
    cache.current.set(key, assets);
    setState({ key, assets, ready: true });
    writes.current = writes.current.then(() => storage(key, assets)).then(() => {
      if (currentKey.current === key) setStorageError(false);
    }).catch(() => {
      if (currentKey.current === key) setStorageError(true);
    });
  }, [key]);

  return {
    assets: state.key === key ? state.assets : [],
    ready: state.key === key && state.ready,
    replace,
    storageError,
  };
}
