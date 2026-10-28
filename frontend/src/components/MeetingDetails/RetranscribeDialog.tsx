import React, { useState, useEffect, useRef, useMemo } from 'react';
import { RefreshCw, Globe, Loader2, AlertCircle, CheckCircle2, X, Cpu } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { useConfig } from '@/contexts/ConfigContext';
import { LANGUAGES } from '@/constants/languages';
import { useTranscriptionModels, ModelOption } from '@/hooks/useTranscriptionModels';
import Analytics from '@/lib/analytics';
import { toUserMessage } from '@/lib/user-message';

interface RetranscribeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meetingId: string;
  meetingFolderPath: string | null;
  onComplete?: () => void;
}

interface RetranscriptionProgress {
  meeting_id: string;
  stage: string;
  progress_percentage: number;
  message: string;
}

interface RetranscriptionResult {
  meeting_id: string;
  segments_count: number;
  duration_seconds: number;
  language: string | null;
}

interface RetranscriptionError {
  meeting_id: string;
  error: string;
}

function retranscriptionStageLabel(stage?: string) {
  switch (stage) {
    case 'decoding': return '正在读取录音…';
    case 'transcribing': return '正在重新转写…';
    case 'saving': return '正在保存转写…';
    default: return '正在处理录音…';
  }
}

