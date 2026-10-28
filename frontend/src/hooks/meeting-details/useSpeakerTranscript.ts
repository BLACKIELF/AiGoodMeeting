import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { DiarizationProgress, SpeakerTranscript } from '@/types/speakers';
import { parseSpeakerTranscript, speakerProgressMessage } from '@/lib/speaker-transcript';
import { toUserMessage } from '@/lib/user-message';

type BusyOperation = 'diarizing' | 'saving' | null;
interface SpeakerState {
  meetingId: string;
  transcript: SpeakerTranscript | null;
  isLoading: boolean;
  busy: BusyOperation;
  isCancelling: boolean;
  progress: string | null;
  error: string | null;
}

interface Operation {
  meetingId: string;
  scope: number;
  kind: Exclude<BusyOperation, null>;
  cancelPending: boolean;
  cancelled: boolean;
  cancelError?: string;
  outcome?: { transcript: SpeakerTranscript } | { error: unknown };
}

const initialState = (meetingId: string): SpeakerState => ({
  meetingId, transcript: null, isLoading: true, busy: null,
  isCancelling: false, progress: null, error: null,
});

export interface SpeakerTranscriptController extends SpeakerState {
  refresh: () => Promise<void>;
  generate: () => Promise<boolean>;
  cancel: () => Promise<void>;
  rename: (speakerId: string, name: string) => Promise<boolean>;
  merge: (sourceId: string, targetId: string) => Promise<boolean>;
  assign: (segmentIndex: number, speakerId: string) => Promise<boolean>;
}

