import type { Transport } from '@comprobify/core';
import { getTranslations } from 'next-intl/server';
import { DetailTile } from '@/components/detail-tile';
import { SectionCard } from '@/components/section-card';

const date = (iso: string) => iso.split('-').reverse().join('/');

// FR-SAL-9, FR-DOC-12: a guía's carrier, dates and recipients with their goods.
export async function TransportCard({ transport }: { transport: Transport }) {
  const t = await getTranslations('documents.detail.transport');
  return (
    <SectionCard title={t('title')}>
      <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <DetailTile
          label={t('carrier')}
          value={transport.carrier.name}
          detail={transport.carrier.identification}
        />
        <DetailTile
          label={t('plate')}
          value={<span className="tabular-nums">{transport.plate}</span>}
        />
        <DetailTile label={t('departure')} value={transport.departureAddress} />
        <DetailTile
          label={t('start')}
          value={<span className="tabular-nums">{date(transport.start)}</span>}
        />
        <DetailTile
          label={t('end')}
          value={<span className="tabular-nums">{date(transport.end)}</span>}
        />
      </dl>
      <ol className="mt-4 space-y-4">
        {transport.recipients.map((one, index) => (
          <li key={index} className="rounded-md border border-border p-3 text-sm">
            <p className="font-medium">
              {t('recipient', { number: index + 1 })}: {one.name}
              <span className="ml-2 font-normal tabular-nums text-muted-foreground">
                {one.identification}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              {one.address} · {one.reason}
              {one.support && ` · ${t('support', { number: one.support.number })}`}
            </p>
            <ul className="mt-2 space-y-1">
              {one.lines.map((line, lineIndex) => (
                <li key={lineIndex} className="flex justify-between gap-3">
                  <span className="min-w-0">
                    {line.name}
                    {line.code && (
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {line.code}
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums">{line.quantity}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}
