/**
 * Web adaptation of AiGoodBro's WorkspaceGlass.swift / WorkspaceGlassPreferences.
 * Original implementation: Copyright (c) 2026 Guomeiqing, MIT.
 * Full source and license: vendor/aigoodbro-skins/ at the project root (snapshot).
 * The coefficients below are source formulas, not per-skin artwork additions.
 * CSS only samples content in the web view; it does not reproduce AppKit's
 * NSVisualEffectView(.hudWindow, .behindWindow) or desktop/window transparency.
 */
import type { PaletteId, ReadonlyPaletteTokens, ResolvedAppearance } from './appearance';

export const WORKSPACE_GLASS_DEFAULTS = Object.freeze({ systemGlass: true, opacity: 68, depth: 32 });
export const WORKSPACE_GLASS_METRICS = Object.freeze({
  tintOpacity: WORKSPACE_GLASS_DEFAULTS.opacity / 100,
  lineOpacity: 0.1 + WORKSPACE_GLASS_DEFAULTS.depth / 100 * 0.09,
  controlOpacity: 0.03 + WORKSPACE_GLASS_DEFAULTS.depth / 100 * 0.045,
  strength: 0.7 + WORKSPACE_GLASS_DEFAULTS.opacity / 100 * 0.3,
});

type RGBA = readonly [number, number, number, number];
export interface GlassStop { readonly color: string; readonly opacity: number; readonly location: number }
export interface GlassLayer {
  readonly kind: 'linear' | 'radial';
  readonly stops: readonly GlassStop[];
  readonly center?: readonly [number, number];
  readonly radius?: number;
  readonly radiusBasis?: 'width' | 'span';
}
export interface WorkspaceGlassRecipe {
  readonly themed: boolean;
  readonly appearance: ResolvedAppearance;
  readonly baseTint: string;
  readonly baseTintOpacity: number;
  /** SwiftUI ZStack order: first is the lowest layer. */
  readonly backdrop: readonly GlassLayer[];
  readonly controlBase: string;
  readonly controlBaseOpacity: number;
  readonly controlWhiteOpacity: number;
  readonly surfaceTint: string;
  readonly surfaceTintOpacity: number;
  readonly surfaceSheen: readonly GlassStop[];
  readonly edge: readonly GlassStop[];
  readonly lineWidth: number;
  readonly selectedLineWidth: number;
  readonly selectedFill: string;
  readonly selectedStroke: string;
  readonly shadowOpacity: number;
}

const stop = (color: string, opacity: number, location: number): GlassStop => ({ color, opacity, location });
const linear = (...stops: GlassStop[]): GlassLayer => ({ kind: 'linear', stops });
const radial = (center: readonly [number, number], radius: number, radiusBasis: 'width' | 'span', ...stops: GlassStop[]): GlassLayer => ({ kind: 'radial', center, radius, radiusBasis, stops });

