'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { getPaletteTokens, type PaletteId, type ReadonlyPaletteTokens, type ResolvedAppearance } from '@/lib/appearance';

// Port of AiGoodBro Sources/CodexUsageWidget/UI/PaletteSettingsView.swift:
// PaletteArtworkCard (2.15 aspect ratio), PaletteArtworkHalf and PaletteFlowBand.
// PaletteModels.swift interprets 8-digit token colors as RRGGBBAA in sRGB.
export const PALETTE_ARTWORK_ASPECT_RATIO = 2.15;

export function paletteArtworkColor(hex: string, opacity = 1) {
  const color = hex.slice(0, 7);
  const alpha = hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1;
  return { color, opacity: alpha * opacity };
}

export function paletteArtworkCSSColor(hex: string, opacity = 1): string {
  const value = paletteArtworkColor(hex, opacity);
  const [red, green, blue] = [1, 3, 5].map(index => parseInt(value.color.slice(index, index + 2), 16));
  return `rgba(${red}, ${green}, ${blue}, ${value.opacity})`;
}

export function paletteFlowBandPath(width: number, height: number, amplitude: number, verticalPosition: number): string {
  const centerY = height * verticalPosition;
  const rise = height * amplitude;
  const n = (value: number) => Number(value.toFixed(6));
  // These endpoints and cubic control points are the original PaletteFlowBand.path(in:).
  return [
    `M ${n(-width * 0.08)} ${n(centerY - rise * 0.55)}`,
    `C ${n(width * 0.22)} ${n(centerY + rise * 1.35)} ${n(width * 0.72)} ${n(centerY - rise * 1.20)} ${n(width * 1.08)} ${n(centerY + rise * 0.20)}`,
    `L ${n(width * 1.08)} ${n(centerY + rise * 1.28)}`,
    `C ${n(width * 0.72)} ${n(centerY - rise * 0.04)} ${n(width * 0.22)} ${n(centerY + rise * 2.10)} ${n(-width * 0.08)} ${n(centerY + rise * 0.54)}`,
    'Z',
  ].join(' ');
}

function TokenStop({ color, opacity = 1, offset }: { color: string; opacity?: number; offset: number }) {
  const value = paletteArtworkColor(color, opacity);
  return <stop offset={offset} stopColor={value.color} stopOpacity={value.opacity} />;
}

