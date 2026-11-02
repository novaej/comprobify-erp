'use client';

import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { useLocale, useTranslations } from 'next-intl';
import { useActionState, type ReactNode } from 'react';
import { FormField } from '@/components/form-field';
import { Link } from '@/i18n/navigation';
import type { ActionState } from '@/server/actions';
import {
  requestPasswordResetAction,
  resendVerificationAction,
  resetPasswordAction,
  signInAction,
  signUpAction,
  verifyEmailAction,
} from './actions';

type Action = (state: ActionState, form: FormData) => Promise<ActionState>;

function AuthForm({
  action,
  submit,
  submitting,
  hidden = {},
  done,
  children,
}: {
  action: Action;
  submit: string;
  submitting: string;
  hidden?: Record<string, string>;
  done?: ReactNode;
  children?: ReactNode;
}) {
  const locale = useLocale();
  const tError = useTranslations('authError');
  const [state, formAction, pending] = useActionState(action, {});
  if (state.done && done) return <>{done}</>;
  const message =
    state.error && (tError.has(state.error) ? tError(state.error) : tError('UNKNOWN'));

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <fieldset disabled={pending} className="space-y-4">
        {children}
      </fieldset>
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      <Button type="submit" className="h-11 w-full text-base" disabled={pending}>
        {pending ? submitting : submit}
      </Button>
    </form>
  );
}

function EmailField() {
  const t = useTranslations('auth.fields');
  return (
    <FormField label={t('email')}>
      {(props) => <Input {...props} name="email" type="email" autoComplete="email" required />}
    </FormField>
  );
}

function NewPasswordFields() {
  const t = useTranslations('auth.fields');
  return (
    <>
      <FormField label={t('password')} hint={t('passwordHint')}>
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
      <FormField label={t('confirmPassword')}>
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
    </>
  );
}

export function SignUpForm() {
  const t = useTranslations('auth');
  return (
    <AuthForm
      action={signUpAction}
      submit={t('register.submit')}
      submitting={t('register.submitting')}
    >
      <FormField label={t('fields.name')}>
        {(props) => <Input {...props} name="name" autoComplete="name" required />}
      </FormField>
      <EmailField />
      <NewPasswordFields />
    </AuthForm>
  );
}

export function SignInForm() {
  const t = useTranslations('auth');
  return (
    <AuthForm action={signInAction} submit={t('login.submit')} submitting={t('login.submitting')}>
      <EmailField />
      <FormField
        label={t('fields.password')}
        aside={
          <Link
            href="/forgot-password"
            className="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            {t('login.forgotPassword')}
          </Link>
        }
      >
        {(props) => (
          <Input
            {...props}
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        )}
      </FormField>
    </AuthForm>
  );
}

export function VerifyEmailForm({ token }: { token: string }) {
  const t = useTranslations('verifyEmail');
  return (
    <AuthForm
      action={verifyEmailAction}
      hidden={{ token }}
      submit={t('confirmButton')}
      submitting={t('confirming')}
    />
  );
}

export function ResendVerificationForm() {
  const t = useTranslations('verifyEmail');
  return (
    <AuthForm
      action={resendVerificationAction}
      submit={t('resend')}
      submitting={t('resending')}
      done={<p className="text-sm text-muted-foreground">{t('resent')}</p>}
    >
      <EmailField />
    </AuthForm>
  );
}

export function ForgotPasswordForm() {
  const t = useTranslations('forgotPassword');
  return (
    <AuthForm
      action={requestPasswordResetAction}
      submit={t('submit')}
      submitting={t('submitting')}
      done={<p className="text-sm text-muted-foreground">{t('genericMessage')}</p>}
    >
      <EmailField />
    </AuthForm>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations('resetPassword');
  return (
    <AuthForm
      action={resetPasswordAction}
      hidden={{ token }}
      submit={t('submit')}
      submitting={t('submitting')}
    >
      <NewPasswordFields />
    </AuthForm>
  );
}
