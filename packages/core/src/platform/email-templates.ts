import {
  and,
  asc,
  desc,
  eq,
  EMAIL_LOCALES,
  EMAIL_TEMPLATES,
  max,
  schema,
  sql,
  type Database,
  type EmailLocaleKey,
  type EmailTemplateKey,
  type EmailTemplateStatus,
  type Tx,
} from '@comprobify/db';
import { z } from 'zod';
import { recordPlatformAudit } from '../audit';
import {
  copyInput,
  DEFAULT_COPY,
  emailLocale,
  emailTemplate,
  placeholderProblems,
  renderEmail,
  TEMPLATE_PLACEHOLDERS,
  type Copy,
} from '../email';
import { assertSuperAdmin } from '../identity';
import { DomainError, type PlatformActor } from '../kernel';
import type { NotifyDeps } from '../notifications';

// FR-NOT-3, FR-ADM-4 (ADR-037): the super admin edits the emails the platform writes. Companies
// never reach any of this: every function checks the flag, and the tables are platform data.

const key = z.object({ template: emailTemplate, locale: emailLocale });
const copyFields = key.extend(copyInput.shape);

export type EmailTemplateRef = z.input<typeof key>;

const copyOf = (row: Copy): Copy => ({
  subject: row.subject,
  heading: row.heading,
  body: row.body,
  button: row.button,
  footer: row.footer,
});

// A text may only ask for what its template can give, and must keep what it can't do without.
function requireValid(template: EmailTemplateKey, copy: Copy): void {
  const problems = placeholderProblems(template, copy);
  if (problems.unknown.length > 0)
    throw new DomainError(
      'EMAIL_TEMPLATE_PLACEHOLDER_UNKNOWN',
      'The text uses a placeholder this email lacks',
      {
        placeholders: problems.unknown,
      },
    );
  if (problems.missing.length > 0)
    throw new DomainError(
      'EMAIL_TEMPLATE_PLACEHOLDER_MISSING',
      'The text lacks a placeholder this email needs',
      {
        placeholders: problems.missing,
      },
    );
}

export type EmailTemplateSummary = {
  template: EmailTemplateKey;
  locales: {
    locale: EmailLocaleKey;
    // The version in use; null only if nothing was ever published (the migrate step seeds one).
    version: number | null;
    publishedAt: Date | null;
    hasDraft: boolean;
  }[];
};

export async function listEmailTemplates(
  actor: PlatformActor,
  db: Database,
): Promise<EmailTemplateSummary[]> {
  await assertSuperAdmin(db.identity, actor);
  return db.withSystem('super admin: list email templates', async ({ db: tx }) => {
    const rows = await tx.select().from(schema.emailTemplates);
    return EMAIL_TEMPLATES.map((template) => ({
      template,
      locales: EMAIL_LOCALES.map((locale) => {
        const mine = rows.filter((row) => row.template === template && row.locale === locale);
        const inUse = mine
          .filter((row) => row.status === 'PUBLISHED')
          .sort((a, b) => b.version - a.version)[0];
        return {
          locale,
          version: inUse?.version ?? null,
          publishedAt: inUse?.publishedAt ?? null,
          hasDraft: mine.some((row) => row.status === 'DRAFT'),
        };
      }),
    }));
  });
}

export type EmailTemplateDetail = {
  template: EmailTemplateKey;
  locale: EmailLocaleKey;
  placeholders: { allowed: readonly string[]; required: readonly string[] };
  current: (Copy & { version: number; publishedAt: Date | null }) | null;
  draft: (Copy & { version: number }) | null;
  versions: {
    version: number;
    status: EmailTemplateStatus;
    createdAt: Date;
    publishedAt: Date | null;
    author: string | null;
  }[];
};

export async function getEmailTemplate(
  actor: PlatformActor,
  db: Database,
  raw: EmailTemplateRef,
): Promise<EmailTemplateDetail> {
  await assertSuperAdmin(db.identity, actor);
  const { template, locale } = key.parse(raw);
  return db.withSystem('super admin: read an email template', async ({ db: tx }) => {
    const { emailTemplates, users } = schema;
    const rows = await tx
      .select({ row: emailTemplates, author: users.name })
      .from(emailTemplates)
      .leftJoin(users, eq(users.id, emailTemplates.createdBy))
      .where(and(eq(emailTemplates.template, template), eq(emailTemplates.locale, locale)))
      .orderBy(desc(emailTemplates.version));
    const inUse = rows.find((entry) => entry.row.status === 'PUBLISHED')?.row;
    const draft = rows.find((entry) => entry.row.status === 'DRAFT')?.row;
    return {
      template,
      locale,
      placeholders: TEMPLATE_PLACEHOLDERS[template],
      current: inUse
        ? { ...copyOf(inUse), version: inUse.version, publishedAt: inUse.publishedAt }
        : null,
      draft: draft ? { ...copyOf(draft), version: draft.version } : null,
      versions: rows.map(({ row, author }) => ({
        version: row.version,
        status: row.status,
        createdAt: row.createdAt,
        publishedAt: row.publishedAt,
        author,
      })),
    };
  });
}

