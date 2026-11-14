'use client';

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { PermissionStatus, OnboardingPermissions } from '@/types/onboarding';
import { resolveOnboardingSummaryModelStatus } from '@/lib/onboarding-summary-model';
import type { ParakeetDownloadProgressEvent } from '@/lib/parakeet';

const PARAKEET_MODEL = 'parakeet-tdt-0.6b-v3-int8';

interface OnboardingStatus {
  version: string;
  completed: boolean;
  current_step: number;
  model_status: {
    parakeet: string;
    summary: string;
    selected_summary_model?: string;
  };
  last_updated: string;
}

interface SummaryModelProgressInfo {
  percent: number;
  downloadedMb: number;
  totalMb: number;
  speedMbps: number;
}

interface ParakeetProgressInfo {
  percent: number;
  downloadedMb: number;
  totalMb: number;
  speedMbps: number;
}

interface OnboardingContextType {
  currentStep: number;
  parakeetDownloaded: boolean;
  parakeetProgress: number;
  parakeetProgressInfo: ParakeetProgressInfo;
  summaryModelDownloaded: boolean;
  summaryModelProgress: number;
  summaryModelProgressInfo: SummaryModelProgressInfo;
  selectedSummaryModel: string;
  recommendedSummaryModel: string;
  databaseExists: boolean;
  isBackgroundDownloading: boolean;
  // Permissions
  permissions: OnboardingPermissions;
  permissionsSkipped: boolean;
  // Navigation
  goToStep: (step: number) => void;
  goNext: () => void;
  goPrevious: () => void;
  // Setters
  setParakeetDownloaded: (value: boolean) => void;
  setSummaryModelDownloaded: (value: boolean) => void;
  setSelectedSummaryModel: (value: string) => void;
  setDatabaseExists: (value: boolean) => void;
  setPermissionStatus: (permission: keyof OnboardingPermissions, status: PermissionStatus) => void;
  setPermissionsSkipped: (skipped: boolean) => void;
  completeOnboarding: () => Promise<void>;
  startBackgroundDownloads: (options: StartBackgroundDownloadsOptions) => Promise<void>;
  retryParakeetDownload: () => Promise<void>;
}

