import defaultLight from './palettes/default/tokens/light.json';
import defaultDark from './palettes/default/tokens/dark.json';
import defaultLabel from './palettes/default/localizations/zh-Hans.json';
import liquidLight from './palettes/liquid-keycap/tokens/light.json';
import liquidDark from './palettes/liquid-keycap/tokens/dark.json';
import liquidLabel from './palettes/liquid-keycap/localizations/zh-Hans.json';
import porcelainLight from './palettes/blue-white-porcelain/tokens/light.json';
import porcelainDark from './palettes/blue-white-porcelain/tokens/dark.json';
import porcelainLabel from './palettes/blue-white-porcelain/localizations/zh-Hans.json';
import dunhuangLight from './palettes/dunhuang-apsara/tokens/light.json';
import dunhuangDark from './palettes/dunhuang-apsara/tokens/dark.json';
import dunhuangLabel from './palettes/dunhuang-apsara/localizations/zh-Hans.json';
import forbiddenLight from './palettes/forbidden-city-red/tokens/light.json';
import forbiddenDark from './palettes/forbidden-city-red/tokens/dark.json';
import forbiddenLabel from './palettes/forbidden-city-red/localizations/zh-Hans.json';
import orchidLight from './palettes/orchid-dawn/tokens/light.json';
import orchidDark from './palettes/orchid-dawn/tokens/dark.json';
import orchidLabel from './palettes/orchid-dawn/localizations/zh-Hans.json';
import landscapeLight from './palettes/thousand-li-landscape/tokens/light.json';
import landscapeDark from './palettes/thousand-li-landscape/tokens/dark.json';
import landscapeLabel from './palettes/thousand-li-landscape/localizations/zh-Hans.json';
import { getWorkspaceGlassRecipe, getWorkspaceGlassSemanticBacking, getWorkspaceGlassVariables } from './workspace-glass';

export type Appearance = 'light' | 'dark' | 'system';
export type ResolvedAppearance = Exclude<Appearance, 'system'>;
export type PaletteId = 'default' | 'liquid-keycap' | 'blue-white-porcelain' | 'dunhuang-apsara'
  | 'forbidden-city-red' | 'orchid-dawn' | 'thousand-li-landscape';

export interface PaletteTokens {
  accent: { primary: string; primaryStrong: string; primaryLight: string; secondary: string; secondaryStrong: string; highlight: string };
  selection: { foreground: string; fill: string; stroke: string; focusRing: string };
  surfaceTint: { color: string; maximumOpacity: number };
  quota: {
    primary: { start: string; end: string; track: string; label: string };
    secondary: { start: string; end: string; track: string; label: string };
  };
  data: { series: string[]; modelSeries: string[]; tokenInput: string; tokenCached: string; tokenOutput: string;
    heatmap: string[]; zero: string; valueProgress: string[]; milestones: string[] };
  ornament: { ink: string; inkSoft: string; secondaryInk: string; highlight: string; metal: string };
}
export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type ReadonlyPaletteTokens = DeepReadonly<PaletteTokens>;
export interface Palette {
  id: PaletteId;
  name: string;
  description: string;
  light: PaletteTokens;
  dark: PaletteTokens;
}

export const PALETTES: readonly Palette[] = [
  { id: 'default', name: defaultLabel.displayName, description: defaultLabel.shortDescription, light: defaultLight, dark: defaultDark },
  { id: 'liquid-keycap', name: liquidLabel.displayName, description: liquidLabel.shortDescription, light: liquidLight, dark: liquidDark },
  { id: 'blue-white-porcelain', name: porcelainLabel.displayName, description: porcelainLabel.shortDescription, light: porcelainLight, dark: porcelainDark },
  { id: 'dunhuang-apsara', name: dunhuangLabel.displayName, description: dunhuangLabel.shortDescription, light: dunhuangLight, dark: dunhuangDark },
  { id: 'forbidden-city-red', name: forbiddenLabel.displayName, description: forbiddenLabel.shortDescription, light: forbiddenLight, dark: forbiddenDark },
  { id: 'orchid-dawn', name: orchidLabel.displayName, description: orchidLabel.shortDescription, light: orchidLight, dark: orchidDark },
  { id: 'thousand-li-landscape', name: landscapeLabel.displayName, description: landscapeLabel.shortDescription, light: landscapeLight, dark: landscapeDark },
];

