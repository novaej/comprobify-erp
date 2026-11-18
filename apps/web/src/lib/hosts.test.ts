import { describe, expect, it } from 'vitest';
import { hostRedirect, isLandingPath } from './hosts';

// ADR-048.
describe('the landing and app hosts', () => {
  const hosts = { appUrl: 'https://app.comprobify.com', landingUrl: 'https://comprobify.com' };
  const at = (host: string, pathname: string, search = '') => ({ host, pathname, search });

  it('knows the public pages', () => {
    for (const path of ['/', '/es', '/en/', '/es/pricing', '/en/support'])
      expect(isLandingPath(path)).toBe(true);
    for (const path of ['/es/login', '/es/dashboard', '/es/pricing/x', '/fr'])
      expect(isLandingPath(path)).toBe(false);
  });

  it('sends the app away from the landing host, and the public pages away from the app host', () => {
    expect(hostRedirect(at('comprobify.com', '/es/login', '?next=%2Fplan'), hosts)).toBe(
      'https://app.comprobify.com/es/login?next=%2Fplan',
    );
    expect(hostRedirect(at('app.comprobify.com', '/es/pricing'), hosts)).toBe(
      'https://comprobify.com/es/pricing',
    );
    expect(hostRedirect(at('comprobify.com', '/es/pricing'), hosts)).toBeNull();
    expect(hostRedirect(at('app.comprobify.com', '/es/dashboard'), hosts)).toBeNull();
  });

  it('serves everything on one host when the landing has none of its own', () => {
    expect(
      hostRedirect(at('localhost:3000', '/es/login'), { ...hosts, landingUrl: null }),
    ).toBeNull();
    expect(
      hostRedirect(at('app.comprobify.com', '/es'), { ...hosts, landingUrl: hosts.appUrl }),
    ).toBeNull();
    // A host that is neither (an IP, a preview) is left alone.
    expect(hostRedirect(at('10.0.0.5', '/es/login'), hosts)).toBeNull();
  });
});
