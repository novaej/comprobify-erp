import {
  and,
  desc,
  EMAIL_LOCALES,
  EMAIL_TEMPLATES,
  eq,
  schema,
  type Database,
} from '@comprobify/db';
import { DEFAULT_COPY, type Copy } from './copy';
import type { EmailLocale, EmailTemplate } from './templates';

// FR-NOT-3 (ADR-037): which text an email is written from.

type Published = { locale: string; copy: Copy };

// The version in use for the language; else Spanish; else the text the platform started with.
export function pickCopy(
  published: Published[],
  template: EmailTemplate,
  locale: EmailLocale,
): Copy {
  return (
    published.find((row) => row.locale === locale)?.copy ??
    published.find((row) => row.locale === 'es')?.copy ??
    DEFAULT_COPY[locale][template]
  );
}

const copyOf = (row: Copy): Copy => ({
  subject: row.subject,
  heading: row.heading,
  body: row.body,
  button: row.button,
  footer: row.footer,
});

// The latest published version in each language, one read. Platform data is readable from any
// context; system context is how the worker reads it with no company in play.
export async function loadCopy(
  db: Database,
  template: EmailTemplate,
  locale: EmailLocale,
): Promise<Copy> {
  const { emailTemplates } = schema;
  const rows = await db.withSystem('email: load a template', ({ db: tx }) =>
    tx
      .select()
      .from(emailTemplates)
      .where(and(eq(emailTemplates.template, template), eq(emailTemplates.status, 'PUBLISHED')))
      .orderBy(desc(emailTemplates.version)),
  );
  // Newest first, so the first of each language is the one in use.
  return pickCopy(
    rows.map((row) => ({ locale: row.locale, copy: copyOf(row) })),
    template,
    locale,
  );
}

// The migrate step: today's texts as version 1 for every template and language that has none, so
// a new database sends what the code says until the super admin publishes something else.
export async function syncEmailTemplates(db: Database): Promise<string[]> {
  return db.withSystem('seed email templates', async ({ db: tx }) => {
    const { emailTemplates } = schema;
    const added: string[] = [];
    for (const template of EMAIL_TEMPLATES) {
      for (const locale of EMAIL_LOCALES) {
        const [any] = await tx
          .select({ id: emailTemplates.id })
          .from(emailTemplates)
          .where(and(eq(emailTemplates.template, template), eq(emailTemplates.locale, locale)))
          .limit(1);
        if (any) continue;
        await tx.insert(emailTemplates).values({
          template,
          locale,
          version: 1,
          status: 'PUBLISHED',
          publishedAt: new Date(),
          ...DEFAULT_COPY[locale][template],
        });
        added.push(`${template}/${locale}`);
      }
    }
    return added;
  });
}
