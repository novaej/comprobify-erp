import { ThemeToggle } from '@comprobify/ui/theme';
import { getTranslations } from 'next-intl/server';
import { LocaleSwitcher } from '../locale-switcher';

// Desktop only; on mobile these live in the drawer. The notification bell joins in Milestone 9.
export async function TopBar() {
  const tTheme = await getTranslations('theme');
  return (
    <div className="hidden h-12 shrink-0 items-center justify-end gap-2 border-b border-border bg-background px-4 md:flex">
      <LocaleSwitcher />
      <ThemeToggle labels={{ toLight: tTheme('toLight'), toDark: tTheme('toDark') }} />
    </div>
  );
}
