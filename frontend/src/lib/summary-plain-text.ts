import rules from './summary-plain-text-rules.json';

const lineRules = rules.line.map(([pattern, replacement]) => [new RegExp(pattern, 'gi'), replacement] as const);
const inlineRules = rules.inline.map(([pattern, replacement]) => [new RegExp(pattern, 'gi'), replacement] as const);
const textFields = new Set(['markdown', 'text', 'content', 'title', 'MeetingName']);

// The same rules run at the native persistence boundary and at copy/export boundaries.
// Literal information such as C#, issue numbers, URLs, file names and arithmetic stays intact.
export function toSummaryPlainText(value: string): string {
  return value.replace(/\r\n?/g, '\n').split('\n').map(originalLine => {
    const tableRow = originalLine.trim().startsWith('|') && originalLine.trim().endsWith('|');
    let line = originalLine;
    let previous;
    do {
      previous = line;
      for (const [pattern, replacement] of lineRules) line = line.replace(pattern, replacement);
      for (const [pattern, replacement] of inlineRules) line = line.replace(pattern, replacement);
    } while (line !== previous);
    if (tableRow) line = line.replace(/[ \t]*\|[ \t]*/g, '\t');
    return line.trimEnd();
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function sanitizeSummaryText<T>(value: T): T {
  if (Array.isArray(value)) return value.map(sanitizeSummaryText) as T;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    typeof child === 'string' && textFields.has(key)
      ? toSummaryPlainText(child)
      : sanitizeSummaryText(child),
  ])) as T;
}
