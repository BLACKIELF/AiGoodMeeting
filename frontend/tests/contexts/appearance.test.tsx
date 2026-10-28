import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { spawnSync } from 'node:child_process';
import { AppearanceProvider, useAppearance, type AppearanceContextValue } from '../../src/contexts/AppearanceContext';
import { APPEARANCE_STORAGE_KEY, getAppearanceVariables } from '../../src/lib/appearance';
import AppearanceSettings from '../../src/components/AppearanceSettings';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
let renderer: ReactTestRenderer | undefined;
let value: AppearanceContextValue;
let data: Map<string, string>, writes: string[], blocked: boolean;
let mediaListeners: Set<(event: { matches: boolean }) => void>;
let storageListeners: Set<(event: { key: string | null; newValue: string | null }) => void>;
let root: { dataset: Record<string, string>; style: { colorScheme?: string; setProperty: (key: string, value: string) => void }; classList: { toggle: (key: string, active: boolean) => void } };
let variables: Record<string, string>, classes: Set<string>;
let media: { matches: boolean; addEventListener: (event: string, callback: (event: { matches: boolean }) => void) => void; removeEventListener: (event: string, callback: (event: { matches: boolean }) => void) => void };

function Probe() { value = useAppearance(); return <span>{value.paletteId}/{value.appearance}/{value.resolvedAppearance}</span>; }
async function mount(children = <Probe />) { await act(async () => { renderer = create(<AppearanceProvider>{children}</AppearanceProvider>); }); }

beforeEach(() => {
  data = new Map(); writes = []; blocked = false; variables = {}; classes = new Set();
  mediaListeners = new Set(); storageListeners = new Set();
  media = { matches: false, addEventListener: (_event, callback) => { mediaListeners.add(callback); }, removeEventListener: (_event, callback) => { mediaListeners.delete(callback); } };
  root = { dataset: {}, style: { setProperty: (key, input) => { variables[key] = input; } }, classList: { toggle: (key, active) => { if (active) classes.add(key); else classes.delete(key); } } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    matchMedia: () => media,
    localStorage: {
      getItem: (key: string) => { if (blocked) throw new Error('storage blocked'); return data.get(key) ?? null; },
      setItem: (key: string, input: string) => { if (blocked) throw new Error('quota exceeded'); data.set(key, input); writes.push(input); },
    },
    addEventListener: (event: string, callback: (event: { key: string | null; newValue: string | null }) => void) => { if (event === 'storage') storageListeners.add(callback); },
    removeEventListener: (event: string, callback: (event: { key: string | null; newValue: string | null }) => void) => { if (event === 'storage') storageListeners.delete(callback); },
  } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: root } });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount()); renderer = undefined;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else Reflect.deleteProperty(globalThis, 'document');
});

