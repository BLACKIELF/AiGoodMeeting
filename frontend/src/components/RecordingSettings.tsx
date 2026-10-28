import { toUserMessage } from '@/lib/user-message';
import React, { useState, useEffect } from 'react';
import { Switch } from '@/components/ui/switch';
import { FolderOpen } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { DeviceSelection, SelectedDevices } from '@/components/DeviceSelection';
import Analytics from '@/lib/analytics';
import { toast } from 'sonner';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useConfig } from '@/contexts/ConfigContext';

export interface RecordingPreferences {
  save_folder: string;
  auto_save: boolean;
  file_format: string;
  preferred_mic_device: string | null;
  preferred_system_device: string | null;
}

interface RecordingSettingsProps {
  onSave?: (preferences: RecordingPreferences) => void;
}

export function RecordingSettings({ onSave }: RecordingSettingsProps) {
  const [preferences, setPreferences] = useState<RecordingPreferences>({
    save_folder: '',
    auto_save: true,
    file_format: 'mp4',
    preferred_mic_device: null,
    preferred_system_device: null
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showRecordingNotification, setShowRecordingNotification] = useState(true);
  const { isRecording } = useRecordingState();
  const { setSelectedDevices } = useConfig();

  // Load recording preferences on component mount
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const prefs = await invoke<RecordingPreferences>('get_recording_preferences');
        setPreferences(prefs);
      } catch (error) {
        console.error('Failed to load recording preferences:', error);
        // If loading fails, get default folder path
        try {
          const defaultPath = await invoke<string>('get_default_recordings_folder_path');
          setPreferences(prev => ({ ...prev, save_folder: defaultPath }));
        } catch (defaultError) {
          console.error('Failed to get default folder path:', defaultError);
        }
      } finally {
        setLoading(false);
      }
    };

    loadPreferences();
  }, []);

  // Load recording notification preference
  useEffect(() => {
    const loadNotificationPref = async () => {
      try {
        const { Store } = await import('@tauri-apps/plugin-store');
        const store = await Store.load('preferences.json');
        const show = await store.get<boolean>('show_recording_notification') ?? true;
        setShowRecordingNotification(show);
      } catch (error) {
        console.error('Failed to load notification preference:', error);
      }
    };
    loadNotificationPref();
  }, []);

  const handleAutoSaveToggle = async (enabled: boolean) => {
    const newPreferences = { ...preferences, auto_save: enabled };
    setPreferences(newPreferences);
    await savePreferences(newPreferences);

    // Track auto-save setting change
    await Analytics.track('auto_save_recording_toggled', {
      enabled: enabled.toString()
    });
  };

  const handleDeviceChange = async (devices: SelectedDevices) => {
    const newPreferences = {
      ...preferences,
      preferred_mic_device: devices.micDevice,
      preferred_system_device: devices.systemDevice
    };
    setPreferences(newPreferences);
    // Sync the in-memory selection ConfigContext exposes to the start path.
    // Without this, the picker only writes to disk (loaded into context once at
    // app mount), so a newly-chosen mic isn't honored until the next launch —
    // start keeps sending the stale launch-time device.
    setSelectedDevices(devices);
    await savePreferences(newPreferences);

    // Track default device preference changes
    // Note: Individual device selection analytics are tracked in DeviceSelection component
    await Analytics.track('default_devices_changed', {
      has_preferred_microphone: (!!devices.micDevice).toString(),
      has_preferred_system_audio: (!!devices.systemDevice).toString()
    });
  };

  const handleOpenFolder = async () => {
    try {
      await invoke('open_recordings_folder');
    } catch (error) {
      console.error('Failed to open recordings folder:', error);
    }
  };

  const handleNotificationToggle = async (enabled: boolean) => {
    try {
      setShowRecordingNotification(enabled);
      const { Store } = await import('@tauri-apps/plugin-store');
      const store = await Store.load('preferences.json');
      await store.set('show_recording_notification', enabled);
      await store.save();
      toast.success("偏好已保存");
      await Analytics.track('recording_notification_preference_changed', {
        enabled: enabled.toString()
      });
    } catch (error) {
      console.error('Failed to save notification preference:', error);
      toast.error("保存偏好失败");
    }
  };

  const savePreferences = async (prefs: RecordingPreferences) => {
    setSaving(true);
    try {
      await invoke('set_recording_preferences', { preferences: prefs });
      onSave?.(prefs);

      // Show success toast with device details
      const micDevice = prefs.preferred_mic_device || '系统默认';
      const systemDevice = prefs.preferred_system_device || '系统默认';
      toast.success("录音设备已保存", {
        description: `麦克风：${micDevice}；系统音频：${systemDevice}`
      });
    } catch (error) {
      console.error('Failed to save recording preferences:', error);
      toast.error("保存录音设备失败", {
        description: toUserMessage(error, "录音设备未保存，请重试。")
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-4 bg-muted rounded w-1/4 mb-4"></div>
        <div className="h-8 bg-muted rounded mb-4"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-4">录音设置</h3>
        <p className="text-sm text-muted-foreground mb-6">
          选择音频保存方式与录音设备。
        </p>
      </div>

      {/* Auto Save Toggle */}
      <div className="flex items-center justify-between p-4 border rounded-lg">
        <div className="flex-1">
          <div className="font-medium">保存录音文件</div>
          <div className="text-sm text-muted-foreground">
            结束录音后自动保存音频，供回听和自动分人使用
          </div>
        </div>
        <Switch
          checked={preferences.auto_save}
          onCheckedChange={handleAutoSaveToggle}
          disabled={saving}
        />
      </div>

      {/* Folder Location - Only shown when auto_save is enabled */}
      {preferences.auto_save && (
        <div className="space-y-4">
          <div className="p-4 border rounded-lg bg-muted/50">
            <div className="font-medium mb-2">保存位置</div>
            <div className="text-sm text-muted-foreground mb-3 break-all">
              {preferences.save_folder || '默认文件夹'}
            </div>
            <button
              onClick={handleOpenFolder}
              className="flex items-center gap-2 px-3 py-2 text-sm border border-input rounded-md hover:bg-accent transition-colors"
            >
              <FolderOpen className="w-4 h-4" />
              打开文件夹
            </button>
          </div>

          <div className="p-4 border rounded-lg bg-primary/10">
            <div className="text-sm text-primary">
              <strong>音频格式：</strong> {preferences.file_format.toUpperCase()}
            </div>
            <details className="mt-2 text-xs text-primary">
              <summary className="cursor-pointer">文件命名规则</summary>
              <p className="mt-1">文件名包含录制时间：recording_YYYYMMDD_HHMMSS.{preferences.file_format}</p>
            </details>
          </div>
        </div>
      )}

      {/* Info when auto_save is disabled */}
      {!preferences.auto_save && (
        <div className="p-4 border rounded-lg bg-yellow-50">
          <div className="text-sm text-yellow-800">
            当前不保存音频。启用“保存录音文件”后，可回听录音和自动分人。
          </div>
        </div>
      )}

      {/* Recording Notification Toggle */}
      <div className="flex items-center justify-between p-4 border rounded-lg">
        <div className="flex-1">
          <div className="font-medium">开始录音提醒</div>
          <div className="text-sm text-muted-foreground">
            录音开始时，提醒告知参会者
          </div>
        </div>
        <Switch
          checked={showRecordingNotification}
          onCheckedChange={handleNotificationToggle}
        />
      </div>

      {/* Device Preferences */}
      <div className="space-y-4">
        <div className="border-t pt-6">
          <h4 className="text-base font-medium text-foreground mb-4">默认音频设备</h4>
          <p className="text-sm text-muted-foreground mb-4">
            新录音优先使用这些麦克风和系统音频设备。
          </p>

          {isRecording && (
            <p
              role="status"
              aria-live="polite"
              className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2 mb-4"
            >
              录音期间不能切换设备。请先结束录音，再调整输入设备。
            </p>
          )}

          <div className="border rounded-lg p-4 bg-muted/50">
            <DeviceSelection
              selectedDevices={{
                micDevice: preferences.preferred_mic_device,
                systemDevice: preferences.preferred_system_device
              }}
              onDeviceChange={handleDeviceChange}
              disabled={saving || isRecording}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
