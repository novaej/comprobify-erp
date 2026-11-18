import { buttonVariants } from '@comprobify/ui/components/button';
import { getTranslations } from 'next-intl/server';
import type { ComponentProps } from 'react';
import { Link } from '@/i18n/navigation';

type Href = ComponentProps<typeof Link>['href'];

// NFR-PERF-4: the previous and next pages of a list read by keyset. There are no page numbers:
// counting a large table on every page is what keyset paging avoids.
export async function ListPager({
  label,
  previous,
  next,
}: {
  label: string;
  previous: Href | null;
  next: Href | null;
}) {
  if (!previous && !next) return null;
  const t = await getTranslations('listPager');
  return (
    <nav aria-label={label} className="mt-4 flex items-center justify-between gap-3 text-sm">
      {previous ? (
        <Link href={previous} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          {t('previous')}
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link href={next} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          {t('next')}
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
