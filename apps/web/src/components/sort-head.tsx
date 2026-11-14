import { cn } from '@comprobify/ui/lib/utils';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { StackHead } from './stack-table';

// What a list page gives its table to build the sort links.
export type ListSorting = {
  path: string;
  query: Record<string, string | undefined>;
  sort?: string;
  direction?: 'asc' | 'desc';
};

// A column header that sorts the list by that column: a link, so it works without a script and
// the order is in the URL. Choosing the same column again reverses it.
export function SortHead({
  path,
  query,
  column,
  sort,
  direction,
  label,
  actionLabel,
  className,
}: {
  // The list's own path, and the parameters in the URL now.
  path: string;
  query: Record<string, string | undefined>;
  column: string;
  sort?: string;
  direction?: 'asc' | 'desc';
  label: string;
  // For a screen reader: "Sort by name".
  actionLabel: string;
  className?: string;
}) {
  const active = sort === column;
  const next = active && direction !== 'desc' ? 'desc' : 'asc';
  const params = Object.fromEntries(
    Object.entries({ ...query, sort: column, dir: next, page: undefined }).filter(
      ([, value]) => value !== undefined,
    ),
  ) as Record<string, string>;
  const Icon = !active ? ArrowUpDown : direction === 'desc' ? ArrowDown : ArrowUp;
  return (
    <StackHead
      className={className}
      aria-sort={active ? (direction === 'desc' ? 'descending' : 'ascending') : undefined}
    >
      <Link
        href={{ pathname: path, query: params }}
        scroll={false}
        aria-label={actionLabel}
        className="-mx-1 inline-flex items-center gap-1 rounded px-1 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {label}
        <Icon
          className={cn('h-3.5 w-3.5', active ? 'text-foreground' : 'text-muted-foreground/60')}
          aria-hidden
        />
      </Link>
    </StackHead>
  );
}
