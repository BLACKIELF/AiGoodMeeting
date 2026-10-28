import { VirtualizedTranscriptView } from '@/components/VirtualizedTranscriptView';
import { PermissionWarning } from '@/components/PermissionWarning';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Copy, GlobeIcon, Mic } from 'lucide-react';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useConfig } from '@/contexts/ConfigContext';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { usePermissionCheck } from '@/hooks/usePermissionCheck';
import { ModalType } from '@/hooks/useModalState';
import { useIsLinux } from '@/hooks/usePlatform';
import { useMemo } from 'react';

/**
 * TranscriptPanel Component
 *
 * Displays transcript content with controls for copying and language settings.
 * Uses TranscriptContext, ConfigContext, and RecordingStateContext internally.
 */

interface TranscriptPanelProps {
  // indicates stop-processing state for transcripts; derived from backend statuses.
  isProcessingStop: boolean;
  isStopping: boolean;
  showModal: (name: ModalType, message?: string) => void;
}

export function TranscriptPanel({
  isProcessingStop,
  isStopping,
  showModal
}: TranscriptPanelProps) {
  // Contexts
  const { transcripts, transcriptContainerRef, copyTranscript, meetingTitle } = useTranscripts();
  const { transcriptModelConfig } = useConfig();
  const { isRecording, isPaused } = useRecordingState();
  const { checkPermissions, isChecking, hasSystemAudio, hasMicrophone } = usePermissionCheck();
  const isLinux = useIsLinux();

  // Convert transcripts to segments for virtualized view
  const segments = useMemo(() =>
    transcripts.map(t => ({
      id: t.id,
      timestamp: t.audio_start_time ?? 0,
      endTime: t.audio_end_time,
      text: t.text,
      confidence: t.confidence,
    })),
    [transcripts]
  );

  return (
    <div ref={transcriptContainerRef} className="agb-panel flex min-h-0 w-full flex-col overflow-y-auto bg-background text-foreground">
      {/* Title area - Sticky header */}
      <div className="agb-header sticky top-0 z-10 flex min-h-[88px] flex-wrap items-center justify-between gap-3 border-b border-border bg-background/95 px-5 py-4 backdrop-blur-xl sm:px-8">
        <div className="min-w-0 flex-1">
          <p className="agb-kicker mb-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <Mic className="h-3 w-3" />录音工作台
          </p>
          <h1 className="truncate text-lg font-semibold tracking-tight">
            {!meetingTitle || meetingTitle === '+ New Call' ? '新建会议' : meetingTitle}
          </h1>
        </div>
        <div className="agb-toolbar flex flex-wrap items-center gap-2">
          {isRecording && (
            <span className="agb-chip flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
              <span className={`h-1.5 w-1.5 rounded-full ${isPaused ? 'bg-amber-500' : 'bg-red-500'}`} />
              {isPaused ? '录音已暂停' : '正在录音'}
            </span>
          )}
          {transcripts.length > 0 && <span className="text-[11px] tabular-nums text-muted-foreground">{transcripts.length} 段转写</span>}
              <ButtonGroup>
                {transcripts?.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copyTranscript}
                    title="复制转写"
                    aria-label="复制转写"
                  >
                    <Copy />
                    <span className='hidden md:inline'>
                      复制
                    </span>
                  </Button>
                )}
                {transcriptModelConfig.provider === "localWhisper" &&
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => showModal('languageSettings')}
                    title="转写语言"
                    aria-label="转写语言"
                  >
                    <GlobeIcon />
                    <span className='hidden md:inline'>
                      语言
                    </span>
                  </Button>
                }
              </ButtonGroup>
        </div>
      </div>

      {/* Permission Warning - Not needed on Linux */}
      {!isRecording && !isChecking && !isLinux && (
        <div className="flex justify-center px-4 pt-4">
          <PermissionWarning
            hasMicrophone={hasMicrophone}
            hasSystemAudio={hasSystemAudio}
            onRecheck={checkPermissions}
            isRechecking={isChecking}
          />
        </div>
      )}

      {/* Transcript content */}
      <div className="flex-1 pb-28 pt-6">
        <div className="flex justify-center">
          <div className="w-full max-w-[850px] px-5 sm:px-8">
            <VirtualizedTranscriptView
              segments={segments}
              isRecording={isRecording}
              isPaused={isPaused}
              isProcessing={isProcessingStop}
              isStopping={isStopping}
              enableStreaming={isRecording}
              showConfidence={true}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
