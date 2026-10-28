'use client';

import { type ReactNode } from 'react';
import { FileText, Sparkles } from 'lucide-react';
import { CardWorkspace } from '@/components/CardWorkspace';

export type MeetingDetailsTab = 'transcript' | 'summary';

interface MeetingDetailsSplitViewProps {
  transcript: ReactNode;
  summary: ReactNode;
  activeTab: MeetingDetailsTab;
  onTabChange: (tab: MeetingDetailsTab) => void;
}

export function MeetingDetailsSplitView({ transcript, summary, activeTab, onTabChange }: MeetingDetailsSplitViewProps) {
  return (
    <CardWorkspace id="meeting-content" value={activeTab}
      onValueChange={value => onTabChange(value as MeetingDetailsTab)}
      cards={[
        { id: 'transcript', title: '会议转写', description: '查看发言与校对说话人', icon: FileText, content: transcript },
        { id: 'summary', title: '会议纪要', description: '整理重点、决策与待办', icon: Sparkles, content: summary },
      ]}
    />
  );
}
