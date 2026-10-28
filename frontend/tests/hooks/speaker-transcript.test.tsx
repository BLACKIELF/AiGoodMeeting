import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { SpeakerTranscript } from '../../src/types/speakers';

const originalCore = { ...await import('@tauri-apps/api/core') };
const originalEvents = { ...await import('@tauri-apps/api/event') };
type Request = {
  command: string;
  args: Record<string, unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};
const requests: Request[] = [];
const handlers = new Map<string, (event: { payload: any }) => void>();
const unlisten = mock(() => {});
let deferSubscriptions = false;
const subscriptionResolvers: Array<(value: () => void) => void> = [];
const invoke = mock((command: string, args: Record<string, unknown>) => new Promise((resolve, reject) => {
  requests.push({ command, args, resolve, reject });
}));
const listen = mock((event: string, callback: (event: { payload: any }) => void) => {
  handlers.set(event, callback);
  return deferSubscriptions ? new Promise<() => void>(resolve => subscriptionResolvers.push(resolve)) : Promise.resolve(unlisten);
});
mock.module('@tauri-apps/api/core', () => ({ ...originalCore, invoke }));
mock.module('@tauri-apps/api/event', () => ({ ...originalEvents, listen }));
const { useSpeakerTranscript } = await import('../../src/hooks/meeting-details/useSpeakerTranscript');
afterAll(() => {
  mock.module('@tauri-apps/api/core', () => originalCore);
  mock.module('@tauri-apps/api/event', () => originalEvents);
});

let state: ReturnType<typeof useSpeakerTranscript>;
let renderer: ReactTestRenderer | undefined;
function View({ meetingId }: { meetingId: string }) {
  state = useSpeakerTranscript(meetingId);
  return <output>{state.meetingId}:{state.transcript?.updated_at}:{state.error}</output>;
}
const transcript = (revision = 'revision-1'): SpeakerTranscript => ({
  schema_version: 1, model: 'local-test', updated_at: revision,
  segments: [{ start: 0, end: 1, speaker: 'speaker_0', text: 'Original words' }],
  speakers: ['speaker_0'], names: {}, warnings: [],
});
beforeEach(() => {
  requests.length = 0; handlers.clear(); subscriptionResolvers.length = 0;
  invoke.mockClear(); listen.mockClear(); unlisten.mockClear(); deferSubscriptions = false;
  mock.module('@tauri-apps/api/core', () => ({ ...originalCore, invoke }));
  mock.module('@tauri-apps/api/event', () => ({ ...originalEvents, listen }));
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
});
async function show(meetingId = 'A') {
  await act(async () => {
    if (renderer) renderer.update(<View meetingId={meetingId} />);
    else renderer = create(<View meetingId={meetingId} />);
  });
}
function request(command: string, meetingId = 'A', index = 0) {
  const result = requests.filter(r => r.command === command && r.args.meetingId === meetingId)[index];
  expect(result).toBeDefined();
  return result;
}
async function resolve(req: Request, value: unknown) { await act(async () => { req.resolve(value); }); }
async function reject(req: Request, error: unknown) { await act(async () => { req.reject(error); }); }
async function load(value: SpeakerTranscript | null = transcript(), meetingId = 'A') {
  await show(meetingId);
  await resolve(request('get_speaker_transcript', meetingId), value);
}

