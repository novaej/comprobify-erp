'use client';

import { Switch } from '@comprobify/ui/components/switch';
import { toast } from '@comprobify/ui/components/sonner';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { SectionCard } from '@/components/section-card';
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
import { setPreferenceAction } from './actions';

type Row = {
  type: string;
  mandatory: boolean;
  channels: { channel: string; enabled: boolean; locked: boolean }[];
};

// FR-NOT-1: a switch per channel each type has; a mandatory type's are on and locked, and a
// channel the type lacks isn't offered at all.
export function Preferences({ rows }: { rows: Row[] }) {
  const t = useTranslations('notifications');
  const tTypes = useTranslations('notifications.types');
  const tError = useTranslations('notificationsError');
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  // What the member just chose, shown at once while the change is saved.
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const channels = ['IN_APP', 'EMAIL'] as const;

  const change = (type: string, channel: string, enabled: boolean) => {
    const key = `${type}:${channel}`;
    setChosen((current) => ({ ...current, [key]: enabled }));
    const form = new FormData();
    form.set('locale', locale);
    form.set('type', type);
    form.set('channel', channel);
    form.set('enabled', String(enabled));
    startTransition(async () => {
      const state = await setPreferenceAction({}, form);
      if (state.error) {
        // Back to what it was.
        setChosen((current) =>
          Object.fromEntries(Object.entries(current).filter(([name]) => name !== key)),
        );
        toast.error(tError.has(state.error) ? tError(state.error) : tError('UNKNOWN'));
        return;
      }
      toast.success(t('preferences.saved'));
    });
  };

  return (
    <SectionCard title={t('preferences.title')} description={t('preferences.description')}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('preferences.none')}</p>
      ) : (
        <TableCard className="mt-1">
          <StackTable aria-label={t('preferences.title')}>
            <StackHeader>
              <StackRow className="bg-muted/40">
                <StackHead className="pl-4">{t('preferences.type')}</StackHead>
                {channels.map((channel) => (
                  <StackHead key={channel}>{t(`channels.${channel}`)}</StackHead>
                ))}
              </StackRow>
            </StackHeader>
            <StackBody>
              {rows.map((row) => (
                <StackRow key={row.type}>
                  <StackCell heading className="pl-4">
                    <span className="font-medium">{tTypes(`${row.type}.label`)}</span>
                    {row.mandatory && (
                      <span className="ml-2">
                        <ToneBadge tone="info">{t('preferences.mandatory')}</ToneBadge>
                      </span>
                    )}
                  </StackCell>
                  {channels.map((channel) => {
                    const entry = row.channels.find((candidate) => candidate.channel === channel);
                    return (
                      <StackCell key={channel} label={t(`channels.${channel}`)}>
                        {entry ? (
                          <Switch
                            checked={chosen[`${row.type}:${channel}`] ?? entry.enabled}
                            disabled={entry.locked || pending}
                            onCheckedChange={(enabled) => change(row.type, channel, enabled)}
                            aria-label={t('preferences.switch', {
                              type: tTypes(`${row.type}.label`),
                              channel: t(`channels.${channel}`),
                            })}
                          />
                        ) : (
                          <span
                            className="text-muted-foreground"
                            aria-label={t('preferences.noChannel')}
                          >
                            —
                          </span>
                        )}
                      </StackCell>
                    );
                  })}
                </StackRow>
              ))}
            </StackBody>
          </StackTable>
        </TableCard>
      )}
    </SectionCard>
  );
}