export function RetranscribeDialog({
  open,
  onOpenChange,
  meetingId,
  meetingFolderPath,
  onComplete,
}: RetranscribeDialogProps) {
  const { selectedLanguage, transcriptModelConfig } = useConfig();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<RetranscriptionProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedLang, setSelectedLang] = useState(selectedLanguage || 'auto');

  // Use centralized model fetching hook
  const {
    availableModels,
    selectedModelKey,
    setSelectedModelKey,
    loadingModels,
    fetchModels,
    resetSelection,
  } = useTranscriptionModels(transcriptModelConfig);

  // Stable refs for callbacks to avoid listener re-registration
  const onCompleteRef = useRef(onComplete);
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);
  useEffect(() => { onOpenChangeRef.current = onOpenChange; }, [onOpenChange]);

  // Track previous open state to only reset on closed→open transition
  const prevOpenRef = useRef(false);

  // Helper to get selected model details (memoized)
  const selectedModelDetails = useMemo((): ModelOption | undefined => {
    if (!selectedModelKey) return undefined;
    const colonIndex = selectedModelKey.indexOf(':');
    if (colonIndex === -1) return undefined;
    const provider = selectedModelKey.slice(0, colonIndex);
    const name = selectedModelKey.slice(colonIndex + 1);
    return availableModels.find(m => m.provider === provider && m.name === name);
  }, [selectedModelKey, availableModels]);
  const isParakeetModel = selectedModelDetails?.provider === 'parakeet';

  useEffect(() => {
    if (isParakeetModel && selectedLang !== 'auto') {
      setSelectedLang('auto');
    }
  }, [isParakeetModel, selectedLang]);

  // Reset state only when dialog transitions from closed to open
  // This prevents re-initialization when config changes while dialog is already open
  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;

    if (open && !wasOpen) {
      resetSelection();
      setIsProcessing(false);
      setProgress(null);
      setError(null);
      setSelectedLang(selectedLanguage || 'auto');

      // Fetch available models using centralized hook
      fetchModels();
    }
  }, [open, selectedLanguage, transcriptModelConfig, fetchModels]);

  // Listen for retranscription events
  useEffect(() => {
    if (!open) return;

    const unlisteners: UnlistenFn[] = [];
    const cleanedUpRef = { current: false };

    const setupListeners = async () => {
      // Progress events
      const unlistenProgress = await listen<RetranscriptionProgress>(
        'retranscription-progress',
        (event) => {
          if (event.payload.meeting_id === meetingId) {
            setProgress(event.payload);
          }
        }
      );
      if (cleanedUpRef.current) {
        unlistenProgress();
        return;
      }
      unlisteners.push(unlistenProgress);

      // Completion event
      const unlistenComplete = await listen<RetranscriptionResult>(
        'retranscription-complete',
        async (event) => {
          if (event.payload.meeting_id === meetingId) {
            await Analytics.track('enhance_transcript_completed', {
              success: 'true',
              duration_seconds: event.payload.duration_seconds.toString(),
              segments_count: event.payload.segments_count.toString()
            });

            setIsProcessing(false);
            toast.success(
              `重新转写完成，共 ${event.payload.segments_count} 段。`
            );
            onCompleteRef.current?.();
            onOpenChangeRef.current(false);
          }
        }
      );
      if (cleanedUpRef.current) {
        unlistenComplete();
        unlisteners.forEach(u => u());
        return;
      }
      unlisteners.push(unlistenComplete);

      // Error event
      const unlistenError = await listen<RetranscriptionError>(
        'retranscription-error',
        async (event) => {
          if (event.payload.meeting_id === meetingId) {
            await Analytics.trackError('enhance_transcript_failed', event.payload.error);

            setIsProcessing(false);
            console.error('Retranscription backend error:', event.payload.error);
            setError(toUserMessage(event.payload.error, '重新转写失败，请检查录音和模型设置后重试。'));
          }
        }
      );
      if (cleanedUpRef.current) {
        unlistenError();
        unlisteners.forEach(u => u());
        return;
      }
      unlisteners.push(unlistenError);
    };

    setupListeners().catch(error => {
      console.error('Failed to listen for retranscription:', error);
      if (!cleanedUpRef.current) setError(toUserMessage(error, '无法读取转写进度，请关闭后重试。'));
    });

    return () => {
      cleanedUpRef.current = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [open, meetingId]);

  const handleStartRetranscription = async () => {
    if (!meetingFolderPath) {
      setError('找不到这场会议的录音文件夹。');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setProgress(null);

    try {
      const languageToSend = isParakeetModel ? null : selectedLang === 'auto' ? null : selectedLang;
      await Analytics.track('enhance_transcript_started', {
        language: isParakeetModel ? 'auto' : (selectedLang === 'auto' ? 'auto' : selectedLang),
        model_provider: selectedModelDetails?.provider || '',
        model_name: selectedModelDetails?.name || ''
      });

      await invoke('start_retranscription_command', {
        meetingId,
        meetingFolderPath,
        language: languageToSend,
        model: selectedModelDetails?.name || null,
        provider: selectedModelDetails?.provider || null,
      });
    } catch (err: any) {
      setIsProcessing(false);
      const errorMsg = typeof err === 'string' ? err : (err?.message || String(err));
      console.error('Failed to start retranscription:', err);
      setError(toUserMessage(err, '重新转写失败，请检查录音和模型设置后重试。'));

      await Analytics.trackError('enhance_transcript_failed', errorMsg);
    }
  };

  const handleCancel = async () => {
    if (isProcessing) {
      try {
        await invoke('cancel_retranscription_command');
        setIsProcessing(false);
        setProgress(null);
        toast.info('已取消重新转写');
      } catch (err) {
        console.error('Failed to cancel retranscription:', err);
        setError(toUserMessage(err, '暂时无法取消，转写仍在进行。请稍后重试。'));
        return;
      }
    }
    onOpenChange(false);
  };

  // Prevent closing during processing
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen && isProcessing) {
      return;
    }
    onOpenChange(newOpen);
  };

  const handleEscapeKeyDown = (event: KeyboardEvent) => {
    if (isProcessing) {
      event.preventDefault();
    }
  };

  const handleInteractOutside = (event: Event) => {
    if (isProcessing) {
      event.preventDefault();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="rounded-2xl border-border bg-card text-card-foreground sm:max-w-[450px]"
        onEscapeKeyDown={handleEscapeKeyDown}
        onInteractOutside={handleInteractOutside}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isProcessing ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                正在重新转写…
              </>
            ) : error ? (
              <>
                <AlertCircle className="h-5 w-5 text-destructive" />
                重新转写失败
              </>
            ) : (
              <>
                <RefreshCw className="h-5 w-5 text-primary" />
                重新转写录音
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {isProcessing
              ? retranscriptionStageLabel(progress?.stage)
              : error
                ? '转写未完成，请检查录音与模型设置后重试'
                : '可调整语言和模型，重新识别这场会议的录音。'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {!isProcessing && !error && (
            !isParakeetModel ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">录音语言</span>
                </div>
                <Select value={selectedLang} onValueChange={setSelectedLang}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择语言" />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    {LANGUAGES.map((lang) => (
                      <SelectItem key={lang.code} value={lang.code}>
                        {lang.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  选择录音使用的语言，也可使用自动识别。
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">录音语言</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Parakeet 使用自动语言识别，无需手动选择。
                </p>
              </div>
            )
          )}

          {!isProcessing && !error && availableModels.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">转写模型</span>
              </div>
              <Select value={selectedModelKey} onValueChange={setSelectedModelKey} disabled={loadingModels}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={loadingModels ? "正在读取模型…" : "选择模型"} />
                </SelectTrigger>
                <SelectContent>
                  {availableModels.map((model) => (
                    <SelectItem key={`${model.provider}:${model.name}`} value={`${model.provider}:${model.name}`}>
                      {model.displayName} ({Math.round(model.size_mb)} MB)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                使用已配置的转写模型处理录音。
              </p>
            </div>
          )}

          {isProcessing && progress && (
            <div className="space-y-2">
              <div className="relative">
                <div className="w-full bg-muted rounded-full h-3">
                  <div
                    className="bg-primary h-3 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${Math.min(progress.progress_percentage, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>{retranscriptionStageLabel(progress.stage)}</span>
                  <span>{Math.round(progress.progress_percentage)}%</span>
                </div>
              </div>
              <p className="text-sm text-muted-foreground text-center">
                {retranscriptionStageLabel(progress.stage)}
              </p>
            </div>
          )}

          {error && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          {!isProcessing && !error && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button
                onClick={handleStartRetranscription}
                className="bg-primary hover:bg-primary/90"
                disabled={!meetingFolderPath}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                开始重新转写
              </Button>
            </>
          )}
          {isProcessing && (
            <Button variant="outline" onClick={handleCancel}>
              <X className="h-4 w-4 mr-2" />
              取消
            </Button>
          )}
          {error && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                关闭
              </Button>
              <Button
                onClick={() => {
                  setError(null);
                  setProgress(null);
                }}
                variant="outline"
              >
                重试
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
