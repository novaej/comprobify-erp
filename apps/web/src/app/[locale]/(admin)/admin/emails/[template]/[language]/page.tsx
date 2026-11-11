import { getEmailTemplate, type EmailTemplateRef } from '@comprobify/core';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PageHeader } from '@/components/page-header';
import { pageTitle } from '@/server/page-title';
import { loadPlatform } from '@/server/platform';
import { getRuntime } from '@/server/runtime';
import { EmailEditor } from './email-editor';

export const generateMetadata = pageTitle('adminEmail');

// FR-NOT-3, FR-ADM-4 (ADR-037): one email in one language: its text, a preview, a test to the
// super admin, publishing, and every version it has had.
export default async function AdminEmailPage({
  params,
}: {
  params: Promise<{ locale: string; template: string; language: string }>;
}) {
  const { locale, template, language } = await params;
  setRequestLocale(locale);
  const { actor } = await loadPlatform(locale);
  const { db } = await getRuntime();
  const detail = await getEmailTemplate(actor, db, {
    template,
    locale: language,
  } as EmailTemplateRef).catch((error: unknown) => {
    if (error instanceof Error && error.name === 'ZodError') notFound();
    throw error;
  });
  const t = await getTranslations('adminEmails');
  const tTemplates = await getTranslations('adminEmails.templates');
  const tNav = await getTranslations('adminNav');
  const when = new Intl.DateTimeFormat(locale === 'en' ? 'en' : 'es-EC', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Guayaquil',
  });
  const saved = detail.draft ?? detail.current;

  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader
        title={tTemplates(`${detail.template}.name`)}
        description={`${t('languages.' + detail.locale)} · ${tTemplates(`${detail.template}.use`)}`}
        backHref="/admin/emails"
        backLabel={tNav('emails')}
        className="mb-2"
      />
      <EmailEditor
        template={detail.template}
        language={detail.locale}
        placeholders={{
          allowed: [...detail.placeholders.allowed],
          required: [...detail.placeholders.required],
        }}
        initial={{
          subject: saved?.subject ?? '',
          heading: saved?.heading ?? '',
          body: saved?.body ?? '',
          button: saved?.button ?? '',
          footer: saved?.footer ?? '',
        }}
        draftVersion={detail.draft?.version ?? null}
        inUseVersion={detail.current?.version ?? null}
        versions={detail.versions.map((row) => ({
          version: row.version,
          status: row.status,
          when: when.format(row.publishedAt ?? row.createdAt),
          author: row.author,
        }))}
      />
    </div>
  );
}
