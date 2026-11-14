import { toUserMessage } from '@/lib/user-message';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { useRecordingState, RecordingStatus } from '@/contexts/RecordingStateContext';
import { storageService } from '@/services/storageService';
import { transcriptService } from '@/services/transcriptService';
import Analytics from '@/lib/analytics';
import {
  applyPinnedSummaryLanguageToMeeting,
  detectAndCacheSummaryLanguage,
} from '@/lib/summary-language-preferences';

type SummaryStatus = 'idle' | 'processing' | 'summarizing' | 'regenerating' | 'completed' | 'error';

interface UseRecordingStopReturn {
  handleRecordingStop: (callApi: boolean) => Promise<void>;
  isStopping: boolean;
  isProcessingTranscript: boolean;
  isSavingTranscript: boolean;
  summaryStatus: SummaryStatus;
  setIsStopping: (value: boolean) => void;
}

/**
 * Custom hook for managing recording stop lifecycle.
 * Handles the complex stop sequence: transcription wait → buffer flush → SQLite save → navigation.
 *
 * Features:
 * - Transcription completion polling (60s max, 500ms interval)
 * - Transcript buffer flush coordination
 * - SQLite meeting save with folder_path from sessionStorage
 * - Comprehensive analytics tracking (duration, word count, activation)
 * - Auto-navigation to meeting details
 * - Toast notifications for success/error
 * - Window exposure for Rust callbacks
 */
