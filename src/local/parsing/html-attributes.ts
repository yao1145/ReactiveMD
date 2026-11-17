interface HtmlAttributeValue {
  name: string;
  value: string;
  start: number;
  end: number;
}
interface HtmlAttributeScan {
  attrs: Record<string, string>;
  entries: HtmlAttributeValue[];
  invalid: HtmlAttributeValue[];
}
/** Attribute values are raw decoded strings; the source is never executed. */
export function scanHtmlAttributes(raw: string, offset: number, decode: (value: string) => string): HtmlAttributeScan {
  const attrs: Record<string, string> = Object.create(null);
  const entries: HtmlAttributeValue[] = [];
  const invalid: HtmlAttributeValue[] = [];
  let index = 0;
  while (index < raw.length) {
    while (index < raw.length && /\s/.test(raw[index])) index += 1;
    if (index >= raw.length || raw[index] === '/') break;
    const start = index;
    const match = /^[A-Za-z_:][A-Za-z0-9_.:-]*/.exec(raw.slice(index));
    if (!match) {
      index += 1;
      continue;
    }
    const name = match[0].toLowerCase();
    index += match[0].length;
    while (index < raw.length && /\s/.test(raw[index])) index += 1;
    let value = 'true';
    if (raw[index] === '=') {
      index += 1;
      while (index < raw.length && /\s/.test(raw[index])) index += 1;
      const quote = raw[index];
      if (quote === '"' || quote === "'") {
        index += 1;
        const end = raw.indexOf(quote, index);
        if (end < 0) {
          invalid.push({ name, value: '', start: offset + start, end: offset + raw.length });
          break;
        }
        value = decode(raw.slice(index, end));
        index = end + 1;
      } else {
        const begin = index;
        while (index < raw.length && !/[\s>]/.test(raw[index])) index += 1;
        value = decode(raw.slice(begin, index));
      }
    }
    const entry = { name, value, start: offset + start, end: offset + index };
    if (Object.hasOwn(attrs, name)) {
      // HTML keeps the first occurrence; duplicates are inert.
      entries.push(entry);
      continue;
    }
    attrs[name] = value;
    entries.push(entry);
  }
  return { attrs, entries, invalid };
}
