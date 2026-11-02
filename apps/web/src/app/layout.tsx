import { ThemeProvider, themeScript } from '@comprobify/ui/theme';
import { Geist, Geist_Mono } from 'next/font/google';
import Script from 'next/script';
import { getLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import './globals.css';

const geistSans = Geist({ subsets: ['latin'], variable: '--font-sans' });

// Without this, font-mono falls back to the sans face (access keys, sequentials).
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="h-full antialiased">
        <Script id="theme" strategy="beforeInteractive">
          {themeScript}
        </Script>
        <ThemeProvider defaultTheme="system">{children}</ThemeProvider>
      </body>
    </html>
  );
}
