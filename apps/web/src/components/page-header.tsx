import { cn } from '@comprobify/ui/lib/utils';
import { ChevronLeft } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { Link } from '@/i18n/navigation';

// Every page opens with this: title, optional description, back link and actions.
export function PageHeader({
  title,
  description,
  action,
  backHref,
  backLabel,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  backHref?: ComponentProps<typeof Link>['href'];
  backLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn('mb-6', className)}>
      {backHref && backLabel && (
        <Link
          href={backHref}
          className="mb-3 flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          {backLabel}
        </Link>
      )}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {title}
          </h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="mt-3 flex shrink-0 items-center gap-2 sm:mt-0">{action}</div>}
      </div>
    </div>
  );
}
