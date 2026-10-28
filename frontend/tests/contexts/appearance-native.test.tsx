import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { APPEARANCE_STORAGE_KEY } from '../../src/lib/appearance';
import type { AppearanceContextValue } from '../../src/contexts/AppearanceContext';

const originalCore = { ...await import('@tauri-apps/api/core') };
const originalWindowApi = { ...await import('@tauri-apps/api/window') };
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
let native = false;
let calls: ('light' | 'dark' | null)[];
let implementation: (theme: 'light' | 'dark' | null) => Promise<void>;
const setTheme = mock((theme: 'light' | 'dark' | null) => { calls.push(theme); return implementation(theme); });
const currentWindow = mock(() => ({ setTheme }));
mock.module('@tauri-apps/api/core', () => ({ ...originalCore, isTauri: () => native }));
mock.module('@tauri-apps/api/window', () => ({ ...originalWindowApi, getCurrentWindow: currentWindow }));
const { AppearanceProvider, useAppearance } = await import('../../src/contexts/AppearanceContext');

let renderer: ReactTestRenderer | undefined;
let value: AppearanceContextValue;
let data: Map<string, string>;
let media: { matches: boolean; addEventListener: (event: string, callback: (event: { matches: boolean }) => void) => void; removeEventListener: (event: string, callback: (event: { matches: boolean }) => void) => void };
let mediaListeners: Set<(event: { matches: boolean }) => void>;
function Probe() { value = useAppearance(); return <span>{value.appearance}/{value.resolvedAppearance}</span>; }
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function mount() { await act(async () => { renderer = create(<AppearanceProvider><Probe /></AppearanceProvider>); }); await settle(); }
function stored(appearance: 'light' | 'dark' | 'system') { data.set(APPEARANCE_STORAGE_KEY, JSON.stringify({ version: 1, paletteId: 'default', appearance })); }

beforeEach(() => {
  native = false; calls = []; data = new Map(); mediaListeners = new Set();
  implementation = async () => {};
  setTheme.mockClear(); currentWindow.mockClear();
  mock.module('@tauri-apps/api/core', () => ({ ...originalCore, isTauri: () => native }));
  mock.module('@tauri-apps/api/window', () => ({ ...originalWindowApi, getCurrentWindow: currentWindow }));
  media = { matches: false, addEventListener: (_event, callback) => { mediaListeners.add(callback); }, removeEventListener: (_event, callback) => { mediaListeners.delete(callback); } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    matchMedia: () => media,
    localStorage: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, input: string) => { data.set(key, input); } },
    addEventListener() {}, removeEventListener() {},
  } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    documentElement: { dataset: {}, style: { setProperty() {} }, classList: { toggle() {} } },
  } });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount()); renderer = undefined;
  await settle();
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else Reflect.deleteProperty(globalThis, 'document');
});
afterAll(() => {
  mock.module('@tauri-apps/api/core', () => originalCore);
  mock.module('@tauri-apps/api/window', () => originalWindowApi);
});

describe('native window appearance synchronization', () => {
  test('browser-only appearance never opens the native window bridge', async () => {
    stored('dark'); await mount();
    await act(async () => value.setAppearance('light')); await settle();
    expect(calls).toEqual([]); expect(currentWindow).not.toHaveBeenCalled();
  });

  test('hydrates the saved manual choice without briefly overriding it with system', async () => {
    native = true; stored('dark'); await mount();
    expect(calls).toEqual(['dark']); expect(value.appearance).toBe('dark');
    await act(async () => value.setPaletteId('orchid-dawn')); await settle();
    expect(calls).toEqual(['dark']);
  });

  test('system sends null and allows a native override to release the real system media state', async () => {
    native = true; stored('dark');
    implementation = async theme => {
      // Simulate WebKit's media query reflecting the manual native override,
      // then returning to the OS's actual light preference when setTheme(null).
      media.matches = theme === 'dark';
      mediaListeners.forEach(callback => callback({ matches: media.matches }));
    };
    await mount(); expect(value.resolvedAppearance).toBe('dark');
    await act(async () => value.setAppearance('system')); await settle();
    expect(calls).toEqual(['dark', null]);
    expect(value.appearance).toBe('system'); expect(value.resolvedAppearance).toBe('light');
    await act(async () => { media.matches = true; mediaListeners.forEach(callback => callback({ matches: true })); });
    expect(value.resolvedAppearance).toBe('dark'); expect(calls).toEqual(['dark', null]);
  });

  test('serializes in-flight calls and skips stale queued choices during rapid switching', async () => {
    native = true; stored('dark'); let release!: () => void;
    implementation = theme => theme === 'dark' ? new Promise<void>(resolve => { release = resolve; }) : Promise.resolve();
    await mount(); expect(calls).toEqual(['dark']);
    await act(async () => value.setAppearance('light')); await settle();
    await act(async () => value.setAppearance('system')); await settle();
    expect(calls).toEqual(['dark']);
    await act(async () => release()); await settle();
    expect(calls).toEqual(['dark', null]);
  });

  test('unmount cancels pending work and a remount waits for the older in-flight call', async () => {
    native = true; stored('dark'); let release!: () => void;
    implementation = theme => theme === 'dark' ? new Promise<void>(resolve => { release = resolve; }) : Promise.resolve();
    await mount();
    await act(async () => value.setAppearance('light')); await settle();
    await act(async () => renderer!.unmount()); renderer = undefined;
    stored('system'); await mount();
    expect(calls).toEqual(['dark']);
    await act(async () => release()); await settle();
    expect(calls).toEqual(['dark', null]);
  });

  test('a rejected bridge request does not poison later native changes', async () => {
    native = true; stored('dark');
    implementation = async theme => { if (theme === 'dark') throw new Error('native request rejected'); };
    await mount(); expect(value.appearance).toBe('dark');
    await act(async () => value.setAppearance('light')); await settle();
    expect(calls).toEqual(['dark', 'light']); expect(value.appearance).toBe('light');
  });
});
