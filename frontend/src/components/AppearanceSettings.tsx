'use client';

import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useId, type CSSProperties } from 'react';
import { useAppearance } from '@/contexts/AppearanceContext';
import { APPEARANCE_OPTIONS, PALETTES, getPaletteTokens, type Appearance } from '@/lib/appearance';
import { cn } from '@/lib/utils';
import { PaletteArtwork, paletteArtworkCSSColor } from './PaletteArtwork';

const icons = { light: Sun, dark: Moon, system: Monitor };

export function AppearanceSettings({ className }: { className?: string }) {
  const { paletteId, setPaletteId, appearance, setAppearance } = useAppearance();
  const groupId = useId();
  return (
    <div className={cn('agb-appearance-settings space-y-7', className)}>
      <fieldset className="min-w-0">
        <legend className="mb-3 text-sm font-semibold text-foreground">外观</legend>
        <div className="agb-appearance-control" aria-label="外观模式">
          {APPEARANCE_OPTIONS.map(option => {
            const Icon = icons[option.value];
            return (
              <label key={option.value} className="agb-appearance-option" data-selected={appearance === option.value}>
                <input className="sr-only" type="radio" name={`${groupId}-appearance`} value={option.value}
                  checked={appearance === option.value} onChange={() => setAppearance(option.value as Appearance)} />
                <Icon size={15} strokeWidth={1.7} aria-hidden="true" />
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="min-w-0">
        <legend className="mb-3 text-sm font-semibold text-foreground">皮肤</legend>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {PALETTES.map(palette => {
            const tokens = getPaletteTokens(palette.id, 'light');
            const selected = paletteId === palette.id;
            const previewStyle = {
              '--palette-focus-ring': tokens.selection.focusRing,
              '--palette-border': selected ? tokens.selection.focusRing : 'rgba(255,255,255,0.24)',
              '--palette-border-width': selected ? '2px' : '0.7px',
              '--palette-card-shadow': selected ? `0 2px 10px ${paletteArtworkCSSColor(tokens.selection.focusRing, 0.30)}` : '0 2px 5px rgba(0,0,0,0.15)',
              '--palette-hover-shadow': selected ? `0 4px 10px ${paletteArtworkCSSColor(tokens.selection.focusRing, 0.30)}` : '0 4px 8px rgba(0,0,0,0.24)',
            } as CSSProperties;
            return (
              <label key={palette.id} title={palette.description} style={previewStyle}
                className="group relative block min-w-0 cursor-pointer overflow-hidden rounded-[14px] shadow-[var(--palette-card-shadow)] transition-shadow [transition-duration:180ms] hover:shadow-[var(--palette-hover-shadow)] motion-reduce:transition-none"
                data-selected={selected}>
                <input className="sr-only" type="radio" name={`${groupId}-palette`} value={palette.id}
                  aria-label={`${palette.name}，内置主题`}
                  checked={selected} onChange={() => setPaletteId(palette.id)} />
                <PaletteArtwork paletteId={palette.id} />
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-3" aria-hidden="true">
                  <div className="flex max-w-full flex-col items-center gap-[1.5px] rounded-full border-[0.7px] border-white/30 px-[10px] py-[4.5px] text-center text-white"
                    style={{ background: 'rgba(0,0,0,0.20)', boxShadow: '0 2px 5px rgba(0,0,0,0.24)', fontFamily: 'ui-rounded, system-ui, sans-serif' }}>
                    <span className="max-w-full truncate text-[12.5px] font-semibold leading-[15px] tracking-[0.2px]">{palette.name}</span>
                    <span className="text-[7.5px] font-medium leading-[10px] text-white/[0.84]">内置主题</span>
                  </div>
                </div>
                {selected && <span className="pointer-events-none absolute right-[7px] top-[7px] flex h-[19px] w-[19px] items-center justify-center rounded-full border-[0.8px] border-white/[0.48] text-white backdrop-blur-md"
                  style={{ background: 'var(--agb-glass-surface)', boxShadow: '0 1px 4px rgba(0,0,0,0.22)' }} aria-hidden="true">
                  <Check size={9} strokeWidth={3} />
                </span>}
                <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[14px] border-[length:var(--palette-border-width)] border-[color:var(--palette-border)] group-hover:border-white/[0.52] group-has-[:focus-visible]:border-2 group-has-[:focus-visible]:border-[color:var(--palette-focus-ring)]"
                  style={selected ? { borderColor: tokens.selection.focusRing } : undefined} />
              </label>
            );
          })}
        </div>
      </fieldset>
      <p className="text-xs leading-relaxed text-muted-foreground">更改会立即生效，并保存在这台电脑。</p>
    </div>
  );
}

export default AppearanceSettings;
