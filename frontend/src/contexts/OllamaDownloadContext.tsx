'use client';

import { toUserMessage } from '@/lib/user-message';
import React, { createContext, useContext, useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';

/**
 * Ollama download state synchronized with backend
 * This context provides persistent download state that survives component unmounts,
 * solving:
 * 1. Lost progress when modal closes
 * 2. Duplicate download requests
 * 3. No feedback for background downloads
 */

interface OllamaDownloadState {
  downloadProgress: Map<string, number>;  // modelName -> progress (0-100)
  downloadingModels: Set<string>;         // Set of model names currently downloading
}

interface OllamaDownloadContextType extends OllamaDownloadState {
  isDownloading: (modelName: string) => boolean;
  getProgress: (modelName: string) => number | undefined;
}

const OllamaDownloadContext = createContext<OllamaDownloadContextType | null>(null);

export const useOllamaDownload = () => {
  const context = useContext(OllamaDownloadContext);
  if (!context) {
    throw new Error('useOllamaDownload must be used within an OllamaDownloadProvider');
  }
  return context;
};

export function OllamaDownloadProvider({ children }: { children: React.ReactNode }) {
  const [downloadProgress, setDownloadProgress] = useState<Map<string, number>>(new Map());
  const [downloadingModels, setDownloadingModels] = useState<Set<string>>(new Set());

  /**
   * Set up event listeners for download progress
   * These persist for the lifetime of the app, unlike modal-scoped listeners
   */
  useEffect(() => {
    let disposed = false;
    const unsubscribers: (() => void)[] = [];

    const setupListeners = async () => {
      try {
        // Download progress
        const unlistenProgress = await listen<{ modelName: string; progress: number }>(
          'ollama-model-download-progress',
          (event) => {
            if (disposed) return;
            const { modelName, progress } = event.payload;

            setDownloadProgress(prev => {
              const newProgress = new Map(prev);
              newProgress.set(modelName, progress);
              return newProgress;
            });

            // Add to downloading set if not already there
            setDownloadingModels(prev => {
              if (prev.has(modelName)) return prev;
              const newSet = new Set(prev);
              newSet.add(modelName);
              return newSet;
            });
          }
        );
        if (disposed) { unlistenProgress(); return; }
        unsubscribers.push(unlistenProgress);

        // Download complete
        const unlistenComplete = await listen<{ modelName: string }>(
          'ollama-model-download-complete',
          (event) => {
            if (disposed) return;
            const { modelName } = event.payload;

            toast.success(`模型 ${modelName} 已下载`, {
              description: '模型已就绪，可以使用。',
              duration: 4000
            });

            // Clear progress and remove from downloading set
            setDownloadProgress(prev => {
              const newProgress = new Map(prev);
              newProgress.delete(modelName);
              return newProgress;
            });

            setDownloadingModels(prev => {
              const newSet = new Set(prev);
              newSet.delete(modelName);
              return newSet;
            });
          }
        );
        if (disposed) { unlistenComplete(); return; }
        unsubscribers.push(unlistenComplete);

        // Download error
        const unlistenError = await listen<{ modelName: string; error: string }>(
          'ollama-model-download-error',
          (event) => {
            if (disposed) return;
            const { modelName, error } = event.payload;
            console.error(`[OllamaDownloadContext] Download error for ${modelName}:`, error);

            toast.error(`${modelName} 下载失败`, {
              description: toUserMessage(error, "模型下载失败，请检查连接后重试。"),
              duration: 6000
            });

            // Clear progress and remove from downloading set
            setDownloadProgress(prev => {
              const newProgress = new Map(prev);
              newProgress.delete(modelName);
              return newProgress;
            });

            setDownloadingModels(prev => {
              const newSet = new Set(prev);
              newSet.delete(modelName);
              return newSet;
            });
          }
        );
        if (disposed) { unlistenError(); return; }
        unsubscribers.push(unlistenError);

      } catch (error) {
        unsubscribers.splice(0).forEach(unsub => unsub());
        console.error('[OllamaDownloadContext] Failed to set up event listeners:', error);
      }
    };

    setupListeners();

    return () => {
      disposed = true;
      unsubscribers.forEach(unsub => unsub());
    };
  }, []);

  const contextValue: OllamaDownloadContextType = {
    downloadProgress,
    downloadingModels,
    isDownloading: (modelName: string) => downloadingModels.has(modelName),
    getProgress: (modelName: string) => downloadProgress.get(modelName),
  };

  return (
    <OllamaDownloadContext.Provider value={contextValue}>
      {children}
    </OllamaDownloadContext.Provider>
  );
}
