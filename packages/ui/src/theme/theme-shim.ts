'use client';

// Replaces next-themes, whose injected <script> triggers a React 19
// warning, so the flash of the wrong theme is prevented by themeScript instead.
// The API matches next-themes. State lives in localStorage and matchMedia, read
// through useSyncExternalStore rather than copied into state by an effect.

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
} from 'react';
import type { JSX, ReactNode } from 'react';
import { THEME_STORAGE_KEY } from './script';

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export interface UseThemeProps {
  theme: Theme | undefined;
  setTheme: (theme: Theme) => void;
  resolvedTheme: ResolvedTheme | undefined;
  systemTheme: ResolvedTheme | undefined;
  themes: Theme[];
  forcedTheme: Theme | undefined;
}

const ALL_THEMES: Theme[] = ['light', 'dark', 'system'];

const ThemeCtx = createContext<UseThemeProps>({
  theme: undefined,
  setTheme: () => {},
  resolvedTheme: undefined,
  systemTheme: undefined,
  themes: ALL_THEMES,
  forcedTheme: undefined,
});

export function useTheme(): UseThemeProps {
  return useContext(ThemeCtx);
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyClass(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(resolved);
}

// Used when storage is blocked, so the choice still lasts for this page.
let memoryTheme: Theme | null = null;
const listeners = new Set<() => void>();

function readStored(): Theme | null {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : null;
  } catch {
    return memoryTheme;
  }
}

function writeStored(theme: Theme): void {
  memoryTheme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage blocked: memoryTheme keeps it.
  }
  listeners.forEach((listener) => listener());
}

// Other tabs, the OS preference and setTheme all notify through here.
function subscribe(listener: () => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', listener);
  window.addEventListener('storage', listener);
  listeners.add(listener);
  return () => {
    mq.removeEventListener('change', listener);
    window.removeEventListener('storage', listener);
    listeners.delete(listener);
  };
}

const onServer = (): undefined => undefined;

export interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
}

export function ThemeProvider({
  children,
  defaultTheme = 'system',
}: ThemeProviderProps): JSX.Element {
  const theme = useSyncExternalStore<Theme | undefined>(
    subscribe,
    () => readStored() ?? defaultTheme,
    onServer,
  );
  const systemTheme = useSyncExternalStore<ResolvedTheme | undefined>(
    subscribe,
    getSystemTheme,
    onServer,
  );
  const resolvedTheme = theme === 'system' ? systemTheme : theme;

  useEffect(() => {
    if (resolvedTheme) applyClass(resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = useCallback((next: Theme) => writeStored(next), []);

  return createElement(
    ThemeCtx.Provider,
    {
      value: {
        theme,
        setTheme,
        resolvedTheme,
        systemTheme,
        themes: ALL_THEMES,
        forcedTheme: undefined,
      },
    },
    children,
  );
}
