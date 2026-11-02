import { describe, expect, it } from 'vitest';
import { ambienteFor, PERMISSIONS, ROLE_PERMISSIONS, ROLES } from '.';

describe('ambiente (FR-ONB-6)', () => {
  // Every deployment × mode cell: only a real organization on production gets 2.
  it.each([
    ['local', 'TEST', '1'],
    ['local', 'PRODUCTION', '1'],
    ['staging', 'TEST', '1'],
    ['staging', 'PRODUCTION', '1'],
    ['production', 'TEST', '1'],
    ['production', 'PRODUCTION', '2'],
  ] as const)('%s × %s → %s', (appEnv, mode, expected) => {
    expect(ambienteFor(mode, appEnv)).toBe(expected);
  });
});

describe('roles (FR-ROLE-1)', () => {
  it('covers every role in the database list', () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...ROLES].sort());
  });

  it('gives the owner everything and keeps go-live and ownership from the admin', () => {
    expect(ROLE_PERMISSIONS.OWNER).toEqual(PERMISSIONS);
    expect(ROLE_PERMISSIONS.ADMIN).not.toContain('organization.go_live');
    expect(ROLE_PERMISSIONS.ADMIN).not.toContain('organization.transfer_ownership');
    expect(ROLE_PERMISSIONS.ADMIN).toContain('organization.reset_twin');
  });

  it('keeps the viewer and accountant read-only, except exports for the accountant', () => {
    expect(ROLE_PERMISSIONS.VIEWER.every((permission) => permission.endsWith('.read'))).toBe(true);
    expect(
      ROLE_PERMISSIONS.ACCOUNTANT.filter((permission) => !permission.endsWith('.read')),
    ).toEqual(['reports.export']);
  });

  it('only grants known permissions', () => {
    for (const permissions of Object.values(ROLE_PERMISSIONS)) {
      for (const permission of permissions) expect(PERMISSIONS).toContain(permission);
    }
  });
});
