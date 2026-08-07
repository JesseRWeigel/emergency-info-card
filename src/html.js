// The two string helpers everything else needs, and nothing more.

/** Escape for text content and for double quoted attribute values. */
export function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Build a style attribute value from an object, dropping null and undefined. */
export function style(declarations) {
  return Object.entries(declarations)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
}
