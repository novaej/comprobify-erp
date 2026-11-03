import { agreementStatus } from '@comprobify/core';
import { Badge } from '@comprobify/ui/components/badge';
import { Card, CardContent } from '@comprobify/ui/components/card';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';
import { AcceptAgreementsForm } from './accept-form';

const SLUGS = { TERMS: 'terms', PRIVACY: 'privacy', DPA: 'dpa' } as const;

// FR-ONB-8: every member can read the company's texts; only the owner accepts them.
export default async function LegalPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { actor } = await loadShell(locale);
  const { db, agreementParties } = await getRuntime();
  const t = await getTranslations('legal');

  if (!agreementParties) {
    return (
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t('underReview')}</p>
      </div>
    );
  }

  const status = await agreementStatus(actor, db);
  const pending = status.some((row) => !row.accepted);
  const when = new Intl.DateTimeFormat(locale === 'en' ? 'en' : 'es-EC', {
    dateStyle: 'medium',
    timeZone: 'America/Guayaquil',
  });

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t('description')}</p>
      </div>
      <Card>
        <CardContent>
          <ul className="divide-y divide-border" aria-label={t('title')}>
            {status.map((row) => (
              <li key={row.type} className="flex items-center justify-between gap-3 py-3 text-sm">
                <Link
                  href={`/legal/${SLUGS[row.type]}`}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {t(`types.${row.type}`)} · v{row.version}
                </Link>
                {row.accepted && row.acceptedAt ? (
                  <Badge variant="secondary">
                    {t('acceptedOn', { date: when.format(row.acceptedAt) })}
                  </Badge>
                ) : (
                  <Badge variant="outline">{t('pending')}</Badge>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      {pending &&
        (actor.permissions.includes('organization.accept_agreements') ? (
          <AcceptAgreementsForm />
        ) : (
          <p className="text-sm text-muted-foreground">{t('ownerAccepts')}</p>
        ))}
    </div>
  );
}