// The draft of a template and language, replaced if there is one, else started as the next
// version (numbers are never reused, discarded drafts included).
async function saveDraft(
  tx: Tx['db'],
  actor: PlatformActor,
  ref: { template: EmailTemplateKey; locale: EmailLocaleKey },
  copy: Copy,
): Promise<number> {
  const { emailTemplates } = schema;
  const [draft] = await tx
    .select({ id: emailTemplates.id, version: emailTemplates.version })
    .from(emailTemplates)
    .where(
      and(
        eq(emailTemplates.template, ref.template),
        eq(emailTemplates.locale, ref.locale),
        eq(emailTemplates.status, 'DRAFT'),
      ),
    )
    .for('update');
  if (draft) {
    await tx.update(emailTemplates).set(copy).where(eq(emailTemplates.id, draft.id));
    return draft.version;
  }
  const [last] = await tx
    .select({ version: max(emailTemplates.version) })
    .from(emailTemplates)
    .where(and(eq(emailTemplates.template, ref.template), eq(emailTemplates.locale, ref.locale)));
  const version = (last?.version ?? 0) + 1;
  await tx
    .insert(emailTemplates)
    .values({ ...ref, ...copy, version, status: 'DRAFT', createdBy: actor.userId });
  return version;
}

export async function draftEmailTemplate(
  actor: PlatformActor,
  db: Database,
  raw: z.input<typeof copyFields>,
): Promise<void> {
  await assertSuperAdmin(db.identity, actor);
  const { template, locale, ...copy } = copyFields.parse(raw);
  requireValid(template, copy);
  await db.withSystem('super admin: save an email template draft', async ({ db: tx }) => {
    const version = await saveDraft(tx, actor, { template, locale }, copy);
    await recordPlatformAudit(tx, {
      actorUserId: actor.userId,
      action: 'email_template.drafted',
      details: { template, locale, version },
    });
  });
}

// Goes back to an older text without rewriting history: it becomes the draft, to publish as the
// next version.
export async function draftFromVersion(
  actor: PlatformActor,
  db: Database,
  raw: EmailTemplateRef & { version: number },
): Promise<void> {
  await assertSuperAdmin(db.identity, actor);
  const { template, locale } = key.parse(raw);
  const version = z.int().min(1).parse(raw.version);
  await db.withSystem('super admin: start a draft from a version', async ({ db: tx }) => {
    const { emailTemplates } = schema;
    const [from] = await tx
      .select()
      .from(emailTemplates)
      .where(
        and(
          eq(emailTemplates.template, template),
          eq(emailTemplates.locale, locale),
          eq(emailTemplates.version, version),
        ),
      );
    if (!from) throw new DomainError('NOT_FOUND', 'Email template version not found');
    const draftVersion = await saveDraft(tx, actor, { template, locale }, copyOf(from));
    await recordPlatformAudit(tx, {
      actorUserId: actor.userId,
      action: 'email_template.drafted',
      details: { template, locale, version: draftVersion, from: version },
    });
  });
}

export async function discardEmailTemplateDraft(
  actor: PlatformActor,
  db: Database,
  raw: EmailTemplateRef,
): Promise<void> {
  await assertSuperAdmin(db.identity, actor);
  const { template, locale } = key.parse(raw);
  await db.withSystem('super admin: discard an email template draft', async ({ db: tx }) => {
    const { emailTemplates } = schema;
    const discarded = await tx
      .update(emailTemplates)
      .set({ status: 'DISCARDED' })
      .where(
        and(
          eq(emailTemplates.template, template),
          eq(emailTemplates.locale, locale),
          eq(emailTemplates.status, 'DRAFT'),
        ),
      )
      .returning({ version: emailTemplates.version });
    if (discarded.length === 0)
      throw new DomainError('EMAIL_TEMPLATE_NO_DRAFT', 'There is no draft to discard');
    await recordPlatformAudit(tx, {
      actorUserId: actor.userId,
      action: 'email_template.discarded',
      details: { template, locale, version: discarded[0]!.version },
    });
  });
}

