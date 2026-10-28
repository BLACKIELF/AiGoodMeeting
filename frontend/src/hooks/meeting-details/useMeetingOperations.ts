import { useCallback } from 'react';
import { invoke as invokeTauri } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { toUserMessage } from '@/lib/user-message';

interface UseMeetingOperationsProps {
  meeting: any;
}

export function useMeetingOperations({
  meeting,
}: UseMeetingOperationsProps) {

  // Open meeting folder in file explorer
  const handleOpenMeetingFolder = useCallback(async () => {
    try {
      await invokeTauri('open_meeting_folder', { meetingId: meeting.id });
    } catch (error) {
      console.error('Failed to open meeting folder:', error);
      toast.error(toUserMessage(error, '无法打开录音文件夹，请重试。'));
    }
  }, [meeting.id]);

  return {
    handleOpenMeetingFolder,
  };
}
