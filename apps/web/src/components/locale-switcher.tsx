'use client';

import { cn } from '@comprobify/ui/lib/utils';
import { Globe } from 'lucide-react';
import { useLocale } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';

export function LocaleSwitcher({ className }: { className?: string }) {
  const locale = useLocale();
  const pathname = usePathname();

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      {routing.locales.map((code) => (
        <Link
          key={code}
          href={pathname}
          locale={code}
          className={cn(
            'rounded px-1.5 py-0.5 text-xs uppercase transition-colors',
            locale === code
              ? 'font-semibold text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {code}
        </Link>
      ))}
    </div>
  );
}
