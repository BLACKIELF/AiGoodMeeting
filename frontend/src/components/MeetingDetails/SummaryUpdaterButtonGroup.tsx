"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Bot,
  Copy,
  Save,
  Loader2,
  FileText,
  FileDown,
  Send,
  Sparkles,
  MoreHorizontal,
  Settings2,
} from 'lucide-react';
import Analytics from '@/lib/analytics';
import type { ExportDocumentFormat } from '@/lib/document-export';

interface SummaryUpdaterButtonGroupProps {
  isSaving: boolean;
  isDirty: boolean;
  onSave: () => Promise<void>;
  onCopy: () => Promise<void>;
  onCopyMarkdown?: () => Promise<void>;
  onExport?: (format: ExportDocumentFormat) => Promise<void>;
  onUploadFeishu?: (mode?: string) => Promise<void>;
  isUploadingFeishu?: boolean;
  onSendToAgent?: () => void;
}

export function SummaryUpdaterButtonGroup({
  isSaving,
  isDirty,
  onSave,
  onCopy,
  onCopyMarkdown,
  onExport,
  onUploadFeishu,
  isUploadingFeishu = false,
  onSendToAgent,
}: SummaryUpdaterButtonGroupProps) {
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {(isDirty || isSaving) && (
        <Button
          variant="outline"
          size="sm"
          className={isDirty ? 'border-primary/35 bg-primary/10 text-primary' : ''}
          title={isSaving ? '正在保存' : '保存修改'}
          aria-label="保存纪要修改"
          onClick={() => {
            Analytics.trackButtonClick('save_changes', 'meeting_details');
            void onSave();
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
        </Button>
      )}

      <Button
        variant="outline"
        size="sm"
        title="复制纪要"
        aria-label="复制纪要"
        onClick={() => {
          Analytics.trackButtonClick('copy_summary', 'meeting_details');
          void onCopy();
        }}
        className="cursor-pointer"
      >
        <Copy />
        <span>复制</span>
      </Button>

      {onExport && (
        <>
          <Button
            variant="outline"
            size="sm"
            title="导出 TXT 文件"
            aria-label="导出 TXT"
            onClick={() => {
              Analytics.trackButtonClick('export_summary_txt', 'meeting_details');
              void onExport('txt');
            }}
            className="cursor-pointer"
          >
            <FileText />
            <span>TXT</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            title="导出 Word 文档"
            aria-label="导出 Word"
            onClick={() => {
              Analytics.trackButtonClick('export_summary_docx', 'meeting_details');
              void onExport('docx');
            }}
            className="cursor-pointer"
          >
            <FileDown />
            <span>Word</span>
          </Button>
        </>
      )}

      {onSendToAgent && (
        <Button
          variant="default"
          size="sm"
          title="发送会议转写与纪要给本地 Agent，预检并执行后同步飞书"
          aria-label="交给 Agent 执行"
          onClick={() => {
            Analytics.trackButtonClick('send_to_agent', 'meeting_details');
            onSendToAgent();
          }}
          className="cursor-pointer"
        >
          <Sparkles />
          <span>交给 Agent</span>
        </Button>
      )}

      {onUploadFeishu && (
        <Button
          variant="outline"
          size="sm"
          title="通过飞书 CLI 直接上传到飞书"
          aria-label="上传飞书"
          disabled={isUploadingFeishu}
          onClick={() => {
            Analytics.trackButtonClick('upload_summary_feishu', 'meeting_details');
            void onUploadFeishu();
          }}
          className="cursor-pointer border-primary/30 text-primary hover:bg-primary/10"
        >
          {isUploadingFeishu ? <Loader2 className="animate-spin" /> : <Send />}
          <span>{isUploadingFeishu ? '上传中…' : '上传飞书'}</span>
        </Button>
      )}

      {onUploadFeishu && (
        <Popover open={moreOpen} onOpenChange={setMoreOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="px-2 text-muted-foreground hover:text-foreground cursor-pointer"
              title="更多"
              aria-label="更多导出选项"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-52 p-1.5">
            <div className="flex flex-col gap-0.5">
              {onUploadFeishu && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="justify-start px-2.5 text-xs font-normal"
                  disabled={isUploadingFeishu}
                  onClick={() => {
                    setMoreOpen(false);
                    void onUploadFeishu('file_docx');
                  }}
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>上传 Word 原文件到飞书</span>
                </Button>
              )}
              <div className="my-1 border-t border-border" />
              <Button
                variant="ghost"
                size="sm"
                className="justify-start px-2.5 text-xs font-normal text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setMoreOpen(false);
                  router.push('/settings?tab=agent');
                }}
              >
                <Bot className="h-3.5 w-3.5" />
                <span>配置 Agent 联动…</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="justify-start px-2.5 text-xs font-normal text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setMoreOpen(false);
                  router.push('/settings?tab=feishu');
                }}
              >
                <Settings2 className="h-3.5 w-3.5" />
                <span>配置飞书 CLI…</span>
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
