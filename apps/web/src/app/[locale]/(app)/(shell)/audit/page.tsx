import { listAuditEvents } from '@comprobify/core';
import { ScrollText } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { NoAccess } from '@/components/no-access';
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
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';
import { pageTitle } from '@/server/page-title';

export const generateMetadata = pageTitle('activity');

// FR-NOT-4: who did what, when, in this company. Times in Ecuador (CLAUDE.md rule 15).
export default async function AuditPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  if (!actor.permissions.includes('audit.read')) return <NoAccess />;

  const { db } = await getRuntime();
  const events = await listAuditEvents(actor, db, { limit: 200 });
  const t = await getTranslations('audit');
  const tRoles = await getTranslations('roles');
  const english = locale === 'en';
  const when = new Intl.DateTimeFormat(locale === 'en' ? 'en' : 'es-EC', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Guayaquil',
  });
  // Only these detail fields are shown; anything else stays in the database.
  const detail = (details: Record<string, unknown>) => {
    if (typeof details.email === 'string') return details.email;
    if (typeof details.role === 'string') return tRoles(details.role as 'VIEWER');
    if (Array.isArray(details.points))
      return details.points.length ? details.points.join(', ') : t('allPoints');
    if (typeof details.required === 'boolean') return details.required ? t('on') : t('off');
    if (typeof details.issuerName === 'string') return details.issuerName;
    // Names were stored with the change, so a later rename doesn't rewrite history.
    if (typeof details.planEs === 'string')
      return String(english ? details.planEn : details.planEs);
    if (typeof details.moduleEs === 'string')
      return String(english ? details.moduleEn : details.moduleEs);
    if (typeof details.billing === 'string')
      return details.billing === 'COMPLIMENTARY' ? t('complimentary') : t('paid');
    if (typeof details.feature === 'string') return details.feature;
    if (typeof details.monthlyPrice === 'string') return `$${details.monthlyPrice}`;
    if ('monthlyPrice' in details) return '—';
    return '';
  };

  return (
    <div className="max-w-5xl">
      <PageHeader title={t('title')} description={t('description')} />
      <TableCard>
        {events.length === 0 ? (
          <EmptyState icon={ScrollText} title={t('empty')} description={t('emptyHint')} />
        ) : (
          <StackTable aria-label={t('title')}>
            <StackHeader>
              <StackRow className="bg-muted/40">
                <StackHead className="pl-4">{t('table.what')}</StackHead>
                <StackHead className="pr-4 text-right">{t('table.when')}</StackHead>
              </StackRow>
            </StackHeader>
            <StackBody>
              {events.map((event) => (
                <StackRow key={event.id}>
                  <StackCell heading className="pl-4 whitespace-normal">
                    <span className="font-medium">{event.actorName ?? t('system')}</span>{' '}
                    {t(`actions.${event.action}`)}
                    {event.subjectName && <span className="font-medium"> {event.subjectName}</span>}
                    {detail(event.details) && (
                      <span className="text-muted-foreground">: {detail(event.details)}</span>
                    )}
                  </StackCell>
                  <StackCell
                    label={t('table.when')}
                    className="pr-4 text-right whitespace-nowrap text-muted-foreground"
                  >
                    <time dateTime={event.occurredAt.toISOString()}>
                      {when.format(event.occurredAt)}
                    </time>
                  </StackCell>
                </StackRow>
              ))}
            </StackBody>
          </StackTable>
        )}
      </TableCard>
    </div>
  );
}