// The draft becomes the version in use, and is frozen. The next email is written from it.
export async function publishEmailTemplate(
  actor: PlatformActor,
  db: Database,
  raw: EmailTemplateRef,
): Promise<void> {
  await assertSuperAdmin(db.identity, actor);
  const { template, locale } = key.parse(raw);
  await db.withSystem('super admin: publish an email template', async ({ db: tx }) => {
    const { emailTemplates } = schema;
    const [draft] = await tx
      .select()
      .from(emailTemplates)
      .where(
        and(
          eq(emailTemplates.template, template),
          eq(emailTemplates.locale, locale),
          eq(emailTemplates.status, 'DRAFT'),
        ),
      )
      .for('update');
    if (!draft) throw new DomainError('EMAIL_TEMPLATE_NO_DRAFT', 'There is no draft to publish');
    requireValid(template, copyOf(draft));
    const [inUse] = await tx
      .select()
      .from(emailTemplates)
      .where(
        and(
          eq(emailTemplates.template, template),
          eq(emailTemplates.locale, locale),
          eq(emailTemplates.status, 'PUBLISHED'),
        ),
      )
      .orderBy(desc(emailTemplates.version))
      .limit(1);
    if (inUse && JSON.stringify(copyOf(inUse)) === JSON.stringify(copyOf(draft)))
      throw new DomainError('EMAIL_TEMPLATE_UNCHANGED', 'The draft is the version already in use');
    await tx
      .update(emailTemplates)
      .set({ status: 'PUBLISHED', publishedAt: sql`now()`, publishedBy: actor.userId })
      .where(eq(emailTemplates.id, draft.id));
    await recordPlatformAudit(tx, {
      actorUserId: actor.userId,
      action: 'email_template.published',
      details: { template, locale, version: draft.version },
    });
  });
}

// Made-up values, so a text can be read as the recipient would read it.
const SAMPLES: Record<EmailLocaleKey, Record<string, string>> = {
  es: {
    organization: 'Empresa de Ejemplo S.A.',
    date: '10 de diciembre de 2026',
    amount: '$11.39',
    rate: '15 %',
    reason: 'AMOUNT_MISMATCH',
    number: '001-001-000000123',
    count: '48',
  },
  en: {
    organization: 'Example Company S.A.',
    date: 'December 10, 2026',
    amount: '$11.39',
    rate: '15 %',
    reason: 'AMOUNT_MISMATCH',
    number: '001-001-000000123',
    count: '48',
  },
};

const sampleParams = (locale: EmailLocaleKey, url: string) => ({
  url,
  organization: SAMPLES[locale].organization!,
  date: SAMPLES[locale].date!,
  amount: SAMPLES[locale].amount!,
  rate: SAMPLES[locale].rate!,
  reason: SAMPLES[locale].reason!,
  number: SAMPLES[locale].number!,
  count: SAMPLES[locale].count!,
});

// What the text editor holds, saved or not: the draft, else the version in use, else the start.
async function workingCopy(
  tx: Tx['db'],
  template: EmailTemplateKey,
  locale: EmailLocaleKey,
): Promise<Copy> {
  const { emailTemplates } = schema;
  const rows = await tx
    .select()
    .from(emailTemplates)
    .where(and(eq(emailTemplates.template, template), eq(emailTemplates.locale, locale)))
    .orderBy(asc(emailTemplates.status), desc(emailTemplates.version));
  const row =
    rows.find((entry) => entry.status === 'DRAFT') ??
    rows.find((entry) => entry.status === 'PUBLISHED');
  return row ? copyOf(row) : DEFAULT_COPY[locale][template];
}

// The email as written, with sample values; nothing is saved or sent.
export async function previewEmailTemplate(
  actor: PlatformActor,
  db: Database,
  raw: z.input<typeof copyFields>,
): Promise<{ subject: string; html: string; text: string }> {
  await assertSuperAdmin(db.identity, actor);
  const { template, locale, ...copy } = copyFields.parse(raw);
  requireValid(template, copy);
  const message = renderEmail(
    template,
    locale,
    'preview@example.com',
    sampleParams(locale, `https://app.example.com/${locale}/plan`),
    copy,
  );
  return { subject: message.subject, html: message.html, text: message.text };
}

// The only address a test goes to is the super admin's own, never one typed in a form. It is an
// ordinary email.send job, so the provider's overrides apply to it like to any email (ADR-037).
export async function sendTestEmail(
  actor: PlatformActor,
  db: Database,
  raw: EmailTemplateRef & { copy?: Copy },
  deps: NotifyDeps,
): Promise<{ to: string }> {
  await assertSuperAdmin(db.identity, actor);
  const { template, locale } = key.parse(raw);
  const supplied = raw.copy ? copyInput.parse(raw.copy) : null;
  const [self] = await db.identity
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, actor.userId));
  if (!self) throw new DomainError('NOT_FOUND', 'The super admin has no email address');
  await db.withSystem('super admin: send a test email', async (txAll) => {
    const copy = supplied ?? (await workingCopy(txAll.db, template, locale));
    requireValid(template, copy);
    const mark = locale === 'en' ? '[Test] ' : '[Prueba] ';
    await deps.jobs.enqueue(txAll, 'email.send', {
      to: self.email,
      locale,
      template,
      params: sampleParams(locale, `${deps.appUrl}/${locale}/plan`),
      copy: { ...copy, subject: `${mark}${copy.subject}`.slice(0, 200) },
    });
    await recordPlatformAudit(txAll.db, {
      actorUserId: actor.userId,
      action: 'email_template.test_sent',
      details: { template, locale },
    });
  });
  return { to: self.email };
}
