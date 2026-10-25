import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';

function sameHeights(previous: number[], next: number[]) {
  return previous.length === next.length
    && previous.every((height, index) => Math.abs(height - next[index]) < 0.01);
}

// Measures the hidden mirror once per source/width/font change so the gutter
// can give each logical line the height of its wrapped visual rows.
export function useGutterMetrics(
  lines: string[],
  mirrorRef: RefObject<HTMLDivElement | null>,
  editorRef: RefObject<HTMLTextAreaElement | null>,
) {
  const [width, setWidth] = useState(0);
  const [heights, setHeights] = useState<number[]>([]);
  const [fontEpoch, setFontEpoch] = useState(0);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const sync = () => setWidth(editor.clientWidth);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(editor);
    return () => observer.disconnect();
  }, [editorRef]);

  useEffect(() => {
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) setFontEpoch((value) => value + 1);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useLayoutEffect(() => {
    const mirror = mirrorRef.current;
    if (!mirror || width === 0) return;
    const children = Array.from(mirror.children);
    if (children.length !== lines.length) return;
    const lineHeight = Number.parseFloat(window.getComputedStyle(mirror).lineHeight) || 22;
    const next = children.map((child) => child.getBoundingClientRect().height || lineHeight);
    setHeights((previous) => (sameHeights(previous, next) ? previous : next));
  }, [lines, width, fontEpoch, mirrorRef]);

  return { width, heights };
}
