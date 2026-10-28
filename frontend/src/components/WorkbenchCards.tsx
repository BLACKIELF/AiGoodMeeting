'use client';

import { useState, type ReactNode } from 'react';
import { FileText, Mic, Upload } from 'lucide-react';
import { CardWorkspace } from '@/components/CardWorkspace';
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
}: WorkbenchCardsProps) {
  const [activeCard, setActiveCard] = useState('recording');
  const { openImportDialog } = useImportDialog();
  const title = !meetingTitle || meetingTitle === '+ New Call' ? '新建会议' : meetingTitle;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="shrink-0 px-5 py-4 sm:px-6">
        <h1 className="text-xl font-semibold text-foreground">工作台</h1>
      </header>
      <CardWorkspace
        id="workbench"
        value={activeCard}
        onValueChange={setActiveCard}
        className="min-h-0 flex-1 px-3 pb-3 sm:px-5"
        cards={[
          {
            id: 'recording', title: '录音', description: '开始、暂停与保存会议录音', icon: Mic,
            meta: isRecording ? (isPaused ? '已暂停' : '录音中') : undefined,
            content: (
              <section className="flex h-full min-h-0 flex-col overflow-y-auto px-5 py-5 sm:px-7 sm:py-6" aria-label="会议录音">
                <h2 className="break-words text-lg font-semibold text-foreground">{title}</h2>
                <p className="mt-2 text-sm text-muted-foreground" role="status" aria-live="polite">{recordingStatus}</p>
                <p className="mt-6 max-w-prose text-sm leading-relaxed text-muted-foreground">
                  开始录音后，可在“实时文字”中查看转写；停止后会保存会议记录。
                </p>
                {permissionWarning && <div className="mt-5">{permissionWarning}</div>}
              </section>
            ),
          },
          {
            id: 'transcript', title: '实时文字', description: '查看与复制这场会议的转写', icon: FileText,
            meta: transcriptCount > 0 ? `${transcriptCount} 段` : undefined,
            content: transcript,
          },
          {
            id: 'import', title: '导入录音', description: '从已有音频生成会议记录', icon: Upload,
            content: (
              <section className="h-full overflow-y-auto px-5 py-5 sm:px-7 sm:py-6" aria-label="导入会议录音">
                <h2 className="text-lg font-semibold text-foreground">导入录音</h2>
                <p className="mb-5 mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
                  选择已有录音，转写后保存为会议记录。
                </p>
                <Button onClick={() => openImportDialog()} disabled={!canImport}>
                  <Upload className="h-4 w-4" aria-hidden="true" />选择录音文件
                </Button>
                {!canImport && <p className="mt-3 text-xs text-muted-foreground">请先在设置中开启音频导入。</p>}
                <p className="mt-5 max-w-prose text-xs leading-relaxed text-muted-foreground">支持 {getAudioFormatsDisplayList()}</p>
              </section>
            ),
          },
        ]}
      />
      {/* One persistent control instance stays outside the selectable cards. */}
      {recordingControls && (
        <div className="flex shrink-0 justify-center overflow-y-auto px-4 pb-4 pt-1" role="region" aria-label="录音控制">
          {recordingControls}
        </div>
      )}
    </div>
  );
}