interface StartBackgroundDownloadsOptions {
  includeParakeet: boolean;
  includeSummary: boolean;
  summaryModel?: string;
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined);

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [currentStep, setCurrentStep] = useState(1);
  const [completed, setCompleted] = useState(false);
  const [parakeetDownloaded, setParakeetDownloaded] = useState(false);
  const [parakeetProgress, setParakeetProgress] = useState(0);
  const [parakeetProgressInfo, setParakeetProgressInfo] = useState<ParakeetProgressInfo>({
    percent: 0,
    downloadedMb: 0,
    totalMb: 0,
    speedMbps: 0,
  });
  const [summaryModelDownloaded, setSummaryModelDownloaded] = useState(false);
  const [summaryModelProgress, setSummaryModelProgress] = useState(0);
  const [summaryModelProgressInfo, setSummaryModelProgressInfo] = useState<SummaryModelProgressInfo>({
    percent: 0,
    downloadedMb: 0,
    totalMb: 0,
    speedMbps: 0,
  });
  const [selectedSummaryModel, setSelectedSummaryModel] = useState<string>('');
  const [recommendedSummaryModel, setRecommendedSummaryModel] = useState<string>('');
  const [databaseExists, setDatabaseExists] = useState(false);
  const [isBackgroundDownloading, setIsBackgroundDownloading] = useState(false);

  // Permissions state
  const [permissions, setPermissions] = useState<OnboardingPermissions>({
    microphone: 'not_determined',
    systemAudio: 'not_determined',
    screenRecording: 'not_determined',
  });
  const [permissionsSkipped, setPermissionsSkipped] = useState(false);

  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const saveTimeoutRef = useRef<NodeJS.Timeout>();

  const initializeSummaryModelSelection = async (preferredModel = selectedSummaryModel) => {
    try {
      const recommendedModel = await invoke<string>('builtin_ai_get_recommended_model');
      if (mountedRef.current) setRecommendedSummaryModel(recommendedModel);
      const modelToCheck = preferredModel || recommendedModel;
      if (mountedRef.current) setSelectedSummaryModel(modelToCheck);

      const selectedModelReady = await invoke<boolean>('builtin_ai_is_model_ready', {
        modelName: modelToCheck,
        refresh: true,
      });
      const resolved = resolveOnboardingSummaryModelStatus({
        selectedModel: preferredModel,
        recommendedModel,
        selectedModelReady,
      });

      if (mountedRef.current) setSelectedSummaryModel(resolved.selectedSummaryModel);
      if (mountedRef.current) setSummaryModelDownloaded(resolved.summaryModelDownloaded);

      return resolved;
    } catch (error) {
      console.error('[OnboardingContext] Failed to initialize summary model:', error);
      return null;
    }
  };

  const requestSummaryModelDownload = (modelName: string) => {
    invoke('builtin_ai_download_model', { modelName })
      .catch(err => {
        if (String(err).includes('Download already in progress')) {
          return;
        }
        console.error('[OnboardingContext] Summary Model download failed:', err);
      });
  };

  // Load status on mount and initialize database
  useEffect(() => {
    loadOnboardingStatus();
    checkDatabaseStatus();
    initializeDatabaseInBackground();
  }, []);

  // Initialize database silently in background (moved from SetupOverviewStep)
  const initializeDatabaseInBackground = async () => {
    try {
      const isFirstLaunch = await invoke<boolean>('check_first_launch');

      if (!isFirstLaunch) {
        if (mountedRef.current) setDatabaseExists(true);
        return;
      }

      // First launch - attempt auto-detection and import
      await performAutoDetection();
    } catch (error) {
      console.error('[OnboardingContext] Database initialization failed:', error);
      // Don't throw - database init failure shouldn't block onboarding
    }
  };

  const performAutoDetection = async () => {
    // Check Homebrew (macOS only)
    if (typeof navigator !== 'undefined' && navigator.platform?.toLowerCase().includes('mac')) {
      const homebrewDbPath = '/usr/local/var/meetily/meeting_minutes.db';
      try {
        const homebrewCheck = await invoke<{ exists: boolean; size: number } | null>(
          'check_homebrew_database',
          { path: homebrewDbPath }
        );

        if (homebrewCheck?.exists) {
          await invoke('import_and_initialize_database', { legacyDbPath: homebrewDbPath });
          if (mountedRef.current) setDatabaseExists(true);
          return;
        }
      } catch (e) {
      }
    }

    // Check default legacy database location
    try {
      const legacyPath = await invoke<string | null>('check_default_legacy_database');
      if (legacyPath) {
        await invoke('import_and_initialize_database', { legacyDbPath: legacyPath });
        if (mountedRef.current) setDatabaseExists(true);
        return;
      }
    } catch (e) {
    }

    // No legacy database found - initialize fresh
    await invoke('initialize_fresh_database');
    if (mountedRef.current) setDatabaseExists(true);
  };

  const isCompletingRef = useRef(false);

  // Auto-save on state change (debounced)
  useEffect(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    // Don't auto-save if completed (to avoid overwriting completion status)
    // Also don't auto-save if we are currently in the process of completing
    if (completed || isCompletingRef.current) return;

    saveTimeoutRef.current = setTimeout(() => {
      saveOnboardingStatus();
    }, 1000);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [currentStep, parakeetDownloaded, summaryModelDownloaded, selectedSummaryModel, completed]);

  // Listen to Parakeet download progress
  useEffect(() => {
    let disposed = false;
    const unlisten = listen<ParakeetDownloadProgressEvent>(
      'parakeet-model-download-progress',
      (event) => {
        if (disposed) return;
        const { modelName, progress, downloaded_mb, total_mb, speed_mbps, status } = event.payload;
        if (modelName !== PARAKEET_MODEL) return;

        if (status === 'cancelled') {
          setIsBackgroundDownloading(false);
          setParakeetDownloaded(false);
          setParakeetProgress(0);
          setParakeetProgressInfo({
            percent: 0,
            downloadedMb: 0,
            totalMb: 0,
            speedMbps: 0,
          });
          return;
        }

        setParakeetProgress(progress);
        setParakeetProgressInfo({
          percent: progress,
          downloadedMb: downloaded_mb ?? 0,
          totalMb: total_mb ?? 0,
          speedMbps: speed_mbps ?? 0,
        });
        if (status === 'completed') {
          setParakeetDownloaded(true);
        }
      }
    ).catch(error => {
      console.error('Failed to setup onboarding listener:', error);
      return () => {};
    });

    const unlistenComplete = listen<{ modelName: string }>(
      'parakeet-model-download-complete',
      (event) => {
        if (disposed) return;
        const { modelName } = event.payload;
        if (modelName === PARAKEET_MODEL) {
          setParakeetDownloaded(true);
          setParakeetProgress(100);
        }
      }
    ).catch(error => {
      console.error('Failed to setup onboarding listener:', error);
      return () => {};
    });

    const unlistenError = listen<{ modelName: string; error: string }>(
      'parakeet-model-download-error',
      (event) => {
        if (disposed) return;
        const { modelName } = event.payload;
        if (modelName === PARAKEET_MODEL) {
          console.error('Parakeet download error:', event.payload.error);
        }
      }
    ).catch(error => {
      console.error('Failed to setup onboarding listener:', error);
      return () => {};
    });

    return () => {
      disposed = true;
      unlisten.then(fn => fn());
      unlistenComplete.then(fn => fn());
      unlistenError.then(fn => fn());
    };
  }, []);

  // Listen to summary model (Built-in AI) download progress
  useEffect(() => {
    let disposed = false;
    const unlisten = listen<{
      model: string;
      progress: number;
      downloaded_mb?: number;
      total_mb?: number;
      speed_mbps?: number;
      status: string;
    }>(
      'builtin-ai-download-progress',
      (event) => {
        if (disposed) return;
        const { model, progress, downloaded_mb, total_mb, speed_mbps, status } = event.payload;
        if (selectedSummaryModel && model === selectedSummaryModel) {
          setSummaryModelProgress(progress);
          setSummaryModelProgressInfo({
            percent: progress,
            downloadedMb: downloaded_mb ?? 0,
            totalMb: total_mb ?? 0,
            speedMbps: speed_mbps ?? 0,
          });
          if (status === 'completed' || progress >= 100) {
            setSummaryModelDownloaded(true);
          }
        }
      }
    ).catch(error => {
      console.error('Failed to setup onboarding listener:', error);
      return () => {};
    });

    return () => {
      disposed = true;
      unlisten.then(fn => fn());
    };
  }, [selectedSummaryModel]);

  const checkDatabaseStatus = async () => {
    try {
      const isFirstLaunch = await invoke<boolean>('check_first_launch');
      if (mountedRef.current) setDatabaseExists(!isFirstLaunch);
    } catch (error) {
      console.error('[OnboardingContext] Failed to check database status:', error);
      if (mountedRef.current) setDatabaseExists(false);
    }
  };

  const loadOnboardingStatus = async () => {
    try {
      const status = await invoke<OnboardingStatus | null>('get_onboarding_status');
      if (status) {

        if (status.completed) {
          if (mountedRef.current) setCurrentStep(status.current_step);
          if (mountedRef.current) setCompleted(true);
          if (mountedRef.current) setParakeetDownloaded(status.model_status.parakeet === 'downloaded');
          if (mountedRef.current) setSummaryModelDownloaded(status.model_status.summary === 'downloaded');
          if (status.model_status.selected_summary_model) {
            if (mountedRef.current) setSelectedSummaryModel(status.model_status.selected_summary_model);
          }
          return;
        }

        // Don't trust saved status - verify actual model status on disk
        const verifiedStatus = await verifyModelStatus(status);

        if (mountedRef.current) setCurrentStep(verifiedStatus.currentStep);
        if (mountedRef.current) setCompleted(verifiedStatus.completed);
        if (mountedRef.current) setParakeetDownloaded(verifiedStatus.parakeetDownloaded);
        if (mountedRef.current) setSummaryModelDownloaded(verifiedStatus.summaryModelDownloaded);
        if (verifiedStatus.selectedSummaryModel) {
          if (mountedRef.current) setSelectedSummaryModel(verifiedStatus.selectedSummaryModel);
        }


        // Check if any downloads are active to restore isBackgroundDownloading state
        await checkActiveDownloads();
      } else {
        await initializeSummaryModelSelection();
      }
    } catch (error) {
      console.error('[OnboardingContext] Failed to load onboarding status:', error);
    }
  };

  // Verify that models actually exist on disk, not just trust saved JSON
  const verifyModelStatus = async (savedStatus: OnboardingStatus) => {
    let parakeetDownloaded = false;
    let summaryModelDownloaded = false;
    let selectedSummaryModel = '';

    // Verify Parakeet model exists on disk
    try {
      await invoke('parakeet_init');
      parakeetDownloaded = await invoke<boolean>('parakeet_has_available_models');
    } catch (error) {
      console.warn('[OnboardingContext] Failed to verify Parakeet:', error);
      parakeetDownloaded = false;
    }

    // Verify the selected/recommended Summary model exists on disk.
    try {
      const recommendedModel = await invoke<string>('builtin_ai_get_recommended_model');
      if (mountedRef.current) setRecommendedSummaryModel(recommendedModel);
      const savedSelectedModel = savedStatus.model_status.selected_summary_model || '';
      const modelToCheck = savedSelectedModel || recommendedModel;
      const selectedModelReady = await invoke<boolean>('builtin_ai_is_model_ready', {
        modelName: modelToCheck,
        refresh: true,
      });
      const resolved = resolveOnboardingSummaryModelStatus({
        selectedModel: savedSelectedModel,
        recommendedModel,
        selectedModelReady,
      });
      selectedSummaryModel = resolved.selectedSummaryModel;
      summaryModelDownloaded = resolved.summaryModelDownloaded;
    } catch (error) {
      console.warn('[OnboardingContext] Failed to verify Summary model:', error);
      summaryModelDownloaded = false;
    }

    // Determine the correct step based on verified status
    // New simplified flow: Step 1: Welcome, Step 2: Setup Overview, Step 3: Download Progress, Step 4: Permissions (macOS)
    let currentStep = savedStatus.current_step;
    let completed = savedStatus.completed;

    // Clamp step to new max (4)
    if (currentStep > 4) {
      currentStep = 3; // Go to download progress step
    }

    // Trust the completed status - don't revert based on model downloads
    // Downloads continue in background; user stays in main app regardless
    return {
      currentStep,
      completed,
      parakeetDownloaded,
      summaryModelDownloaded,
      selectedSummaryModel,
    };
  };

  const saveOnboardingStatus = async () => {
    // Safety check: if we are in the process of completing, DO NOT save
    // This prevents a race condition where a download completion event triggers a save
    // that overwrites the "completed" status set by completeOnboarding
    if (isCompletingRef.current) {
      return;
    }

    try {
      await invoke('save_onboarding_status_cmd', {
        status: {
          version: '1.0',
          completed: completed,
          current_step: currentStep,
          model_status: {
            parakeet: parakeetDownloaded ? 'downloaded' : 'not_downloaded',
            summary: summaryModelDownloaded ? 'downloaded' : 'not_downloaded',
            selected_summary_model: selectedSummaryModel || undefined,
          },
          last_updated: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error('[OnboardingContext] Failed to save onboarding status:', error);
    }
  };

  const completeOnboarding = async () => {
    try {
      // Set completion flag to prevent race conditions with auto-save
      isCompletingRef.current = true;

      // Clear any pending auto-saves
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = undefined;
      }

      let modelToSave = selectedSummaryModel;
      if (!modelToSave) {
        modelToSave = await invoke<string>('builtin_ai_get_recommended_model');
        if (mountedRef.current) setSelectedSummaryModel(modelToSave);
      }

      const selectedModelReady = await invoke<boolean>('builtin_ai_is_model_ready', {
        modelName: modelToSave,
        refresh: true,
      });
      if (mountedRef.current) setSummaryModelDownloaded(selectedModelReady);
      if (!selectedModelReady) {
        requestSummaryModelDownload(modelToSave);
      }

      // Onboarding always uses builtin-ai with selected model
      await invoke('complete_onboarding', {
        model: modelToSave,
      });
      if (mountedRef.current) setCompleted(true);

      // Reset the flag so subsequent state updates can be saved
      isCompletingRef.current = false;
    } catch (error) {
      console.error('[OnboardingContext] Failed to complete onboarding:', error);
      isCompletingRef.current = false; // Reset flag on error
      throw error; // Re-throw so PermissionsStep can handle it
    }
  };

  // Start background downloads for models.
  const startBackgroundDownloads = async ({
    includeParakeet,
    includeSummary,
    summaryModel,
  }: StartBackgroundDownloadsOptions) => {

    try {
      const shouldStartParakeet = includeParakeet && !parakeetDownloaded;
      const shouldStartSummary = includeSummary && !summaryModelDownloaded && !!summaryModel;

      if (!shouldStartParakeet && !shouldStartSummary) {
        if (includeSummary && !summaryModelDownloaded && !summaryModel) {
          console.warn('[OnboardingContext] Summary Model download skipped until recommendation is loaded');
        }
        return;
      }

      if (mountedRef.current) setIsBackgroundDownloading(true);

      // Start Parakeet download first (speech recognition - always required)
      if (shouldStartParakeet) {
        invoke('parakeet_download_model', { modelName: PARAKEET_MODEL })
          .catch(err => console.error('[OnboardingContext] Parakeet download failed:', err));
      }

      // Start selected Summary Model download immediately so completion cannot race the request.
      if (shouldStartSummary && summaryModel) {
        requestSummaryModelDownload(summaryModel);
      }
    } catch (error) {
      console.error('[OnboardingContext] Failed to start background downloads:', error);
      if (mountedRef.current) setIsBackgroundDownloading(false);
      throw error;
    }
  };

  // Check if any models are currently downloading (for re-entry)
  const checkActiveDownloads = async () => {
    try {
      const models = await invoke<any[]>('parakeet_get_available_models');
      const isDownloading = models.some(m => m.status && (typeof m.status === 'object' ? 'Downloading' in m.status : m.status === 'Downloading'));
      
      if (isDownloading) {
        if (mountedRef.current) setIsBackgroundDownloading(true);
      }
      
      // Also check for Built-in AI downloads if possible (though less critical as Parakeet is the main blocker)
      
    } catch (error) {
      console.warn('[OnboardingContext] Failed to check active downloads:', error);
    }
  };

  const retryParakeetDownload = async () => {
    try {
      await invoke('parakeet_retry_download', { modelName: PARAKEET_MODEL });
    } catch (error) {
      console.error('[OnboardingContext] Retry failed:', error);
      throw error;
    }
  };

  const setPermissionStatus = useCallback((permission: keyof OnboardingPermissions, status: PermissionStatus) => {
    setPermissions((prev: OnboardingPermissions) => ({
      ...prev,
      [permission]: status,
    }));
  }, []);

  const goToStep = useCallback((step: number) => {
    setCurrentStep(Math.max(1, Math.min(step, 4)));
  }, []);

  const goNext = useCallback(() => {
    setCurrentStep((prev: number) => {
      const next = prev + 1;
      // Don't go past step 4
      return Math.min(next, 4);
    });
  }, []);

  const goPrevious = useCallback(() => {
    setCurrentStep((prev: number) => {
      const previous = prev - 1;
      // Don't go below step 1
      return Math.max(previous, 1);
    });
  }, []);

  return (
    <OnboardingContext.Provider
      value={{
        currentStep,
        parakeetDownloaded,
        parakeetProgress,
        parakeetProgressInfo,
        summaryModelDownloaded,
        summaryModelProgress,
        summaryModelProgressInfo,
        selectedSummaryModel,
        recommendedSummaryModel,
        databaseExists,
        isBackgroundDownloading,
        permissions,
        permissionsSkipped,
        goToStep,
        goNext,
        goPrevious,
        setParakeetDownloaded,
        setSummaryModelDownloaded,
        setSelectedSummaryModel,
        setDatabaseExists,
        setPermissionStatus,
        setPermissionsSkipped,
        completeOnboarding,
        startBackgroundDownloads,
        retryParakeetDownload,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error('useOnboarding must be used within OnboardingProvider');
  }
  return context;
}
