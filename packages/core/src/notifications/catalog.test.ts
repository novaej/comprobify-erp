import { describe, expect, it } from 'vitest';
import { TEMPLATE_PLACEHOLDERS } from '../email';
import { NOTIFICATIONS } from './catalog';

// FR-NOT-1, FR-NOT-3 (ADR-036): what a type declares has to hold together.
describe('the notification catalogue', () => {
  it('gives every type with the email channel a template, and none to the others', () => {
    for (const [type, spec] of Object.entries(NOTIFICATIONS)) {
      expect(spec.emailTemplate !== null, type).toBe(spec.channels.includes('EMAIL'));
      if (spec.emailTemplate)
        expect(TEMPLATE_PLACEHOLDERS, type).toHaveProperty(spec.emailTemplate);
    }
  });

  it('turns on by default only what a type can do, and all of what is mandatory', () => {
    for (const [type, spec] of Object.entries(NOTIFICATIONS)) {
      for (const channel of spec.defaults) expect(spec.channels, type).toContain(channel);
      if (spec.mandatory)
        expect([...spec.defaults].sort(), type).toEqual([...spec.channels].sort());
    }
  });
});
