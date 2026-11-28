const NUMBER_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export function parseNumberLiteral(raw: string): number | null {
  const text = raw.trim();
  if (!NUMBER_TEXT.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export function parsePositiveNumberLiteral(raw: string): number | undefined {
  const value = parseNumberLiteral(raw);
  return value !== null && value > 0 ? value : undefined;
}
