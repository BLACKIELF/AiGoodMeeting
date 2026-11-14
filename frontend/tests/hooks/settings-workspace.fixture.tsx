import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import type { ModelConfig } from '../../src/components/ModelSettingsModal';
import type { TranscriptModelProps } from '../../src/components/TranscriptSettings';

const originalCore = { ...await import('@tauri-apps/api/core') };
const originalNavigation = { ...await import('next/navigation') };
const originalConfig = { ...await import('../../src/contexts/ConfigContext') };
const originalTranscript = { ...await import('../../src/components/TranscriptSettings') };
const originalRecording = { ...await import('../../src/components/RecordingSettings') };
const originalPreference = { ...await import('../../src/components/PreferenceSettings') };
const originalSummary = { ...await import('../../src/components/SummaryModelSettings') };
const originalBeta = { ...await import('../../src/components/BetaSettings') };
const originalFeishu = { ...await import('../../src/components/FeishuSettings') };
const originalAppearance = { ...await import('../../src/components/AppearanceSettings') };
const originalModel = { ...await import('../../src/components/ModelSettingsModal') };
const originalAbout = { ...await import('../../src/components/About') };

const savedTranscript: TranscriptModelProps = { provider: 'localWhisper', model: 'large-v3-turbo', apiKey: null };
const initialModel: ModelConfig = { provider: 'ollama', model: 'qwen3:8b', whisperModel: 'large-v3-turbo', apiKey: null, ollamaEndpoint: null };
const invoke = mock(async () => savedTranscript);
const back = mock(() => {});
const resetSaveSuccess = mock((_success: boolean | null) => {});
const saveModel = mock((_config: ModelConfig) => {});
let transcriptMounts = 0;
let summaryMounts = 0;
let observedTranscript: TranscriptModelProps;

const Config = createContext<{
  transcriptModelConfig: TranscriptModelProps;
  setTranscriptModelConfig: (config: TranscriptModelProps) => void;
} | null>(null);

function ConfigHarness({ children }: { children: ReactNode }) {
  const [transcriptModelConfig, setTranscriptModelConfig] = useState<TranscriptModelProps>({ provider: 'parakeet', model: 'saved-in-context' });
  return <Config.Provider value={{ transcriptModelConfig, setTranscriptModelConfig }}>{children}</Config.Provider>;
}

function TranscriptProbe(props: {
  transcriptModelConfig: TranscriptModelProps;
  setTranscriptModelConfig: (config: TranscriptModelProps) => void;
}) {
  observedTranscript = props.transcriptModelConfig;
  useEffect(() => { transcriptMounts += 1; }, []);
  return <button data-action="select-transcript" onClick={() => props.setTranscriptModelConfig({ ...props.transcriptModelConfig, model: 'small' })}>选择转写模型</button>;
}

function SummaryProbe() {
  const [draft, setDraft] = useState('');
  useEffect(() => { summaryMounts += 1; }, []);
  return <>
    <input aria-label="纪要模型草稿" value={draft} onChange={(event) => setDraft(event.target.value)} />
    <p role="alert">模型下载失败，请重试。</p>
    <button data-action="retry-model" onClick={() => setDraft('retry-requested')}>重试下载</button>
  </>;
}

function ModelProbe(props: {
  modelConfig: ModelConfig;
  setModelConfig: (config: ModelConfig | ((previous: ModelConfig) => ModelConfig)) => void;
  onSave: (config: ModelConfig) => void;
}) {
  return <>
    <input aria-label="纪要模型名称" value={props.modelConfig.model} onChange={(event) => props.setModelConfig(previous => ({ ...previous, model: event.target.value }))} />
    <button data-action="save-model" onClick={() => props.onSave(props.modelConfig)}>保存模型</button>
  </>;
}

function installMocks() {
  mock.module('@tauri-apps/api/core', () => ({ ...originalCore, invoke }));
  mock.module('next/navigation', () => ({ ...originalNavigation, useRouter: () => ({ back }) }));
  mock.module('../../src/contexts/ConfigContext', () => ({ ...originalConfig, useConfig: () => useContext(Config)! }));
  mock.module('../../src/components/TranscriptSettings', () => ({ ...originalTranscript, TranscriptSettings: TranscriptProbe }));
  mock.module('../../src/components/RecordingSettings', () => ({ ...originalRecording, RecordingSettings: () => <p>录音设置内容</p> }));
  mock.module('../../src/components/PreferenceSettings', () => ({ ...originalPreference, PreferenceSettings: () => <p>偏好设置内容</p> }));
  mock.module('../../src/components/SummaryModelSettings', () => ({ ...originalSummary, SummaryModelSettings: SummaryProbe }));
  mock.module('../../src/components/BetaSettings', () => ({ ...originalBeta, BetaSettings: () => <p>实验功能内容</p> }));
  mock.module('../../src/components/FeishuSettings', () => ({ ...originalFeishu, FeishuSettings: () => <p>飞书同步配置内容</p> }));
  mock.module('../../src/components/AppearanceSettings', () => ({ ...originalAppearance, default: () => <p>七套皮肤与明暗模式</p> }));
  mock.module('../../src/components/ModelSettingsModal', () => ({ ...originalModel, ModelSettingsModal: ModelProbe }));
  mock.module('../../src/components/About', () => ({ ...originalAbout, About: () => <p>版本与开源许可内容</p> }));
}
installMocks();

const { default: SettingsPage } = await import('../../src/app/settings/page');
const { SettingTabs } = await import('../../src/components/SettingTabs');
const { CardWorkspace } = await import('../../src/components/CardWorkspace');

