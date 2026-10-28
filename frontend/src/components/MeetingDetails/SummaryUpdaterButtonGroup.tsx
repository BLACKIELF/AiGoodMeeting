"use client";

import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Copy, Save, Loader2 } from 'lucide-react';
import Analytics from '@/lib/analytics';

interface SummaryUpdaterButtonGroupProps {
  isSaving: boolean;
  isDirty: boolean;
  onSave: () => Promise<void>;
  onCopy: () => Promise<void>;
}

export function SummaryUpdaterButtonGroup({
  isSaving,
  isDirty,
  onSave,
  onCopy,
}: SummaryUpdaterButtonGroupProps) {
  return (
    <ButtonGroup>
      {/* Save button */}
      {(isDirty || isSaving) && <Button
        variant="outline"
        size="sm"
        className={isDirty ? 'border-primary/30 bg-primary/10 text-primary' : ''}
        title={isSaving ? '正在保存' : '保存修改'}
        aria-label="保存纪要修改"
        onClick={() => {
          Analytics.trackButtonClick('save_changes', 'meeting_details');
          onSave();
        }}
        disabled={isSaving}
      >
        {isSaving ? (
          <>
            <Loader2 className="animate-spin" />
            <span>保存中…</span>
          </>
        ) : (
          <>
            <Save />
            <span>保存</span>
          </>
        )}
      </Button>}

      {/* Copy button */}
      <Button
        variant="outline"
        size="sm"
        title="复制纪要"
        aria-label="复制纪要"
        onClick={() => {
          Analytics.trackButtonClick('copy_summary', 'meeting_details');
          onCopy();
        }}
        className="cursor-pointer"
      >
        <Copy />
        <span>复制</span>
      </Button>

    </ButtonGroup>
  );
}
