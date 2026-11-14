import { useState, useEffect } from 'react';
import { recordingService } from '@/services/recordingService';

interface UseRecordingStateSyncReturn {
  isBackendRecording: boolean;
  isRecordingDisabled: boolean;
  setIsRecordingDisabled: (value: boolean) => void;
}

/**
 * Custom hook for synchronizing frontend recording state with backend.
 * Polls backend every 1 second to detect recording state changes.
 *
 * Features:
 * - Backend state synchronization (1-second polling)
 * - Recording disabled flag management (prevents re-recording during processing)
 */
export function useRecordingStateSync(
  isRecording: boolean,
  setIsRecording: (value: boolean) => void,
  setIsMeetingActive: (value: boolean) => void
): UseRecordingStateSyncReturn {
  const [isRecordingDisabled, setIsRecordingDisabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let checking = false;

    const checkRecordingState = async () => {
      if (cancelled || checking) return;
      checking = true;
      try {
        const isCurrentlyRecording = await recordingService.isRecording();
        if (cancelled) return;

        if (isCurrentlyRecording && !isRecording) {
          setIsRecording(true);
          setIsMeetingActive(true);
        } else if (!isCurrentlyRecording && isRecording) {
          setIsRecording(false);
        }
      } catch (error) {
        console.error('Failed to check recording state:', error);
      } finally {
        checking = false;
      }
    };

    // Test if Tauri is available
    if (typeof window !== 'undefined' && (window as any).__TAURI__) {
      checkRecordingState();

      // Set up a polling interval to periodically check recording state
      const interval = setInterval(checkRecordingState, 1000); // Check every 1 second

      return () => {
        cancelled = true;
        clearInterval(interval);
      };
    } else {
    }
  }, [isRecording, setIsRecording, setIsMeetingActive]);

  return {
    isBackendRecording: isRecording,
    isRecordingDisabled,
    setIsRecordingDisabled,
  };
}