export const APPEARANCE_STORAGE_KEY = 'meetily.appearance.v1';
export interface AppearancePreferences { version: 1; paletteId: PaletteId; appearance: Appearance }
export const DEFAULT_APPEARANCE: AppearancePreferences = { version: 1, paletteId: 'default', appearance: 'system' };
export const APPEARANCE_OPTIONS: readonly { value: Appearance; label: string }[] = [
  { value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }, { value: 'system', label: '跟随系统' },
];

export function isPaletteId(value: unknown): value is PaletteId {
  return PALETTES.some(palette => palette.id === value);
}
export function isAppearance(value: unknown): value is Appearance {
  return value === 'light' || value === 'dark' || value === 'system';
}
export function getPalette(id: PaletteId): Palette {
  return PALETTES.find(palette => palette.id === id) ?? PALETTES[0];
}
function freezeDeep<T extends object>(value: T): DeepReadonly<T> {
  for (const child of Object.values(value)) if (child && typeof child === 'object' && !Object.isFrozen(child)) freezeDeep(child);
  return Object.freeze(value) as DeepReadonly<T>;
}
/** Original source tokens, including 8-digit alpha hex; consumers cannot mutate them. */
export function getPaletteTokens(id: PaletteId, appearance: ResolvedAppearance): ReadonlyPaletteTokens {
  return freezeDeep(getPalette(id)[appearance]);
}
export function parseAppearancePreferences(raw: string | null): AppearancePreferences {
  if (!raw) return { ...DEFAULT_APPEARANCE };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_APPEARANCE };
    const stored = value as Record<string, unknown>;
    if (stored.version !== 1) return { ...DEFAULT_APPEARANCE };
    return { version: 1,
      paletteId: isPaletteId(stored.paletteId) ? stored.paletteId : DEFAULT_APPEARANCE.paletteId,
      appearance: isAppearance(stored.appearance) ? stored.appearance : DEFAULT_APPEARANCE.appearance };
  } catch { return { ...DEFAULT_APPEARANCE }; }
}
export function resolveAppearance(appearance: Appearance, systemDark: boolean): ResolvedAppearance {
  return appearance === 'system' ? (systemDark ? 'dark' : 'light') : appearance;
}

