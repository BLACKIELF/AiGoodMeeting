"use client";

import { Transcript, TranscriptSegmentData } from '@/types';
import { VirtualizedTranscriptView } from '@/components/VirtualizedTranscriptView';
import { TranscriptButtonGroup } from './TranscriptButtonGroup';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { SpeakerTranscriptController } from '@/hooks/meeting-details/useSpeakerTranscript';
import { speakerLabel, speakerTranscriptText } from '@/lib/speaker-transcript';
import { SpeakerTranscriptControls } from './SpeakerTranscriptControls';
import { SpeakerIdentity } from './SpeakerIdentity';
import { MessageSquareText } from 'lucide-react';

interface TranscriptPanelProps {
  transcripts: Transcript[];
  customPrompt: string;
  onPromptChange: (value: string) => void;
  onCopyTranscript: () => void;
  onOpenMeetingFolder: () => Promise<void>;
  isRecording: boolean;
  disableAutoScroll?: boolean;

  // Optional pagination props (when using virtualization)
  usePagination?: boolean;
  segments?: TranscriptSegmentData[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;

  // Retranscription props
  meetingId?: string;
  meetingFolderPath?: string | null;
  onRefetchTranscripts?: () => Promise<void>;
  speakers?: SpeakerTranscriptController;
}

export function TranscriptPanel({
  transcripts,
  customPrompt,
  onPromptChange,
  onCopyTranscript,
  onOpenMeetingFolder,
  isRecording,
  disableAutoScroll = false,
  usePagination = false,
  segments,
  hasMore,
  isLoadingMore,
  totalCount,
  loadedCount,
  onLoadMore,
  meetingId,
  meetingFolderPath,
  onRefetchTranscripts,
  speakers,
}: TranscriptPanelProps) {
  const [showSpeakers, setShowSpeakers] = useState(true);
  const [originalTranscriptUpdated, setOriginalTranscriptUpdated] = useState(false);
  const previousMeetingRef = useRef(meetingId);
  useEffect(() => {
    if (previousMeetingRef.current !== meetingId) {
      setShowSpeakers(true);
      setOriginalTranscriptUpdated(false);
    }
    previousMeetingRef.current = meetingId;
  }, [meetingId]);
  // Convert transcripts to segments if pagination is not used but we want virtualization
  const convertedSegments = useMemo(() => {
    if (usePagination && segments) {
      return segments;
    }
    // Convert transcripts to segments for virtualization
    return transcripts.map(t => ({
      id: t.id,
      timestamp: t.audio_start_time ?? 0,
      endTime: t.audio_end_time,
      text: t.text,
      confidence: t.confidence,
    }));
  }, [transcripts, usePagination, segments]);

  const attributedSegments = useMemo(() => speakers?.transcript?.segments.map((segment, index) => ({
    id: `speaker-${index}`, timestamp: segment.start, endTime: segment.end, text: segment.text,
  })) ?? [], [speakers?.transcript]);
  const isSpeakerView = showSpeakers && !!speakers?.transcript;
  const handleRetranscribeComplete = async () => {
    if (speakers?.transcript) setOriginalTranscriptUpdated(true);
    try { await onRefetchTranscripts?.(); }
    catch { toast.error('原始转写读取失败，请重新打开这场会议。'); }
  };
  const handleCopyTranscript = async () => {
    if (!isSpeakerView || !speakers?.transcript) { onCopyTranscript(); return; }
    try {
      await navigator.clipboard.writeText(speakerTranscriptText(speakers.transcript));
      toast.success('已复制按说话人整理的转写');
    } catch {
      toast.error('复制失败，请重试。');
    }
  };

  return (
    <div className="flex h-full min-w-0 w-full bg-card text-card-foreground flex-col relative @container">
      {/* Title area */}
      <div className="max-h-[50%] shrink-0 overflow-y-auto border-b border-border px-4 py-3.5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <MessageSquareText className="h-4 w-4 text-primary" aria-hidden="true" />会议转写
          </h2>
          <span className="text-[11px] text-muted-foreground">{isSpeakerView ? '按说话人阅读' : '原始内容'}</span>
        </div>
        <TranscriptButtonGroup
          transcriptCount={usePagination ? (totalCount ?? convertedSegments.length) : (transcripts?.length || 0)}
          onCopyTranscript={() => { void handleCopyTranscript(); }}
          onOpenMeetingFolder={onOpenMeetingFolder}
          meetingId={meetingId}
          meetingFolderPath={meetingFolderPath}
          onRefetchTranscripts={handleRetranscribeComplete}
        />
        {speakers && !isRecording && <SpeakerTranscriptControls
          controller={speakers}
          transcriptCount={usePagination ? (totalCount ?? convertedSegments.length) : transcripts.length}
          showSpeakers={isSpeakerView}
          onShowSpeakers={setShowSpeakers}
          onGenerated={() => { setOriginalTranscriptUpdated(false); setShowSpeakers(true); }}
        />}
        {originalTranscriptUpdated && speakers?.transcript && (
          <p className="mt-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-foreground" role="status">
            原始转写已更新；按说话人整理的内容尚未更新，需要时可重新自动分人。
          </p>
        )}
      </div>

      {/* Transcript content - use virtualized view for better performance */}
      <div className="min-h-0 flex-1 overflow-hidden pb-2">
        <VirtualizedTranscriptView
          segments={isSpeakerView ? attributedSegments : convertedSegments}
          isRecording={isRecording}
          isPaused={false}
          isProcessing={false}
          isStopping={false}
          enableStreaming={false}
          showConfidence={!isSpeakerView}
          preserveText={isSpeakerView}
          disableAutoScroll={disableAutoScroll}
          hasMore={!isSpeakerView && hasMore}
          isLoadingMore={!isSpeakerView && isLoadingMore}
          totalCount={isSpeakerView ? attributedSegments.length : totalCount}
          loadedCount={isSpeakerView ? attributedSegments.length : loadedCount}
          onLoadMore={isSpeakerView ? undefined : onLoadMore}
          renderSegmentHeader={isSpeakerView && speakers?.transcript ? (_segment, index) => {
            const transcript = speakers.transcript!;
            const segment = transcript.segments[index];
            const choices = [...new Set([...transcript.speakers, segment.speaker, 'unknown'])];
            return <div className="mb-1.5 flex items-center gap-1.5">
              <SpeakerIdentity id={segment.speaker} />
              <span className="text-xs font-semibold text-foreground">{speakerLabel(segment.speaker, transcript.names)}</span>
              <details className="ml-auto">
                <summary className="cursor-pointer list-none text-[11px] text-muted-foreground hover:text-foreground">修改</summary>
              <select aria-label={`第 ${index + 1} 段的说话人`}
                title="更换这段发言的说话人"
                value={segment.speaker} disabled={!!speakers.busy || speakers.isLoading}
                className="max-w-full rounded-md border border-transparent bg-transparent py-0.5 pr-1 text-xs font-semibold text-foreground hover:border-border hover:bg-muted focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                onChange={event => { void speakers.assign(index, event.target.value); }}>
                {choices.map(id => <option key={id} value={id}>{speakerLabel(id, transcript.names)}</option>)}
              </select>
              </details>
            </div>;
          } : undefined}
        />
      </div>

      {/* Custom prompt input at bottom of transcript section */}
      {!isRecording && convertedSegments.length > 0 && (
        <details className="shrink-0 border-t border-border bg-muted/25 px-4 py-3">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">补充会议背景</summary>
          <label htmlFor="meeting-summary-context" className="sr-only">补充会议背景</label>
          <textarea
            id="meeting-summary-context"
            placeholder="例如参会人、讨论目标，帮助整理纪要…"
            className="mt-2 w-full rounded-lg border border-border bg-background/70 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 min-h-[64px] max-h-40 resize-y"
            value={customPrompt}
            onChange={(e) => onPromptChange(e.target.value)}
          />
        </details>
      )}
    </div>
  );
}
