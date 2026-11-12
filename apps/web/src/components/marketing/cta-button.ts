import { buttonVariants } from '@comprobify/ui/components/button';
import { cn } from '@comprobify/ui/lib/utils';

/**
 * Button classes for primary calls to action (marketing pages, auth forms).
 * 44px tall for comfortable touch targets; the shadcn `lg` size is only 36px
 * and src/components/ui must not be edited, so the override lives here.
 */
export function ctaVariants(variant: 'default' | 'outline' = 'default', className?: string) {
  return cn(buttonVariants({ variant, size: 'lg' }), 'h-11! px-5! text-base!', className);
}