type RGB = [number, number, number];
function rgb(hex: string): RGB {
  return [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16)) as RGB;
}
export function mixColor(background: string, foreground: string, amount: number): string {
  const base = rgb(background), tint = rgb(foreground);
  return '#' + base.map((channel, index) => Math.round(channel * (1 - amount) + tint[index] * amount).toString(16).padStart(2, '0')).join('');
}
export function contrastRatio(first: string, second: string): number {
  const luminance = (hex: string) => rgb(hex).map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
function hsl(hex: string): string {
  const [r, g, b] = rgb(hex).map(channel => channel / 255);
  const high = Math.max(r, g, b), low = Math.min(r, g, b), difference = high - low;
  const lightness = (high + low) / 2;
  const saturation = difference === 0 ? 0 : difference / (1 - Math.abs(2 * lightness - 1));
  const hue = difference === 0 ? 0 : high === r ? ((g - b) / difference + 6) % 6 : high === g ? (b - r) / difference + 2 : (r - g) / difference + 4;
  return `${(hue * 60).toFixed(2)} ${(saturation * 100).toFixed(2)}% ${(lightness * 100).toFixed(2)}%`;
}

export interface AppearanceTheme {
  background: string; foreground: string; sidebar: string; panel: string; card: string;
  muted: string; subtle: string; border: string; inputBorder: string;
  primary: string; primaryForeground: string; primaryHover: string;
  controlFill: string; controlFillForeground: string; controlFillHover: string;
  selection: string; selectionForeground: string;
  destructive: string; destructiveForeground: string;
  success: string; warning: string;
}

const appearanceThemeCache = new Map<string, AppearanceTheme>();

export function getAppearanceTheme(id: PaletteId, appearance: ResolvedAppearance): AppearanceTheme {
  const cached = appearanceThemeCache.get(`${id}:${appearance}`);
  if (cached) return cached;
  const dark = appearance === 'dark';
  const tokens = getPalette(id)[appearance];
  const theme = dark ? {
    background: '#202226', foreground: '#F2F3F5', sidebar: '#25272B', panel: '#26292E', card: '#2C2F35',
    muted: '#B0B7C2', subtle: '#9EA7B5', border: '#444A54', inputBorder: '#788597',
    destructive: '#F18D96', destructiveForeground: '#25151A', success: '#8DD6AB', warning: '#E8C579',
  } : {
    background: '#F4F5F7', foreground: '#24272D', sidebar: '#ECEEF1', panel: '#FAFBFC', card: '#FFFFFF',
    muted: '#5F6773', subtle: '#616B79', border: '#D8DDE5', inputBorder: '#8490A2',
    destructive: '#B82435', destructiveForeground: '#FFFFFF', success: '#246C43', warning: '#82570E',
  };
  const selection = mixColor(theme.card, tokens.accent.primary, dark ? 0.17 : 0.10);
  const glass = getWorkspaceGlassRecipe(id, appearance, tokens, theme.card, theme.foreground);
  const backing = getWorkspaceGlassSemanticBacking(glass, theme.background, theme.foreground,
    [theme.muted, theme.destructive, theme.success, theme.warning]);
  const surfaces = [theme.background, theme.card, theme.sidebar, theme.panel, selection,
    ...backing.samples];
  const candidates = [tokens.accent.primary, tokens.accent.primaryStrong, tokens.accent.primaryLight];
  // Keep the original source variant when readable; use a nearby source color
  // before deriving a minimal contrast adjustment for UI text.
  let primary = candidates.find(color => surfaces.every(surface => contrastRatio(color, surface) >= 4.5));
  if (!primary) {
    for (let step = 1; step <= 20; step++) {
      const candidate = mixColor(tokens.accent.primary, dark ? '#FFFFFF' : '#000000', step / 20);
      if (surfaces.every(surface => contrastRatio(candidate, surface) >= 4.5)) { primary = candidate; break; }
    }
  }
  primary ??= dark ? '#FFFFFF' : '#000000';
  const primaryForeground = contrastRatio(primary, '#FFFFFF') >= contrastRatio(primary, '#181B20') ? '#FFFFFF' : '#181B20';
  const primaryHover = mixColor(primary, primaryForeground === '#FFFFFF' ? '#000000' : '#FFFFFF', 0.08);
  // PaletteEnvironment.swift deliberately separates readable text/icon ink from
  // saturated filled controls. Preserve that distinction on colored glass.
  const controlFill = tokens.accent.primary;
  const controlFillForeground = contrastRatio(controlFill, '#FFFFFF') >= contrastRatio(controlFill, '#000000') ? '#FFFFFF' : '#000000';
  const controlFillHover = mixColor(controlFill, controlFillForeground === '#FFFFFF' ? '#000000' : '#FFFFFF', 0.08);
  const readable = (color: string, minimum = 4.5) => {
    if (surfaces.every(surface => contrastRatio(color, surface) >= minimum)) return color;
    for (let step = 1; step <= 100; step++) {
      const candidate = mixColor(color, dark ? '#FFFFFF' : '#000000', step / 100);
      if (surfaces.every(surface => contrastRatio(candidate, surface) >= minimum)) return candidate;
    }
    return dark ? '#FFFFFF' : '#000000';
  };
  const result = { ...theme, foreground: readable(theme.foreground), muted: readable(theme.muted), subtle: readable(theme.subtle),
    inputBorder: readable(theme.inputBorder, 3), primary, primaryForeground, primaryHover,
    controlFill, controlFillForeground, controlFillHover, selection, selectionForeground: primary };
  appearanceThemeCache.set(`${id}:${appearance}`, result);
  return result;
}

export function getAppearanceVariables(id: PaletteId, appearance: ResolvedAppearance): Record<string, string> {
  const theme = getAppearanceTheme(id, appearance), source = getPalette(id)[appearance];
  const roles: Record<string, string> = {
    background: theme.background, foreground: theme.foreground,
    card: theme.card, 'card-foreground': theme.foreground,
    popover: theme.card, 'popover-foreground': theme.foreground,
    primary: theme.controlFill, 'primary-foreground': theme.controlFillForeground,
    secondary: theme.sidebar, 'secondary-foreground': theme.foreground,
    muted: theme.sidebar, 'muted-foreground': theme.muted,
    accent: theme.selection, 'accent-foreground': theme.selectionForeground,
    destructive: theme.destructive, 'destructive-foreground': theme.destructiveForeground,
    border: theme.border, input: theme.inputBorder, ring: theme.primary,
  };
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(roles)) {
    result[`--${key}`] = hsl(value);
    // BlockNote defines its own shadcn variables; these aliases remain inherited.
    result[`--agb-${key}`] = hsl(value);
  }
  Object.assign(result, {
    '--agb-sidebar': hsl(theme.sidebar), '--agb-panel': hsl(theme.panel), '--agb-subtle': hsl(theme.subtle),
    '--agb-primary-hover': hsl(theme.controlFillHover), '--agb-source-primary': hsl(source.accent.primary),
    '--agb-control-foreground': hsl(theme.primary),
    '--agb-secondary-accent': hsl(source.accent.secondary), '--agb-highlight': hsl(source.accent.highlight),
    '--agb-success': hsl(theme.success), '--agb-warning': hsl(theme.warning),
    '--agb-tint': hsl(source.surfaceTint.color), '--agb-tint-opacity': String(Math.min(source.surfaceTint.maximumOpacity, 0.04)),
    '--agb-material-opacity': appearance === 'dark' ? '0.91' : '0.88',
    '--agb-shadow': appearance === 'dark' ? '0 10px 32px #00000026, 0 1px 2px #00000020' : '0 8px 28px #26334A08, 0 1px 2px #26334A05',
    '--agb-panel-shadow': appearance === 'dark' ? '0 1px 0 #FFFFFF06 inset' : '0 1px 0 #FFFFFFB3 inset',
  });
  const glass = getWorkspaceGlassRecipe(id, appearance, source, theme.card, theme.foreground);
  Object.assign(result, getWorkspaceGlassVariables(glass),
    getWorkspaceGlassSemanticBacking(glass, theme.background, appearance === 'dark' ? '#F2F3F5' : '#24272D',
      [appearance === 'dark' ? '#B0B7C2' : '#5F6773', theme.destructive, theme.success, theme.warning]).variables, {
    '--agb-progress-texture': id === 'blue-white-porcelain'
      ? `url("/aigoodbro-skins/blue-white-porcelain/assets/${appearance}/progress-linear.svg")` : 'none',
  });
  const neutrals = appearance === 'dark'
    ? ['#292C31', '#32363D', '#454C57', '#697485', '#A3AEBD', '#B4BECC', '#C3CBD7', '#D2D9E3', '#E2E7EE', '#F0F3F7', '#F8FAFC']
    : ['#FAFBFC', '#F1F3F5', '#E5E8ED', '#CDD3DE', '#8490A2', '#667182', '#515D6F', '#3F4B5D', '#2D384A', '#202A3A', '#151D2B'];
  [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].forEach((step, index) => {
    result[`--agb-neutral-${step}`] = hsl(neutrals[index]);
  });
  [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].forEach((step, index) => {
    let amount = [0.03, 0.06, 0.09, 0.12][index] ?? 0;
    let color = index < 4 ? mixColor(theme.card, theme.primary, amount)
      : index === 6 ? theme.controlFillHover : theme.controlFill;
    while (index < 4 && contrastRatio(theme.primary, color) < 4.55 && amount > 0.01) {
      amount -= 0.005; color = mixColor(theme.card, theme.primary, amount);
    }
    result[`--agb-blue-${step}`] = hsl(color);
  });
  source.data.series.slice(0, 5).forEach((value, index) => { result[`--chart-${index + 1}`] = hsl(value); });
  result['--chart-4'] = hsl(theme.success);
  result['--chart-5'] = hsl(theme.warning);
  return result;
}

