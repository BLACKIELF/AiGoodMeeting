import { toUserMessage } from '@/lib/user-message';
import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { useConfig } from '@/contexts/ConfigContext';
import { useRecordingState, RecordingStatus } from '@/contexts/RecordingStateContext';
import { recordingService } from '@/services/recordingService';
import Analytics from '@/lib/analytics';
import { showRecordingNotification } from '@/lib/recordingNotification';
import {
  getProviderCommands,
  hasDownloadingModel,
  type ModelWithStatus,
} from '@/lib/transcription-model-readiness';
import { toast } from 'sonner';

const TRANSCRIPTION_RUNTIME_START_ERROR_CODE = 'TRANSCRIPTION_RUNTIME_INITIALIZATION_FAILED';
const TRANSCRIPTION_RUNTIME_USER_MESSAGE = '语音识别未能启动，请重新打开应用。若仍无法使用，请修复或重新安装应用。';

const isTranscriptionRuntimeStartError = (error: unknown) =>
  String(error) === TRANSCRIPTION_RUNTIME_START_ERROR_CODE;

interface UseRecordingStartReturn {
  handleRecordingStart: () => Promise<void>;
  isAutoStarting: boolean;
}

interface TranscriptConfig {
  provider?: string;
}

/**
 * Custom hook for managing recording start lifecycle.
 * Handles both manual start (button click) and auto-start (from sidebar navigation).
 *
 * Features:
 * - Meeting title generation (format: Meeting DD_MM_YY_HH_MM_SS)
 * - Transcript clearing on start
 * - Analytics tracking
 * - Recording notification display
 * - Auto-start from sidebar via sessionStorage flag
 */
