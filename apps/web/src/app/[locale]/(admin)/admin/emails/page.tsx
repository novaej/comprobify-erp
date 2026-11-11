import { listEmailTemplates } from '@comprobify/core';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PageHeader } from '@/components/page-header';
import {
  StackBody,
  StackCell,
  StackHead,
  StackHeader,
  StackRow,
  StackTable,
  TableCard,
} from '@/components/stack-table';
import { ToneBadge } from '@/components/tone-badge';
import { Link } from '@/i18n/navigation';
import { pageTitle } from '@/server/page-title';
import { loadPlatform } from '@/server/platform';
import { getRuntime } from '@/server/runtime';

export const generateMetadata = pageTitle('adminEmails');

// FR-NOT-3, FR-ADM-4 (ADR-037): the emails the platform writes, by language, with the version in
// use. Each opens its editor.
export default async function AdminEmailsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { actor } = await loadPlatform(locale);
  const { db } = await getRuntime();
  const templates = await listEmailTemplates(actor, db);
  const t = await getTranslations('adminEmails');
  const tTemplates = await getTranslations('adminEmails.templates');
  const when = new Intl.DateTimeFormat(locale === 'en' ? 'en' : 'es-EC', {
    dateStyle: 'medium',
    timeZone: 'America/Guayaquil',
  });

  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader title={t('title')} description={t('description')} className="mb-2" />
      <TableCard>
        <StackTable aria-label={t('title')}>
          <StackHeader>
            <StackRow className="bg-muted/40">
              <StackHead className="pl-4">{t('table.email')}</StackHead>
              <StackHead>{t('languages.es')}</StackHead>
              <StackHead>{t('languages.en')}</StackHead>
            </StackRow>
          </StackHeader>
          <StackBody>
            {templates.map((entry) => (
              <StackRow key={entry.template}>
                <StackCell heading className="pl-4">
                  <span className="font-medium">{tTemplates(`${entry.template}.name`)}</span>
                  <p className="text-xs text-muted-foreground">
                    {tTemplates(`${entry.template}.use`)}
                  </p>
                </StackCell>
                {entry.locales.map((entryLocale) => (
                  <StackCell key={entryLocale.locale} label={t(`languages.${entryLocale.locale}`)}>
                    <Link
                      href={`/admin/emails/${entry.template}/${entryLocale.locale}`}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {entryLocale.version ? t('version', { version: entryLocale.version }) : '—'}
                      <span className="sr-only">
                        {' · '}
                        {t('edit', {
                          email: tTemplates(`${entry.template}.name`),
                          language: t(`languages.${entryLocale.locale}`),
                        })}
                      </span>
                    </Link>
                    {entryLocale.publishedAt && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {when.format(entryLocale.publishedAt)}
                      </span>
                    )}
                    {entryLocale.hasDraft && (
                      <span className="ml-2">
                        <ToneBadge tone="warning">{t('draft')}</ToneBadge>
                      </span>
                    )}
                  </StackCell>
                ))}
              </StackRow>
            ))}
          </StackBody>
        </StackTable>
      </TableCard>
    </div>
  );
}
