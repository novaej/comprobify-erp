import { cn } from '@comprobify/ui/lib/utils';
import { useId, type ReactNode } from 'react';

// One titled block of a page: settings, a summary, a form. Lists use TableCard instead.
export function SectionCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  // A button or link at the top right.
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={cn('rounded-xl border border-border bg-card p-6 shadow-sm', className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={id} className="text-sm font-semibold">
            {title}
          </h2>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </section>
  );
}
