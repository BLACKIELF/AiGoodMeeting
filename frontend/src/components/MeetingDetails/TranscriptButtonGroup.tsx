"use client";

import { useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Copy, FileDown, FileText, FolderOpen, Loader2, RefreshCw, Send, Settings2, Sparkles } from 'lucide-react';
import Analytics from '@/lib/analytics';
import { RetranscribeDialog } from './RetranscribeDialog';
import { useConfig } from '@/contexts/ConfigContext';
import type { ExportDocumentFormat } from '@/lib/document-export';

interface TranscriptButtonGroupProps {
  transcriptCount: number;
  onCopyTranscript: () => void;
  onOpenMeetingFolder: () => Promise<void>;
  meetingId?: string;
  meetingFolderPath?: string | null;
  onRefetchTranscripts?: () => Promise<void>;
  onCopyTranscriptMarkdown?: () => Promise<void>;
  onExportTranscript?: (format: ExportDocumentFormat) => Promise<void>;
  onUploadTranscriptFeishu?: (mode?: string) => Promise<void>;
  isUploadingTranscriptFeishu?: boolean;
  onOpenFeishuSettings?: () => void;
  onSendToAgent?: () => void;
}

export function TranscriptButtonGroup({
  transcriptCount,
  onCopyTranscript,
  onOpenMeetingFolder,
  meetingId,
  meetingFolderPath,
  onRefetchTranscripts,
  onCopyTranscriptMarkdown,
  onExportTranscript,
  onUploadTranscriptFeishu,
  isUploadingTranscriptFeishu = false,
  onOpenFeishuSettings,
  onSendToAgent,
}: TranscriptButtonGroupProps) {
  const { betaFeatures } = useConfig();
  const [showRetranscribeDialog, setShowRetranscribeDialog] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  const closeDetails = () => {
    if (detailsRef.current) {
      detailsRef.current.open = false;
    }
  };

  const handleRetranscribeComplete = useCallback(async () => {
    if (onRefetchTranscripts) {
      await onRefetchTranscripts();
    }
  }, [onRefetchTranscripts]);

  const disabled = transcriptCount === 0;

  return (
    <div className="agb-toolbar flex w-full flex-wrap items-center gap-1.5">
      <Button
        variant="outline"
        size="sm"
        className="px-2.5 cursor-pointer"
        onClick={() => {
          Analytics.trackButtonClick('copy_transcript', 'meeting_details');
          onCopyTranscript();
        }}
        disabled={disabled}
        title={disabled ? '暂无可复制的转写' : '复制转写'}
        aria-label="复制转写"
      >
        <Copy />
        <span>复制</span>
      </Button>

      {onExportTranscript && (
        <>
          <Button
            variant="outline"
            size="sm"
            className="px-2.5 cursor-pointer"
            disabled={disabled}
            onClick={() => {
              Analytics.trackButtonClick('export_transcript_txt', 'meeting_details');
              void onExportTranscript('txt');
            }}
            title="导出转写为 TXT 纯文本"
            aria-label="导出转写 TXT"
          >
            <FileText />
            <span>TXT</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="px-2.5 cursor-pointer"
            disabled={disabled}
            onClick={() => {
              Analytics.trackButtonClick('export_transcript_docx', 'meeting_details');
              void onExportTranscript('docx');
            }}
            title="导出转写为标准 Word (.docx) 文档"
            aria-label="导出转写 Word"
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
          className="px-2.5 cursor-pointer"
          disabled={disabled}
          onClick={() => {
            Analytics.trackButtonClick('send_transcript_to_agent', 'meeting_details');
            onSendToAgent();
          }}
          title="发送完整转写给本地 Agent，预检并执行后同步飞书"
          aria-label="交给 Agent 执行"
        >
          <Sparkles />
          <span>交给 Agent</span>
        </Button>
      )}

      {onUploadTranscriptFeishu && (
        <Button
          variant="outline"
          size="sm"
          className="px-2.5 cursor-pointer border-primary/30 text-primary hover:bg-primary/10"
          disabled={disabled || isUploadingTranscriptFeishu}
          onClick={() => {
            Analytics.trackButtonClick('upload_transcript_feishu', 'meeting_details');
            void onUploadTranscriptFeishu();
          }}
          title="通过飞书 CLI 直接上传转写"
          aria-label="上传转写到飞书"
        >
          {isUploadingTranscriptFeishu ? <Loader2 className="animate-spin" /> : <Send />}
          <span>{isUploadingTranscriptFeishu ? '上传中…' : '上传飞书'}</span>
        </Button>
      )}

      <details ref={detailsRef} className="relative">
        <summary className="flex h-8 cursor-pointer list-none items-center rounded-md px-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          更多
        </summary>
        <div className="absolute right-0 z-20 mt-1 flex min-w-44 flex-col gap-0.5 rounded-xl border border-border bg-popover p-1.5 shadow-md">
          <Button
            size="sm"
            variant="ghost"
            className="justify-start px-2.5 text-xs font-normal"
            onClick={() => {
              closeDetails();
              Analytics.trackButtonClick('open_recording_folder', 'meeting_details');
              void onOpenMeetingFolder();
            }}
            title="打开录音文件夹"
            aria-label="打开录音文件夹"
          >
            <FolderOpen size={15} />
            <span>打开录音文件夹</span>
          </Button>

          {betaFeatures.importAndRetranscribe && meetingId && meetingFolderPath && (
            <Button
              size="sm"
              variant="ghost"
              className="justify-start px-2.5 text-xs font-normal"
              onClick={() => {
                closeDetails();
                Analytics.trackButtonClick('enhance_transcript', 'meeting_details');
                setShowRetranscribeDialog(true);
              }}
              title="重新转写录音"
              aria-label="重新转写录音"
            >
              <RefreshCw size={15} />
              <span>重新转写</span>
            </Button>
          )}

          {onOpenFeishuSettings && (
            <>
              <div className="my-1 border-t border-border" />
              <Button
                size="sm"
                variant="ghost"
                className="justify-start px-2.5 text-xs font-normal text-muted-foreground hover:text-foreground"
                onClick={() => {
                  closeDetails();
                  onOpenFeishuSettings();
                }}
              >
                <Settings2 size={15} />
                <span>配置飞书 CLI…</span>
              </Button>
            </>
          )}
        </div>
      </details>

      {betaFeatures.importAndRetranscribe && meetingId && meetingFolderPath && (
        <RetranscribeDialog
          open={showRetranscribeDialog}
          onOpenChange={setShowRetranscribeDialog}
          meetingId={meetingId}
          meetingFolderPath={meetingFolderPath}
          onComplete={handleRetranscribeComplete}
        />
      )}
    </div>
  );
}