export function getWorkspaceGlassRecipe(id: PaletteId, appearance: ResolvedAppearance,
  tokens: ReadonlyPaletteTokens, controlBase: string, foreground: string): WorkspaceGlassRecipe {
  const dark = appearance === 'dark', themed = id !== 'default';
  const { tintOpacity, lineOpacity, controlOpacity, strength } = WORKSPACE_GLASS_METRICS;
  const accent = tokens.accent;
  const backdrop = themed ? [
    linear(stop(accent.primary, (dark ? 0.20 : 0.12) * strength, 0),
      stop(accent.secondary, (dark ? 0.13 : 0.08) * strength, 0.5),
      stop(accent.highlight, (dark ? 0.10 : 0.07) * strength, 1)),
    radial([0.08, 0.08], 0.88, 'span',
      stop(accent.primary, (dark ? 0.45 : 0.34) * strength, 0),
      stop(accent.primaryLight, (dark ? 0.23 : 0.16) * strength, 0.47),
      stop(accent.primaryLight, 0, 1)),
    radial([1, 1], 0.76, 'span', stop(accent.secondary, (dark ? 0.38 : 0.25) * strength, 0), stop(accent.secondary, 0, 1)),
    radial([0.88, 0.12], 0.54, 'span', stop(accent.highlight, (dark ? 0.22 : 0.17) * strength, 0), stop(accent.highlight, 0, 1)),
    linear(stop('#FFFFFF', dark ? 0.08 : 0.20, 0), stop('#FFFFFF', 0, 0.42), stop('#FFFFFF', dark ? 0.015 : 0.055, 1)),
  ] : [
    radial([0, 0], 0.8, 'width', stop(accent.primary, dark ? 0.14 : 0.10, 0), stop(accent.primary, 0, 1)),
    radial([1, 1], 0.65, 'width', stop(accent.secondary, dark ? 0.075 : 0.055, 0), stop(accent.secondary, 0, 1)),
  ];
  return {
    themed, appearance, baseTint: dark ? '#303438' : '#F6F7FA', baseTintOpacity: tintOpacity,
    backdrop, controlBase, controlBaseOpacity: themed ? (dark ? 0.24 : 0.36) : 0,
    controlWhiteOpacity: controlOpacity * (dark ? 0.4 : 1.4),
    surfaceTint: tokens.surfaceTint.color,
    surfaceTintOpacity: tokens.surfaceTint.maximumOpacity * (themed ? 0.75 : 0.22),
    surfaceSheen: themed
      ? [stop('#FFFFFF', dark ? 0.13 : 0.36, 0), stop(accent.primaryLight, dark ? 0.065 : 0.035, 0.5), stop(accent.primaryLight, 0, 1)]
      : [stop('#FFFFFF', dark ? 0.055 : 0.14, 0), stop('#FFFFFF', 0, 1)],
    edge: themed
      ? [stop('#FFFFFF', dark ? 0.38 : 0.78, 0), stop(accent.primaryLight, lineOpacity * 1.8, 0.5), stop(foreground, lineOpacity * 0.6, 1)]
      : [stop(foreground, lineOpacity * (dark ? 0.78 : 0.47), 0), stop(foreground, lineOpacity * (dark ? 0.78 : 0.47), 1)],
    lineWidth: themed ? 0.7 : 0.6, selectedLineWidth: 1,
    selectedFill: tokens.selection.fill, selectedStroke: tokens.selection.stroke,
    shadowOpacity: dark ? 0.05 : 0.025,
  };
}

function rgba(color: string, opacity = 1): RGBA {
  return [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16),
    (color.length === 9 ? parseInt(color.slice(7, 9), 16) / 255 : 1) * opacity];
}
function cssColor(color: string, opacity = 1): string {
  const [r, g, b, alpha] = rgba(color, opacity);
  return `rgba(${r}, ${g}, ${b}, ${Number(alpha.toFixed(6))})`;
}
function cssStops(stops: readonly GlassStop[]): string {
  return stops.map(item => `${cssColor(item.color, item.opacity)} ${Number((item.location * 100).toFixed(4))}%`).join(', ');
}
function cssLayer(layer: GlassLayer): string {
  if (layer.kind === 'linear') return `linear-gradient(to bottom right, ${cssStops(layer.stops)})`;
  const radius = Number(((layer.radius ?? 1) * 100).toFixed(4));
  const unit = layer.radiusBasis === 'width' ? 'vw' : 'vmax';
  return `radial-gradient(circle ${radius}${unit} at ${(layer.center?.[0] ?? 0) * 100}% ${(layer.center?.[1] ?? 0) * 100}%, ${cssStops(layer.stops)})`;
}
const solid = (color: string, opacity: number) => `linear-gradient(${cssColor(color, opacity)}, ${cssColor(color, opacity)})`;