export function useRecordingStop(
  setIsRecording: (value: boolean) => void,
  setIsRecordingDisabled: (value: boolean) => void
): UseRecordingStopReturn {
  // USE global state instead
  const recordingState = useRecordingState();
  const {
    status,
    setStatus,
    isStopping,
    isProcessing: isProcessingTranscript,
    isSaving: isSavingTranscript
  } = recordingState;

  const {
    transcriptsRef,
    flushBuffer,
    clearTranscripts,
    meetingTitle,
    markMeetingAsSaved,
  } = useTranscripts();

  const {
    refetchMeetings,
    setCurrentMeeting,
    setMeetings,
    meetings,
    setIsMeetingActive,
  } = useSidebar();

  const router = useRouter();

  const navigationTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const completionUnlistenRef = useRef<(() => void) | null>(null);
  const waitsRef = useRef(new Map<ReturnType<typeof setTimeout>, () => void>());
  const wait = useCallback((ms: number) => new Promise<void>(resolve => {
    const timer = setTimeout(() => { waitsRef.current.delete(timer); resolve(); }, ms);
    waitsRef.current.set(timer, resolve);
  }), []);
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimeout(navigationTimerRef.current);
    };
  }, []);

  // Guard to prevent duplicate/concurrent stop calls (e.g., from UI and tray simultaneously)
  const stopInProgressRef = useRef(false);

  // Promise to track recording-stopped event data (fixes race condition with recording-stop-complete)
  const recordingStoppedDataRef = useRef<Promise<void> | null>(null);

  // Set up recording-stopped listener for meeting navigation
  useEffect(() => {
    let disposed = false;
    let unlistenFn: (() => void) | undefined;

    const setupRecordingStoppedListener = async () => {
      try {
        unlistenFn = await listen<{
          message: string;
          folder_path?: string;
          meeting_name?: string;
        }>('recording-stopped', (event) => {
          if (disposed) return;
          // Create promise that resolves when sessionStorage is set (prevents race condition)
          recordingStoppedDataRef.current = (async () => {
            const { folder_path, meeting_name } = event.payload;

            // Store folder_path and meeting_name for later use in handleRecordingStop
            if (folder_path) {
              sessionStorage.setItem('last_recording_folder_path', folder_path);
            }
            if (meeting_name) {
              sessionStorage.setItem('last_recording_meeting_name', meeting_name);
            }
          })().catch(error => console.error('Failed to store recording stopped data:', error));

        });
        if (disposed) { unlistenFn(); unlistenFn = undefined; }
      } catch (error) {
        console.error('Failed to setup recording stopped listener:', error);
      }
    };

    setupRecordingStoppedListener();

    return () => {
      disposed = true;
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, [router]);

  // Main recording stop handler
  const handleRecordingStop = useCallback(async (isCallApi: boolean) => {
    if (recordingStoppedDataRef.current) {
      await recordingStoppedDataRef.current;
    }

    // Guard: prevent duplicate/concurrent stop calls
    if (stopInProgressRef.current) {
      return;
    }
    stopInProgressRef.current = true;

    // Set status to STOPPING immediately
    if (mountedRef.current) setStatus(RecordingStatus.STOPPING);
    if (mountedRef.current) setIsRecording(false);
    if (mountedRef.current) setIsRecordingDisabled(true);

    try {

      // Note: stop_recording is already called by RecordingControls.stopRecordingAction
      // This function only handles post-stop processing (transcription wait, API call, navigation)

      // Wait for transcription to complete
      if (mountedRef.current) setStatus(RecordingStatus.PROCESSING_TRANSCRIPTS, '正在等待转写完成…');

      const MAX_WAIT_TIME = 60000; // 60 seconds maximum wait (increased for longer processing)
      const POLL_INTERVAL = 500; // Check every 500ms
      let elapsedTime = 0;
      let transcriptionComplete = false;

      // Listen for transcription-complete event
      const unlistenComplete = await listen('transcription-complete', () => {
        transcriptionComplete = true;
      });

      completionUnlistenRef.current = unlistenComplete;

      // Poll for transcription status
      while (elapsedTime < MAX_WAIT_TIME && !transcriptionComplete) {
        try {
          const status = await transcriptService.getTranscriptionStatus();

          // Check if transcription is complete
          if (!status.is_processing && status.chunks_in_queue === 0) {
            transcriptionComplete = true;
            break;
          }

          // If no activity for more than 8 seconds and no chunks in queue, consider it done (increased from 5s to 8s)
          if (status.last_activity_ms > 8000 && status.chunks_in_queue === 0) {
            transcriptionComplete = true;
            break;
          }

          // Update user with current status
          if (status.chunks_in_queue > 0) {
            if (mountedRef.current) setStatus(RecordingStatus.PROCESSING_TRANSCRIPTS, `正在处理剩余 ${status.chunks_in_queue} 段…`);
          }

          // Wait before next check
          await wait(POLL_INTERVAL);
          elapsedTime += POLL_INTERVAL;
        } catch (error) {
          console.error('Error checking transcription status:', error);
          break;
        }
      }

      // Clean up listener
      completionUnlistenRef.current = null;
      unlistenComplete();

      if (!transcriptionComplete && elapsedTime >= MAX_WAIT_TIME) {
        console.warn('Transcription wait timeout reached after', elapsedTime, 'ms');
      } else {
        // Wait longer for any late transcript segments (increased from 1s to 4s)
        await wait(4000);
      }

      // Final buffer flush: process ALL remaining transcripts regardless of timing
      if (mountedRef.current) setStatus(RecordingStatus.PROCESSING_TRANSCRIPTS, '正在整理转写内容…');
      flushBuffer();

      // NOTE: Status remains PROCESSING_TRANSCRIPTS until we start saving

      // Wait a bit more to ensure all transcript state updates have been processed
      await wait(500);

      // Save to SQLite
      // NOTE: enabled to save COMPLETE transcripts after frontend receives all updates
      // This ensures user sees all transcripts streaming in before database save
      if (isCallApi && transcriptionComplete == true) {

        if (mountedRef.current) setStatus(RecordingStatus.SAVING, '正在保存会议…');

        // Get fresh transcript state (ALL transcripts including late ones)
        const freshTranscripts = [...transcriptsRef.current];

        // Get folder_path and meeting_name from recording-stopped event
        const folderPath = sessionStorage.getItem('last_recording_folder_path');
        const savedMeetingName = sessionStorage.getItem('last_recording_meeting_name');


        try {
          const responseData = await storageService.saveMeeting(
            savedMeetingName || meetingTitle || '新会议',  // PREFER savedMeetingName (backend source)
            freshTranscripts,
            folderPath
          );

          const meetingId = responseData.meeting_id;
          if (!meetingId) {
            console.error('No meeting_id in response:', responseData);
            throw new Error('No meeting ID received from save operation');
          }

          let shouldDetectSummaryLanguage = false;
          try {
            shouldDetectSummaryLanguage = !(await applyPinnedSummaryLanguageToMeeting(meetingId));
          } catch (error) {
            console.warn('Failed to apply pinned summary language preference for new meeting:', error);
            toast.warning('未能应用默认纪要语言', {
              description: '会议已保存，但默认纪要语言未生效，可在会议页面重新选择。',
            });
          }

          if (shouldDetectSummaryLanguage) {
            try {
              await detectAndCacheSummaryLanguage(
                meetingId,
                freshTranscripts.map(t => t.text)
              );
            } catch (error) {
              console.warn('Failed to detect summary language for new meeting:', error);
              toast.warning('未能识别纪要语言', {
                description: '会议已保存，但未能自动识别纪要语言，请在会议页面选择。',
              });
            }
          }


          // Mark meeting as saved in IndexedDB (for recovery system)
          await markMeetingAsSaved();

          // Clean up session storage
          sessionStorage.removeItem('last_recording_folder_path');
          sessionStorage.removeItem('last_recording_meeting_name');
          // Clean up IndexedDB meeting ID (redundant with markMeetingAsSaved cleanup, but ensures cleanup)
          sessionStorage.removeItem('indexeddb_current_meeting_id');

          // Refetch meetings and set current meeting
          await refetchMeetings();

          try {
            const meetingData = await storageService.getMeeting(meetingId);
            if (meetingData) {
              if (mountedRef.current) setCurrentMeeting({
                id: meetingId,
                title: meetingData.title
              });
            }
          } catch (error) {
            console.warn('Could not fetch meeting details, using ID only:', error);
            if (mountedRef.current) setCurrentMeeting({ id: meetingId, title: savedMeetingName || meetingTitle || '新会议' });
          }

          // Mark as completed
          if (mountedRef.current) setStatus(RecordingStatus.COMPLETED);

          // Show success toast with navigation option
          toast.success('录音已保存', {
            description: `已保存 ${freshTranscripts.length} 段转写内容。`,
            action: {
              label: '查看会议',
              onClick: () => {
                router.push(`/meeting-details?id=${meetingId}&source=recording`);
                void Analytics.trackButtonClick('view_meeting_from_toast', 'recording_complete').catch(error => console.warn('Failed to track recording navigation:', error));
              }
            },
            duration: 10000,
          });

          // Auto-navigate after a short delay with source parameter
          clearTimeout(navigationTimerRef.current);
          navigationTimerRef.current = setTimeout(() => {
            if (!mountedRef.current) return;
            router.push(`/meeting-details?id=${meetingId}&source=recording`);
            if (mountedRef.current) clearTranscripts()
            void Analytics.trackPageView('meeting_details').catch(error => console.warn('Failed to track recording navigation:', error));

            // Reset to IDLE after navigation
            if (mountedRef.current) setStatus(RecordingStatus.IDLE);
          }, 2000);
          // Track meeting completion analytics
          try {
            // Calculate meeting duration from transcript timestamps
            let durationSeconds = 0;
            if (freshTranscripts.length > 0 && freshTranscripts[0].audio_start_time !== undefined) {
              // Use audio_end_time of last transcript if available
              const lastTranscript = freshTranscripts[freshTranscripts.length - 1];
              durationSeconds = lastTranscript.audio_end_time || lastTranscript.audio_start_time || 0;
            }

            // Calculate word count
            const transcriptWordCount = freshTranscripts
              .map(t => t.text.split(/\s+/).length)
              .reduce((a, b) => a + b, 0);

            // Calculate words per minute
            const wordsPerMinute = durationSeconds > 0 ? transcriptWordCount / (durationSeconds / 60) : 0;

            // Get meetings count today
            const meetingsToday = await Analytics.getMeetingsCountToday();

            // Track meeting completed
            await Analytics.trackMeetingCompleted(meetingId, {
              duration_seconds: durationSeconds,
              transcript_segments: freshTranscripts.length,
              transcript_word_count: transcriptWordCount,
              words_per_minute: wordsPerMinute,
              meetings_today: meetingsToday
            });

            // Update meeting count in analytics.json
            await Analytics.updateMeetingCount();

            // Check for activation (first meeting)
            const { Store } = await import('@tauri-apps/plugin-store');
            const store = await Store.load('analytics.json');
            const totalMeetings = await store.get<number>('total_meetings');

            if (totalMeetings === 1) {
              const daysSinceInstall = await Analytics.calculateDaysSince('first_launch_date');
              await Analytics.track('user_activated', {
                meetings_count: '1',
                days_since_install: daysSinceInstall?.toString() || 'null',
                first_meeting_duration_seconds: durationSeconds.toString()
              });
            }
          } catch (analyticsError) {
            console.error('Failed to track meeting completion analytics:', analyticsError);
            // Don't block user flow on analytics errors
          }

        } catch (saveError) {
          console.error('Failed to save meeting to database:', saveError);
          if (mountedRef.current) setStatus(RecordingStatus.ERROR, toUserMessage(saveError, '会议保存失败，请重试。'));
          toast.error('会议保存失败', {
            description: toUserMessage(saveError, '会议保存失败，请重试。')
          });
          throw saveError;
        }
      } else {
        // No save needed, go back to IDLE
        if (mountedRef.current) setStatus(RecordingStatus.IDLE);
      }

      if (mountedRef.current) setIsMeetingActive(false);
      // isRecording already set to false at function start
      if (mountedRef.current) setIsRecordingDisabled(false);
    } catch (error) {
      console.error('Error in handleRecordingStop:', error);
      if (mountedRef.current) setStatus(RecordingStatus.ERROR, toUserMessage(error, '录音处理未完成，请重试。'));
      // isRecording already set to false at function start
      if (mountedRef.current) setIsRecordingDisabled(false);
    } finally {
      completionUnlistenRef.current?.();
      completionUnlistenRef.current = null;
      // Always reset the guard flag when done
      stopInProgressRef.current = false;
    }
  }, [
    wait,
    setIsRecording,
    setIsRecordingDisabled,
    setStatus,
    transcriptsRef,
    flushBuffer,
    clearTranscripts,
    meetingTitle,
    markMeetingAsSaved,
    refetchMeetings,
    setCurrentMeeting,
    setMeetings,
    meetings,
    setIsMeetingActive,
    router,
  ]);

  // Expose handleRecordingStop function to window for Rust callbacks
  const handleRecordingStopRef = useRef(handleRecordingStop);
  useEffect(() => {
    handleRecordingStopRef.current = handleRecordingStop;
  });

  useEffect(() => {
    (window as any).handleRecordingStop = (callApi: boolean = true) => {
      void handleRecordingStopRef.current(callApi).catch(error => console.error('Recording stop callback failed:', error));
    };

    // Cleanup on unmount
    return () => {
      delete (window as any).handleRecordingStop;
    };
  }, []);

  // Derive summaryStatus from RecordingStatus for backward compatibility
  const summaryStatus: SummaryStatus = status === RecordingStatus.PROCESSING_TRANSCRIPTS ? 'processing' : 'idle';

  return {
    handleRecordingStop,
    isStopping,
    isProcessingTranscript,
    isSavingTranscript,
    summaryStatus,
    setIsStopping: (value: boolean) => {
      setStatus(value ? RecordingStatus.STOPPING : RecordingStatus.IDLE);
    },
  };
}
