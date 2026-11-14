'use client';

import { type ReactNode } from 'react';
import { FileText, Sparkles } from 'lucide-react';
import { CardWorkspace } from '@/components/CardWorkspace';

export type MeetingDetailsTab = 'transcript' | 'summary' | '';

interface MeetingDetailsSplitViewProps {
  transcript: ReactNode;
  summary: ReactNode;
  activeTab: MeetingDetailsTab;
  onTabChange: (tab: MeetingDetailsTab) => void;
  transcriptMeta?: ReactNode;
  summaryMeta?: ReactNode;
}

export function MeetingDetailsSplitView({
  transcript,
  summary,
  activeTab,
  onTabChange,
  transcriptMeta,
  summaryMeta,
}: MeetingDetailsSplitViewProps) {
  return (
    <CardWorkspace
      id="meeting-content"
      value={activeTab}
      onValueChange={value => onTabChange(value as MeetingDetailsTab)}
      className="h-full w-full flex-1 min-h-0"
      cards={[
        {
          id: 'transcript',
          title: '会议转写',
          description: '查看发言、区分说话人与导出',
          icon: FileText,
          meta: transcriptMeta,
          content: (
            <div className="flex h-full min-h-[280px] w-full flex-1 flex-col overflow-hidden">
              {transcript}
            </div>
          ),
        },
        {
          id: 'summary',
          title: '会议纪要',
          description: '整理重点、导出 Word/TXT 或直传飞书',
          icon: Sparkles,
          meta: summaryMeta,
          content: (
            <div className="flex h-full min-h-[280px] w-full flex-1 flex-col overflow-hidden">
              {summary}
            </div>
          ),
        },
      ]}
    />
  );
}
