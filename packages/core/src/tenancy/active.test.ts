import { describe, expect, it } from 'vitest';
import { chooseActiveOrganization, type OrganizationEntry } from '.';

const entry = (id: string, live = false): OrganizationEntry => ({
  realTenantId: `${id}-real`,
  twinTenantId: `${id}-twin`,
  ruc: '1712345678001',
  name: id,
  role: 'OWNER',
  live,
  requireTwoFactor: false,
});

// FR-USR-5, FR-ONB-5.
describe('chooseActiveOrganization', () => {
  it('keeps the session choice when it is one of the user’s organizations', () => {
    expect(chooseActiveOrganization([entry('a'), entry('b')], 'b-twin')).toMatchObject({
      tenantId: 'b-twin',
      mode: 'TEST',
    });
  });

  it('never offers a real organization before go-live', () => {
    expect(chooseActiveOrganization([entry('a')], 'a-real')).toMatchObject({
      tenantId: 'a-twin',
      mode: 'TEST',
    });
  });

  it('allows production once live', () => {
    expect(chooseActiveOrganization([entry('a', true)], 'a-real')).toMatchObject({
      mode: 'PRODUCTION',
    });
  });

  it('falls back to the first organization when the choice is stale or missing', () => {
    expect(chooseActiveOrganization([entry('a')], 'someone-else')).toMatchObject({
      tenantId: 'a-twin',
    });
    expect(chooseActiveOrganization([entry('a', true)], null)).toMatchObject({
      tenantId: 'a-real',
    });
  });

  it('returns null without organizations', () => {
    expect(chooseActiveOrganization([], null)).toBeNull();
  });
});
