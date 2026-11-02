'use client';

import { useEffect } from 'react';
import { recordActivityAction } from './actions';

const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
const THROTTLE_MS = 60_000;

// Only real input keeps a session alive; page loads and polling never do (FR-USR-2).
export function ActivityTracker() {
  useEffect(() => {
    let last = 0;
    const onInput = () => {
      const now = Date.now();
      if (now - last < THROTTLE_MS) return;
      last = now;
      void recordActivityAction();
    };
    for (const event of EVENTS) window.addEventListener(event, onInput, { passive: true });
    return () => {
      for (const event of EVENTS) window.removeEventListener(event, onInput);
    };
  }, []);
  return null;
}
