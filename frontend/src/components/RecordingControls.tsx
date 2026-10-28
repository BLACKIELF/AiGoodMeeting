'use client';

import { invoke } from '@tauri-apps/api/core';
import { appDataDir } from '@tauri-apps/api/path';
import { useCallback, useEffect, useState, useRef } from 'react';
import { Play, Pause, Square, Mic, AlertCircle, X } from 'lucide-react';
import { ProcessRequest, SummaryResponse } from '@/types/summary';
import { listen } from '@tauri-apps/api/event';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import Analytics from '@/lib/analytics';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import type { TranscriptionErrorPayload } from '@/services/transcriptService';

interface RecordingControlsProps {
  isRecording: boolean;
  barHeights: string[];
  onRecordingStop: (callApi?: boolean) => void;
  onRecordingStart: () => void;
  onTranscriptReceived: (summary: SummaryResponse) => void;
  onTranscriptionError?: (message: string) => void;
  onStopInitiated?: () => void; // Called immediately when stop button is clicked
  isRecordingDisabled: boolean;
  isParentProcessing: boolean;
  selectedDevices?: {
    micDevice: string | null;
    systemDevice: string | null;
  };
  meetingName?: string;
}

export const RecordingControls: React.FC<RecordingControlsProps> = ({
  isRecording,
  barHeights,
  onRecordingStop,
  onRecordingStart,
  onTranscriptReceived,
  onTranscriptionError,
  onStopInitiated,
  isRecordingDisabled,
  isParentProcessing,
  selectedDevices,
  meetingName,
}) => {
  // Use global recording state context for pause state (syncs with tray operations)
  const recordingState = useRecordingState();
  const isPaused = recordingState.isPaused;
  const isStartingRecording = recordingState.isStartingRecording;

  const [showPlayback, setShowPlayback] = useState(false);
  const [recordingPath, setRecordingPath] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isPausing, setIsPausing] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const MIN_RECORDING_DURATION = 2000; // 2 seconds minimum recording time
  const [transcriptionErrors, setTranscriptionErrors] = useState(0);
  const [isValidatingModel, setIsValidatingModel] = useState(false);
  const [speechDetected, setSpeechDetected] = useState(false);
  const [deviceError, setDeviceError] = useState<{ title: string, message: string } | null>(null);

  const currentTime = 0;
  const duration = 0;
  const isPlaying = false;
  const progress = 0;

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    const checkTauri = async () => {
      try {
        const result = await invoke('is_recording');
        console.log('Tauri is initialized and ready, is_recording result:', result);
      } catch (error) {
        console.error('Tauri initialization error:', error);
        alert('录音初始化失败，请重新打开应用后重试。');
      }
    };
    checkTauri();
  }, []);

  const handleStartRecording = useCallback(async () => {
    if (isStarting || isValidatingModel || isStartingRecording) return;
    console.log('Starting recording...');
    console.log('Selected devices:', selectedDevices);
    console.log('Meeting name:', meetingName);
    console.log('Current isRecording state:', isRecording);

    setShowPlayback(false);
    setTranscript(''); // Clear any previous transcript
    setSpeechDetected(false); // Reset speech detection on new recording

    try {
      // Call the validation callback which will:
      // 1. Check if model is ready
      // 2. Show appropriate toast/modal
      // 3. Call backend if valid
      // 4. Update UI state
      await onRecordingStart();
    } catch (error) {
      console.error('Failed to start recording:', error);
      console.error('Error details:', {
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : 'Unknown',
        stack: error instanceof Error ? error.stack : undefined
      });

      // Parse error message to provide user-friendly feedback
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Check for device-related errors
      if (errorMsg.includes('microphone') || errorMsg.includes('mic') || errorMsg.includes('input')) {
        setDeviceError({
          title: '麦克风不可用',
          message: '无法访问麦克风，请检查：\n• 麦克风已连接\n• 应用已获得麦克风权限\n• 音频设备可正常使用'
        });
      } else if (errorMsg.includes('system audio') || errorMsg.includes('speaker') || errorMsg.includes('output')) {
        setDeviceError({
          title: '系统声音不可用',
          message: '无法捕捉系统声音。请在系统设置中检查音频捕捉权限，并确认所选音频设备可用。'
        });
      } else if (errorMsg.includes('permission')) {
        setDeviceError({
          title: '需要录音权限',
          message: '请在系统设置中允许麦克风及系统声音捕捉权限，授权后重新打开应用。'
        });
      } else {
        setDeviceError({
          title: '无法开始录音',
          message: '请检查音频设备设置后重试。'
        });
      }
    }
  }, [onRecordingStart, isStarting, isValidatingModel, selectedDevices, meetingName, isRecording]);

  const stopRecordingAction = useCallback(async () => {
    console.log('Executing stop recording...');
    try {
      setIsProcessing(true);
      const dataDir = await appDataDir();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const savePath = `${dataDir}/recording-${timestamp}.wav`;
      console.log('Saving recording to:', savePath);
      console.log('About to call stop_recording command');
      const result = await invoke('stop_recording', {
        args: {
          save_path: savePath
        }
      });
      console.log('stop_recording command completed successfully:', result);
      setRecordingPath(savePath);
      // setShowPlayback(true);
      setIsProcessing(false);
      // Track successful transcription
      Analytics.trackTranscriptionSuccess();
      onRecordingStop(true);
    } catch (error) {
      console.error('Failed to stop recording:', error);
      if (error instanceof Error) {
        console.error('Error details:', {
          message: error.message,
          name: error.name,
          stack: error.stack,
        });
        if (error.message.includes('No recording in progress')) {
          return;
        }
      } else if (typeof error === 'string' && error.includes('No recording in progress')) {
        return;
      } else if (error && typeof error === 'object' && 'toString' in error) {
        if (error.toString().includes('No recording in progress')) {
          return;
        }
      }
      setIsProcessing(false);
      onRecordingStop(false);
    } finally {
      setIsStopping(false);
    }
  }, [onRecordingStop]);

  const handleStopRecording = useCallback(async () => {
    console.log('handleStopRecording called - isRecording:', isRecording, 'isStarting:', isStarting, 'isStopping:', isStopping, 'isStartingRecording:', isStartingRecording);
    if (!isRecording || isStarting || isStopping || isStartingRecording) {
      console.log('Early return from handleStopRecording due to state check');
      return;
    }

    console.log('Stopping recording...');

    // Notify parent immediately (for UI state updates)
    onStopInitiated?.();

    setIsStopping(true);

    // Immediately trigger the stop action
    await stopRecordingAction();
  }, [isRecording, isStarting, isStopping, isStartingRecording, stopRecordingAction, onStopInitiated]);

  const handlePauseRecording = useCallback(async () => {
    if (!isRecording || isPaused || isPausing) return;

    console.log('Pausing recording...');
    setIsPausing(true);

    try {
      await invoke('pause_recording');
      // isPaused state now managed by RecordingStateContext via events
      console.log('Recording paused successfully');
    } catch (error) {
      console.error('Failed to pause recording:', error);
      alert('暂停录音失败，请重试。');
    } finally {
      setIsPausing(false);
    }
  }, [isRecording, isPaused, isPausing]);

  const handleResumeRecording = useCallback(async () => {
    if (!isRecording || !isPaused || isResuming) return;

    console.log('Resuming recording...');
    setIsResuming(true);

    try {
      await invoke('resume_recording');
      // isPaused state now managed by RecordingStateContext via events
      console.log('Recording resumed successfully');
    } catch (error) {
      console.error('Failed to resume recording:', error);
      alert('继续录音失败，请重试。');
    } finally {
      setIsResuming(false);
    }
  }, [isRecording, isPaused, isResuming]);

  useEffect(() => {
    return () => {
      // Cleanup on unmount if needed
    };
  }, []);

  useEffect(() => {
    console.log('Setting up recording event listeners');
    let unsubscribes: (() => void)[] = [];

    const setupListeners = async () => {
      try {
        // Transcript error listener - handles both regular and actionable errors
        const transcriptErrorUnsubscribe = await listen('transcript-error', (event) => {
          console.log('transcript-error event received:', event);
          console.error('Transcription error received:', event.payload);
          const errorMessage = event.payload as string;

          Analytics.trackTranscriptionError(errorMessage);
          console.log('Tracked transcription error:', errorMessage);

          setTranscriptionErrors(prev => {
            const newCount = prev + 1;
            console.log('Transcription error count incremented:', newCount);
            return newCount;
          });
          setIsProcessing(false);
          console.log('Calling onRecordingStop(false) due to transcript error');
          onRecordingStop(false);
          if (onTranscriptionError) {
            onTranscriptionError(errorMessage);
          }
        });

        // Transcription error listener - handles structured error objects with actionable flag
        const transcriptionErrorUnsubscribe = await listen<TranscriptionErrorPayload>('transcription-error', (event) => {
          console.log('transcription-error event received:', event);
          console.error('Transcription error received:', event.payload);

          const errorMessage = event.payload.userMessage || event.payload.error;

          Analytics.trackTranscriptionError(errorMessage);
          console.log('Tracked transcription error:', errorMessage);

          setTranscriptionErrors(prev => {
            const newCount = prev + 1;
            console.log('Transcription error count incremented:', newCount);
            return newCount;
          });
          setIsProcessing(false);

          if (event.payload.phase === 'active') {
            console.log('Calling onRecordingStop(false) due to active transcription error');
            onRecordingStop(false);
          }

          // For actionable errors (like model loading failures), the main page will handle showing the model selector
          // For regular errors, they are handled by useModalState global listener which shows a toast
        });

        // Pause/Resume events are now handled by RecordingStateContext
        // No need for duplicate listeners here

        // Speech detected listener - for UX feedback when VAD detects speech
        const speechDetectedUnsubscribe = await listen('speech-detected', (event) => {
          console.log('speech-detected event received:', event);
          setSpeechDetected(true);
        });

        unsubscribes = [
          transcriptErrorUnsubscribe,
          transcriptionErrorUnsubscribe,
          speechDetectedUnsubscribe
        ];
        console.log('Recording event listeners set up successfully');
      } catch (error) {
        console.error('Failed to set up recording event listeners:', error);
      }
    };

    setupListeners();

    return () => {
      console.log('Cleaning up recording event listeners');
      unsubscribes.forEach(unsubscribe => {
        if (unsubscribe && typeof unsubscribe === 'function') {
          unsubscribe();
        }
      });
    };
  }, [onRecordingStop, onTranscriptionError]);

  return (
    <TooltipProvider>
      <div className="flex min-w-0 flex-col gap-2">
        <div className="agb-toolbar flex min-w-0 items-center gap-2 rounded-2xl border border-border bg-card/95 px-3 py-2.5 text-foreground shadow-lg backdrop-blur-xl">
          {isProcessing && !isParentProcessing ? (
            <div className="flex items-center space-x-2">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary"></div>
              <span className="text-sm text-muted-foreground">正在处理录音…</span>
            </div>
          ) : (
            <>
              {showPlayback ? (
                <>
                  <button
                    onClick={handleStartRecording}
                    className="w-10 h-10 flex items-center justify-center bg-destructive/100 rounded-full text-white hover:bg-red-600 transition-colors"
                  >
                    <Mic size={16} />
                  </button>

                  <div className="w-px h-6 bg-muted mx-1" />

                  <div className="flex items-center space-x-1 mx-2">
                    <div className="text-sm text-muted-foreground min-w-[40px]">
                      {formatTime(currentTime)}
                    </div>
                    <div
                      className="relative w-24 h-1 bg-muted rounded-full"
                    >
                      <div
                        className="absolute h-full bg-primary rounded-full"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="text-sm text-muted-foreground min-w-[40px]">
                      {formatTime(duration)}
                    </div>
                  </div>

                  <button
                    className="w-10 h-10 flex items-center justify-center bg-muted rounded-full text-white cursor-not-allowed"
                    disabled
                  >
                    <Play size={16} />
                  </button>
                </>
              ) : (
                <>
                  {!isRecording ? (
                    // Start recording button
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => {
                            Analytics.trackButtonClick('start_recording', 'recording_controls');
                            handleStartRecording();
                          }}
                          disabled={isStarting || isProcessing || isRecordingDisabled || isValidatingModel || isStartingRecording}
                          aria-label="开始录音"
                          className={`relative flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${isStarting || isProcessing || isValidatingModel || isStartingRecording ? 'bg-muted text-muted-foreground' : 'bg-primary text-primary-foreground hover:bg-primary/90'}`}
                        >
                          {isValidatingModel || isStartingRecording ? (
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                          ) : (
                            <Mic size={18} />
                          )}
                          <span className="whitespace-nowrap">{isValidatingModel || isStartingRecording ? '正在准备…' : '开始录音'}</span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>开始录音</p>
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    // Recording controls (pause/resume + stop)
                    <>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => {
                              if (isPaused) {
                                Analytics.trackButtonClick('resume_recording', 'recording_controls');
                                handleResumeRecording();
                              } else {
                                Analytics.trackButtonClick('pause_recording', 'recording_controls');
                                handlePauseRecording();
                              }
                            }}
                            disabled={isPausing || isResuming || isStopping}
                            aria-label={isPaused ? '继续录音' : '暂停录音'}
                            className={`w-10 h-10 flex items-center justify-center ${isPausing || isResuming || isStopping
                              ? 'bg-muted border-2 border-border text-muted-foreground'
                              : 'bg-background border-2 border-border text-muted-foreground hover:border-primary/50 hover:bg-muted'
                              } rounded-full transition-colors relative`}
                          >
                            {isPaused ? <Play size={16} /> : <Pause size={16} />}
                            {(isPausing || isResuming) && (
                              <div className="absolute -top-8 text-muted-foreground font-medium text-xs">
                                {isPausing ? '正在暂停…' : '正在继续…'}
                              </div>
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{isPaused ? '继续录音' : '暂停录音'}</p>
                        </TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => {
                              Analytics.trackButtonClick('stop_recording', 'recording_controls');
                              handleStopRecording();
                            }}
                            disabled={isStopping || isPausing || isResuming || isStartingRecording}
                            aria-label="停止并保存录音"
                            className={`w-10 h-10 flex items-center justify-center ${isStopping || isPausing || isResuming || isStartingRecording ? 'bg-muted' : 'bg-destructive/100 hover:bg-red-600'
                              } rounded-full text-white transition-colors relative`}
                          >
                            <Square size={16} />
                            {isStopping && (
                              <div className="absolute -top-8 text-muted-foreground font-medium text-xs">
                                正在停止…
                              </div>
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>停止并保存</p>
                        </TooltipContent>
                      </Tooltip>
                    </>
                  )}

                  <div aria-hidden="true" className="flex h-7 items-center gap-1 px-1">
                    {barHeights.map((height, index) => (
                      <div
                        key={index}
                        className={`w-1 rounded-full transition-all duration-200 ${isPaused ? 'bg-orange-500' : 'bg-destructive/100'
                          }`}
                        style={{
                          height: isRecording && !isPaused ? height : '4px',
                          opacity: isPaused ? 0.6 : 1,
                        }}
                      />
                    ))}
                  </div>
                  <span className="mr-1 whitespace-nowrap text-xs text-muted-foreground">
                    {isRecording ? (isPaused ? '录音已暂停' : '正在录音') : '实时转写'}
                  </span>
                </>
              )}
            </>
          )}
        </div>

        {/* Show validation status only */}
        {isValidatingModel && (
          <div className="text-xs text-muted-foreground text-center mt-2">
            正在检查转写模型…
          </div>
        )}

        {/* Device error alert */}
        {deviceError && (
          <Alert variant="destructive" className="mt-4 border-destructive/30 bg-destructive/10">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <button
              onClick={() => setDeviceError(null)}
              className="absolute right-3 top-3 text-destructive hover:text-destructive transition-colors"
              aria-label="关闭提示"
            >
              <X className="h-4 w-4" />
            </button>
            <AlertTitle className="text-destructive font-semibold mb-2">
              {deviceError.title}
            </AlertTitle>
            <AlertDescription className="text-destructive">
              {deviceError.message.split('\n').map((line, i) => (
                <div key={i} className={i > 0 ? 'ml-2' : ''}>
                  {line}
                </div>
              ))}
            </AlertDescription>
          </Alert>
        )}

        {/* {showPlayback && recordingPath && (
        <div className="text-sm text-muted-foreground px-4">
          录音已保存至： {recordingPath}
        </div>
      )} */}
      </div>
    </TooltipProvider>
  );
};
