import { Badge } from '@comprobify/ui/components/badge';
import { cn } from '@comprobify/ui/lib/utils';
import type { ReactNode } from 'react';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'primary';

const TONES: Record<Tone, string> = {
  // Muted text on the muted fill sits right at 4.5:1, so neutral uses the body text.
  neutral: 'border-border bg-muted text-foreground',
  info: 'border-info-border bg-info-soft text-info',
  success: 'border-success-border bg-success-soft text-success',
  warning: 'border-warning-border bg-warning-soft text-warning',
  danger: 'border-destructive/30 bg-destructive/10 text-destructive',
  primary: 'border-primary/20 bg-primary/10 text-primary',
};

// A status or category pill. The tone says how it reads: done, waiting, a problem.
export function ToneBadge({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn(TONES[tone], className)}>
      {children}
    </Badge>
  );
}
