'use client';

import { useState, type ReactNode } from 'react';
import { AudioLines, ChevronRight, FileText, Mic, NotebookPen, Upload } from 'lucide-react';
import { CardWorkspace } from '@/components/CardWorkspace';
import { QuickHandoffStrip } from '@/components/QuickHandoffStrip';
import { Button } from '@/components/ui/button';
import { useImportDialog } from '@/contexts/ImportDialogContext';
import { getAudioFormatsDisplayList } from '@/constants/audioFormats';

interface WorkbenchCardsProps {
  meetingTitle: string;
  transcriptCount: number;
  isRecording: boolean;
  isPaused: boolean;
  recordingStatus: string;
  canImport: boolean;
  transcript: ReactNode;
  recordingControls: ReactNode;
  permissionWarning?: ReactNode;
  recentMeetings?: Array<{ id: string; title: string }>;
  onOpenMeeting?: (meeting: { id: string; title: string }) => void;
}

export function WorkbenchCards({
  meetingTitle,
  transcriptCount,
  isRecording,
  isPaused,
  recordingStatus,
  canImport,
  transcript,
  recordingControls,
  permissionWarning,
  recentMeetings = [],
  onOpenMeeting,
}: WorkbenchCardsProps) {
  const [activeCard, setActiveCard] = useState('recording');
  const { openImportDialog } = useImportDialog();
  const title = !meetingTitle || meetingTitle === '+ New Call' ? '新建会议' : meetingTitle;

  return (
    <div className="agb-workbench">
      <aside className="agb-workbench-session" aria-label="当前会议">
        <div className="agb-workbench-product">AiGoodMeeting</div>
        <div className="agb-workbench-session-content">
          <div className="agb-workbench-symbol" data-recording={isRecording && !isPaused}>
            <AudioLines aria-hidden="true" />
          </div>
          <span className="agb-workbench-label">当前会议</span>
          <h2>{title}</h2>
          <p className="agb-workbench-status" role="status" aria-live="polite">{recordingStatus}</p>
        </div>
        {recordingControls && (
          <div className="agb-workbench-controls" role="region" aria-label="录音控制">
            {recordingControls}
          </div>
        )}
      </aside>

      <main className="agb-workbench-overview">
        <header className="agb-workbench-header">
          <h1>工作台</h1>
          {isRecording && <span className="agb-workbench-live">{isPaused ? '已暂停' : '录音中'}</span>}
        </header>
        <QuickHandoffStrip mode="arm" className="mb-3" />
        <CardWorkspace
          id="workbench"
          layout="overview"
          value={activeCard}
          onValueChange={setActiveCard}
          className="agb-workbench-cards"
          cards={[
            {
              id: 'recording',
              title: '录音',
              description: '开始、暂停与保存会议录音',
              icon: Mic,
              meta: isRecording ? (isPaused ? '已暂停' : '录音中') : undefined,
              content: (
                <section className="agb-workbench-card-copy" aria-label="会议录音">
                  <p>保存录音后，根据转写生成会议主题和摘要。</p>
                  {permissionWarning}
                </section>
              ),
            },
            {
              id: 'transcript',
              title: '实时文字',
              description: '查看与复制这场会议的转写',
              icon: FileText,
              meta: transcriptCount > 0 ? `${transcriptCount} 段` : undefined,
              content: (
                <div className="flex h-full min-h-[280px] w-full flex-1 flex-col overflow-hidden">
                  {transcript}
                </div>
              ),
            },
            {
              id: 'import',
              title: '导入录音',
              description: '从已有音频生成会议记录',
              icon: Upload,
              content: (
                <section className="agb-workbench-card-copy" aria-label="导入会议录音">
                  <Button onClick={() => openImportDialog()} disabled={!canImport}>
                    <Upload className="h-4 w-4" aria-hidden="true" />选择录音文件
                  </Button>
                  {canImport
                    ? <p>支持 {getAudioFormatsDisplayList()}</p>
                    : <p>在设置 → 实验功能中开启音频导入。</p>}
                </section>
              ),
            },
          ]}
        />
        {recentMeetings.length > 0 && onOpenMeeting && (
          <section className="agb-workbench-recent" aria-labelledby="workbench-recent-title">
            <h2 id="workbench-recent-title">最近会议</h2>
            <ul>
              {recentMeetings.slice(0, 6).map(meeting => (
                <li key={meeting.id}>
                  <button type="button" className="agb-workbench-recent-item" onClick={() => onOpenMeeting(meeting)}>
                    <NotebookPen aria-hidden="true" />
                    <span>{meeting.title}</span>
                    <ChevronRight aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
