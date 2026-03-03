/**
 * Strips leftover wiki / scraping syntax that may leak into display fields.
 * Used defensively in detail-page templates.
 */

const HTML_COMMENT = /<!--[^]*?-->/g;
const WIKI_FIELD   = /\|[a-z_]+\s*=\s*/gi;
const WIKI_TPL     = /\{\{[^}]*\}\}?/g;
const WIKI_LINK    = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;   // [[Page|label]] → label or page
const WIKI_BOLD    = /'''([^']+)'''/g;

export function cleanStr(s: string | null | undefined): string | null {
  if (!s) return null;
  let v = s;
  v = v.replace(HTML_COMMENT, '');
  v = v.replace(WIKI_FIELD, '');
  v = v.replace(WIKI_TPL, '');
  v = v.replace(WIKI_LINK, '$1');
  v = v.replace(WIKI_BOLD, '$1');
  v = v.replace(/<br\s*\/?>/gi, '. ');
  v = v.replace(/\.\s*\./g, '.').replace(/  +/g, ' ').trim();
  return v || null;
}

export function cleanArr(arr: string[] | null | undefined): string[] {
  if (!arr) return [];
  return arr
    .map(s => cleanStr(s))
    .filter((s): s is string => s !== null && s.length > 0);
}
