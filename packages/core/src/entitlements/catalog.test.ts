import { describe, expect, it } from 'vitest';
import { STARTING_MODULES, STARTING_PLANS } from './catalog';
import { FEATURES } from './features';

// ADR-011: the starting catalog keeps the rules the admin editor will enforce.
describe('starting catalog', () => {
  const base = STARTING_MODULES.filter((module) => 'isBase' in module);

  it('has exactly one base module, and every plan contains it', () => {
    expect(base.map((module) => module.key)).toEqual(['INVOICING']);
    for (const plan of STARTING_PLANS) expect(plan.modules).toContain('INVOICING');
  });

  it('uses unique keys', () => {
    const modules = STARTING_MODULES.map((module) => module.key);
    const plans = STARTING_PLANS.map((plan) => plan.key);
    expect(new Set(modules).size).toBe(modules.length);
    expect(new Set(plans).size).toBe(plans.length);
  });

  it('puts only boolean keys in modules and only limit keys in plan limits', () => {
    for (const module of STARTING_MODULES)
      for (const key of module.features) expect(FEATURES[key]).toBe('BOOLEAN');
    for (const plan of STARTING_PLANS)
      for (const key of Object.keys(plan.limits))
        expect(FEATURES[key as keyof typeof FEATURES]).toBe('LIMIT');
  });

  it('lets a key sit in several modules, as PROVIDERS does', () => {
    const withProviders = STARTING_MODULES.filter((module) =>
      (module.features as readonly string[]).includes('PROVIDERS'),
    );
    expect(withProviders.map((module) => module.key)).toEqual([
      'PURCHASING',
      'WITHHOLDINGS',
      'PURCHASE_SETTLEMENTS',
      'RECEIVED_DOCUMENTS',
    ]);
  });

  it('keeps plans built on a coming-soon module as drafts, except where it rides along', () => {
    const comingSoon = new Set<string>(
      STARTING_MODULES.filter((module) => module.status === 'COMING_SOON').map(
        (module) => module.key,
      ),
    );
    const published = STARTING_PLANS.filter((plan) => plan.status === 'PUBLISHED');
    // Empresa lists guías de remisión, which reach it once they ship.
    expect(
      published
        .filter((plan) => plan.modules.some((key) => comingSoon.has(key)))
        .map((plan) => plan.key),
    ).toEqual(['ENTERPRISE']);
    expect(
      STARTING_PLANS.filter((plan) => plan.modules.includes('API_INTEGRATION')).every(
        (plan) => plan.status === 'DRAFT',
      ),
    ).toBe(true);
  });
});
