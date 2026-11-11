import { describe, expect, it } from 'vitest';
import { DEFAULT_COPY, copyInput, placeholderProblems, TEMPLATE_PLACEHOLDERS } from './copy';
import { sendEmailPayload } from './index';
import { pickCopy } from './store';
import { emailTemplate, renderEmail } from './templates';

// FR-NOT-3 (ADR-037).
describe('the starting texts', () => {
  it('give every template a text in both languages that satisfies its own placeholder rules', () => {
    for (const template of emailTemplate.options) {
      expect(Object.keys(TEMPLATE_PLACEHOLDERS)).toContain(template);
      for (const locale of ['es', 'en'] as const) {
        const copy = DEFAULT_COPY[locale][template];
        expect(copyInput.safeParse(copy).success).toBe(true);
        expect(placeholderProblems(template, copy)).toEqual({ unknown: [], missing: [] });
      }
    }
  });
});

describe('placeholders', () => {
  const base = { ...DEFAULT_COPY.es.paymentVerified };

  it('refuses one the template cannot fill, in any field', () => {
    expect(placeholderProblems('paymentVerified', { ...base, footer: 'Fecha {date}' })).toEqual({
      unknown: ['date'],
      missing: [],
    });
    expect(
      placeholderProblems('verifyEmail', {
        ...DEFAULT_COPY.es.verifyEmail,
        subject: '{organization}',
      }).unknown,
    ).toEqual(['organization']);
  });

  it('refuses a text that drops what the email cannot do without', () => {
    expect(placeholderProblems('paymentVerified', { ...base, body: 'Recibimos tu pago.' })).toEqual(
      { unknown: [], missing: ['amount'] },
    );
    // Anywhere in the text counts, the subject included.
    expect(
      placeholderProblems('paymentVerified', {
        ...base,
        subject: 'Pago de {amount}',
        body: 'Gracias.',
      }).missing,
    ).toEqual([]);
  });
});

describe('which text is used', () => {
  const es = { ...DEFAULT_COPY.es.pastDue, heading: 'Publicado en español' };
  const en = { ...DEFAULT_COPY.en.pastDue, heading: 'Published in English' };

  it('prefers the language, then Spanish, then the starting text', () => {
    expect(
      pickCopy(
        [
          { locale: 'en', copy: en },
          { locale: 'es', copy: es },
        ],
        'pastDue',
        'en',
      ),
    ).toBe(en);
    expect(pickCopy([{ locale: 'es', copy: es }], 'pastDue', 'en')).toBe(es);
    expect(pickCopy([], 'pastDue', 'en')).toBe(DEFAULT_COPY.en.pastDue);
  });
});

describe('rendering a given text', () => {
  const params = {
    url: 'https://app.test/es/plan',
    organization: 'Alfa <b>S.A.</b>',
    amount: '$5.00',
  };

  it('writes the supplied copy, escaping what it fills in', () => {
    const message = renderEmail('paymentVerified', 'es', 'a@example.com', params, {
      subject: 'Pago de {amount} en {organization}',
      heading: 'Gracias',
      body: 'Recibimos {amount}.',
      button: 'Ver',
      footer: 'Hasta pronto',
    });
    expect(message.subject).toBe('Pago de $5.00 en Alfa <b>S.A.</b>');
    expect(message.html).toContain('<p>Recibimos $5.00.</p>');
    expect(message.html).not.toContain('<b>');
    expect(message.text).toBe(
      'Gracias\n\nRecibimos $5.00.\n\nhttps://app.test/es/plan\n\nHasta pronto',
    );
  });

  it('leaves out an empty footer', () => {
    const message = renderEmail(
      'verifyEmail',
      'es',
      'a@example.com',
      { url: 'https://app.test/x' },
      {
        ...DEFAULT_COPY.es.verifyEmail,
        footer: '',
      },
    );
    expect(message.text.endsWith('https://app.test/x')).toBe(true);
    expect(message.html).not.toContain('font-size:12px');
  });
});

// The queue parses a job's payload, and a schema drops what it doesn't list: every word a template
// may use must survive it, or the email goes out with a blank.
describe('the email job payload', () => {
  it('keeps every parameter a template allows', () => {
    for (const template of emailTemplate.options) {
      const params = Object.fromEntries(
        TEMPLATE_PLACEHOLDERS[template].allowed.map((name) => [name, '1']),
      );
      const parsed = sendEmailPayload.parse({
        to: 'a@example.com',
        locale: 'es',
        template,
        params: { url: 'https://app.test/es', ...params },
      });
      expect(parsed.params, template).toEqual({ url: 'https://app.test/es', ...params });
    }
  });
});
