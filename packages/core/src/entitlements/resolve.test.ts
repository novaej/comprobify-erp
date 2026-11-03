import { describe, expect, it } from 'vitest';
import { resolveEntitlements, type EntitlementSources, type ModuleSource } from './resolve';

const periodStart = new Date('2026-11-01T05:00:00Z');
const module = (keys: string[], extra: Partial<ModuleSource> = {}): ModuleSource => ({
  status: 'AVAILABLE',
  removesAt: null,
  features: keys.map((key) => ({ key, removesAt: null })),
  ...extra,
});
const sources = (extra: Partial<EntitlementSources> = {}): EntitlementSources => ({
  planModules: [module(['DOC_TYPE_01', 'CLIENTS'])],
  itemModules: [],
  planLimits: { USERS: 1, DOCUMENT_QUOTA: 5 },
  itemLimits: {},
  overrides: [],
  ...extra,
});

// ADR-011: override, then subscription items, then the plan, then off.
describe('resolveEntitlements', () => {
  it('takes the plan when nothing else applies', () => {
    expect(resolveEntitlements(sources(), periodStart)).toEqual({
      features: ['CLIENTS', 'DOC_TYPE_01'],
      limits: { USERS: 1, DOCUMENT_QUOTA: 5 },
    });
  });

  it('adds item modules as a union, and lets item limits replace the plan', () => {
    const result = resolveEntitlements(
      sources({
        itemModules: [module(['INVENTORY', 'CLIENTS'])],
        itemLimits: { USERS: 8 },
      }),
      periodStart,
    );
    expect(result.features).toEqual(['CLIENTS', 'DOC_TYPE_01', 'INVENTORY']);
    expect(result.limits).toEqual({ USERS: 8, DOCUMENT_QUOTA: 5 });
  });

  it('lets overrides win over items and plan, in both directions', () => {
    const result = resolveEntitlements(
      sources({
        itemModules: [module(['INVENTORY'])],
        itemLimits: { USERS: 8 },
        overrides: [
          { key: 'INVENTORY', effect: 'REVOKE', limitValue: null },
          { key: 'RIDE_LOGO', effect: 'GRANT', limitValue: null },
          { key: 'USERS', effect: 'LIMIT', limitValue: null },
        ],
      }),
      periodStart,
    );
    expect(result.features).toEqual(['CLIENTS', 'DOC_TYPE_01', 'RIDE_LOGO']);
    expect(result.limits.USERS).toBeNull();
  });

  it('grants nothing from a coming-soon module', () => {
    const result = resolveEntitlements(
      sources({
        planModules: [module(['DOC_TYPE_01']), module(['DOC_TYPE_06'], { status: 'COMING_SOON' })],
      }),
      periodStart,
    );
    expect(result.features).toEqual(['DOC_TYPE_01']);
  });

  it('keeps a removed module or key until the first period start after the removal', () => {
    const removed = (removesAt: string) =>
      resolveEntitlements(
        sources({
          planModules: [
            module(['DOC_TYPE_01']),
            module(['INVENTORY'], { removesAt: new Date(removesAt) }),
            {
              ...module(['SALE_ORDERS']),
              features: [{ key: 'SALE_ORDERS', removesAt: new Date(removesAt) }],
            },
          ],
        }),
        periodStart,
      ).features;
    // Removed mid-period: still there until the next period begins.
    expect(removed('2026-11-15T00:00:00Z')).toEqual(['DOC_TYPE_01', 'INVENTORY', 'SALE_ORDERS']);
    // Removed before this period began: gone.
    expect(removed('2026-10-20T00:00:00Z')).toEqual(['DOC_TYPE_01']);
  });
});
