import { toUserMessage } from '@/lib/user-message';
import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import Analytics from '@/lib/analytics';
import { applyPinnedSummaryLanguageToMeeting } from '@/lib/summary-language-preferences';
import { toast } from 'sonner';

export interface AudioFileInfo {
  path: string;
  filename: string;
  duration_seconds: number;
  size_bytes: number;
  format: string;
}

export interface ImportProgress {
  stage: string;
  progress_percentage: number;
  message: string;
}

export interface ImportResult {
  meeting_id: string;
  title: string;
  segments_count: number;
  duration_seconds: number;
}

export interface ImportError {
  error: string;
}

export type ImportStatus = 'idle' | 'validating' | 'processing' | 'complete' | 'error';

export interface UseImportAudioOptions {
  onComplete?: (result: ImportResult) => void;
  onError?: (error: string) => void;
}

export interface UseImportAudioReturn {
  status: ImportStatus;
  fileInfo: AudioFileInfo | null;
  progress: ImportProgress | null;
  error: string | null;
  isProcessing: boolean;
  isBusy: boolean;
  selectFile: () => Promise<AudioFileInfo | null>;
  validateFile: (path: string) => Promise<AudioFileInfo | null>;
  startImport: (
    sourcePath: string,
    title: string,
    language?: string | null,
    model?: string | null,
    provider?: string | null
  ) => Promise<void>;
  cancelImport: () => Promise<void>;
  reset: () => void;
}

