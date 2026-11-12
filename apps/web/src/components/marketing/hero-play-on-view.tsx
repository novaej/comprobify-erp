'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@comprobify/ui/lib/utils';

/**
 * Holds the hero document's CSS animation until the card is actually on screen,
 * so a phone visitor (where it sits below the buttons) doesn't scroll to a
 * finished animation. Server-rendered markup runs the animation normally; the
 * pause is only armed once JS is running, so with no JS the page still ends in
 * the final state. See `.hero-armed` in globals.css.
 */
export function HeroPlayOnView({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [armed, setArmed] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    setArmed(true);
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setPlaying(true);
          observer.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <figure ref={ref} className={cn(className, armed && !playing && 'hero-armed')}>
      {children}
    </figure>
  );
}
