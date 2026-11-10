import { cn } from '@comprobify/ui/lib/utils';

// How far along something is, in parts that add up to its whole: done, problems and the rest.
// Colour never carries it alone: the numbers are beside it and in the label.
export function ProgressBar({
  label,
  total,
  done,
  failed = 0,
  className,
}: {
  label: string;
  total: number;
  done: number;
  failed?: number;
  className?: string;
}) {
  const share = (count: number) => (total > 0 ? Math.min(100, (count / total) * 100) : 0);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done + failed}
      className={cn('flex h-2 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <div className="bg-success" style={{ width: `${share(done)}%` }} />
      <div className="bg-destructive" style={{ width: `${share(failed)}%` }} />
    </div>
  );
}
