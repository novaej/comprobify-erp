// "Back" on a page that can be reached from several places goes to where the person came from
// (CLAUDE.md rule 19: screens behave alike). The link that opens the page carries `?back=<path>`;
// the page reads it with `safeBack`, which accepts only the app's own list and detail paths.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BackKey =
  | 'documents'
  | 'pending'
  | 'document'
  | 'bulk'
  | 'batch'
  | 'saleOrders'
  | 'saleOrder'
  | 'purchaseOrders'
  | 'purchaseOrder'
  | 'receivables'
  | 'inventory'
  | 'valuation'
  | 'product';

// What a path is, by its segments: a list, or one record of it.
function keyOf(segments: string[]): BackKey | null {
  const [root, next, extra] = segments;
  if (extra !== undefined) return null;
  const record = next !== undefined && UUID.test(next);
  switch (root) {
    case 'documents':
      return next === undefined
        ? 'documents'
        : next === 'pending'
          ? 'pending'
          : record
            ? 'document'
            : null;
    case 'bulk-invoicing':
      return next === undefined ? 'bulk' : record ? 'batch' : null;
    case 'sale-orders':
      return next === undefined ? 'saleOrders' : record ? 'saleOrder' : null;
    case 'purchase-orders':
      return next === undefined ? 'purchaseOrders' : record ? 'purchaseOrder' : null;
    case 'receivables':
      return next === undefined ? 'receivables' : null;
    case 'inventory':
      return next === undefined
        ? 'inventory'
        : next === 'valuation'
          ? 'valuation'
          : record
            ? 'product'
            : null;
    default:
      return null;
  }
}

// A path from the URL, made safe: one of the app's own, with at most a query, never another site's
// or a script's. Anything else is ignored, as if it had not been sent.
export function safeBack(raw: string | undefined): { href: string; key: BackKey } | null {
  if (!raw || raw.length > 400 || !raw.startsWith('/') || raw.startsWith('//')) return null;
  if (!/^\/[A-Za-z0-9\-_/.?=&%,:+]*$/.test(raw) || raw.includes('..')) return null;
  const [path = ''] = raw.split('?');
  const key = keyOf(path.split('/').filter(Boolean));
  return key ? { href: raw, key } : null;
}

// A link to `href` that remembers where it was opened from.
export function withBack(href: string, from: string | undefined | null): string {
  if (!from) return href;
  return `${href}${href.includes('?') ? '&' : '?'}back=${encodeURIComponent(from)}`;
}

// A list's address with what is filtering it now, to come back to.
export function listAddress(
  path: string,
  search: Record<string, string | string[] | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(search))
    if (typeof value === 'string' && value !== '' && name !== 'back') params.set(name, value);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