export function useImportAudio({
  onComplete,
  onError,
}: UseImportAudioOptions = {}): UseImportAudioReturn {
  const [status, setStatus] = useState<ImportStatus>('idle');
  const [fileInfo, setFileInfo] = useState<AudioFileInfo | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Stable refs for callbacks to avoid listener re-registration on every render
  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  const mountedRef = useRef(false);
  const operationRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; operationRef.current += 1; };
  }, []);

  // Cancellation guard: prevents late events from updating state after cancel
  const isCancelledRef = useRef(false);

  // Set up event listeners (registered once, use refs for callbacks)
  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    const cleanedUpRef = { current: false };

    const setupListeners = async () => {
      // Progress events
      const unlistenProgress = await listen<ImportProgress>(
        'import-progress',
        (event) => {
          if (cleanedUpRef.current || isCancelledRef.current) return;
          setProgress(event.payload);
          setStatus('processing');
        }
      );
      if (cleanedUpRef.current) {
        unlistenProgress();
        return;
      }
      unlisteners.push(unlistenProgress);

      // Completion event
      const unlistenComplete = await listen<ImportResult>(
        'import-complete',
        (event) => {
          void (async () => {
            if (cleanedUpRef.current || isCancelledRef.current) return;

            const operation = operationRef.current;
            await Analytics.track('import_audio_completed', {
              success: 'true',
              duration_seconds: event.payload.duration_seconds.toString(),
              segments_count: event.payload.segments_count.toString()
            }).catch(error => console.warn('Failed to track import completion:', error));
            if (cleanedUpRef.current || isCancelledRef.current || operation !== operationRef.current) return;

            setStatus('complete');
            setProgress(null);
            try {
              await applyPinnedSummaryLanguageToMeeting(event.payload.meeting_id);
            } catch (error) {
              console.warn('Failed to apply pinned summary language to imported meeting:', error);
              toast.warning('未能应用默认纪要语言', {
                description: '音频已导入并保存，但默认纪要语言未生效，可在会议页面重新选择。',
              });
            }
            if (cleanedUpRef.current || isCancelledRef.current || operation !== operationRef.current) return;
            onCompleteRef.current?.(event.payload);
          })().catch(error => console.error('Import completion callback failed:', error));
        }
      );
      if (cleanedUpRef.current) {
        unlistenComplete();
        unlisteners.forEach(u => u());
        return;
      }
      unlisteners.push(unlistenComplete);

      // Error event
      const unlistenError = await listen<ImportError>(
        'import-error',
        (event) => {
          void (async () => {
            if (cleanedUpRef.current || isCancelledRef.current) return;

            const operation = operationRef.current;
            await Analytics.trackError('import_audio_failed', event.payload.error)
              .catch(error => console.warn('Failed to track import error:', error));
            if (cleanedUpRef.current || isCancelledRef.current || operation !== operationRef.current) return;

            setStatus('error');
            const message = toUserMessage(event.payload.error, '音频导入失败，请重试。');
            setError(message);
            onErrorRef.current?.(message);
          })().catch(error => console.error('Import error callback failed:', error));
        }
      );
      if (cleanedUpRef.current) {
        unlistenError();
        unlisteners.forEach(u => u());
        return;
      }
      unlisteners.push(unlistenError);
    };

    void setupListeners().catch(error => {
      unlisteners.splice(0).forEach(unlisten => unlisten());
      console.error('Failed to setup import listeners:', error);
    });

    return () => {
      cleanedUpRef.current = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  // Select file using native file dialog
  const selectFile = useCallback(async (): Promise<AudioFileInfo | null> => {
    const operation = ++operationRef.current;
    setStatus('validating');
    setError(null);

    try {
      const result = await invoke<AudioFileInfo | null>('select_and_validate_audio_command');
      if (!mountedRef.current || operation !== operationRef.current) return null;
      if (result) {
        setFileInfo(result);
        setStatus('idle');
        return result;
      } else {
        // User cancelled
        setStatus('idle');
        return null;
      }
    } catch (err: any) {
      if (!mountedRef.current || operation !== operationRef.current) return null;
      setStatus('error');
      const errorMsg = toUserMessage(err, '无法读取音频文件，请检查文件后重试。');
      setError(errorMsg);
      onErrorRef.current?.(errorMsg);
      return null;
    }
  }, []);

  // Validate a file from a given path (for drag-drop)
  const validateFile = useCallback(async (path: string): Promise<AudioFileInfo | null> => {
    const operation = ++operationRef.current;
    setStatus('validating');
    setError(null);

    try {
      const result = await invoke<AudioFileInfo>('validate_audio_file_command', { path });
      if (!mountedRef.current || operation !== operationRef.current) return null;
      setFileInfo(result);
      setStatus('idle');
      return result;
    } catch (err: any) {
      if (!mountedRef.current || operation !== operationRef.current) return null;
      setStatus('error');
      const errorMsg = toUserMessage(err, '无法读取音频文件，请检查文件后重试。');
      setError(errorMsg);
      onErrorRef.current?.(errorMsg);
      return null;
    }
  }, []);

  // Start the import process
  const startImport = useCallback(
    async (
      sourcePath: string,
      title: string,
      language?: string | null,
      model?: string | null,
      provider?: string | null
    ) => {
      const operation = ++operationRef.current;
      isCancelledRef.current = false;
      setStatus('processing');
      setError(null);
      setProgress(null);

      try {
        if (fileInfo) {
          await Analytics.track('import_audio_started', {
            file_size_bytes: fileInfo.size_bytes.toString(),
            duration_seconds: fileInfo.duration_seconds.toString(),
            language: language || 'auto',
            model_provider: provider || '',
            model_name: model || ''
          }).catch(error => console.warn('Failed to track import start:', error));
        }

        if (!mountedRef.current || isCancelledRef.current || operation !== operationRef.current) return;
        await invoke('start_import_audio_command', {
          sourcePath,
          title,
          language: language || null,
          model: model || null,
          provider: provider || null,
        });
      } catch (err: any) {
        if (!mountedRef.current || isCancelledRef.current || operation !== operationRef.current) return;
        setStatus('error');
        const errorMsg = toUserMessage(err, '无法开始导入音频，请重试。');
        setError(errorMsg);

        await Analytics.trackError('import_audio_failed', errorMsg)
          .catch(error => console.warn('Failed to track import error:', error));

        onErrorRef.current?.(errorMsg);
      }
    },
    [fileInfo]
  );

  // Cancel ongoing import
  const cancelImport = useCallback(async () => {
    const operation = ++operationRef.current;
    isCancelledRef.current = true;
    try {
      await invoke('cancel_import_command');
      if (!mountedRef.current || operation !== operationRef.current) return;
      setStatus('idle');
      setProgress(null);
    } catch (err: any) {
      console.error('Failed to cancel import:', err);
    }
  }, []);

  // Reset all state
  const reset = useCallback(() => {
    operationRef.current += 1;
    isCancelledRef.current = true;
    setStatus('idle');
    setFileInfo(null);
    setProgress(null);
    setError(null);
  }, []);

  return {
    status,
    fileInfo,
    progress,
    error,
    isProcessing: status === 'processing',
    isBusy: status === 'processing' || status === 'validating',
    selectFile,
    validateFile,
    startImport,
    cancelImport,
    reset,
  };
}
