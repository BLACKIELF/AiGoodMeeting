'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  APPEARANCE_STORAGE_KEY, DEFAULT_APPEARANCE, applyAppearance, isAppearance, isPaletteId,
  parseAppearancePreferences, resolveAppearance,
  type Appearance, type AppearancePreferences, type PaletteId, type ResolvedAppearance,
} from '../lib/appearance';

export interface AppearanceContextValue {
  paletteId: PaletteId;
  setPaletteId: (paletteId: PaletteId) => void;
  appearance: Appearance;
  setAppearance: (appearance: Appearance) => void;
  resolvedAppearance: ResolvedAppearance;
}

const AppearanceContext = createContext<AppearanceContextValue | undefined>(undefined);
// macOS setTheme is app-wide. Serialize across provider remounts as well as
// quick preference changes; an already-started native request cannot be aborted.
let nativeAppearanceQueue: Promise<void> = Promise.resolve();

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  // The server and the first hydration render share the same state. The head
  // bootstrap script handles visual preferences before the client mounts.
  const [preferences, setPreferences] = useState<AppearancePreferences>({ ...DEFAULT_APPEARANCE });
  const [systemDark, setSystemDark] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    let media: MediaQueryList | undefined;
    try {
      media = window.matchMedia('(prefers-color-scheme: dark)');
      setSystemDark(media.matches);
    } catch { /* A browser without matchMedia uses the safe light fallback. */ }

    let stored = { ...DEFAULT_APPEARANCE };
    try { stored = parseAppearancePreferences(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)); }
    catch { /* Private/restricted storage keeps a working in-memory setting. */ }
    setPreferences(stored);
    applyAppearance(document.documentElement, stored, media?.matches ?? false);
    setInitialized(true);

    const handleSystemChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    if (media?.addEventListener) media.addEventListener('change', handleSystemChange);
    else media?.addListener?.(handleSystemChange);

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== APPEARANCE_STORAGE_KEY && event.key !== null) return;
      const next = parseAppearancePreferences(event.key === null ? null : event.newValue);
      setPreferences(previous => previous.paletteId === next.paletteId && previous.appearance === next.appearance ? previous : next);
    };
    window.addEventListener('storage', handleStorage);
    return () => {
      if (media?.removeEventListener) media.removeEventListener('change', handleSystemChange);
      else media?.removeListener?.(handleSystemChange);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    if (!initialized) return;
    applyAppearance(document.documentElement, preferences, systemDark);
  }, [preferences, systemDark, initialized]);

  useEffect(() => {
    if (!initialized) return;
    let cancelled = false;
    const requestedTheme = preferences.appearance === 'system' ? null : preferences.appearance;
    nativeAppearanceQueue = nativeAppearanceQueue.then(async () => {
      if (cancelled) return;
      const { isTauri } = await import('@tauri-apps/api/core');
      if (cancelled || typeof isTauri !== 'function' || !isTauri()) return;
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      if (cancelled) return;
      await getCurrentWindow().setTheme(requestedTheme);
    }).catch(() => {
      // Native chrome is optional in a browser or an unavailable bridge. Keep
      // the web appearance usable and allow the next native request to recover.
    });
    return () => { cancelled = true; };
  }, [preferences.appearance, initialized]);

  useEffect(() => {
    if (!initialized) return;
    try {
      const serialized = JSON.stringify(preferences);
      if (window.localStorage.getItem(APPEARANCE_STORAGE_KEY) !== serialized) {
        window.localStorage.setItem(APPEARANCE_STORAGE_KEY, serialized);
      }
    } catch { /* Theme changes remain usable when persistence is unavailable. */ }
  }, [preferences, initialized]);

  const setPaletteId = useCallback((paletteId: PaletteId) => {
    const valid = isPaletteId(paletteId) ? paletteId : DEFAULT_APPEARANCE.paletteId;
    setPreferences(previous => previous.paletteId === valid ? previous : { ...previous, paletteId: valid });
  }, []);
  const setAppearance = useCallback((appearance: Appearance) => {
    const valid = isAppearance(appearance) ? appearance : DEFAULT_APPEARANCE.appearance;
    setPreferences(previous => previous.appearance === valid ? previous : { ...previous, appearance: valid });
  }, []);
  const value = useMemo<AppearanceContextValue>(() => ({
    paletteId: preferences.paletteId, setPaletteId,
    appearance: preferences.appearance, setAppearance,
    resolvedAppearance: resolveAppearance(preferences.appearance, systemDark),
  }), [preferences, systemDark, setPaletteId, setAppearance]);

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceContextValue {
  const context = useContext(AppearanceContext);
  if (!context) throw new Error('useAppearance requires AppearanceProvider');
  return context;
}
