import { useState, useEffect, useCallback, useRef } from 'react';
import { ModelConfig } from '@/components/ModelSettingsModal';
import { invoke as invokeTauri } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import Analytics from '@/lib/analytics';
import { toUserMessage } from '@/lib/user-message';

interface UseModelConfigurationProps {
  serverAddress: string | null;
}

export function useModelConfiguration({ serverAddress }: UseModelConfigurationProps) {
  // Note: No hardcoded defaults - DB is the source of truth
  const [modelConfig, setModelConfig] = useState<ModelConfig>({
    provider: 'ollama',
    model: '', // Empty until loaded from DB
    whisperModel: 'large-v3'
  });
  const [isLoading, setIsLoading] = useState(true);
  const [, setError] = useState<string>('');

  const mountedRef = useRef(false);
  const configVersionRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; configVersionRef.current += 1; };
  }, []);

  // Fetch model configuration on mount and when serverAddress changes
  useEffect(() => {
    const version = ++configVersionRef.current;
    let cancelled = false;
    const fetchModelConfig = async () => {
      setIsLoading(true);
      try {
        const data = await invokeTauri('api_get_model_config', {}) as any;
        if (data && data.provider !== null) {
          // Fetch API key if not included and provider requires it
          if (data.provider !== 'ollama' && data.provider !== 'custom-openai' && !data.apiKey) {
            try {
              const apiKeyData = await invokeTauri('api_get_api_key', {
                provider: data.provider
              }) as string;
              data.apiKey = apiKeyData;
            } catch (err) {
              console.error('Failed to fetch API key:', err);
            }
          }

          // Fetch custom OpenAI config if provider is custom-openai
          if (data.provider === 'custom-openai') {
            try {
              const customConfig = await invokeTauri('api_get_custom_openai_config') as any;
              if (customConfig) {
                data.customOpenAIDisplayName = customConfig.displayName || null;
                data.customOpenAIEndpoint = customConfig.endpoint || null;
                data.customOpenAIModel = customConfig.model || null;
                data.customOpenAIApiKey = customConfig.apiKey || null;
                data.maxTokens = customConfig.maxTokens || null;
                data.temperature = customConfig.temperature || null;
                data.topP = customConfig.topP || null;
                // For custom-openai, model field should match customOpenAIModel
                data.model = customConfig.model || data.model;
              }
            } catch (err) {
              console.error('Failed to fetch custom OpenAI config:', err);
            }
          }

          if (!cancelled && version === configVersionRef.current) setModelConfig(data);
        } else {
          console.warn('No model config found in database, using defaults');
        }
      } catch (error) {
        console.error('Failed to fetch model config:', error);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchModelConfig();
    return () => { cancelled = true; };
  }, [serverAddress]);

  // Listen for model config updates from other components
  useEffect(() => {
    let disposed = false;
    const setupListener = async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen<ModelConfig>('model-config-updated', (event) => {
        if (disposed) return;
        configVersionRef.current += 1;
        setModelConfig(event.payload);
      });

      return unlisten;
    };

    let cleanup: (() => void) | undefined;
    void setupListener().then(fn => { if (disposed) fn(); else cleanup = fn; })
      .catch(error => console.error('Failed to setup model config listener:', error));

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  // Save model configuration
  const handleSaveModelConfig = useCallback(async (updatedConfig?: ModelConfig) => {
    try {
      const configToSave = updatedConfig || modelConfig;
      const payload = {
        provider: configToSave.provider,
        model: configToSave.model,
        whisperModel: configToSave.whisperModel,
        apiKey: configToSave.apiKey ?? null,
        ollamaEndpoint: configToSave.ollamaEndpoint ?? null
      };

      // Track model configuration change
      if (updatedConfig && (
        updatedConfig.provider !== modelConfig.provider ||
        updatedConfig.model !== modelConfig.model
      )) {
        await Analytics.trackModelChanged(
          modelConfig.provider,
          modelConfig.model,
          updatedConfig.provider,
          updatedConfig.model
        );
      }

      await invokeTauri('api_save_model_config', {
        provider: payload.provider,
        model: payload.model,
        whisperModel: payload.whisperModel,
        apiKey: payload.apiKey,
        ollamaEndpoint: payload.ollamaEndpoint,
      });

      configVersionRef.current += 1;
      if (mountedRef.current) setModelConfig(payload);

      // Emit event to sync other components
      const { emit } = await import('@tauri-apps/api/event');
      await emit('model-config-updated', payload);

      toast.success('纪要设置已保存');

      await Analytics.trackSettingsChanged('model_config', `${payload.provider}_${payload.model}`);
    } catch (error) {
      console.error('Failed to save model config:', error);
      const message = toUserMessage(error, '纪要设置保存失败，请重试。');
      toast.error('纪要设置保存失败', { description: message });
      if (mountedRef.current) setError(message);
    }
  }, [modelConfig]);

  return {
    modelConfig,
    setModelConfig,
    handleSaveModelConfig,
    isLoading,
  };
}
