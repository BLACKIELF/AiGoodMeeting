'use client';

import { useState } from 'react';
import { Globe, Pin } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { LanguagePickerPopover } from '@/components/LanguagePickerPopover';
import { useRecentLanguages } from '@/hooks/useRecentLanguages';
import { labelForCode } from '@/lib/summary-languages';

export function SummaryLanguageSettings() {
  const { recents, pinned, addRecent, removeRecent, setPinned } = useRecentLanguages();
  const [pickerOpen, setPickerOpen] = useState(false);

  const togglePin = (code: string) => {
    setPinned(pinned === code ? null : code);
  };

  return (
    <div className="bg-card rounded-lg border border-border p-6 shadow-sm relative">
      <div className="flex items-center gap-2 mb-2">
        <Globe size={18} className="text-muted-foreground" />
        <h3 className="text-lg font-semibold text-foreground">纪要语言</h3>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        点选一种语言作为新会议的默认值；其他语言保留为快捷选项。“自动”跟随转写语言。
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {recents.map((code) => {
          const isPinned = pinned === code;
          return (
            <span
              key={code}
              className={`inline-flex items-center rounded-full border text-sm overflow-hidden ${
                isPinned
                  ? 'bg-primary/10 border-primary/20 text-primary'
                  : 'bg-muted border-border text-foreground'
              }`}
            >
              <button
                type="button"
                aria-label={isPinned ? `取消默认语言：${labelForCode(code)}` : `设为默认语言：${labelForCode(code)}`}
                aria-pressed={isPinned}
                title={isPinned ? '点击取消默认' : '点击设为默认'}
                onClick={() => togglePin(code)}
                className={`flex items-center gap-1.5 pl-3 pr-2 py-1 hover:brightness-95 active:brightness-90 ${
                  isPinned ? 'text-primary' : 'text-foreground'
                }`}
              >
                <Pin
                  size={14}
                  className={isPinned ? 'text-primary' : 'text-muted-foreground'}
                  fill={isPinned ? 'currentColor' : 'none'}
                />
                {labelForCode(code)}
              </button>
              <button
                type="button"
                aria-label={`移除 ${labelForCode(code)}`}
                onClick={() => removeRecent(code)}
                className={`pr-2.5 pl-0.5 py-1 leading-none ${isPinned ? 'text-blue-400 hover:text-primary' : 'text-muted-foreground hover:text-foreground'}`}
              >
                ×
              </button>
            </span>
          );
        })}

        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={recents.length >= 5}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-input px-3 py-1 text-sm text-muted-foreground hover:border-gray-400 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              ＋ 添加语言
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0 border-0 shadow-none bg-transparent">
            <LanguagePickerPopover
              mode="settings"
              value={null}
              onChange={(code) => {
                if (code) addRecent(code);
                setPickerOpen(false);
              }}
              onClose={() => setPickerOpen(false)}
            />
          </PopoverContent>
        </Popover>
      </div>

      <p className="text-xs text-muted-foreground mt-3">
        {pinned
          ? `默认：${labelForCode(pinned)}。再次点击可取消；最多保留 5 种快捷语言。`
          : '点选语言设为默认；最多保留 5 种快捷语言。'}
      </p>
    </div>
  );
}
