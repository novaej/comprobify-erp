'use client';

import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { useTranslations } from 'next-intl';
import { ActionForm } from '@/components/action-form';
import { FormField } from '@/components/form-field';
import { acceptAction, acceptAsNewUserAction } from './actions';

export function AcceptForm({ token }: { token: string }) {
  const t = useTranslations('invite');
  return (
    <ActionForm action={acceptAction} hidden={{ token }} errors="inviteError">
      {(pending) => (
        <Button type="submit" className="h-11 w-full text-base" disabled={pending}>
          {pending ? t('accepting') : t('accept')}
        </Button>
      )}
    </ActionForm>
  );
}

export function NewUserForm({ token }: { token: string }) {
  const t = useTranslations('invite');
  const tFields = useTranslations('auth.fields');
  return (
    <ActionForm
      action={acceptAsNewUserAction}
      hidden={{ token }}
      errors="inviteError"
      className="space-y-4"
    >
      {(pending) => (
        <fieldset disabled={pending} className="space-y-4">
          <FormField label={tFields('name')}>
            {(props) => <Input {...props} name="name" autoComplete="name" required />}
          </FormField>
          <FormField label={tFields('password')} hint={tFields('passwordHint')}>
            {(props) => (
              <Input
                {...props}
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={10}
                required
              />
            )}
          </FormField>
          <FormField label={tFields('confirmPassword')}>
            {(props) => (
              <Input
                {...props}
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
              />
            )}
          </FormField>
          <Button type="submit" className="h-11 w-full text-base">
            {pending ? t('accepting') : t('createAndAccept')}
          </Button>
        </fieldset>
      )}
    </ActionForm>
  );
}