export function useSpeakerTranscript(meetingId: string): SpeakerTranscriptController {
  const [state, setState] = useState<SpeakerState>(() => initialState(meetingId));
  const visibleMeetingRef = useRef(meetingId);
  visibleMeetingRef.current = meetingId;
  const scopeRef = useRef(0);
  const mountedRef = useRef(false);
  const readVersionRef = useRef(0);
  const operationRef = useRef<Operation | null>(null);

  const isCurrent = useCallback((id: string, scope: number) =>
    mountedRef.current && visibleMeetingRef.current === id && scopeRef.current === scope, []);

  const readSaved = useCallback(async (id: string, scope: number) => {
    const version = ++readVersionRef.current;
    try {
      const saved = await invoke<unknown>('get_speaker_transcript', { meetingId: id });
      const transcript = saved === null ? null : parseSpeakerTranscript(saved);
      if (!isCurrent(id, scope) || version !== readVersionRef.current) return;
      setState(previous => ({ ...previous, transcript, isLoading: false }));
    } catch (error) {
      console.error('Failed to read speaker transcript:', error);
      if (!isCurrent(id, scope) || version !== readVersionRef.current) return;
      setState(previous => ({ ...previous, isLoading: false,
        error: toUserMessage(error, '无法读取分人结果，请重试。') }));
    }
  }, [isCurrent]);

  useEffect(() => {
    const scope = ++scopeRef.current;
    mountedRef.current = true;
    setState(initialState(meetingId));
    operationRef.current = null;
    const unlisteners: UnlistenFn[] = [];
    let disposed = false;

    const subscribe = async <T,>(name: string, callback: (payload: T) => void) => {
      try {
        const unlisten = await listen<T>(name, event => {
          if (isCurrent(meetingId, scope)) callback(event.payload);
        });
        if (disposed) unlisten(); else unlisteners.push(unlisten);
      } catch (error) {
        console.error('Failed to subscribe to speaker transcript progress:', error);
        if (isCurrent(meetingId, scope)) {
          setState(previous => ({ ...previous, error: '无法获取处理进度。仍可等待结果或取消后重试。' }));
        }
      }
    };

    void readSaved(meetingId, scope);
    void subscribe<DiarizationProgress>('diarization-progress', payload => {
      const operation = operationRef.current;
      if (payload.meetingId !== meetingId || operation?.kind !== 'diarizing' || operation.cancelled) return;
      // Completion is confirmed by the command result, never by a progress event alone.
      setState(previous => ({ ...previous, progress: speakerProgressMessage(payload.stage) }));
    });
    void subscribe<{ meetingId: string; updatedAt: string }>('diarization-updated', payload => {
      if (payload.meetingId === meetingId && !operationRef.current) void readSaved(meetingId, scope);
    });

    return () => {
      disposed = true;
      unlisteners.forEach(unlisten => unlisten());
      mountedRef.current = false;
      readVersionRef.current += 1;
      const operation = operationRef.current;
      if (operation?.meetingId === meetingId) {
        operation.cancelled = true;
        operationRef.current = null;
        if (operation.kind === 'diarizing') {
          void invoke('cancel_diarization', { meetingId }).catch(error => {
            console.warn('Could not stop diarization after leaving the meeting:', error);
          });
        }
      }
    };
  }, [isCurrent, meetingId, readSaved]);

  const settle = useCallback((operation: Operation): boolean => {
    if (!isCurrent(operation.meetingId, operation.scope) || operationRef.current !== operation
      || operation.cancelPending || operation.cancelled || !operation.outcome) return false;
    operationRef.current = null;
    readVersionRef.current += 1;
    const outcome = operation.outcome;
    if ('transcript' in outcome) {
      setState(previous => ({ ...previous, transcript: outcome.transcript,
        busy: null, isLoading: false, isCancelling: false, progress: null,
        error: operation.cancelError ?? null }));
      return true;
    }
    console.error('Speaker transcript operation failed:', outcome.error);
    setState(previous => ({ ...previous, busy: null, isCancelling: false, progress: null,
      error: toUserMessage(outcome.error, operation.kind === 'diarizing'
        ? '自动分人失败，请重试。原有转写仍可查看。' : '未能保存说话人修改，请重试。') }));
    return false;
  }, [isCurrent]);

  const run = useCallback(async (command: string, args: Record<string, unknown>, kind: Exclude<BusyOperation, null>) => {
    if (!meetingId || !isCurrent(meetingId, scopeRef.current) || operationRef.current) return false;
    const operation: Operation = { meetingId, scope: scopeRef.current, kind, cancelPending: false, cancelled: false };
    operationRef.current = operation;
    readVersionRef.current += 1;
    setState(previous => ({ ...previous, busy: kind, error: null, isCancelling: false,
      progress: kind === 'diarizing' ? speakerProgressMessage('preparing') : null }));
    try {
      operation.outcome = { transcript: parseSpeakerTranscript(await invoke(command, { meetingId, ...args })) };
    } catch (error) {
      operation.outcome = { error };
    }
    return settle(operation);
  }, [isCurrent, meetingId, settle]);

  const refresh = useCallback(async () => {
    if (operationRef.current || !isCurrent(meetingId, scopeRef.current)) return;
    setState(previous => ({ ...previous, isLoading: true, error: null }));
    await readSaved(meetingId, scopeRef.current);
  }, [isCurrent, meetingId, readSaved]);

  const cancel = useCallback(async () => {
    const operation = operationRef.current;
    if (!operation || operation.kind !== 'diarizing' || operation.cancelPending || operation.cancelled
      || !isCurrent(operation.meetingId, operation.scope)) return;
    operation.cancelPending = true;
    setState(previous => ({ ...previous, isCancelling: true, error: null }));
    try {
      await invoke('cancel_diarization', { meetingId: operation.meetingId });
      if (!isCurrent(operation.meetingId, operation.scope) || operationRef.current !== operation) return;
      operation.cancelled = true;
      operationRef.current = null;
      readVersionRef.current += 1;
      setState(previous => ({ ...previous, busy: null, isCancelling: false,
        isLoading: true, progress: '已停止自动分人。', error: null }));
      // A completed run may have saved just before cancellation. Read the durable result.
      await readSaved(operation.meetingId, operation.scope);
    } catch (error) {
      if (!isCurrent(operation.meetingId, operation.scope) || operationRef.current !== operation) return;
      operation.cancelPending = false;
      console.error('Failed to cancel diarization:', error);
      operation.cancelError = toUserMessage(error, '未能取消自动分人，请重试。');
      setState(previous => ({ ...previous, isCancelling: false, error: operation.cancelError! }));
      settle(operation);
    }
  }, [isCurrent, readSaved, settle]);

  const generate = useCallback(() => run('diarize_meeting', {}, 'diarizing'), [run]);
  const rename = useCallback((speakerId: string, name: string) =>
    run('rename_speaker', { speakerId, name: name.trim() }, 'saving'), [run]);
  const merge = useCallback((sourceId: string, targetId: string) =>
    run('merge_speakers', { sourceId, targetId }, 'saving'), [run]);
  const assign = useCallback((segmentIndex: number, speakerId: string) =>
    run('set_segment_speaker', { segmentIndex, speakerId }, 'saving'), [run]);

  return { ...(state.meetingId === meetingId ? state : initialState(meetingId)),
    refresh, generate, cancel, rename, merge, assign };
}