export function getWorkspaceGlassVariables(recipe: WorkspaceGlassRecipe): Record<string, string> {
  const surfaceLayers = [
    solid(recipe.controlBase, recipe.controlBaseOpacity), solid('#FFFFFF', recipe.controlWhiteOpacity),
    solid(recipe.surfaceTint, recipe.surfaceTintOpacity), cssLayer(linear(...recipe.surfaceSheen)),
  ];
  return {
    '--agb-glass-opacity': String(WORKSPACE_GLASS_DEFAULTS.opacity), '--agb-glass-depth': String(WORKSPACE_GLASS_DEFAULTS.depth),
    '--agb-glass-tint-opacity': String(WORKSPACE_GLASS_METRICS.tintOpacity),
    '--agb-glass-line-opacity': String(WORKSPACE_GLASS_METRICS.lineOpacity),
    '--agb-glass-control-opacity': String(WORKSPACE_GLASS_METRICS.controlOpacity),
    '--agb-glass-strength': String(WORKSPACE_GLASS_METRICS.strength),
    '--agb-workspace-backdrop': [...recipe.backdrop].reverse().map(cssLayer).concat(solid(recipe.baseTint, recipe.baseTintOpacity)).join(', '),
    '--agb-glass-surface': surfaceLayers.reverse().join(', '),
    '--agb-glass-edge': cssLayer(linear(...recipe.edge)),
    '--agb-glass-line-width': `${recipe.lineWidth}px`,
    '--agb-glass-selected-line-width': `${recipe.selectedLineWidth}px`,
    '--agb-selected-fill': cssColor(recipe.selectedFill), '--agb-selected-stroke': cssColor(recipe.selectedStroke),
    '--agb-glass-shadow': `0 2px 6px ${cssColor('#000000', recipe.shadowOpacity)}`,
    '--agb-glass-material-filter': 'blur(20px) saturate(110%)',
  };
}

