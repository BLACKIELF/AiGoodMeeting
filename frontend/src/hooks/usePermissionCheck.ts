import { toUserMessage } from '@/lib/user-message';
import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface PermissionStatus {
  hasMicrophone: boolean;
  hasSystemAudio: boolean;
  isChecking: boolean;
  error: string | null;
}

export function usePermissionCheck() {
  const [status, setStatus] = useState<PermissionStatus>({
    hasMicrophone: false,
    hasSystemAudio: false,
    isChecking: true,
    error: null,
  });

  const mountedRef = useRef(false);
  const requestRef = useRef(0);
  const recheckTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const checkPermissions = async () => {
    const request = ++requestRef.current;
    setStatus(prev => ({ ...prev, isChecking: true, error: null }));

    try {
      // Get audio devices to check for microphone and system audio availability
      const devices = await invoke<Array<{ name: string; device_type: 'Input' | 'Output' }>>('get_audio_devices');

      // Check for microphone devices (Input)
      const inputDevices = devices.filter(d => d.device_type === 'Input');
      const hasMicrophone = inputDevices.length > 0;

      // Check for system audio devices (Output)
      // On macOS, we need ScreenCaptureKit devices for system audio
      const outputDevices = devices.filter(d => d.device_type === 'Output');
      const hasSystemAudio = outputDevices.length > 0;


      if (!mountedRef.current || request !== requestRef.current) return { hasMicrophone, hasSystemAudio };
      setStatus({
        hasMicrophone,
        hasSystemAudio,
        isChecking: false,
        error: null,
      });

      return { hasMicrophone, hasSystemAudio };
    } catch (error) {
      console.error('Failed to check audio permissions:', error);
      if (!mountedRef.current || request !== requestRef.current) return { hasMicrophone: false, hasSystemAudio: false };
      setStatus({
        hasMicrophone: false,
        hasSystemAudio: false,
        isChecking: false,
        error: toUserMessage(error, '无法检查录音权限，请重试。'),
      });
      return { hasMicrophone: false, hasSystemAudio: false };
    }
  };

  const requestPermissions = async () => {
    try {
      // Trigger audio permission by trying to access devices
      await invoke('get_audio_devices');

      // Recheck after triggering
      if (!mountedRef.current) return;
      clearTimeout(recheckTimerRef.current);
      recheckTimerRef.current = setTimeout(() => {
        checkPermissions();
      }, 1000);
    } catch (error) {
      console.error('Failed to request permissions:', error);
    }
  };

  // Check permissions on mount
  useEffect(() => {
    mountedRef.current = true;
    void checkPermissions();
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
      clearTimeout(recheckTimerRef.current);
    };
  }, []);

  return {
    ...status,
    checkPermissions,
    requestPermissions,
  };
}
