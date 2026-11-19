// The docs site (ADR-051), apart from the app: Spanish at the root, English under /en/. A plain
// module, so server and client components read the same value (CLAUDE.md mistake 30).
export const DOCS_URL = 'https://docs.comprobify.com';

export const docsUrl = (locale: string): string =>
  locale === 'en' ? `${DOCS_URL}/en/` : `${DOCS_URL}/`;
