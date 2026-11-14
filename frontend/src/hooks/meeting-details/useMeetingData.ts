import { useState, useCallback, useRef, useEffect } from 'react';
import { MeetingSummary, Summary, Transcript } from '@/types';
import { BlockNoteSummaryViewRef } from '@/components/AISummary/BlockNoteSummaryView';
import { CurrentMeeting, useSidebar } from '@/components/Sidebar/SidebarProvider';
import { invoke as invokeTauri } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { hasVisibleSummaryContent } from '@/lib/summary-content';
import { toUserMessage } from '@/lib/user-message';

interface UseMeetingDataProps {
  meeting: any;
  summaryData: MeetingSummary | null;
  onMeetingUpdated?: () => Promise<void>;
}

export function useMeetingData({ meeting, summaryData, onMeetingUpdated }: UseMeetingDataProps) {
  // State
  // Use prop directly since summary generation fetches transcripts independently
  const transcripts = meeting.transcripts;
  const [meetingTitle, setMeetingTitle] = useState(meeting.title || '未命名会议');
  const [aiSummary, setAiSummary] = useState<MeetingSummary | null>(summaryData);
  const [isSaving, setIsSaving] = useState(false);
  const [isSummaryDirty, setIsSummaryDirty] = useState(false);

  const mountedRef = useRef(false);
  const saveScopeRef = useRef(0);
  const visibleMeetingRef = useRef(meeting.id);
  visibleMeetingRef.current = meeting.id;
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Ref for BlockNoteSummaryView
  const blockNoteSummaryRef = useRef<BlockNoteSummaryViewRef>(null);

  // Sidebar context
  const { setCurrentMeeting, setMeetings, meetings: sidebarMeetings } = useSidebar();

  // Sync aiSummary state when summaryData prop changes (fixes display of fetched summaries)
  useEffect(() => {
    setAiSummary(summaryData);
  }, [summaryData]); // Only trigger when parent prop changes, not when aiSummary changes

  useEffect(() => {
    setIsSaving(false);
    setIsSummaryDirty(false);
    return () => { saveScopeRef.current += 1; };
  }, [meeting.id]);

  useEffect(() => { setMeetingTitle(meeting.title || '未命名会议'); }, [meeting.id, meeting.title]);

  const handleSummaryChange = useCallback((newSummary: Summary) => {
    setAiSummary(newSummary);
  }, []);



  const handleSaveSummary = useCallback(async (summary: MeetingSummary) => {
    if (!hasVisibleSummaryContent(summary)) {
      throw new Error('纪要没有可保存的内容。');
    }

    const formattedSummary = 'markdown' in summary || 'summary_json' in summary
      ? summary
      : { MeetingName: meetingTitle, ...summary };
    await invokeTauri('api_save_meeting_summary', {
      meetingId: meeting.id,
      summary: formattedSummary,
    });
  }, [meeting.id, meetingTitle]);

  const saveAllChanges = useCallback(async () => {
    const scope = saveScopeRef.current;
    if (mountedRef.current && visibleMeetingRef.current === meeting.id) setIsSaving(true);
    try {
      // Save BlockNote editor changes if dirty
      if (blockNoteSummaryRef.current?.isDirty) {
        await blockNoteSummaryRef.current.saveSummary();
      } else if (aiSummary) {
        await handleSaveSummary(aiSummary);
      }

      toast.success("修改已保存");
    } catch (error) {
      console.error('Failed to save changes:', error);
      toast.error('保存失败，请重试', { description: toUserMessage(error, '纪要暂时无法保存，请重试。') });
    } finally {
      if (mountedRef.current && visibleMeetingRef.current === meeting.id && scope === saveScopeRef.current) setIsSaving(false);
    }
  }, [aiSummary, handleSaveSummary]);

  // Update meeting title from external source (e.g., AI summary)
  const updateMeetingTitle = useCallback((newTitle: string) => {
    setMeetingTitle(newTitle);
    const updatedMeetings = sidebarMeetings.map((m: CurrentMeeting) =>
      m.id === meeting.id ? { id: m.id, title: newTitle } : m
    );
    setMeetings(updatedMeetings);
    setCurrentMeeting({ id: meeting.id, title: newTitle });
  }, [meeting.id, sidebarMeetings, setMeetings, setCurrentMeeting]);

  return {
    // State
    transcripts,
    meetingTitle,
    aiSummary,
    isSaving,
    isSummaryDirty,
    blockNoteSummaryRef,

    // Setters
    setMeetingTitle,
    setAiSummary,
    setIsSummaryDirty,

    // Handlers
    handleSummaryChange,
    handleSaveSummary,
    saveAllChanges,
    updateMeetingTitle,
  };
}