describe('speaker transcript request ownership and persistence', () => {
  test('reads saved results and keeps the last saved names when a rename fails', async () => {
    await load();
    await act(async () => { void state.rename('speaker_0', '小李'); });
    expect(request('rename_speaker').args).toEqual({ meetingId: 'A', speakerId: 'speaker_0', name: '小李' });
    expect(state.transcript?.names).toEqual({});
    await reject(request('rename_speaker'), '无法保存说话人姓名，请重试。');
    expect(state.busy).toBeNull();
    expect(state.transcript?.names).toEqual({});
    expect(state.error).toContain('无法保存');
  });

  test('successful correction takes the backend revision and never overlaps another edit', async () => {
    await load();
    await act(async () => { void state.assign(0, 'unknown'); void state.rename('speaker_0', '小李'); });
    expect(requests.filter(r => r.command === 'rename_speaker')).toHaveLength(0);
    expect(request('set_segment_speaker').args).toEqual({ meetingId: 'A', segmentIndex: 0, speakerId: 'unknown' });
    const saved = transcript('revision-2'); saved.segments[0].speaker = 'unknown';
    await resolve(request('set_segment_speaker'), saved);
    expect(state.transcript).toEqual(saved);
    expect(state.error).toBeNull();
  });

  test('ignores another meeting progress and waits for real result after completed event', async () => {
    await load(null);
    await act(async () => { void state.generate(); });
    await act(async () => { handlers.get('diarization-progress')!({ payload: { meetingId: 'B', stage: 'saving' } }); });
    expect(state.progress).toBe('正在准备录音…');
    await act(async () => { handlers.get('diarization-progress')!({ payload: { meetingId: 'A', stage: 'completed' } }); });
    expect(state.busy).toBe('diarizing'); expect(state.transcript).toBeNull();
    await resolve(request('diarize_meeting'), transcript());
    expect(state.busy).toBeNull(); expect(state.transcript?.updated_at).toBe('revision-1');
  });

  test('cancel rereads saved data and ignores a late successful run', async () => {
    await load();
    await act(async () => { void state.generate(); });
    const pendingRun = request('diarize_meeting');
    await act(async () => { void state.cancel(); });
    expect(state.isCancelling).toBe(true);
    await resolve(request('cancel_diarization'), null);
    await resolve(request('get_speaker_transcript', 'A', 1), transcript());
    await resolve(pendingRun, transcript('cancelled-late-result'));
    expect(state.transcript?.updated_at).toBe('revision-1');
    expect(state.busy).toBeNull(); expect(state.isCancelling).toBe(false);
    expect(state.progress).toBe('已停止自动分人。');
  });

  test('a failed cancel keeps tracking the run and settles a result received during cancellation', async () => {
    await load();
    await act(async () => { void state.generate(); });
    await act(async () => { void state.cancel(); });
    await resolve(request('diarize_meeting'), transcript('completed-during-cancel'));
    expect(state.isCancelling).toBe(true); expect(state.busy).toBe('diarizing');
    await reject(request('cancel_diarization'), new Error('cancel failed'));
    expect(state.transcript?.updated_at).toBe('completed-during-cancel');
    expect(state.busy).toBeNull(); expect(state.error).toContain('未能取消');
  });

  test('navigation cancels the old run, and A to B to A never revives stale A results', async () => {
    await load();
    await act(async () => { void state.generate(); });
    const stale = request('diarize_meeting');
    await show('B');
    expect(request('cancel_diarization').args.meetingId).toBe('A');
    await resolve(request('get_speaker_transcript', 'B'), null);
    await show('A');
    await resolve(request('get_speaker_transcript', 'A', 1), transcript('current-A'));
    await resolve(stale, transcript('stale-A'));
    expect(state.transcript?.updated_at).toBe('current-A');
    expect(state.error).toBeNull();
  });

  test('late initial reads and failures cannot replace the selected meeting', async () => {
    await show('A'); const stale = request('get_speaker_transcript');
    await load(transcript('B'), 'B');
    await reject(stale, '旧会议读取失败');
    expect(state.meetingId).toBe('B'); expect(state.transcript?.updated_at).toBe('B');
    expect(state.error).toBeNull(); expect(state.isLoading).toBe(false);
  });

  test('invalid generation output leaves the saved result and reports failure', async () => {
    await load();
    await act(async () => { void state.generate(); });
    await resolve(request('diarize_meeting'), { ...transcript('invalid'), segments: [{ start: 3, end: 1, speaker: 'speaker_0', text: 'bad' }] });
    expect(state.transcript?.updated_at).toBe('revision-1');
    expect(state.error).toContain('自动分人失败');
    await act(async () => { void state.generate(); });
    await resolve(request('diarize_meeting', 'A', 1), { ...transcript('empty'), segments: [] });
    expect(state.transcript?.updated_at).toBe('revision-1');
    expect(state.error).toContain('自动分人失败');
  });

  test('unmount releases listeners registered late and requests cancellation only for this meeting', async () => {
    deferSubscriptions = true;
    await load(null);
    await act(async () => { void state.generate(); });
    await act(async () => { renderer!.unmount(); }); renderer = undefined;
    expect(request('cancel_diarization').args).toEqual({ meetingId: 'A' });
    await act(async () => { subscriptionResolvers.forEach(resolve => resolve(unlisten)); });
    expect(unlisten).toHaveBeenCalledTimes(2);
    await resolve(request('diarize_meeting'), transcript('late-unmounted'));
    expect(requests.filter(r => r.command === 'get_speaker_transcript')).toHaveLength(1);
  });
});
