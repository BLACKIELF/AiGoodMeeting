import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { ReactNode } from 'react';
import type { SpeakerTranscriptController } from '../../src/hooks/meeting-details/useSpeakerTranscript';
import type { SpeakerTranscript } from '../../src/types/speakers';

const originalConfig = { ...await import('../../src/contexts/ConfigContext') };
const originalTooltip = { ...await import('../../src/components/ui/tooltip') };
const tooltipWrappers = {
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  TooltipContent: ({ children }: { children: ReactNode }) => <span>{children}</span>,
};
mock.module('../../src/contexts/ConfigContext', () => ({ useConfig: () => ({ betaFeatures: { importAndRetranscribe: false } }) }));
// Radix tooltips require a browser document; their behavior is outside this interaction test.
mock.module('../../src/components/ui/tooltip', () => tooltipWrappers);
const { TranscriptPanel } = await import('../../src/components/MeetingDetails/TranscriptPanel');
const { TranscriptButtonGroup } = await import('../../src/components/MeetingDetails/TranscriptButtonGroup');
const { TooltipProvider } = await import('../../src/components/ui/tooltip');
afterAll(() => {
  mock.module('../../src/contexts/ConfigContext', () => originalConfig);
  mock.module('../../src/components/ui/tooltip', () => originalTooltip);
});

let renderer: ReactTestRenderer | undefined;
let controller: SpeakerTranscriptController;
const transcript: SpeakerTranscript = {
  schema_version: 1, model: 'local-test', updated_at: 'revision-1',
  speakers: ['speaker_0', 'speaker_1'], names: {}, warnings: [],
  segments: [
    { start: 2, end: 4, speaker: 'speaker_0', text: 'Um, preserve this word.' },
    { start: 4, end: 6, speaker: 'speaker_1', text: 'Another person.' },
  ],
};
beforeEach(() => {
  controller = {
    meetingId: 'A', transcript, isLoading: false, busy: null, isCancelling: false, progress: null, error: null,
    refresh: mock(async () => {}), generate: mock(async () => true), cancel: mock(async () => {}),
    rename: mock(async () => true), merge: mock(async () => true), assign: mock(async () => true),
  };
  mock.module('../../src/contexts/ConfigContext', () => ({ useConfig: () => ({ betaFeatures: { importAndRetranscribe: false } }) }));
  mock.module('../../src/components/ui/tooltip', () => tooltipWrappers);
});
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; });
async function show() {
  await act(async () => {
    const view = <TooltipProvider><TranscriptPanel
      meetingId="A" transcripts={[{ id: 'original-1', timestamp: '00:02', text: 'Original transcription.' }]}
      customPrompt="" onPromptChange={() => {}} onCopyTranscript={() => {}} onOpenMeetingFolder={async () => {}}
      isRecording={false} disableAutoScroll speakers={controller}
    /></TooltipProvider>;
    if (renderer) renderer.update(view); else renderer = create(view);
  });
}
const button = (label: string) => renderer!.root.findAllByType('button').find(node => node.children.includes(label))!;
const content = () => JSON.stringify(renderer!.toJSON());

describe('meeting speaker correction controls', () => {
  test('keeps the original transcript accessible and sends manual segment corrections', async () => {
    await show();
    expect(content()).toContain('Um, preserve this word.');
    expect(content()).not.toContain('Original transcription.');
    await act(async () => { button('原始转写').props.onClick(); });
    expect(content()).toContain('Original transcription.');
    expect(content()).not.toContain('Um, preserve this word.');
    await act(async () => { button('按说话人').props.onClick(); });
    const assignment = renderer!.root.findByProps({ 'aria-label': '第 1 段的说话人' });
    await act(async () => { assignment.props.onChange({ target: { value: 'unknown' } }); });
    expect(controller.assign).toHaveBeenCalledWith(0, 'unknown');
    // Saved backend state is authoritative; a pending command does not relabel a segment.
    expect(renderer!.root.findByProps({ 'aria-label': '第 1 段的说话人' }).props.value).toBe('speaker_0');
  });

  test('keeps uncommon actions secondary and shows a freshly generated speaker result automatically', async () => {
    await show();
    const copy = renderer!.root.findByProps({ 'aria-label': '复制转写' });
    expect(copy.findAllByType('details')).toHaveLength(0);
    const recording = renderer!.root.findByProps({ 'aria-label': '打开录音文件夹' });
    let parent = recording.parent;
    while (parent && parent.type !== 'details') parent = parent.parent;
    expect(parent?.type).toBe('details');
    const assignment = renderer!.root.findByProps({ 'aria-label': '第 1 段的说话人' });
    parent = assignment.parent;
    while (parent && parent.type !== 'details') parent = parent.parent;
    expect(parent?.type).toBe('details');
    await act(async () => { button('原始转写').props.onClick(); });
    expect(content()).toContain('Original transcription.');
    await act(async () => { await button('自动分人').props.onClick(); });
    expect(content()).toContain('Um, preserve this word.');
    expect(content()).not.toContain('Original transcription.');
  });

  test('submits names and merge direction, retaining selections when persistence fails', async () => {
    controller.merge = mock(async () => false);
    await show();
    const input = renderer!.root.findByProps({ id: 'speaker-name-speaker_0' });
    await act(async () => { input.props.onChange({ target: { value: '小李' } }); });
    await act(async () => { renderer!.root.findAllByType('form')[0].props.onSubmit({ preventDefault() {} }); });
    expect(controller.rename).toHaveBeenCalledWith('speaker_0', '小李');
    await act(async () => { renderer!.root.findByProps({ id: 'merge-speaker-source' }).props.onChange({ target: { value: 'speaker_0' } }); });
    await act(async () => { renderer!.root.findByProps({ id: 'merge-speaker-target' }).props.onChange({ target: { value: 'speaker_1' } }); });
    await act(async () => { await button('合并').props.onClick(); });
    expect(controller.merge).toHaveBeenCalledWith('speaker_0', 'speaker_1');
    expect(renderer!.root.findByProps({ id: 'merge-speaker-source' }).props.value).toBe('speaker_0');
  });

  test('shows stage, cancellation and backend setup failures without claiming success', async () => {
    controller = { ...controller, busy: 'diarizing', progress: '正在识别说话人…' };
    await show();
    expect(button('自动分人').props.disabled).toBe(true);
    expect(content()).toContain('正在识别说话人…');
    await act(async () => { button('取消').props.onClick(); });
    expect(controller.cancel).toHaveBeenCalledTimes(1);
    controller = { ...controller, transcript: null, busy: null, progress: null, error: '本地说话人模型尚未配置，暂时无法自动区分。' };
    await show();
    expect(renderer!.root.findByProps({ role: 'alert' }).children[0]).toBeDefined();
    expect(content()).toContain('模型尚未配置');
    expect(renderer!.root.findAllByProps({ 'aria-label': '第 1 段的说话人' })).toHaveLength(0);
  });

  test('explains an updated original transcript and clears the notice only after fresh automatic separation', async () => {
    await show();
    await act(async () => { await renderer!.root.findByType(TranscriptButtonGroup).props.onRefetchTranscripts(); });
    expect(content()).toContain('原始转写已更新');
    controller = { ...controller, transcript: { ...transcript, updated_at: 'renamed', names: { speaker_0: '小李' } } };
    await show();
    expect(content()).toContain('原始转写已更新');
    await act(async () => { await button('自动分人').props.onClick(); });
    expect(content()).not.toContain('原始转写已更新');
  });
});
