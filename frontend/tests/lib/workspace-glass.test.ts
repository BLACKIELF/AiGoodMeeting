import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  PALETTES, contrastRatio, getAppearanceTheme, getAppearanceVariables, getPaletteTokens,
} from '../../src/lib/appearance';
import {
  WORKSPACE_GLASS_DEFAULTS, WORKSPACE_GLASS_METRICS, getWorkspaceGlassRecipe,
  getWorkspaceGlassSemanticBacking, getWorkspaceGlassVariables,
} from '../../src/lib/workspace-glass';

const css = readFileSync(new URL('../../src/app/globals.css', import.meta.url), 'utf8');

describe('shared WorkspaceGlass source adaptation', () => {
  test('uses the original default preference contract and depth equations', () => {
    expect(WORKSPACE_GLASS_DEFAULTS).toEqual({ systemGlass: true, opacity: 68, depth: 32 });
    expect(WORKSPACE_GLASS_METRICS.tintOpacity).toBeCloseTo(0.68, 12);
    expect(WORKSPACE_GLASS_METRICS.lineOpacity).toBeCloseTo(0.1288, 12);
    expect(WORKSPACE_GLASS_METRICS.controlOpacity).toBeCloseTo(0.0444, 12);
    expect(WORKSPACE_GLASS_METRICS.strength).toBeCloseTo(0.904, 12);
    // Depth is not translated into a physical blur radius.
    expect(getWorkspaceGlassVariables(getWorkspaceGlassRecipe('default', 'light', getPaletteTokens('default', 'light'), '#FFFFFF', '#24272D'))['--agb-glass-material-filter']).toBe('blur(20px) saturate(110%)');
  });

  test('themed backdrop has exactly the original five layers, stops and radii', () => {
    const tokens = getPaletteTokens('dunhuang-apsara', 'dark');
    const recipe = getWorkspaceGlassRecipe('dunhuang-apsara', 'dark', tokens, '#2C2F35', '#F2F3F5');
    expect(recipe.backdrop.map(layer => layer.kind)).toEqual(['linear', 'radial', 'radial', 'radial', 'linear']);
    expect(recipe.backdrop[0].stops.map(item => item.color)).toEqual([tokens.accent.primary, tokens.accent.secondary, tokens.accent.highlight]);
    expect(recipe.backdrop[0].stops.map(item => item.opacity)).toEqual([0.20, 0.13, 0.10].map(alpha => alpha * WORKSPACE_GLASS_METRICS.strength));
    expect(recipe.backdrop[1].center).toEqual([0.08, 0.08]); expect(recipe.backdrop[1].radius).toBe(0.88);
    expect(recipe.backdrop[1].stops.map(item => item.location)).toEqual([0, 0.47, 1]);
    expect(recipe.backdrop[2].center).toEqual([1, 1]); expect(recipe.backdrop[2].radius).toBe(0.76);
    expect(recipe.backdrop[3].center).toEqual([0.88, 0.12]); expect(recipe.backdrop[3].radius).toBe(0.54);
    expect(recipe.backdrop[4].stops.map(item => item.location)).toEqual([0, 0.42, 1]);
    expect(recipe.baseTint).toBe('#303438'); expect(recipe.baseTintOpacity).toBe(0.68);
  });

  test('default backdrop retains its two quieter source radials', () => {
    for (const appearance of ['light', 'dark'] as const) {
      const recipe = getWorkspaceGlassRecipe('default', appearance, getPaletteTokens('default', appearance), '#FFFFFF', '#24272D');
      expect(recipe.themed).toBeFalse(); expect(recipe.backdrop).toHaveLength(2);
      expect(recipe.backdrop.map(layer => layer.radiusBasis)).toEqual(['width', 'width']);
      expect(recipe.backdrop.map(layer => layer.radius)).toEqual([0.8, 0.65]);
      expect(recipe.backdrop[0].stops[0].opacity).toBe(appearance === 'dark' ? 0.14 : 0.10);
      expect(recipe.backdrop[1].stops[0].opacity).toBe(appearance === 'dark' ? 0.075 : 0.055);
      expect(recipe.controlBaseOpacity).toBe(0); expect(recipe.lineWidth).toBe(0.6);
    }
  });

  test('surface, sheen, selected alpha and gradient edge follow source values', () => {
    const tokens = getPaletteTokens('blue-white-porcelain', 'light');
    const recipe = getWorkspaceGlassRecipe('blue-white-porcelain', 'light', tokens, '#FFFFFF', '#24272D');
    expect(recipe.controlBaseOpacity).toBe(0.36);
    expect(recipe.controlWhiteOpacity).toBeCloseTo(0.0444 * 1.4, 12);
    expect(recipe.surfaceTintOpacity).toBe(tokens.surfaceTint.maximumOpacity * 0.75);
    expect(recipe.surfaceSheen.map(item => item.opacity)).toEqual([0.36, 0.035, 0]);
    expect(recipe.edge.map(item => item.opacity)).toEqual([0.78, 0.1288 * 1.8, 0.1288 * 0.6]);
    expect(recipe.lineWidth).toBe(0.7); expect(recipe.selectedLineWidth).toBe(1);
    expect(recipe.selectedFill).toBe(tokens.selection.fill); expect(recipe.selectedStroke).toBe(tokens.selection.stroke);
    const variables = getWorkspaceGlassVariables(recipe);
    expect(variables['--agb-selected-fill']).toContain('0.121569');
    expect(variables['--agb-workspace-backdrop']).toContain('47%');
  });

  test('original artwork tokens are deeply read-only and retain full source fields', () => {
    const tokens = getPaletteTokens('orchid-dawn', 'dark');
    expect(Object.isFrozen(tokens)).toBeTrue(); expect(Object.isFrozen(tokens.quota.primary)).toBeTrue();
    expect(Object.isFrozen(tokens.data.series)).toBeTrue(); expect(tokens.selection.focusRing).toMatch(/^#[0-9A-F]{8}$/);
    expect(tokens.quota.primary.start).toBe('#D0BCFA'); expect(tokens.ornament.metal).toBe('#E9A071');
  });

  for (const palette of PALETTES) for (const appearance of ['light', 'dark'] as const) {
    test(`${palette.id} ${appearance}: original backdrop plus transparent semantic backing remains readable`, () => {
      const theme = getAppearanceTheme(palette.id, appearance);
      const tokens = getPaletteTokens(palette.id, appearance);
      const recipe = getWorkspaceGlassRecipe(palette.id, appearance, tokens, theme.card, theme.foreground);
      const originalForeground = appearance === 'dark' ? '#F2F3F5' : '#24272D';
      const originalMuted = appearance === 'dark' ? '#B0B7C2' : '#5F6773';
      const backing = getWorkspaceGlassSemanticBacking(recipe, theme.background, originalForeground,
        [originalMuted, theme.destructive, theme.success, theme.warning]);
      expect(backing.contentOpacity).toBeLessThanOrEqual(0.08);
      expect(backing.surfaceOpacity).toBeLessThan(1);
      for (const surface of backing.samples) {
        for (const ink of [theme.foreground, theme.muted, theme.subtle, theme.primary]) {
          expect(contrastRatio(ink, surface)).toBeGreaterThanOrEqual(4.5);
        }
        expect(contrastRatio(theme.inputBorder, surface)).toBeGreaterThanOrEqual(3);
      }
      expect(theme.controlFill).toBe(tokens.accent.primary);
      expect(contrastRatio(theme.controlFillForeground, theme.controlFill)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.controlFillForeground, theme.controlFillHover)).toBeGreaterThanOrEqual(4.5);
      const variables = getAppearanceVariables(palette.id, appearance);
      expect(variables['--agb-workspace-backdrop']).toBe(getWorkspaceGlassVariables(recipe)['--agb-workspace-backdrop']);
      expect(variables['--agb-glass-semantic-backing']).toBe(backing.variables['--agb-glass-semantic-backing']);
    });
  }

  test('real shell/surfaces avoid opaque wrappers, have one material pass, and offer accessibility fallbacks', () => {
    expect(css).not.toMatch(/\.agb-palette-preview|\.agb-preview-|\.agb-palette-choice/);
    expect(css).toContain(':root .agb-shell::before');
    expect(css).toContain('background-image: var(--agb-workspace-backdrop)');
    expect(css).toContain('background-image: var(--agb-glass-semantic-backing), var(--agb-glass-surface)');
    expect(css).toContain(':root .agb-panel > :is(div, section).bg-card');
    expect(css).toContain('-webkit-mask-composite: xor'); expect(css).toContain('mask-composite: exclude');
    expect(css).toContain('@media (prefers-reduced-transparency: reduce), (prefers-contrast: more)');
    expect(css).toContain('.agb-shell::before { background-image: none; backdrop-filter: none;');
  });

  test('progress artwork uses the one original asset only where active progress fills exist', () => {
    for (const palette of PALETTES) for (const appearance of ['light', 'dark'] as const) {
      const texture = getAppearanceVariables(palette.id, appearance)['--agb-progress-texture'];
      expect(texture).toBe(palette.id === 'blue-white-porcelain'
        ? `url("/aigoodbro-skins/blue-white-porcelain/assets/${appearance}/progress-linear.svg")` : 'none');
    }
    for (const file of ['ImportAudio/ImportAudioDialog.tsx', 'MeetingDetails/RetranscribeDialog.tsx']) {
      const source = readFileSync(new URL(`../../src/components/${file}`, import.meta.url), 'utf8');
      expect(source).toContain('bg-primary h-3 rounded-full transition-all');
      expect(source).toContain('Math.min(progress.progress_percentage, 100)');
    }
    for (const file of ['WhisperModelManager.tsx', 'ParakeetModelManager.tsx']) {
      const source = readFileSync(new URL(`../../src/components/${file}`, import.meta.url), 'utf8');
      expect(source).toContain('w-full h-2 bg-muted rounded-full overflow-hidden');
      expect(source).toContain('h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full');
    }
    expect(css).toContain('.h-3.rounded-full.bg-primary.transition-all[style*="width"]');
    expect(css).toContain('.h-2.rounded-full.overflow-hidden > .h-full.bg-gradient-to-r[style*="width"]');
    expect(css).toContain('background-repeat: repeat-x'); expect(css).toContain('background-size: auto 100%');
  });
});
