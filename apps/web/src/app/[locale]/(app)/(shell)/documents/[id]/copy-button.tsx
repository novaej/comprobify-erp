'use client';

import { toast } from '@comprobify/ui/components/sonner';
import { Copy } from 'lucide-react';

export function CopyButton({ value, label, done }: { value: string; label: string; done: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => toast.success(done));
      }}
      className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <Copy className="h-4 w-4" aria-hidden />
    </button>
  );
}
