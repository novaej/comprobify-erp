import { randomUUID } from 'node:crypto';
import {
  DEFAULT_COPY,
  discardEmailTemplateDraft,
  draftEmailTemplate,
  draftFromVersion,
  fixedClock,
  getEmailTemplate,
  listEmailTemplates,
  loadCopy,
  previewEmailTemplate,
  publishEmailTemplate,
  sendEmailHandler,
  sendTestEmail,
  syncEmailTemplates,
  type EmailMessage,
  type PlatformActor,
} from '@comprobify/core';
import { emailTemplateStatusTriggerBody } from '@comprobify/db';
import { eq, schema, type Database } from '@comprobify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDatabase, superAdmin } from './helpers';

// FR-NOT-3 (ADR-037): the platform's email templates, their versions, and what a sent email is
// written from. Only movedToFree in English is edited, and put back at the end.
describe('email templates', () => {
  const clock = fixedClock('2026-11-10T15:00:00Z');
  let db: Database;
  let operator: PlatformActor;
  let operatorEmail: string;
  const sql = (text: string, values: unknown[] = []) =>
    db.withSystem('test: email templates', ({ executeSql }) => executeSql(text, values));
  const ref = { template: 'movedToFree', locale: 'en' } as const;
  const edited = {
    ...DEFAULT_COPY.en.movedToFree,
    heading: 'You are on the Free plan now',
    body: 'Since {date} {organization} is on the Free plan.',
  };
  const failure = async (action: Promise<unknown>) => {
    try {
      await action;
    } catch (error) {
      return (error as { code?: string; name?: string }).code ?? (error as Error).name;
    }
    return 'it did not fail';
  };
  const sent: { to: string; copy?: { subject: string; heading: string } }[] = [];
  const deps = {
    appUrl: 'https://app.test',
    jobs: {
      enqueue: (_tx: unknown, _queue: string, data: unknown) => {
        sent.push(data as (typeof sent)[number]);
        return Promise.resolve(null);
      },
    },
  };

  beforeAll(async () => {
    db = appDatabase();
    operator = { ...(await superAdmin(db)), clock };
    const [user] = await db.identity
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, operator.userId));
    operatorEmail = user!.email;
  });

  afterAll(async () => {
    // Back to the starting text, as a new version, for the tests that follow.
    const detail = await getEmailTemplate(operator, db, ref);
    if (detail.current?.heading !== DEFAULT_COPY.en.movedToFree.heading) {
      await draftFromVersion(operator, db, { ...ref, version: 1 });
      await publishEmailTemplate(operator, db, ref);
    }
    await db.close();
  });

  it('keeps the database to the rules, and starts every template at version 1', async () => {
    const { rows } = await sql(
      `SELECT prosrc FROM pg_proc WHERE proname = 'app_email_template_status_check'`,
    );
    expect((rows[0] as { prosrc: string }).prosrc).toContain(emailTemplateStatusTriggerBody());
    const summary = await listEmailTemplates(operator, db);
    expect(summary).toHaveLength(11);
    for (const entry of summary)
      for (const locale of entry.locales) expect(locale.version).toBeGreaterThanOrEqual(1);
    // Safe to run again.
    await expect(syncEmailTemplates(db)).resolves.toEqual([]);

    // A published version is history; a second draft is refused; no company can write here.
    await expect(
      sql(`UPDATE email_templates SET body = 'x' WHERE status = 'PUBLISHED'`),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      sql(
        `INSERT INTO email_templates (template, locale, version, status, subject, heading, body, button, footer)
         VALUES ('pastDue', 'es', 900, 'DRAFT', 'a', 'b', 'c', 'd', ''),
                ('pastDue', 'es', 901, 'DRAFT', 'a', 'b', 'c', 'd', '')`,
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      db.withTenant({ tenantId: randomUUID() }, ({ executeSql }) =>
        executeSql(`UPDATE email_templates SET subject = 'x' WHERE status = 'DRAFT'`),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('is the super admin’s alone', async () => {
    const [user] = await db.identity
      .insert(schema.users)
      .values({ name: 'Dueña', email: `et.${randomUUID()}@example.com`, emailVerified: true })
      .returning({ id: schema.users.id });
    const notOperator = { userId: user!.id, isSuperAdmin: true as const, clock };
    expect(await failure(listEmailTemplates(notOperator, db))).toBe('FORBIDDEN');
    expect(await failure(draftEmailTemplate(notOperator, db, { ...ref, ...edited }))).toBe(
      'FORBIDDEN',
    );
    expect(await failure(sendTestEmail(notOperator, db, ref, deps))).toBe('FORBIDDEN');
  });

  it('refuses a text that asks for what the email cannot fill or drops what it needs', async () => {
    expect(
      await failure(
        draftEmailTemplate(operator, db, { ...ref, ...edited, footer: 'Amount {amount}' }),
      ),
    ).toBe('EMAIL_TEMPLATE_PLACEHOLDER_UNKNOWN');
    expect(
      await failure(
        draftEmailTemplate(operator, db, { ...ref, ...edited, body: 'On the Free plan.' }),
      ),
    ).toBe('EMAIL_TEMPLATE_PLACEHOLDER_MISSING');
    // One line for a subject, and nothing blank.
    expect(
      await failure(
        draftEmailTemplate(operator, db, { ...ref, ...edited, subject: 'a\nb {date}' }),
      ),
    ).toBe('ZodError');
    expect(await failure(publishEmailTemplate(operator, db, ref))).toBe('EMAIL_TEMPLATE_NO_DRAFT');
  });

  it('drafts, previews and tests a text, then publishes it as the next version', async () => {
    await draftEmailTemplate(operator, db, { ...ref, ...edited });
    let detail = await getEmailTemplate(operator, db, ref);
    expect(detail.current).toMatchObject({
      version: 1,
      heading: DEFAULT_COPY.en.movedToFree.heading,
    });
    expect(detail.draft).toMatchObject({ version: 2, heading: edited.heading });
    // Saving again edits the same draft.
    await draftEmailTemplate(operator, db, { ...ref, ...edited, button: 'See the plans now' });
    detail = await getEmailTemplate(operator, db, ref);
    expect(detail.draft).toMatchObject({ version: 2, button: 'See the plans now' });
    expect(
      (await listEmailTemplates(operator, db)).find((row) => row.template === 'movedToFree')!
        .locales,
    ).toMatchObject([
      { locale: 'es', hasDraft: false },
      { locale: 'en', version: 1, hasDraft: true },
    ]);

    // Preview: the text with sample values, nothing sent.
    const preview = await previewEmailTemplate(operator, db, { ...ref, ...edited });
    expect(preview.subject).toContain('Example Company S.A.');
    expect(preview.html).toContain(
      'Since December 10, 2026 Example Company S.A. is on the Free plan.',
    );
    expect(sent).toHaveLength(0);

    // The test goes to the super admin only, marked, written from the draft.
    await expect(sendTestEmail(operator, db, ref, deps)).resolves.toEqual({ to: operatorEmail });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: operatorEmail,
      copy: { heading: edited.heading },
    });
    expect(sent[0]!.copy!.subject.startsWith('[Test] ')).toBe(true);

    // Not published yet: the worker still writes the version in use.
    await expect(loadCopy(db, ref.template, ref.locale)).resolves.toMatchObject({
      heading: DEFAULT_COPY.en.movedToFree.heading,
    });
    await publishEmailTemplate(operator, db, ref);
    detail = await getEmailTemplate(operator, db, ref);
    expect(detail.current).toMatchObject({ version: 2, heading: edited.heading });
    expect(detail.draft).toBeNull();
    expect(detail.versions.map((row) => [row.version, row.status])).toEqual([
      [2, 'PUBLISHED'],
      [1, 'PUBLISHED'],
    ]);
  });

  it('writes the next email from what was published, and a test from its own text', async () => {
    const messages: EmailMessage[] = [];
    const handler = sendEmailHandler(
      {
        send: (message) => {
          messages.push(message);
          return Promise.resolve('sent');
        },
      },
      (template, locale) => loadCopy(db, template, locale),
    );
    const job = {
      to: 'payer@example.com',
      locale: 'en' as const,
      template: 'movedToFree' as const,
      params: { url: 'https://app.test/en/plan', organization: 'Acme', date: 'December 10, 2026' },
    };
    await handler({ data: job });
    expect(messages[0]!.html).toContain('You are on the Free plan now');
    expect(messages[0]!.html).toContain('Since December 10, 2026 Acme is on the Free plan.');
    // Spanish is its own text, untouched.
    await handler({ data: { ...job, locale: 'es' } });
    expect(messages[1]!.html).toContain('Acme está en el plan Gratis');
    // A test carries its own text and is written from it.
    await handler({
      data: {
        ...job,
        copy: {
          ...DEFAULT_COPY.en.movedToFree,
          heading: 'Only a test',
          subject: '[Test] {organization}',
        },
      },
    });
    expect(messages[2]!.html).toContain('Only a test');
    expect(messages[2]!.subject).toBe('[Test] Acme');
  });

  it('never reuses a version number, and goes back by publishing an old text as a new version', async () => {
    expect(await failure(publishEmailTemplate(operator, db, ref))).toBe('EMAIL_TEMPLATE_NO_DRAFT');
    await draftEmailTemplate(operator, db, { ...ref, ...edited, heading: 'A third idea' });
    await discardEmailTemplateDraft(operator, db, ref);
    expect(await failure(discardEmailTemplateDraft(operator, db, ref))).toBe(
      'EMAIL_TEMPLATE_NO_DRAFT',
    );
    // The discarded draft was version 3; the next is 4.
    await draftFromVersion(operator, db, { ...ref, version: 1 });
    const detail = await getEmailTemplate(operator, db, ref);
    expect(detail.draft).toMatchObject({
      version: 4,
      heading: DEFAULT_COPY.en.movedToFree.heading,
    });
    expect(detail.versions.find((row) => row.version === 3)!.status).toBe('DISCARDED');
    // A draft equal to what is in use isn't a new version.
    await draftEmailTemplate(operator, db, { ...ref, ...edited, button: 'See the plans now' });
    expect(await failure(publishEmailTemplate(operator, db, ref))).toBe('EMAIL_TEMPLATE_UNCHANGED');
    await draftFromVersion(operator, db, { ...ref, version: 1 });
    await publishEmailTemplate(operator, db, ref);
    await expect(loadCopy(db, ref.template, ref.locale)).resolves.toMatchObject({
      heading: DEFAULT_COPY.en.movedToFree.heading,
    });
    const { rows } = await sql(
      `SELECT action FROM platform_audit_events WHERE action LIKE 'email_template.%' AND details->>'template' = 'movedToFree'`,
    );
    const actions = rows.map((row) => (row as { action: string }).action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'email_template.drafted',
        'email_template.published',
        'email_template.discarded',
        'email_template.test_sent',
      ]),
    );
  });
});