afterAll(() => {
  mock.module('@tauri-apps/api/core', () => originalCore);
  mock.module('next/navigation', () => originalNavigation);
  mock.module('../../src/contexts/ConfigContext', () => originalConfig);
  mock.module('../../src/components/TranscriptSettings', () => originalTranscript);
  mock.module('../../src/components/RecordingSettings', () => originalRecording);
  mock.module('../../src/components/PreferenceSettings', () => originalPreference);
  mock.module('../../src/components/SummaryModelSettings', () => originalSummary);
  mock.module('../../src/components/BetaSettings', () => originalBeta);
  mock.module('../../src/components/FeishuSettings', () => originalFeishu);
  mock.module('../../src/components/AppearanceSettings', () => originalAppearance);
  mock.module('../../src/components/ModelSettingsModal', () => originalModel);
  mock.module('../../src/components/About', () => originalAbout);
});

let renderer: ReactTestRenderer | undefined;
const originalAnimationFrame = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
const originalCancelAnimationFrame = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame');
beforeEach(() => {
  installMocks();
  invoke.mockClear(); back.mockClear(); resetSaveSuccess.mockClear(); saveModel.mockClear();
  transcriptMounts = 0; summaryMounts = 0;
  // The renderer has no browser frame scheduler; these tests exercise state, not animation timing.
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: () => 0 });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: () => {} });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  if (originalAnimationFrame) Object.defineProperty(globalThis, 'requestAnimationFrame', originalAnimationFrame);
  else Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
  if (originalCancelAnimationFrame) Object.defineProperty(globalThis, 'cancelAnimationFrame', originalCancelAnimationFrame);
  else Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
});

function text(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map(text).join('');
}

async function selectCard(title: string) {
  const button = renderer!.root.findAllByType('button').find(node => text(node).startsWith(title));
  expect(button).toBeDefined();
  await act(async () => { button!.props.onClick(); });
}

describe('settings card workspace integration', () => {
  test('keeps all six settings, saved model changes, visited drafts and error recovery when switching cards', async () => {
    await act(async () => { renderer = create(<ConfigHarness><SettingsPage /></ConfigHarness>); });
    const workspace = renderer!.root.findByType(CardWorkspace);
    expect(workspace.props.cards).toHaveLength(7);
    expect(workspace.props.value).toBe('appearance');
    expect(invoke).toHaveBeenCalledWith('api_get_transcript_config');

    await selectCard('转写模型');
    expect(observedTranscript).toEqual(savedTranscript);
    await act(async () => { renderer!.root.findByProps({ 'data-action': 'select-transcript' }).props.onClick(); });
    expect(observedTranscript.model).toBe('small');
    const transcriptVisits = transcriptMounts;

    await selectCard('纪要模型');
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '纪要模型草稿' }).props.onChange({ target: { value: '未保存的模型设置' } }); });
    const summaryVisits = summaryMounts;
    await selectCard('录音');
    await selectCard('纪要模型');
    expect(renderer!.root.findByProps({ 'aria-label': '纪要模型草稿' }).props.value).toBe('未保存的模型设置');
    expect(summaryMounts).toBe(summaryVisits);
    expect(renderer!.root.findByProps({ role: 'alert' }).children).toContain('模型下载失败，请重试。');
    await act(async () => { renderer!.root.findByProps({ 'data-action': 'retry-model' }).props.onClick(); });
    expect(renderer!.root.findByProps({ 'aria-label': '纪要模型草稿' }).props.value).toBe('retry-requested');

    await selectCard('转写模型');
    expect(observedTranscript.model).toBe('small');
    expect(transcriptMounts).toBe(transcriptVisits);
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '返回上一页' }).props.onClick(); });
    expect(back).toHaveBeenCalledTimes(1);
  });

  test('legacy settings preserve controlled model values and save callbacks, resetting save status only on a changed card', async () => {
    function LegacyHarness() {
      const [modelConfig, setModelConfig] = useState(initialModel);
      return <SettingTabs modelConfig={modelConfig} setModelConfig={setModelConfig} onSave={saveModel}
        transcriptModelConfig={savedTranscript} setTranscriptModelConfig={() => {}} onSaveTranscript={() => {}}
        setSaveSuccess={resetSaveSuccess} defaultTab="modelSettings" />;
    }
    await act(async () => { renderer = create(<LegacyHarness />); });
    expect(renderer!.root.findByType(CardWorkspace).props.cards).toHaveLength(4);
    expect(renderer!.root.findByProps({ 'aria-label': '纪要模型名称' }).props.value).toBe('qwen3:8b');
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '纪要模型名称' }).props.onChange({ target: { value: 'qwen3:custom' } }); });
    await selectCard('录音偏好');
    expect(resetSaveSuccess).toHaveBeenCalledWith(null);
    await selectCard('会议纪要');
    expect(renderer!.root.findByProps({ 'aria-label': '纪要模型名称' }).props.value).toBe('qwen3:custom');
    const changes = resetSaveSuccess.mock.calls.length;
    // Clicking the already-expanded card collapses it in-place without triggering card-switch resets
    await selectCard('会议纪要');
    expect(resetSaveSuccess.mock.calls.length).toBe(changes);
    // Re-opening the collapsed card in-place preserves the unsubmitted draft input
    await selectCard('会议纪要');
    expect(renderer!.root.findByProps({ 'aria-label': '纪要模型名称' }).props.value).toBe('qwen3:custom');
    await act(async () => { renderer!.root.findByProps({ 'data-action': 'save-model' }).props.onClick(); });
    expect(saveModel).toHaveBeenCalledWith({ ...initialModel, model: 'qwen3:custom' });
  });
});
