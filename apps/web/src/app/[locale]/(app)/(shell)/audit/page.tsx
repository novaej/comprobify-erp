import { listAuditEvents } from '@comprobify/core';
import { Card, CardContent } from '@comprobify/ui/components/card';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { NoAccess } from '@/components/no-access';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';

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
    return '';
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t('description')}</p>
      </div>
      <Card>
        <CardContent>
          {events.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <ul className="divide-y divide-border" aria-label={t('title')}>
              {events.map((event) => (
                <li
                  key={event.id}
                  className="flex flex-col gap-0.5 py-3 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
                >
                  <div className="min-w-0">
                    <p>
                      <span className="font-medium">{event.actorName ?? t('system')}</span>{' '}
                      {t(`actions.${event.action}`)}
                      {event.subjectName && (
                        <span className="font-medium"> {event.subjectName}</span>
                      )}
                      {detail(event.details) && (
                        <span className="text-muted-foreground"> · {detail(event.details)}</span>
                      )}
                    </p>
                  </div>
                  <time
                    dateTime={event.occurredAt.toISOString()}
                    className="shrink-0 text-xs text-muted-foreground"
                  >
                    {when.format(event.occurredAt)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