describe('appearance provider integration', () => {
  test('hydrates saved settings without overwriting them with defaults', async () => {
    data.set(APPEARANCE_STORAGE_KEY, JSON.stringify({ version: 1, paletteId: 'dunhuang-apsara', appearance: 'dark' }));
    await mount();
    expect(value.paletteId).toBe('dunhuang-apsara'); expect(value.resolvedAppearance).toBe('dark');
    expect(writes).toHaveLength(0);
    expect(root.dataset).toEqual({ palette: 'dunhuang-apsara', appearance: 'dark' });
    expect(classes.has('dark')).toBeTrue();
    expect(variables['--primary']).toBe(getAppearanceVariables('dunhuang-apsara', 'dark')['--primary']);
  });

  test('persists palette and appearance, restores them on remount', async () => {
    await mount();
    await act(async () => { value.setPaletteId('orchid-dawn'); value.setAppearance('dark'); });
    expect(JSON.parse(data.get(APPEARANCE_STORAGE_KEY)!)).toEqual({ version: 1, paletteId: 'orchid-dawn', appearance: 'dark' });
    await act(async () => renderer!.unmount()); renderer = undefined;
    await mount();
    expect(value.paletteId).toBe('orchid-dawn'); expect(value.appearance).toBe('dark');
  });

  test('follows system changes only when requested and removes event listeners', async () => {
    await mount();
    await act(async () => { media.matches = true; mediaListeners.forEach(callback => callback({ matches: true })); });
    expect(value.resolvedAppearance).toBe('dark'); expect(root.dataset.appearance).toBe('dark');
    await act(async () => { value.setAppearance('light'); });
    await act(async () => { media.matches = true; mediaListeners.forEach(callback => callback({ matches: true })); });
    expect(value.resolvedAppearance).toBe('light'); expect(root.dataset.appearance).toBe('light');
    await act(async () => renderer!.unmount()); renderer = undefined;
    expect(mediaListeners.size).toBe(0); expect(storageListeners.size).toBe(0);
  });

  test('syncs another tab without a write loop and handles deletion', async () => {
    await mount();
    const incoming = JSON.stringify({ version: 1, paletteId: 'forbidden-city-red', appearance: 'dark' });
    data.set(APPEARANCE_STORAGE_KEY, incoming); const before = writes.length;
    await act(async () => { storageListeners.forEach(callback => callback({ key: APPEARANCE_STORAGE_KEY, newValue: incoming })); });
    expect(value.paletteId).toBe('forbidden-city-red'); expect(value.resolvedAppearance).toBe('dark');
    expect(writes.length).toBe(before);
    data.delete(APPEARANCE_STORAGE_KEY);
    await act(async () => { storageListeners.forEach(callback => callback({ key: APPEARANCE_STORAGE_KEY, newValue: null })); });
    expect(value.paletteId).toBe('default'); expect(value.appearance).toBe('system');
  });

  test('recovers malformed storage and remains interactive when persistence fails', async () => {
    data.set(APPEARANCE_STORAGE_KEY, '{invalid'); await mount();
    expect(value.paletteId).toBe('default'); expect(value.appearance).toBe('system');
    blocked = true;
    await act(async () => { value.setPaletteId('thousand-li-landscape'); value.setAppearance('dark'); });
    expect(value.paletteId).toBe('thousand-li-landscape'); expect(root.dataset.appearance).toBe('dark');
  });

  test('initializes with blocked storage and still follows the system', async () => {
    blocked = true; media.matches = true;
    await mount();
    expect(value.paletteId).toBe('default'); expect(value.appearance).toBe('system');
    expect(value.resolvedAppearance).toBe('dark');
    await act(async () => { value.setPaletteId('liquid-keycap'); });
    expect(value.paletteId).toBe('liquid-keycap'); expect(root.dataset.palette).toBe('liquid-keycap');
  });

  test('server render does not access window or document', () => {
    const result = spawnSync(process.execPath, ['-e', `
      import React from 'react';
      import {renderToString} from 'react-dom/server';
      import {AppearanceProvider} from './src/contexts/AppearanceContext';
      Object.defineProperty(globalThis,'window',{get(){throw new Error('SSR read window')}});
      Object.defineProperty(globalThis,'document',{get(){throw new Error('SSR read document')}});
      console.log(renderToString(React.createElement(AppearanceProvider,null,'server-ok')));
    `], { cwd: new URL('../..', import.meta.url), encoding: 'utf8' });
    expect(result.status).toBe(0); expect(result.stdout).toContain('server-ok');
  });

  test('offers all seven previews and three native keyboard-accessible radio modes', async () => {
    await mount(<><Probe /><AppearanceSettings /></>);
    const radios = renderer!.root.findAllByType('input'); expect(radios).toHaveLength(10);
    expect(radios.every(input => input.props.type === 'radio')).toBeTrue();
    const target = radios.find(input => input.props.value === 'blue-white-porcelain')!;
    await act(async () => target.props.onChange()); expect(value.paletteId).toBe('blue-white-porcelain');
    const dark = radios.find(input => input.props.value === 'dark')!;
    await act(async () => dark.props.onChange()); expect(value.appearance).toBe('dark');
  });
});