function over(background: RGBA, foreground: RGBA): RGBA {
  const alpha = foreground[3] + background[3] * (1 - foreground[3]);
  if (!alpha) return [0, 0, 0, 0];
  return [0, 1, 2].map(index => (foreground[index] * foreground[3] + background[index] * background[3] * (1 - foreground[3])) / alpha).concat(alpha) as unknown as RGBA;
}
function hex(color: RGBA): string {
  return '#' + color.slice(0, 3).map(channel => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0')).join('');
}
function sampleStops(stops: readonly GlassStop[], amount: number): RGBA {
  const first = stops[0], last = stops[stops.length - 1];
  if (amount <= first.location) return rgba(first.color, first.opacity);
  if (amount >= last.location) return rgba(last.color, last.opacity);
  const index = stops.findIndex(item => item.location >= amount);
  const left = stops[index - 1], right = stops[index];
  const progress = (amount - left.location) / (right.location - left.location);
  const a = rgba(left.color, left.opacity), b = rgba(right.color, right.opacity);
  const alpha = a[3] + (b[3] - a[3]) * progress;
  // CSS and SwiftUI interpolate transparent gradient stops in premultiplied alpha.
  return [0, 1, 2].map(channel => alpha ? (a[channel] * a[3] * (1 - progress) + b[channel] * b[3] * progress) / alpha : 0).concat(alpha) as unknown as RGBA;
}
function sampleLayer(layer: GlassLayer, x: number, y: number, width: number, height: number): RGBA {
  const amount = layer.kind === 'linear' ? (x * width + y * height) / (width + height)
    : Math.hypot((x - (layer.center?.[0] ?? 0)) * width, (y - (layer.center?.[1] ?? 0)) * height)
      / ((layer.radius ?? 1) * (layer.radiusBasis === 'width' ? width : Math.max(width, height)));
  return sampleStops(layer.stops, amount);
}

/** Analytical color checks, not a claim of native material pixel parity. */
export function sampleWorkspaceGlass(recipe: WorkspaceGlassRecipe, neutralBase: string,
  x: number, y: number, aspectRatio = 1.6): { backdrop: string; surface: string; selected: string } {
  let backdrop = over(rgba(neutralBase), rgba(recipe.baseTint, recipe.baseTintOpacity));
  for (const layer of recipe.backdrop) backdrop = over(backdrop, sampleLayer(layer, x, y, aspectRatio, 1));
  let surface = over(backdrop, rgba(recipe.controlBase, recipe.controlBaseOpacity));
  surface = over(surface, rgba('#FFFFFF', recipe.controlWhiteOpacity));
  surface = over(surface, rgba(recipe.surfaceTint, recipe.surfaceTintOpacity));
  surface = over(surface, sampleStops(recipe.surfaceSheen, (x + y) / 2));
  return { backdrop: hex(backdrop), surface: hex(surface), selected: hex(over(surface, rgba(recipe.selectedFill))) };
}

function contrast(first: string, second: string): number {
  const luminance = (color: string) => rgba(color).slice(0, 3).map(channel => {
    const unit = channel / 255;
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export interface WorkspaceGlassSemanticBacking {
  readonly contentOpacity: number;
  readonly surfaceOpacity: number;
  readonly samples: readonly string[];
  readonly variables: Readonly<Record<string, string>>;
}

/** Native system colors/material have adaptive contrast that CSS cannot inherit.
 * Keep the source backdrop intact on the shell; add the smallest neutral backing
 * only on text-bearing content/surfaces. This is an explicit Web adaptation,
 * separate from the unmodified source gradient/control/edge coefficients.
 */
export function getWorkspaceGlassSemanticBacking(recipe: WorkspaceGlassRecipe, neutralBase: string,
  foreground: string, surfaceSemanticColors: readonly string[]): WorkspaceGlassSemanticBacking {
  const backdropSamples: string[] = [], surfaceSamples: string[] = [];
  for (const aspect of [0.8, 1.6, 2.2]) for (const x of [0, 0.25, 0.5, 0.75, 1]) for (const y of [0, 0.25, 0.5, 0.75, 1]) {
    const colors = sampleWorkspaceGlass(recipe, neutralBase, x, y, aspect);
    backdropSamples.push(colors.backdrop); surfaceSamples.push(colors.surface);
  }
  const backed = (color: string, opacity: number) => hex(over(rgba(color), rgba(neutralBase, opacity)));
  const selected = (color: string) => hex(over(rgba(color), rgba(recipe.selectedFill)));
  const minimumBacking = (colors: readonly string[], text: readonly string[], includeSelected: boolean) => {
    for (let step = 0; step <= 100; step++) {
      const opacity = step / 100;
      if (colors.every(color => {
        const surface = backed(color, opacity);
        return text.every(ink => contrast(ink, surface) >= 4.5 && (!includeSelected || contrast(ink, selected(surface)) >= 4.5));
      })) return opacity;
    }
    return 1;
  };
  const contentOpacity = minimumBacking(backdropSamples, [foreground], false);
  const surfaceOpacity = minimumBacking(surfaceSamples, [foreground, ...surfaceSemanticColors], false);
  const samples = new Set<string>(backdropSamples.map(color => backed(color, contentOpacity)));
  surfaceSamples.forEach(color => {
    const surface = backed(color, surfaceOpacity);
    samples.add(surface); samples.add(selected(surface));
  });
  return { contentOpacity, surfaceOpacity, samples: [...samples], variables: {
    '--agb-glass-content-backing': solid(neutralBase, contentOpacity),
    '--agb-glass-semantic-backing': solid(neutralBase, surfaceOpacity),
    '--agb-glass-content-backing-opacity': String(contentOpacity),
    '--agb-glass-semantic-backing-opacity': String(surfaceOpacity),
  } };
}

export function getWorkspaceGlassContrastSamples(recipe: WorkspaceGlassRecipe, neutralBase: string): readonly string[] {
  const samples = new Set<string>();
  for (const aspect of [0.8, 1.6, 2.2]) for (const x of [0, 0.25, 0.5, 0.75, 1]) for (const y of [0, 0.25, 0.5, 0.75, 1]) {
    const colors = sampleWorkspaceGlass(recipe, neutralBase, x, y, aspect);
    Object.values(colors).forEach(color => samples.add(color));
  }
  return [...samples];
}
