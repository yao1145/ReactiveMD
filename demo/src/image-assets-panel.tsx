import { useId, useRef } from 'react';
import { useLanguage } from './i18n';
import { IMAGE_ACCEPT, type ImageAsset } from './image-assets';
import { IMAGE_COPY } from './image-copy';

export interface ImageAssetsPanelProps {
  assets: readonly ImageAsset[];
  references: readonly string[];
  busy: boolean;
  error: string | null;
  storageError: boolean;
  onFiles(files: File[], target?: string): void;
  onRemove(url: string): void;
  allowInsert?: boolean;
  compact?: boolean;
}

export function ImageAssetsPanel({ assets, references, busy, error, storageError, onFiles, onRemove, allowInsert = true, compact = false }: ImageAssetsPanelProps) {
  const copy = IMAGE_COPY[useLanguage()];
  const id = useId();
  const picker = useRef<HTMLInputElement>(null);
  const target = useRef<string | undefined>(undefined);
  const rows = [...new Set([...references, ...assets.map(a => a.url)])];
  const byUrl = new Map(assets.map(a => [a.url, a]));
  return <section className={`image-assets${compact ? ' image-assets-compact' : ''}`} aria-labelledby={compact ? undefined : id} aria-label={compact ? copy.add : undefined} aria-busy={busy}>
    <div className="image-assets-head">
      {!compact && <h3 id={id}>{copy.title}</h3>}
      {allowInsert && <button type="button" className="button button-secondary" disabled={busy}
        onClick={() => { target.current = undefined; if (picker.current) picker.current.multiple = true; picker.current?.click(); }}>{copy.add}</button>}
    </div>
    <input ref={picker} type="file" accept={IMAGE_ACCEPT} multiple={allowInsert} hidden aria-label={copy.add}
      onChange={event => {
        const files = Array.from(event.target.files ?? []);
        if (files.length) onFiles(files, target.current);
        event.target.value = '';
      }} />
    {!compact && rows.length > 0 && <ul className="image-assets-list">{rows.map(url => {
      const asset = byUrl.get(url);
      return <li key={url} className="image-asset-row">
        {asset ? <img src={asset.dataUrl} alt="" width="48" height="48" /> : <span className="image-asset-placeholder" aria-hidden="true">?</span>}
        <div className="image-asset-info"><code>{url}</code><span>
          {asset ? `${references.includes(url) ? copy.ready : copy.unused} · ${asset.mime.replace('image/', '').toUpperCase()} · ${(asset.size / 1024).toFixed(1)} KiB` : copy.missing}
        </span></div>
        <div className="image-asset-actions">
          <button type="button" className="button button-quiet" disabled={busy}
            aria-label={asset ? copy.replaceLabel(url) : copy.chooseLabel(url)}
            onClick={() => { target.current = url; if (picker.current) picker.current.multiple = false; picker.current?.click(); }}>{asset ? copy.replace : copy.choose}</button>
          {asset && <button type="button" className="button button-quiet" disabled={busy} aria-label={copy.removeLabel(url)} onClick={() => onRemove(url)}>{copy.remove}</button>}
        </div>
      </li>;
    })}</ul>}
    {busy && <p role="status">{copy.loading}</p>}
    {error && <p className="export-status is-error" role="alert">{error}</p>}
    {storageError && <p className="export-status is-error" role="alert">{copy.storage}</p>}
  </section>;
}
