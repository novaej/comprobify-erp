import {
  ecuadorDate,
  ivaRates,
  priceBook,
  systemClock,
  YEARLY_MONTHS,
  type PriceLine,
} from '@comprobify/core';
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
import { pageTitle } from '@/server/page-title';
import { loadPlatform } from '@/server/platform';
import { getRuntime } from '@/server/runtime';
import { ScheduleIvaButton, WithdrawIvaButton } from './iva-actions';
import {
  DiscardPriceButton,
  DraftPriceButton,
  NewPackButton,
  PublishPriceButton,
} from './price-actions';

export const generateMetadata = pageTitle('adminPrices');

const GROUPS: { kind: PriceLine['kind']; title: 'plans' | 'modules' | 'seat' | 'packs' }[] = [
  { kind: 'PLAN', title: 'plans' },
  { kind: 'MODULE', title: 'modules' },
  { kind: 'SEAT', title: 'seat' },
  { kind: 'PACK', title: 'packs' },
];

// FR-BILL-6 (ADR-027): what everything costs, what is announced and what is being drafted.
export default async function AdminPricesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { actor } = await loadPlatform(locale);
  const { db } = await getRuntime();
  const [book, rates] = await Promise.all([priceBook(actor, db), ivaRates(actor, db)]);
  const t = await getTranslations('prices');
  const english = locale === 'en';
  const money = new Intl.NumberFormat(english ? 'en' : 'es-EC', {
    style: 'currency',
    currency: 'USD',
  });
  const show = (amount: string) => money.format(amount as Intl.StringNumericLiteral);
  const date = (iso: string) => iso.split('-').reverse().join('/');
  const today = ecuadorDate(systemClock.now());
  const priceText = (line: PriceLine, amount: string | null) =>
    amount === null
      ? t('withdrawn')
      : line.kind === 'PACK'
        ? show(amount)
        : t('monthly', {
            amount: show(amount),
            yearly: show((Number(amount) * YEARLY_MONTHS).toFixed(2)),
          });

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader title={t('title')} description={t('description')} className="mb-0" />
      <section aria-labelledby="prices-iva" className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 id="prices-iva" className="text-sm font-semibold">
              {t('iva.title')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('iva.description')}</p>
          </div>
          <ScheduleIvaButton today={today} />
        </div>
        <TableCard>
          <StackTable aria-label={t('iva.title')}>
            <StackHeader>
              <StackRow className="bg-muted/40">
                <StackHead className="pl-4">{t('iva.rate')}</StackHead>
                <StackHead>{t('iva.effectiveOn')}</StackHead>
                <StackHead>{t('iva.state')}</StackHead>
                <StackHead className="pr-4">
                  <span className="sr-only">{t('table.actions')}</span>
                </StackHead>
              </StackRow>
            </StackHeader>
            <StackBody>
              {rates.map((rate) => (
                <StackRow key={rate.id}>
                  <StackCell heading className="pl-4 tabular-nums">
                    {Number(rate.rate)} %
                  </StackCell>
                  <StackCell label={t('iva.effectiveOn')}>{date(rate.effectiveOn)}</StackCell>
                  <StackCell label={t('iva.state')}>
                    <ToneBadge
                      tone={
                        rate.state === 'CURRENT'
                          ? 'success'
                          : rate.state === 'SCHEDULED'
                            ? 'info'
                            : 'neutral'
                      }
                    >
                      {t(`iva.states.${rate.state}`)}
                    </ToneBadge>
                  </StackCell>
                  <StackCell className="pr-4 text-right">
                    {rate.state === 'SCHEDULED' && (
                      <WithdrawIvaButton
                        id={rate.id}
                        label={`${Number(rate.rate)} % · ${date(rate.effectiveOn)}`}
                      />
                    )}
                  </StackCell>
                </StackRow>
              ))}
            </StackBody>
          </StackTable>
        </TableCard>
      </section>
      {GROUPS.map((group) => {
        const lines = book.filter((line) => line.kind === group.kind);
        return (
          <section key={group.kind} aria-labelledby={`prices-${group.kind}`} className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h2 id={`prices-${group.kind}`} className="text-sm font-semibold">
                {t(`groups.${group.title}`)}
              </h2>
              {group.kind === 'PACK' && <NewPackButton />}
            </div>
            <TableCard>
              <StackTable aria-label={t(`groups.${group.title}`)}>
                <StackHeader>
                  <StackRow className="bg-muted/40">
                    <StackHead className="pl-4">{t('table.item')}</StackHead>
                    <StackHead>{t('table.current')}</StackHead>
                    <StackHead>{t('table.upcoming')}</StackHead>
                    <StackHead>{t('table.draft')}</StackHead>
                    <StackHead className="pr-4">
                      <span className="sr-only">{t('table.actions')}</span>
                    </StackHead>
                  </StackRow>
                </StackHeader>
                <StackBody>
                  {lines.map((line) => {
                    const name = english ? line.nameEn : line.nameEs;
                    return (
                      <StackRow key={`${line.kind}:${line.key ?? line.packSize ?? ''}`}>
                        <StackCell heading className="pl-4">
                          <span className="font-medium">{name}</span>
                          {line.key && (
                            <p className="font-mono text-xs text-muted-foreground">{line.key}</p>
                          )}
                          {line.affected > 0 && (
                            <p className="text-xs text-muted-foreground">
                              {t('affected', { count: line.affected })}
                            </p>
                          )}
                        </StackCell>
                        <StackCell label={t('table.current')} className="tabular-nums">
                          {line.current ? (
                            <>
                              {priceText(line, line.current.amount)}
                              <p className="text-xs text-muted-foreground">
                                {t('since', { date: date(line.current.effectiveOn) })}
                              </p>
                            </>
                          ) : (
                            <span className="text-muted-foreground">{t('none')}</span>
                          )}
                        </StackCell>
                        <StackCell label={t('table.upcoming')} className="tabular-nums">
                          {line.upcoming.length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <ul className="space-y-1">
                              {line.upcoming.map((next) => (
                                <li key={next.effectiveOn}>
                                  {priceText(line, next.amount)}
                                  <p className="text-xs text-muted-foreground">
                                    {t('from', { date: date(next.effectiveOn) })}
                                  </p>
                                </li>
                              ))}
                            </ul>
                          )}
                        </StackCell>
                        <StackCell label={t('table.draft')}>
                          {line.draft ? (
                            <ToneBadge tone="warning">
                              {priceText(line, line.draft.amount)}
                            </ToneBadge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </StackCell>
                        <StackCell className="pr-4">
                          <div className="flex flex-wrap justify-end gap-2">
                            <DraftPriceButton
                              target={{
                                kind: line.kind,
                                key: line.key,
                                packSize: line.packSize,
                                name,
                              }}
                              amount={line.draft?.amount ?? line.current?.amount ?? null}
                            />
                            {line.draft && (
                              <>
                                <PublishPriceButton
                                  id={line.draft.id}
                                  name={name}
                                  amount={priceText(line, line.draft.amount)}
                                  today={today}
                                />
                                <DiscardPriceButton id={line.draft.id} name={name} />
                              </>
                            )}
                          </div>
                        </StackCell>
                      </StackRow>
                    );
                  })}
                </StackBody>
              </StackTable>
            </TableCard>
          </section>
        );
      })}
    </div>
  );
}
