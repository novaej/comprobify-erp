import { cn } from '@comprobify/ui/lib/utils';

/**
 * Faint grid that fades out from one side. Sections alternate `side` so the
 * grid draws the eye toward the content instead of tiling the whole page.
 * The parent needs `relative overflow-hidden`, and its content `relative`.
 */
export function GridBackdrop({ side, className }: { side: 'left' | 'right'; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'bg-grid pointer-events-none absolute inset-0 opacity-40',
        side === 'right' ? 'mask-hero-fade' : 'mask-hero-fade-left',
        className,
      )}
    />
  );
}
