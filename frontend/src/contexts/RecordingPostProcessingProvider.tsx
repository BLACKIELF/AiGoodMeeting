'use client';

import React, { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useRecordingStop } from '@/hooks/useRecordingStop';

/**
 * RecordingPostProcessingProvider
 *
 * This provider handles post-processing when recording stops from any source:
 * - Tray menu stop
 * - Global keyboard shortcut
 * - Overlay stop button
 * - Main UI stop button
 *
 * It listens for the 'recording-stop-complete' event from Rust backend
 * and triggers the full post-processing flow (save to database, navigate, analytics)
 * regardless of which page the user is currently on.
 */
export function RecordingPostProcessingProvider({ children }: { children: React.ReactNode }) {
  // No-op functions since the global RecordingStateContext already handles state updates
  // These are only needed for the hook's local component state management
  const setIsRecording = () => { };
  const setIsRecordingDisabled = () => { };

  const {
    handleRecordingStop,
  } = useRecordingStop(setIsRecording, setIsRecordingDisabled);

  useEffect(() => {
    let disposed = false;
    let unlistenFn: (() => void) | undefined;

    const setupListener = async () => {
      try {
        // Listen for recording-stop-complete event from Rust
        unlistenFn = await listen<boolean>('recording-stop-complete', (event) => {

          // Call the post-processing handler
          // event.payload is the callApi boolean (true for normal stops)
          if (!disposed) void handleRecordingStop(event.payload).catch(error => console.error('Recording post-processing failed:', error));
        });

      } catch (error) {
        console.error('[RecordingPostProcessing] Failed to set up event listener:', error);
      }
    };

    setupListener();

    return () => {
      disposed = true;
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, [handleRecordingStop]);

  return <>{children}</>;
}
