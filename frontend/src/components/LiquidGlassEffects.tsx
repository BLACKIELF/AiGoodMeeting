'use client';

import { useEffect } from 'react';

const SURFACES = '.agb-card-trigger, .agb-meeting-card, .agb-workbench-session';

/** Feeds the pointer position to glass surfaces so their highlight follows the cursor. */
export function LiquidGlassEffects() {
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let x = 0;
    let y = 0;
    let target: Element | null = null;

    const apply = () => {
      frame = 0;
      const surface = target instanceof Element ? target.closest<HTMLElement>(SURFACES) : null;
      if (!surface) return;
      const rect = surface.getBoundingClientRect();
      surface.style.setProperty('--lg-px', `${Math.round(x - rect.left)}px`);
      surface.style.setProperty('--lg-py', `${Math.round(y - rect.top)}px`);
    };

    const onMove = (event: PointerEvent) => {
      if (!finePointer.matches || reducedMotion.matches) return;
      x = event.clientX;
      y = event.clientY;
      target = event.target as Element | null;
      if (!frame) frame = requestAnimationFrame(apply);
    };

    document.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      document.removeEventListener('pointermove', onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
