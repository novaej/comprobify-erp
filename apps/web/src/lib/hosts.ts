// ADR-048: with LANDING_URL set apart from APP_URL, the public pages (the landing, pricing,
// support) answer on the landing host and everything else on the app host. A request on the
// wrong one is sent to the right one, path and query kept. One host (locally, or LANDING_URL
// unset) serves everything, and so does any host that is neither.

// The public pages: `/`, `/es`, `/en`, and their pricing and support pages.
const LANDING_PATH = /^\/(?:(?:es|en)(?:\/(?:pricing|support))?)?\/?$/;

export const isLandingPath = (pathname: string) => LANDING_PATH.test(pathname);

export function hostRedirect(
  url: { host: string; pathname: string; search: string },
  hosts: { appUrl: string; landingUrl: string | null },
): string | null {
  if (!hosts.landingUrl || !hosts.appUrl) return null;
  const app = new URL(hosts.appUrl);
  const landing = new URL(hosts.landingUrl);
  if (app.host === landing.host) return null;
  const landingPath = isLandingPath(url.pathname);
  const target =
    url.host === landing.host && !landingPath
      ? app
      : url.host === app.host && landingPath
        ? landing
        : null;
  return target ? `${target.origin}${url.pathname}${url.search}` : null;
}
