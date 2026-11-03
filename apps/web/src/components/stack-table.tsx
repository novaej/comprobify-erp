import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@comprobify/ui/components/table';
import { cn } from '@comprobify/ui/lib/utils';
import type { ComponentProps, ReactNode } from 'react';

// A table that becomes small cards below `md` (`.table-stack` in globals.css). Display
// changes drop table semantics for some screen readers, so every part carries its role.
export function StackTable({ className, ...props }: ComponentProps<typeof Table>) {
  return <Table role="table" className={cn('table-stack', className)} {...props} />;
}

export function StackHeader(props: ComponentProps<typeof TableHeader>) {
  return <TableHeader role="rowgroup" {...props} />;
}

export function StackBody(props: ComponentProps<typeof TableBody>) {
  return <TableBody role="rowgroup" {...props} />;
}

export function StackRow(props: ComponentProps<typeof TableRow>) {
  return <TableRow role="row" {...props} />;
}

export function StackHead(props: ComponentProps<typeof TableHead>) {
  return <TableHead role="columnheader" {...props} />;
}

export function StackCell({
  label,
  heading,
  full,
  className,
  ...props
}: Omit<ComponentProps<typeof TableCell>, 'title'> & {
  // Column name shown beside the value on phones; omit for an actions cell.
  label?: string;
  // The cell that names the row: the card heading on phones.
  heading?: boolean;
  // An empty or error cell spanning the table.
  full?: boolean;
}) {
  return (
    <TableCell
      role="cell"
      data-label={label}
      className={cn(heading && 'stack-title', full && 'stack-full', className)}
      {...props}
    />
  );
}

// The bordered card every list sits in.
export function TableCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn('overflow-x-auto rounded-xl border border-border bg-card shadow-sm', className)}
    >
      {children}
    </div>
  );
}
