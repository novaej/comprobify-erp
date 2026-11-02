'use client';

import { cn } from '@comprobify/ui/lib/utils';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from './theme-shim';

// Labels come from the app's message files (CLAUDE.md rule 18).
export function ThemeToggle({
  labels,
  className,
}: {
  labels: { toLight: string; toDark: string };
  className?: string;
}) {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      aria-label={resolvedTheme === 'dark' ? labels.toLight : labels.toDark}
      suppressHydrationWarning
      className={cn(
        'rounded-md p-1.5 transition-colors',
        'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        className,
      )}
    >
      <Sun className="hidden h-4 w-4 dark:block" aria-hidden />
      <Moon className="h-4 w-4 dark:hidden" aria-hidden />
    </button>
  );
}
