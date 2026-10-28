import { afterEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { PALETTES, getPaletteTokens } from '../../src/lib/appearance';
import {
  PaletteArtwork, paletteArtworkColor, paletteArtworkCSSColor, paletteFlowBandPath,
} from '../../src/components/PaletteArtwork';

describe('ported native palette artwork', () => {
  test('keeps the source cubic endpoints and control points at both native band positions', () => {
    expect(paletteFlowBandPath(100, 100, 0.20, 0.34))
      .toBe('M -8 23 C 22 61 72 10 108 38 L 108 59.6 C 72 33.2 22 76 -8 44.8 Z');
    expect(paletteFlowBandPath(100, 100, 0.15, 0.63))
      .toBe('M -8 54.75 C 22 83.25 72 45 108 66 L 108 82.2 C 72 62.4 22 94.5 -8 71.1 Z');
  });

  test('multiplies source RGBA alpha by the native opacity without changing RGB', () => {
    expect(paletteArtworkColor('#164F86A6', 0.30)).toEqual({ color: '#164F86', opacity: 166 / 255 * 0.30 });
    expect(paletteArtworkColor('#164F86', 0.92)).toEqual({ color: '#164F86', opacity: 0.92 });
    expect(paletteArtworkCSSColor('#164F86A6', 0.30)).toBe(`rgba(22, 79, 134, ${166 / 255 * 0.30})`);
  });

  test('server renders both real variants for all seven palettes with distinct SVG references', () => {
    const html = renderToStaticMarkup(<>{PALETTES.map(palette => <PaletteArtwork key={palette.id} paletteId={palette.id} />)}</>);
    expect((html.match(/data-appearance="light"/g) ?? [])).toHaveLength(7);
    expect((html.match(/data-appearance="dark"/g) ?? [])).toHaveLength(7);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const reference of html.matchAll(/url\(#([^\)]+)\)/g)) expect(ids).toContain(reference[1]);
    // Six colored themes each preserve the two flow bands, glow and metal in both halves.
    expect((html.match(/data-layer="secondary-flow-band"/g) ?? [])).toHaveLength(12);
    expect((html.match(/data-layer="primary-flow-band"/g) ?? [])).toHaveLength(12);
    expect((html.match(/data-layer="metal"/g) ?? [])).toHaveLength(12);
    expect((html.match(/data-layer="default-flow-band"/g) ?? [])).toHaveLength(2);
    expect(html).not.toMatch(/<image|<foreignObject|https?:\/\//);
  });

  test('uses the source light and dark gradient colors rather than contrast-adjusted UI colors', () => {
    for (const palette of PALETTES.filter(palette => palette.id !== 'default')) {
      const html = renderToStaticMarkup(<PaletteArtwork paletteId={palette.id} />);
      for (const appearance of ['light', 'dark'] as const) {
        const tokens = getPaletteTokens(palette.id, appearance);
        for (const color of [tokens.accent.secondary, tokens.accent.secondaryStrong,
          tokens.quota.primary.start, tokens.quota.primary.end, tokens.ornament.metal]) {
          expect(html).toContain(`stop-color="${color.slice(0, 7)}"`);
        }
      }
      for (const opacity of [0.98, 0.78, 0.52, 0.76, 0.90, 0.92, 0.22, 0.35, 0.94, 0.08, 0.48, 0.16, 0.04, 0.20]) {
        expect(html).toContain(`stop-opacity="${opacity}"`);
      }
    }
    const standard = renderToStaticMarkup(<PaletteArtwork paletteId="default" />);
    expect(standard).toContain('rgb(96% 97% 98%)');
    expect(standard).toContain('rgb(12% 14% 17%)');
    expect(standard).not.toContain('feGaussianBlur');
  });
});

const originalObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  if (originalObserver) Object.defineProperty(globalThis, 'ResizeObserver', originalObserver);
  else Reflect.deleteProperty(globalThis, 'ResizeObserver');
});

test('resizes native geometry while preserving fixed pixel blur radii and releases its observer', async () => {
  let resize!: (entries: Array<{ contentRect: { width: number; height: number } }>) => void;
  let observed = 0, disconnected = 0;
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class {
    constructor(callback: typeof resize) { resize = callback; }
    observe() { observed += 1; }
    disconnect() { disconnected += 1; }
  } });
  await act(async () => {
    renderer = create(<PaletteArtwork paletteId="blue-white-porcelain" />, { createNodeMock: () => ({}) });
  });
  expect(observed).toBe(1);
  await act(async () => { resize([{ contentRect: { width: 430, height: 200 } }]); });
  const light = renderer!.root.findByProps({ 'data-appearance': 'light' });
  expect(light.props.width).toBe(215);
  expect(light.props.height).toBe(200);
  const secondary = light.findByProps({ 'data-layer': 'secondary-flow-band' });
  expect(secondary.props.d).toBe(paletteFlowBandPath(215, 200, 0.20, 0.34));
  expect(light.findAllByType('feGaussianBlur').map(node => node.props.stdDeviation)).toEqual([8, 1.2, 2.5]);
  expect(renderer!.root.findByProps({ 'data-layer': 'appearance-seam' }).props.width).toBe(0.75);
  await act(async () => { renderer!.unmount(); }); renderer = undefined;
  expect(disconnected).toBe(1);
});
