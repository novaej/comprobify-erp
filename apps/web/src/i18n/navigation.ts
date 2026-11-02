import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

// Use these, not next/navigation, so links keep the locale.
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
