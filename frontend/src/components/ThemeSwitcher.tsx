'use client';

import { ChevronDown, Monitor, Moon, Palette, Sun } from 'lucide-react';
import { useAppearance } from '@/contexts/AppearanceContext';
import { APPEARANCE_OPTIONS, PALETTES, getPalette, getAppearanceTheme, isAppearance, isPaletteId } from '@/lib/appearance';
import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const icons = { light: Sun, dark: Moon, system: Monitor };

export function ThemeSwitcher({ compact = true, className }: { compact?: boolean; className?: string }) {
  const { paletteId, setPaletteId, appearance, setAppearance, resolvedAppearance } = useAppearance();
  const palette = getPalette(paletteId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn('agb-theme-switcher', compact && 'is-compact', className)}
          aria-label={`外观与皮肤，当前${palette.name}，${APPEARANCE_OPTIONS.find(option => option.value === appearance)?.label}`}
          title="外观与皮肤">
          <Palette size={15} strokeWidth={1.7} aria-hidden="true" />
          <span className={compact ? 'sr-only' : undefined}>{compact ? '外观' : palette.name}</span>
          {!compact && <span className="ml-auto text-xs text-muted-foreground">{resolvedAppearance === 'dark' ? '深色' : '浅色'}</span>}
          {!compact && <ChevronDown className="ml-2 opacity-60" size={12} aria-hidden="true" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" sideOffset={8} className="w-56 p-1.5">
        <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">外观</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={appearance} onValueChange={value => { if (isAppearance(value)) setAppearance(value); }}>
          {APPEARANCE_OPTIONS.map(option => {
            const Icon = icons[option.value];
            return <DropdownMenuRadioItem key={option.value} value={option.value} className="gap-2 text-[13px]">
              <Icon size={14} strokeWidth={1.7} aria-hidden="true" />{option.label}
            </DropdownMenuRadioItem>;
          })}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">皮肤</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={paletteId} onValueChange={value => { if (isPaletteId(value)) setPaletteId(value); }}>
          {PALETTES.map(item => <DropdownMenuRadioItem key={item.id} value={item.id} className="gap-2 text-[13px]">
            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: getAppearanceTheme(item.id, resolvedAppearance).primary }} />
            {item.name}
          </DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ThemeSwitcher;
