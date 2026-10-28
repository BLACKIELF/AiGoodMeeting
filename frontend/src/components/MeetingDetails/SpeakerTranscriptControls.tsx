'use client';

import { useEffect, useState } from 'react';
import { Loader2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { speakerLabel } from '@/lib/speaker-transcript';
import type { SpeakerTranscriptController } from '@/hooks/meeting-details/useSpeakerTranscript';
import type { SpeakerTranscript } from '@/types/speakers';
import { SpeakerIdentity } from './SpeakerIdentity';

function SpeakerNameInput({ id, transcript, controller }: {
  id: string; transcript: SpeakerTranscript; controller: SpeakerTranscriptController;
}) {
  const savedName = speakerLabel(id, transcript.names);
  const [name, setName] = useState(savedName);
  useEffect(() => { setName(savedName); }, [savedName]);
  return (
    <form className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2" onSubmit={event => {
      event.preventDefault();
      if (name.trim() && name.trim() !== savedName) void controller.rename(id, name);
    }}>
      <label className="sr-only" htmlFor={`speaker-name-${id}`}>{savedName}的姓名</label>
      <SpeakerIdentity id={id} />
      <input
        id={`speaker-name-${id}`}
        value={name}
        maxLength={80}
        onChange={event => setName(event.target.value)}
        disabled={!!controller.busy || controller.isLoading}
        className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-1 text-sm text-foreground hover:border-border focus:border-ring focus:bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
      />
      <Button type="submit" size="sm" variant="ghost" className="h-7 px-2 text-xs text-primary"
        disabled={!!controller.busy || controller.isLoading || !name.trim() || name.trim() === savedName}>
        保存姓名
      </Button>
    </form>
  );
}

function SpeakerCorrections({ transcript, controller }: {
  transcript: SpeakerTranscript; controller: SpeakerTranscriptController;
}) {
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const speakers = transcript.speakers;
  const validSource = speakers.includes(source) ? source : '';
  const validTarget = speakers.includes(target) && target !== validSource ? target : '';
  const disabled = !!controller.busy || controller.isLoading;
  return (
    <div className="mt-2.5 max-h-60 space-y-2 overflow-y-auto">
        {speakers.map(id => <SpeakerNameInput key={id} id={id} transcript={transcript} controller={controller} />)}
        {speakers.length > 1 && (
          <div className="border-t border-border pt-2.5">
            <p className="mb-2 text-xs text-muted-foreground">同一个人被分成两位时，可合并发言。</p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="sr-only" htmlFor="merge-speaker-source">要合并的说话人</label>
              <select id="merge-speaker-source" value={validSource} disabled={disabled}
                onChange={event => { setSource(event.target.value); if (event.target.value === target) setTarget(''); }}
                className="min-w-0 max-w-full flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20">
                <option value="">选择说话人</option>
                {speakers.map(id => <option key={id} value={id}>{speakerLabel(id, transcript.names)}</option>)}
              </select>
              <span className="text-xs text-muted-foreground">合并到</span>
              <label className="sr-only" htmlFor="merge-speaker-target">合并后的说话人</label>
              <select id="merge-speaker-target" value={validTarget} disabled={disabled || !validSource}
                onChange={event => setTarget(event.target.value)}
                className="min-w-0 max-w-full flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20">
                <option value="">选择保留的人</option>
                {speakers.filter(id => id !== validSource).map(id =>
                  <option key={id} value={id}>{speakerLabel(id, transcript.names)}</option>)}
              </select>
              <Button size="sm" variant="outline" disabled={disabled || !validSource || !validTarget}
                onClick={async () => {
                  if (await controller.merge(validSource, validTarget)) { setSource(''); setTarget(''); }
                }}>合并</Button>
            </div>
          </div>
        )}
        <p className="text-[11px] leading-relaxed text-muted-foreground">个别段落分错时，可在该段上方更换说话人。</p>
    </div>
  );
}

export function SpeakerTranscriptControls({ controller, transcriptCount, showSpeakers, onShowSpeakers, onGenerated }: {
  controller: SpeakerTranscriptController;
  transcriptCount: number;
  showSpeakers: boolean;
  onShowSpeakers: (value: boolean) => void;
  onGenerated?: () => void;
}) {
  const transcript = controller.transcript;
  const isWorking = controller.busy === 'diarizing';
  return (
    <div className="mt-3 border-t border-border/70 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={!!controller.busy || controller.isLoading || transcriptCount === 0}
          className="border-primary/25 bg-primary/5 text-primary hover:bg-primary/10"
          onClick={async () => { if (await controller.generate()) onGenerated?.(); }}>
          {isWorking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
          自动分人
        </Button>
        {isWorking && (
          <Button size="sm" variant="outline" disabled={controller.isCancelling}
            onClick={() => { void controller.cancel(); }}>
            {controller.isCancelling ? '正在取消…' : '取消'}
          </Button>
        )}
      </div>
      {transcript && <details className="mt-2 rounded-lg border border-border/70 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">校对与显示</summary>
          <div className="mt-2 inline-flex rounded-lg border border-border bg-muted/50 p-0.5" role="group" aria-label="转写显示方式">
            <Button size="sm" className={`h-7 px-2.5 text-xs ${showSpeakers ? 'bg-card shadow-sm' : ''}`} variant={showSpeakers ? 'secondary' : 'ghost'} aria-pressed={showSpeakers}
              onClick={() => onShowSpeakers(true)}>按说话人</Button>
            <Button size="sm" className={`h-7 px-2.5 text-xs ${!showSpeakers ? 'bg-card shadow-sm' : ''}`} variant={!showSpeakers ? 'secondary' : 'ghost'} aria-pressed={!showSpeakers}
              onClick={() => onShowSpeakers(false)}>原始转写</Button>
          </div>
        {showSpeakers && <SpeakerCorrections transcript={transcript} controller={controller} />}
      </details>}
      <div aria-live="polite" role="status" className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        {controller.isLoading ? '正在读取分人结果…'
          : controller.busy === 'saving' ? '正在保存修改…' : controller.isCancelling ? '正在取消，请稍候…'
            : controller.progress || (!transcript ? '区分录音中的说话人，结果可手动校对。' : '自动分人可能有误，请核对姓名和发言。')}
      </div>
      {controller.error && (
        <div role="alert" className="mt-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <p>{controller.error}</p>
          {!controller.busy && <button className="mt-1 underline underline-offset-2" disabled={controller.isLoading}
            onClick={() => { void controller.refresh(); }}>重新读取</button>}
        </div>
      )}
      {transcript && showSpeakers && transcript.warnings.length > 0 && (
        <div className="mt-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs leading-relaxed text-foreground" role="note">
          {transcript.warnings.map((warning, index) => <p key={index}>{/[\u3400-\u9fff]/.test(warning)
            ? warning : '部分发言无法可靠区分，请结合原始录音校对。'}</p>)}
        </div>
      )}
    </div>
  );
}
