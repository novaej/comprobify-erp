'use client';

import { Pencil } from 'lucide-react';
import type { ReactNode } from 'react';

// One label and value in a <dl> grid. The edit button lives in the <dd>, the only place
// a definition list allows it.
export function DetailTile({
  label,
  value,
  detail,
  onEdit,
  editLabel,
}: {
  label: string;
  value: ReactNode;
  detail?: string | null;
  onEdit?: () => void;
  editLabel?: string;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-1.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="flex flex-wrap items-center justify-end gap-1 text-right text-sm font-medium">
        {value}
        {detail && <span className="text-xs font-normal text-muted-foreground">({detail})</span>}
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            title={editLabel}
            aria-label={editLabel}
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Pencil className="h-4 w-4" aria-hidden />
          </button>
        )}
      </dd>
    </div>
  );
}
