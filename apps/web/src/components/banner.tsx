import { cn } from '@comprobify/ui/lib/utils';
import type { ComponentType, ReactNode } from 'react';

export type BannerTone = 'warning' | 'danger' | 'info' | 'success';

const TONES: Record<BannerTone, string> = {
  warning: 'border-warning-border bg-warning-soft text-warning',
  danger: 'border-destructive/30 bg-destructive/10 text-destructive',
  info: 'border-info-border bg-info-soft text-info',
  success: 'border-success-border bg-success-soft text-success',
};

// One alert strip for the sandbox, certificate and later account notices.
export function Banner({
  tone,
  icon: Icon,
  title,
  children,
  role = 'alert',
}: {
  tone: BannerTone;
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  title?: string;
  children?: ReactNode;
  // `alert` interrupts screen readers; `note` is for information that isn't urgent.
  role?: 'alert' | 'note';
}) {
  return (
    <div
      role={role}
      className={cn('mb-6 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm', TONES[tone])}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="leading-snug font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5 text-xs opacity-80')}>{children}</div>}
      </div>
    </div>
  );
}
