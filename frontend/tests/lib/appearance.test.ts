import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  APPEARANCE_STORAGE_KEY, DEFAULT_APPEARANCE, PALETTES, contrastRatio, getAppearanceBootstrapScript,
  getAppearanceTheme, getAppearanceVariables, parseAppearancePreferences, resolveAppearance,
} from '../../src/lib/appearance';

describe('appearance palette contracts', () => {
  test('retains the seven real source palettes and both variants without fetching assets', () => {
    expect(PALETTES.map(palette => palette.id)).toEqual(['default', 'liquid-keycap', 'blue-white-porcelain', 'dunhuang-apsara', 'forbidden-city-red', 'orchid-dawn', 'thousand-li-landscape']);
    for (const palette of PALETTES) for (const appearance of ['light', 'dark'] as const) {
      const original = JSON.parse(readFileSync(new URL(`../../src/lib/palettes/${palette.id}/tokens/${appearance}.json`, import.meta.url), 'utf8'));
      expect(palette[appearance]).toEqual(original);
      const license = readFileSync(new URL(`../../src/lib/palettes/${palette.id}/LICENSE`, import.meta.url), 'utf8');
      expect(license).toContain('MIT License'); expect(license).toContain('Copyright (c)');
      expect(license).toContain('The above copyright notice and this permission notice');
    }
  });

  for (const palette of PALETTES) for (const appearance of ['light', 'dark'] as const) {
    test(`${palette.id} ${appearance}: readable text, selection, states and controls`, () => {
      const theme = getAppearanceTheme(palette.id, appearance);
      const textPairs = [
        [theme.foreground, theme.background], [theme.foreground, theme.card], [theme.foreground, theme.sidebar],
        [theme.muted, theme.background], [theme.muted, theme.card], [theme.muted, theme.sidebar],
        [theme.subtle, theme.background], [theme.primary, theme.card], [theme.primary, theme.background],
        [theme.primary, theme.sidebar], [theme.primaryForeground, theme.primary],
        [theme.primaryForeground, theme.primaryHover], [theme.selectionForeground, theme.selection],
        [theme.destructive, theme.card], [theme.destructiveForeground, theme.destructive],
        [theme.success, theme.card], [theme.warning, theme.card],
      ];
      for (const [text, background] of textPairs) expect(contrastRatio(text, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.inputBorder, theme.card)).toBeGreaterThanOrEqual(3);
      const variables = getAppearanceVariables(palette.id, appearance);
      expect(variables['--foreground']).toBe(variables['--agb-foreground']);
      expect(variables['--agb-blue-500']).toBe(variables['--primary']);
      for (const value of Object.values(variables)) expect(value).not.toMatch(/NaN|undefined/);
    });
  }

  test('destructive colors do not follow the selected skin', () => {
    for (const appearance of ['light', 'dark'] as const) {
      const errors = PALETTES.map(palette => getAppearanceTheme(palette.id, appearance).destructive);
      expect(new Set(errors).size).toBe(1);
    }
  });
});

describe('appearance settings recovery and pre-paint behavior', () => {
  test('restores valid settings and individually recovers invalid fields', () => {
    expect(parseAppearancePreferences('{"version":1,"paletteId":"orchid-dawn","appearance":"dark"}')).toEqual({ version: 1, paletteId: 'orchid-dawn', appearance: 'dark' });
    expect(parseAppearancePreferences('{"version":1,"paletteId":"broken","appearance":"dark"}')).toEqual({ version: 1, paletteId: 'default', appearance: 'dark' });
    expect(parseAppearancePreferences('{"version":1,"paletteId":"orchid-dawn","appearance":"broken"}')).toEqual({ version: 1, paletteId: 'orchid-dawn', appearance: 'system' });
    for (const raw of [null, '', '{', '[]', 'null', 'false', '{"version":2}', '{"version":1,"paletteId":"__proto__"}']) {
      expect(parseAppearancePreferences(raw)).toEqual(DEFAULT_APPEARANCE);
    }
  });

  test('system appearance resolves while explicit appearance stays fixed', () => {
    expect(resolveAppearance('system', true)).toBe('dark');
    expect(resolveAppearance('system', false)).toBe('light');
    expect(resolveAppearance('light', true)).toBe('light');
    expect(resolveAppearance('dark', false)).toBe('dark');
  });

  test('bootstrap applies saved dark palette before hydration, recovering restricted storage', () => {
    for (const blocked of [false, true]) {
      const attributes: Record<string, string> = {}, properties: Record<string, string> = {};
      const classes = new Set<string>();
      const root = { dataset: attributes, classList: { toggle: (name: string, active: boolean) => active ? classes.add(name) : classes.delete(name) }, style: { setProperty: (name: string, value: string) => { properties[name] = value; } } };
      const context = {
        document: { documentElement: root }, window: { matchMedia: () => ({ matches: true }) },
        localStorage: { getItem: (key: string) => { expect(key).toBe(APPEARANCE_STORAGE_KEY); if (blocked) throw new Error('disabled'); return '{"version":1,"paletteId":"blue-white-porcelain","appearance":"dark"}'; } },
      };
      vm.runInNewContext(getAppearanceBootstrapScript(), context);
      expect(attributes.appearance).toBe('dark');
      expect(attributes.palette).toBe(blocked ? 'default' : 'blue-white-porcelain');
      expect(classes.has('dark')).toBeTrue();
      expect(properties['--primary']).toBe(getAppearanceVariables(blocked ? 'default' : 'blue-white-porcelain', 'dark')['--primary']);
    }
  });
});