function PaletteArtworkHalf({ paletteId, tokens, appearance, width, height, prefix, x }: {
  paletteId: PaletteId;
  tokens: ReadonlyPaletteTokens;
  appearance: ResolvedAppearance;
  width: number;
  height: number;
  prefix: string;
  x: number;
}) {
  const light = appearance === 'light';
  const url = (name: string) => `url(#${prefix}-${name})`;
  const ellipseX = width * 0.80;
  const ellipseY = height * 0.24;

  if (paletteId === 'default') {
    return (
      <svg x={x} y={0} width={width} height={height} viewBox={`0 0 ${width} ${height}`}
        overflow="hidden" data-appearance={appearance} data-palette-half="default" style={{ isolation: 'isolate' }}>
        <defs>
          <linearGradient id={`${prefix}-background`} x1={0} y1={0} x2={width} y2={height} gradientUnits="userSpaceOnUse">
            <stop offset={0} stopColor={light ? 'rgb(96% 97% 98%)' : 'rgb(28% 30% 33%)'} />
            <stop offset={1} stopColor={light ? 'rgb(80% 83% 87%)' : 'rgb(12% 14% 17%)'} />
          </linearGradient>
          <linearGradient id={`${prefix}-sheen`} x1={0} y1={0} x2={width} y2={height} gradientUnits="userSpaceOnUse">
            <stop offset={0} stopColor="#FFFFFF" stopOpacity={light ? 0.50 : 0.18} />
            <stop offset={1} stopColor="#000000" stopOpacity={0} />
          </linearGradient>
        </defs>
        <rect width={width} height={height} fill={url('background')} data-layer="background" />
        <path d={paletteFlowBandPath(width, height, 0.20, 0.34)} fill="#FFFFFF"
          fillOpacity={light ? 0.50 : 0.12} data-layer="default-flow-band" />
        <rect width={width} height={height} fill={url('sheen')} data-layer="sheen" />
      </svg>
    );
  }

  return (
    <svg x={x} y={0} width={width} height={height} viewBox={`0 0 ${width} ${height}`}
      overflow="hidden" data-appearance={appearance} data-palette-half={paletteId} style={{ isolation: 'isolate' }}>
      <defs>
        <linearGradient id={`${prefix}-background`} x1={0} y1={0} x2={width} y2={height} gradientUnits="userSpaceOnUse">
          {light ? <>
            <stop offset={0} stopColor="#FFFFFF" stopOpacity={0.98} />
            <TokenStop offset={0.5} color={tokens.accent.primaryLight} opacity={0.78} />
            <TokenStop offset={1} color={tokens.surfaceTint.color} opacity={0.52} />
          </> : <>
            <stop offset={0} stopColor="rgb(3.5% 4% 6%)" />
            <TokenStop offset={0.5} color={tokens.accent.primaryStrong} opacity={0.76} />
            <TokenStop offset={1} color={tokens.accent.secondaryStrong} opacity={0.90} />
          </>}
        </linearGradient>
        <radialGradient id={`${prefix}-highlight`} cx={width * 0.16} cy={height * 0.22}
          r={Math.max(width, height) * 0.44} gradientUnits="userSpaceOnUse">
          <TokenStop offset={0} color={tokens.accent.highlight} opacity={0.92} />
          <TokenStop offset={1} color={tokens.accent.primary} opacity={0} />
        </radialGradient>
        <linearGradient id={`${prefix}-secondary-flow`} x1={0} y1={0} x2={width} y2={height} gradientUnits="userSpaceOnUse">
          <TokenStop offset={0} color={tokens.accent.secondary} opacity={0.22} />
          <TokenStop offset={1} color={tokens.accent.secondaryStrong} opacity={0.92} />
        </linearGradient>
        <linearGradient id={`${prefix}-primary-flow`} x1={0} y1={0} x2={width} y2={0} gradientUnits="userSpaceOnUse">
          <TokenStop offset={0} color={tokens.quota.primary.start} opacity={0.35} />
          <TokenStop offset={1} color={tokens.quota.primary.end} opacity={0.94} />
        </linearGradient>
        <linearGradient id={`${prefix}-metal`} x1={ellipseX} y1={ellipseY - height * 0.115}
          x2={ellipseX} y2={ellipseY + height * 0.115} gradientUnits="userSpaceOnUse">
          <TokenStop offset={0} color={tokens.ornament.metal} opacity={0.76} />
          <TokenStop offset={1} color={tokens.accent.highlight} opacity={0.08} />
        </linearGradient>
        <linearGradient id={`${prefix}-sheen`} x1={0} y1={0} x2={0} y2={height} gradientUnits="userSpaceOnUse">
          <stop offset={0} stopColor="#FFFFFF" stopOpacity={light ? 0.48 : 0.16} />
          <stop offset={0.5} stopColor="#000000" stopOpacity={0} />
          <stop offset={1} stopColor="#000000" stopOpacity={light ? 0.04 : 0.20} />
        </linearGradient>
        {/* The viewport is measured in CSS pixels so native fixed blur radii stay fixed on resize. */}
        {[['highlight-blur', 8], ['flow-blur', 1.2], ['metal-blur', 2.5]].map(([name, radius]) =>
          <filter key={name} id={`${prefix}-${name}`} x="-100%" y="-100%" width="300%" height="300%" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation={radius} />
          </filter>)}
      </defs>
      <rect width={width} height={height} fill={url('background')} data-layer="background" />
      <circle cx={width * 0.16} cy={height * 0.22} r={width * 0.59}
        fill={url('highlight')} filter={url('highlight-blur')} data-layer="highlight" />
      <path d={paletteFlowBandPath(width, height, 0.20, 0.34)} fill={url('secondary-flow')}
        filter={url('flow-blur')} data-layer="secondary-flow-band" />
      <path d={paletteFlowBandPath(width, height, 0.15, 0.63)} fill={url('primary-flow')}
        transform={`translate(0 ${height * 0.10})`} data-layer="primary-flow-band" />
      <ellipse cx={ellipseX} cy={ellipseY} rx={width * 0.38} ry={height * 0.115}
        transform={`rotate(-23 ${ellipseX} ${ellipseY})`} fill={url('metal')} filter={url('metal-blur')} data-layer="metal" />
      <rect width={width} height={height} fill={url('sheen')} data-layer="sheen" />
    </svg>
  );
}

export function PaletteArtwork({ paletteId, className }: { paletteId: PaletteId; className?: string }) {
  const prefix = `palette-artwork-${useId().replace(/:/g, '')}`;
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 215, height: 100 });

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setSize(previous => previous.width === width && previous.height === height
        ? previous : { width, height });
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  return <svg ref={svgRef} className={className} viewBox={`0 0 ${size.width} ${size.height}`}
    width="100%" aria-hidden="true" focusable="false" data-palette-artwork={paletteId}
    colorInterpolation="sRGB" style={{ display: 'block', width: '100%', height: 'auto', aspectRatio: PALETTE_ARTWORK_ASPECT_RATIO }}>
    <PaletteArtworkHalf paletteId={paletteId} tokens={getPaletteTokens(paletteId, 'light')}
      appearance="light" width={size.width / 2} height={size.height} prefix={`${prefix}-light`} x={0} />
    <PaletteArtworkHalf paletteId={paletteId} tokens={getPaletteTokens(paletteId, 'dark')}
      appearance="dark" width={size.width / 2} height={size.height} prefix={`${prefix}-dark`} x={size.width / 2} />
    <rect x={size.width / 2 - 0.375} y={0} width={0.75} height={size.height}
      fill="#FFFFFF" fillOpacity={0.24} style={{ mixBlendMode: 'overlay' }} data-layer="appearance-seam" />
  </svg>;
}
