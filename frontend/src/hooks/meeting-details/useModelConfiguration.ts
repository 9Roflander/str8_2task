import { useState, useEffect, useCallback } from 'react';
import { ModelConfig } from '@/components/ModelSettingsModal';
import { invoke as invokeTauri } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import Analytics from '@/lib/analytics';

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

  // Fetch model configuration on mount and when serverAddress changes
  useEffect(() => {
    const fetchModelConfig = async () => {
      setIsLoading(true);
      try {
        console.log('🔄 Fetching model configuration from database...');
        const data = await invokeTauri('api_get_model_config', {}) as any;
        // Handle both null/undefined and empty object cases
        if (data && data !== null && data.provider !== null && data.provider !== undefined && data.provider !== '') {
          console.log('✅ Loaded model config from database:', {
            provider: data.provider,
            model: data.model,
            whisperModel: data.whisperModel,
            hasApiKey: !!data.apiKey,
            ollamaEndpoint: data.ollamaEndpoint || 'default'
          });
          // Fetch API key if not included and provider requires it
          if (data.provider !== 'ollama' && !data.apiKey) {
            try {
              const apiKeyData = await invokeTauri('api_get_api_key', {
                provider: data.provider
              }) as string;
              data.apiKey = apiKeyData;
            } catch (err) {
              console.error('Failed to fetch API key:', err);
            }
          }
          // Ensure model field is not empty
          if (!data.model || data.model.trim() === '') {
            console.warn('⚠️ Model config has empty model field, setting default based on provider');
            if (data.provider === 'ollama') {
              data.model = 'llama3.2:latest';
            } else if (data.provider === 'claude') {
              data.model = 'claude-3-5-sonnet-latest';
            } else if (data.provider === 'groq') {
              data.model = 'llama-3.3-70b-versatile';
            } else if (data.provider === 'gemini') {
              data.model = 'gemini-1.5-pro';
            }
          }
          setModelConfig(data);
        } else {
          console.warn('⚠️ No model config found in database, using defaults');
          // Set sensible defaults when no config exists
          setModelConfig({
            provider: 'ollama',
            model: 'llama3.2:latest',
            whisperModel: 'large-v3',
            apiKey: null,
            ollamaEndpoint: null
          });
        }
      } catch (error) {
        console.error('❌ Failed to fetch model config:', error);
        // Set defaults on error to ensure app continues to work
        console.warn('⚠️ Setting default model config due to error');
        setModelConfig({
          provider: 'ollama',
          model: 'llama3.2:latest',
          whisperModel: 'large-v3',
          apiKey: null,
          ollamaEndpoint: null
        });
      } finally {
        setIsLoading(false);
        console.log('✅ Model configuration loading complete');
      }
    };

    fetchModelConfig();
  }, [serverAddress]);

  // Listen for model config updates from other components
  useEffect(() => {
    const setupListener = async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen<ModelConfig>('model-config-updated', (event) => {
        console.log('Meeting details received model-config-updated event:', event.payload);
        setModelConfig(event.payload);
      });

      return unlisten;
    };

    let cleanup: (() => void) | undefined;
    setupListener().then(fn => cleanup = fn);

    return () => {
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
      console.log('Saving model config with payload:', payload);

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

      console.log('Save model config success');
      setModelConfig(payload);

      // Emit event to sync other components
      const { emit } = await import('@tauri-apps/api/event');
      await emit('model-config-updated', payload);

      toast.success("Summary settings Saved successfully");

      await Analytics.trackSettingsChanged('model_config', `${payload.provider}_${payload.model}`);
    } catch (error) {
      console.error('Failed to save model config:', error);
      toast.error("Failed to save summary settings", { description: String(error) });
      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError('Failed to save model config: Unknown error');
      }
    }
  }, [modelConfig]);

  return {
    modelConfig,
    setModelConfig,
    handleSaveModelConfig,
    isLoading,
  };
}