export function applyAppearance(root: HTMLElement, preferences: AppearancePreferences, systemDark: boolean): ResolvedAppearance {
  const resolved = resolveAppearance(preferences.appearance, systemDark);
  root.dataset.palette = preferences.paletteId;
  root.dataset.appearance = resolved;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
  for (const [key, value] of Object.entries(getAppearanceVariables(preferences.paletteId, resolved))) root.style.setProperty(key, value);
  return resolved;
}

/** A tiny pre-paint script; importing this module never reads window. */
export function getAppearanceBootstrapScript(): string {
  const variables = Object.fromEntries(PALETTES.map(palette => [palette.id, {
    light: getAppearanceVariables(palette.id, 'light'), dark: getAppearanceVariables(palette.id, 'dark'),
  }]));
  return `(function(){var p=${JSON.stringify(DEFAULT_APPEARANCE)},v=${JSON.stringify(variables)};try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(APPEARANCE_STORAGE_KEY)})||'null');if(s&&s.version===1){if(Object.prototype.hasOwnProperty.call(v,s.paletteId))p.paletteId=s.paletteId;if(['light','dark','system'].indexOf(s.appearance)>=0)p.appearance=s.appearance}}catch(e){}var d=false;try{d=window.matchMedia('(prefers-color-scheme: dark)').matches}catch(e){}var a=p.appearance==='system'?(d?'dark':'light'):p.appearance,r=document.documentElement;r.dataset.palette=p.paletteId;r.dataset.appearance=a;r.classList.toggle('dark',a==='dark');r.style.colorScheme=a;var t=v[p.paletteId][a];Object.keys(t).forEach(function(k){r.style.setProperty(k,t[k])})})();`;
}
