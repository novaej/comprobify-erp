import type { ReactNode } from 'react';

// The buttons at the end of a form: in the flow, right-aligned under a rule.
export function FormActionBar({ summary, children }: { summary?: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-6 flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center">
      {summary && <div className="text-sm">{summary}</div>}
      <div className="flex flex-wrap gap-3 sm:ml-auto">{children}</div>
    </div>
  );
}
