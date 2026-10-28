/** Offset-only Markdown nodes consumed by the existing semantic transform. */
interface FastNode {
  type: string;
  position: {start: {offset: number}; end: {offset: number}};
  children?: FastNode[];
  value?: string;
  ordered?: boolean;
  start?: number | null;
  checked?: null;
  align?: ('left' | 'right' | 'center' | null)[];
}
interface Line {from: number; to: number; text: string}
const itemMarker = /^([-+*]|\d{1,9}[.)]) /;

/**
 * Linear scanner for flat, single-line list items and rectangular pipe tables.
 * Only plain text and unambiguous, space-delimited **strong** spans are accepted.
 * No partial result escapes: anything outside this subset uses remark, preserving
 * its reference resolution, escaping, nesting and container precedence rules.
 */
export function parseFastMarkdown(source: string): FastNode | undefined {
  if (!source.includes('|') && !itemMarker.test(source) && !/[\r\n](?:[-+*]|\d{1,9}[.)]) /.test(source)) return;
  if (/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f\ufeff\\`_{}\[\]<>!~&$@#]/.test(source)
    || source.includes('://') || /www\./i.test(source)) return;
  const make = (type: string, from: number, to: number, extra: Partial<FastNode> = {}): FastNode =>
    ({type, position: {start: {offset: from}, end: {offset: to}}, ...extra});
  const lines: Line[] = [];
  for (let from = 0; from < source.length;) {
    let to = from;
    while (to < source.length && source[to] !== '\r' && source[to] !== '\n') to++;
    const text = source.slice(from, to);
    // Keep whitespace normalization and hard-break handling in remark.
    if (text.startsWith(' ') || text.endsWith(' ')) return;
    lines.push({from, to, text});
    from = source[to] === '\r' && source[to + 1] === '\n' ? to + 2 : to + 1;
  }
  function inline(from: number, to: number): FastNode[] | undefined {
    const result: FastNode[] = [];
    let cursor = from;
    while (cursor < to) {
      let open = cursor;
      while (open < to && source[open] !== '*') open++;
      if (open === to) {
        result.push(make('text', cursor, to, {value: source.slice(cursor, to)})); break;
      }
      if (source.slice(open, open + 2) !== '**' || (open > from && source[open - 1] !== ' ')) return;
      let close = open + 2;
      while (close < to && source[close] !== '*') close++;
      if (close + 2 > to || source.slice(close, close + 2) !== '**'
        || (close + 2 < to && !/[ .,;:?)\-]/.test(source[close + 2]))) return;
      const value = source.slice(open + 2, close);
      if (!/^[\p{L}\p{N}](?:[\p{L}\p{N} .,:;()/-]*[\p{L}\p{N}])?$/u.test(value)) return;
      if (open > cursor) result.push(make('text', cursor, open, {value: source.slice(cursor, open)}));
      result.push(make('strong', open, close + 2, {children: [make('text', open + 2, close, {value})]}));
      cursor = close + 2;
    }
    return result;
  }
  function prose(from: number, to: number): FastNode | undefined {
    const text = source.slice(from, to);
    if (!text || /^[ >+=-]/.test(text) || itemMarker.test(text) || text.includes('|')) return;
    const children = inline(from, to);
    return children && make('paragraph', from, to, {children});
  }
  function cells(line: Line): {from: number; to: number; left: number; right: number}[] | undefined {
    if (!line.text.startsWith('|') || !line.text.endsWith('|') || line.text.length < 2) return;
    const result = [];
    let left = line.from;
    for (let right = left + 1; right < line.to; right++) {
      if (source[right] !== '|') continue;
      let from = left + 1, to = right;
      while (source[from] === ' ' && from < to) from++;
      while (source[to - 1] === ' ' && to > from) to--;
      result.push({from, to, left, right}); left = right;
    }
    return result;
  }
  function row(line: Line, parts: NonNullable<ReturnType<typeof cells>>): FastNode | undefined {
    const children: FastNode[] = [];
    for (let i = 0; i < parts.length; i++) {
      const cell = parts[i], content = inline(cell.from, cell.to);
      if (!content) return;
      children.push(make('tableCell', cell.left, i === parts.length - 1 ? line.to : cell.right, {children: content}));
    }
    return make('tableRow', line.from, line.to, {children});
  }
  const children: FastNode[] = [];
  for (let i = 0; i < lines.length;) {
    const first = lines[i];
    if (!first.text) {i++; continue;}
    const marker = itemMarker.exec(first.text);
    if (marker) {
      const items: FastNode[] = [];
      const ordered = marker[1].length > 1;
      const style = ordered ? marker[1].at(-1) : marker[1];
      while (i < lines.length) {
        const line = lines[i], next = itemMarker.exec(line.text);
        if (!next || (ordered ? next[1].length === 1 || next[1].at(-1) !== style : next[1] !== style)) break;
        const paragraph = prose(line.from + next[0].length, line.to);
        if (!paragraph) return;
        items.push(make('listItem', line.from, line.to, {checked: null, children: [paragraph]})); i++;
      }
      // A blank between like lists produces a single loose list in CommonMark.
      let following = i;
      while (following < lines.length && !lines[following].text) following++;
      if (following < lines.length && itemMarker.test(lines[following].text)) return;
      children.push(make('list', first.from, lines[i-1].to, {ordered, start: ordered ? parseInt(marker[1], 10) : null, children: items}));
    } else if (first.text.startsWith('|')) {
      const header = cells(first), delimiter = lines[i + 1] && cells(lines[i + 1]);
      if (!header?.length || !delimiter || header.length !== delimiter.length) return;
      const align: NonNullable<FastNode['align']> = [];
      for (const cell of delimiter) {
        const text = source.slice(cell.from, cell.to);
        if (!/^:?-+:?$/.test(text)) return;
        align.push(text.startsWith(':') ? text.endsWith(':') ? 'center' : 'left' : text.endsWith(':') ? 'right' : null);
      }
      const head = row(first, header);
      if (!head) return;
      const rows = [head]; i += 2;
      while (i < lines.length && lines[i].text.startsWith('|')) {
        const parts = cells(lines[i]);
        if (!parts || parts.length !== header.length) return;
        const next = row(lines[i], parts);
        if (!next) return;
        rows.push(next); i++;
      }
      children.push(make('table', first.from, lines[i-1].to, {align, children: rows}));
    } else {
      const paragraph = prose(first.from, first.to);
      if (!paragraph) return;
      children.push(paragraph); i++;
    }
    if (i < lines.length && lines[i].text) return;
  }
  return make('root', 0, source.length, {children});
}