export function useRecordingStart(
  isRecording: boolean,
  setIsRecording: (value: boolean) => void,
  showModal?: (name: 'modelSelector', message?: string) => void
): UseRecordingStartReturn {
  const [isAutoStarting, setIsAutoStarting] = useState(false);

  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Synchronous latch: a rapid double-click re-enters handleRecordingStart
  // before any state update lands, so an async/state guard can't stop it.
  const isStartingRef = useRef(false);

  const { clearTranscripts, setMeetingTitle } = useTranscripts();
  const { setIsMeetingActive } = useSidebar();
  const { selectedDevices } = useConfig();
  const { setStatus } = useRecordingState();

  // Generate meeting title with timestamp
  const generateMeetingTitle = useCallback(() => {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = String(now.getFullYear()).slice(-2);
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `会议 ${day}_${month}_${year}_${hours}_${minutes}_${seconds}`;
  }, []);

  const getTranscriptionProvider = useCallback(async (): Promise<string> => {
    try {
      const config = await invoke<TranscriptConfig | null>('api_get_transcript_config');
      return config?.provider || 'parakeet';
    } catch (error) {
      console.error('Failed to load transcription provider:', error);
      return 'parakeet';
    }
  }, []);

  // Check the selected local transcription provider, not a hardcoded engine.
  const checkTranscriptionModelReady = useCallback(async (): Promise<boolean> => {
    try {
      const provider = await getTranscriptionProvider();
      const commands = getProviderCommands(provider);

      if (commands) {
        await invoke(commands.initialize);
        return await invoke<boolean>(commands.hasAvailableModels);
      }

      console.error(`Unsupported transcription provider: ${provider}`);
      return false;
    } catch (error) {
      console.error('Failed to check transcription model status:', error);
      return false;
    }
  }, [getTranscriptionProvider]);

  // Check download status for the selected local transcription provider.
  const checkIfModelDownloading = useCallback(async (): Promise<boolean> => {
    try {
      const provider = await getTranscriptionProvider();
      const commands = getProviderCommands(provider);
      if (!commands) return false;

      const models = await invoke<ModelWithStatus[]>(commands.getAvailableModels);
      return hasDownloadingModel(models);
    } catch (error) {
      console.error('Failed to check model download status:', error);
      return false; // Default to not downloading (will show error + modal)
    }
  }, [getTranscriptionProvider]);

  // The Rust recording command validates the same provider again before capture.
  const checkModelReady = checkTranscriptionModelReady;

  // Handle manual recording start (from button click)
  const handleRecordingStart = useCallback(async () => {
    if (isStartingRef.current) {
      return;
    }
    isStartingRef.current = true;
    try {

      // Check the selected transcription model before starting.
      const modelReady = await checkModelReady();
      if (!mountedRef.current) return;
      if (!modelReady) {
        const isDownloading = await checkIfModelDownloading();
        if (!mountedRef.current) return;
        if (isDownloading) {
          toast.info('模型正在下载', {
            description: '转写模型下载完成后即可录音。',
            duration: 5000,
          });
          void Analytics.trackButtonClick('start_recording_blocked_downloading', 'home_page').catch(error => console.warn('Failed to track recording action:', error));
        } else {
          toast.error('转写模型尚未就绪', {
            description: '请先下载转写模型。',
            duration: 5000,
          });
          showModal?.('modelSelector', '请先配置转写模型');
          void Analytics.trackButtonClick('start_recording_blocked_missing', 'home_page').catch(error => console.warn('Failed to track recording action:', error));
        }
        if (mountedRef.current) setStatus(RecordingStatus.IDLE);
        return;
      }


      const randomTitle = generateMeetingTitle();
      if (mountedRef.current) setMeetingTitle(randomTitle);

      // Set STARTING status before initiating backend recording
      if (mountedRef.current) setStatus(RecordingStatus.STARTING, '正在准备录音…');

      // Start the actual backend recording
      await recordingService.startRecordingWithDevices(
        selectedDevices?.micDevice || null,
        selectedDevices?.systemDevice || null,
        randomTitle
      );

      // Update state after successful backend start
      // Note: RECORDING status will be set by RecordingStateContext event listener
      if (mountedRef.current) setIsRecording(true); // This will also update the sidebar via the useEffect
      if (mountedRef.current) clearTranscripts(); // Clear previous transcripts when starting new recording
      if (mountedRef.current) setIsMeetingActive(true);
      void Analytics.trackButtonClick('start_recording', 'home_page').catch(error => console.warn('Failed to track recording action:', error));

      // Show recording notification if enabled
      await showRecordingNotification();
    } catch (error) {
      console.error('Failed to start recording:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);

      // A racing second start that lost to a live recording must not clobber
      // the running recording's state. The winning start is live, so reflect
      // RECORDING here — leaving STARTING latched would keep the Stop button
      // disabled forever, since it's gated on isStartingRecording.
      if (errorMsg.includes('already in progress')) {
        console.warn('Start rejected because recording is already active - leaving live recording state untouched');
        if (mountedRef.current) setStatus(RecordingStatus.RECORDING);
        void Analytics.trackButtonClick('start_recording_error', 'home_page').catch(error => console.warn('Failed to track recording action:', error));
        return;
      }

      const isRuntimeError = isTranscriptionRuntimeStartError(error);
      if (errorMsg.includes('Recording start timed out')) {
        toast.error('开始录音超时，请重试。');
      }

      if (mountedRef.current) setStatus(RecordingStatus.ERROR, isRuntimeError
        ? TRANSCRIPTION_RUNTIME_USER_MESSAGE
        : toUserMessage(error, '无法开始录音，请检查设备和权限后重试。'));
      if (mountedRef.current) setIsRecording(false); // Reset state on error
      void Analytics.trackButtonClick('start_recording_error', 'home_page').catch(error => console.warn('Failed to track recording action:', error));
      if (isRuntimeError) return;
      // Re-throw so RecordingControls can handle device-specific errors
      throw error;
    } finally {
      isStartingRef.current = false;
    }
  }, [generateMeetingTitle, setMeetingTitle, setIsRecording, clearTranscripts, setIsMeetingActive, checkModelReady, checkIfModelDownloading, selectedDevices, showModal, setStatus]);

  // Check for autoStartRecording flag and start recording automatically
  useEffect(() => {
    const checkAutoStartRecording = async () => {
      if (typeof window !== 'undefined') {
        const shouldAutoStart = sessionStorage.getItem('autoStartRecording');
        if (shouldAutoStart === 'true' && !isRecording && !isAutoStarting) {
          if (mountedRef.current) setIsAutoStarting(true);
          sessionStorage.removeItem('autoStartRecording'); // Clear the flag

          // Check the selected transcription model before starting.
          const modelReady = await checkModelReady();
      if (!mountedRef.current) return;
          if (!modelReady) {
            const isDownloading = await checkIfModelDownloading();
        if (!mountedRef.current) return;
            if (isDownloading) {
              toast.info('模型正在下载', {
                description: '转写模型下载完成后即可录音。',
                duration: 5000,
              });
              void Analytics.trackButtonClick('start_recording_blocked_downloading', 'sidebar_auto').catch(error => console.warn('Failed to track recording action:', error));
            } else {
              toast.error('转写模型尚未就绪', {
                description: '请先下载转写模型。',
                duration: 5000,
              });
              showModal?.('modelSelector', '请先配置转写模型');
              void Analytics.trackButtonClick('start_recording_blocked_missing', 'sidebar_auto').catch(error => console.warn('Failed to track recording action:', error));
            }
            if (mountedRef.current) setStatus(RecordingStatus.IDLE);
            if (mountedRef.current) setIsAutoStarting(false);
            return;
          }

          // Start the actual backend recording
          try {
            // Generate meeting title
            const generatedMeetingTitle = generateMeetingTitle();

            // Set STARTING status before initiating backend recording
            if (mountedRef.current) setStatus(RecordingStatus.STARTING, '正在准备录音…');

            await recordingService.startRecordingWithDevices(
              selectedDevices?.micDevice || null,
              selectedDevices?.systemDevice || null,
              generatedMeetingTitle
            );

            // Update UI state after successful backend start
            // Note: RECORDING status will be set by RecordingStateContext event listener
            if (mountedRef.current) setMeetingTitle(generatedMeetingTitle);
            if (mountedRef.current) setIsRecording(true);
            if (mountedRef.current) clearTranscripts();
            if (mountedRef.current) setIsMeetingActive(true);
            void Analytics.trackButtonClick('start_recording', 'sidebar_auto').catch(error => console.warn('Failed to track recording action:', error));

            // Show recording notification if enabled
            await showRecordingNotification();
          } catch (error) {
            console.error('Failed to auto-start recording:', error);
            const errorMsg = error instanceof Error ? error.message : String(error);
            if (errorMsg.includes('already in progress')) {
              // Benign race — another start won and is live; skip ERROR/alert.
              if (mountedRef.current) setStatus(RecordingStatus.RECORDING);
            } else {
              const isRuntimeError = isTranscriptionRuntimeStartError(error);
              if (mountedRef.current) setStatus(RecordingStatus.ERROR, isRuntimeError
                ? TRANSCRIPTION_RUNTIME_USER_MESSAGE
                : toUserMessage(error, '无法开始录音，请检查设备和权限后重试。'));
              if (!isRuntimeError) {
                alert(toUserMessage(error, '无法开始录音，请检查设备和权限后重试。'));
              }
            }
            void Analytics.trackButtonClick('start_recording_error', 'sidebar_auto').catch(error => console.warn('Failed to track recording action:', error));
          } finally {
            if (mountedRef.current) setIsAutoStarting(false);
          }
        }
      }
    };

    void checkAutoStartRecording().catch(error => console.error('Auto-start recording check failed:', error));
  }, [
    isRecording,
    isAutoStarting,
    selectedDevices,
    generateMeetingTitle,
    setMeetingTitle,
    setIsRecording,
    clearTranscripts,
    setIsMeetingActive,
    checkModelReady,
    checkIfModelDownloading,
    showModal,
    setStatus,
  ]);

  // Listen for direct recording trigger from sidebar when already on home page
  useEffect(() => {
    const handleDirectStart = async () => {
      if (isRecording || isAutoStarting) {
        return;
      }

      if (mountedRef.current) setIsAutoStarting(true);

      // Check the selected transcription model before starting.
      const modelReady = await checkModelReady();
      if (!mountedRef.current) return;
      if (!modelReady) {
        const isDownloading = await checkIfModelDownloading();
        if (!mountedRef.current) return;
        if (isDownloading) {
          toast.info('模型正在下载', {
            description: '转写模型下载完成后即可录音。',
            duration: 5000,
          });
          void Analytics.trackButtonClick('start_recording_blocked_downloading', 'sidebar_direct').catch(error => console.warn('Failed to track recording action:', error));
        } else {
          toast.error('转写模型尚未就绪', {
            description: '请先下载转写模型。',
            duration: 5000,
          });
          showModal?.('modelSelector', '请先配置转写模型');
          void Analytics.trackButtonClick('start_recording_blocked_missing', 'sidebar_direct').catch(error => console.warn('Failed to track recording action:', error));
        }
        if (mountedRef.current) setStatus(RecordingStatus.IDLE);
        if (mountedRef.current) setIsAutoStarting(false);
        return;
      }

      try {
        // Generate meeting title
        const generatedMeetingTitle = generateMeetingTitle();

        // Set STARTING status before initiating backend recording
        if (mountedRef.current) setStatus(RecordingStatus.STARTING, '正在准备录音…');

        await recordingService.startRecordingWithDevices(
          selectedDevices?.micDevice || null,
          selectedDevices?.systemDevice || null,
          generatedMeetingTitle
        );

        // Update UI state after successful backend start
        // Note: RECORDING status will be set by RecordingStateContext event listener
        if (mountedRef.current) setMeetingTitle(generatedMeetingTitle);
        if (mountedRef.current) setIsRecording(true);
        if (mountedRef.current) clearTranscripts();
        if (mountedRef.current) setIsMeetingActive(true);
        void Analytics.trackButtonClick('start_recording', 'sidebar_direct').catch(error => console.warn('Failed to track recording action:', error));

        // Show recording notification if enabled
        await showRecordingNotification();
      } catch (error) {
        console.error('Failed to start recording from sidebar:', error);
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes('already in progress')) {
          // Benign race — another start won and is live; skip ERROR/alert.
          if (mountedRef.current) setStatus(RecordingStatus.RECORDING);
        } else {
          const isRuntimeError = isTranscriptionRuntimeStartError(error);
          if (mountedRef.current) setStatus(RecordingStatus.ERROR, isRuntimeError
            ? TRANSCRIPTION_RUNTIME_USER_MESSAGE
            : toUserMessage(error, '无法开始录音，请检查设备和权限后重试。'));
          if (!isRuntimeError) {
            alert(toUserMessage(error, '无法开始录音，请检查设备和权限后重试。'));
          }
        }
        void Analytics.trackButtonClick('start_recording_error', 'sidebar_direct').catch(error => console.warn('Failed to track recording action:', error));
      } finally {
        if (mountedRef.current) setIsAutoStarting(false);
      }
    };

    const handleEvent = () => {
      void handleDirectStart().catch(error => console.error('Direct recording start failed:', error));
    };
    window.addEventListener('start-recording-from-sidebar', handleEvent);

    return () => {
      window.removeEventListener('start-recording-from-sidebar', handleEvent);
    };
  }, [
    isRecording,
    isAutoStarting,
    selectedDevices,
    generateMeetingTitle,
    setMeetingTitle,
    setIsRecording,
    clearTranscripts,
    setIsMeetingActive,
    checkModelReady,
    checkIfModelDownloading,
    showModal,
    setStatus,
  ]);

  return {
    handleRecordingStart,
    isAutoStarting,
  };
}
