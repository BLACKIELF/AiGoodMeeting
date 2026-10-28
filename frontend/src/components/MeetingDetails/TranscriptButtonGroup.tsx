"use client";

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Copy, FolderOpen, RefreshCw } from 'lucide-react';
import Analytics from '@/lib/analytics';
import { RetranscribeDialog } from './RetranscribeDialog';
import { useConfig } from '@/contexts/ConfigContext';


interface TranscriptButtonGroupProps {
  transcriptCount: number;
  onCopyTranscript: () => void;
  onOpenMeetingFolder: () => Promise<void>;
  meetingId?: string;
  meetingFolderPath?: string | null;
  onRefetchTranscripts?: () => Promise<void>;
}


export function TranscriptButtonGroup({
  transcriptCount,
  onCopyTranscript,
  onOpenMeetingFolder,
  meetingId,
  meetingFolderPath,
  onRefetchTranscripts,
}: TranscriptButtonGroupProps) {
  const { betaFeatures } = useConfig();
  const [showRetranscribeDialog, setShowRetranscribeDialog] = useState(false);

  const handleRetranscribeComplete = useCallback(async () => {
    // Refetch transcripts to show the updated data
    if (onRefetchTranscripts) {
      await onRefetchTranscripts();
    }
  }, [onRefetchTranscripts]);

  return (
    <div className="agb-toolbar flex w-full flex-wrap items-start gap-2">
        <Button
          variant="outline"
          size="sm"
          className="px-2 @[22rem]:px-3"
          onClick={() => {
            Analytics.trackButtonClick('copy_transcript', 'meeting_details');
            onCopyTranscript();
          }}
          disabled={transcriptCount === 0}
          title={transcriptCount === 0 ? '暂无可复制的转写' : '复制转写'}
          aria-label="复制转写"
        >
          <Copy />
          <span>复制</span>
        </Button>

        <details>
          <summary className="flex h-8 cursor-pointer list-none items-center rounded-md px-2.5 text-xs text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">更多</summary>
          <div className="mt-1 flex min-w-40 flex-col gap-1 rounded-xl border border-border bg-popover p-1.5">
        <Button
          size="sm"
          variant="ghost"
          className="justify-start px-2"
          onClick={() => {
            Analytics.trackButtonClick('open_recording_folder', 'meeting_details');
            onOpenMeetingFolder();
          }}
          title="打开录音文件夹"
          aria-label="打开录音文件夹"
        >
          <FolderOpen size={16} />
          <span>打开录音文件夹</span>
        </Button>

        {betaFeatures.importAndRetranscribe && meetingId && meetingFolderPath && (
          <Button
            size="sm"
            variant="ghost"
            className="justify-start px-2"
            onClick={() => {
              Analytics.trackButtonClick('enhance_transcript', 'meeting_details');
              setShowRetranscribeDialog(true);
            }}
            title="重新转写录音"
            aria-label="重新转写录音"
          >
            <RefreshCw size={16} />
            <span>重新转写</span>
          </Button>
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
