import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { useEffect, useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const originalImport = { ...await import('../../src/contexts/ImportDialogContext') };
const openImportDialog = mock(() => {});
mock.module('../../src/contexts/ImportDialogContext', () => ({
  ...originalImport, useImportDialog: () => ({ openImportDialog }),
}));
const { CardWorkspace } = await import('../../src/components/CardWorkspace');
const { WorkbenchCards } = await import('../../src/components/WorkbenchCards');
afterAll(() => { mock.module('../../src/contexts/ImportDialogContext', () => originalImport); });

let renderer: ReactTestRenderer | undefined;
const originalFrame = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
const originalCancelFrame = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame');
let controlsMounted = 0, controlsUnmounted = 0, transcriptMounted = 0;
const stop = mock(() => {});
function RecordingControl() {
  useEffect(() => { controlsMounted += 1; return () => { controlsUnmounted += 1; }; }, []);
  return <button aria-label="停止并保存录音" onClick={stop}>停止并保存录音</button>;
}
function Transcript() {
  const [text, setText] = useState('');
  useEffect(() => { transcriptMounted += 1; }, []);
  return <input aria-label="转写定位" value={text} onChange={event => setText(event.target.value)} />;
}
beforeEach(() => {
  controlsMounted = 0; controlsUnmounted = 0; transcriptMounted = 0;
  stop.mockClear(); openImportDialog.mockClear();
  mock.module('../../src/contexts/ImportDialogContext', () => ({
    ...originalImport, useImportDialog: () => ({ openImportDialog }),
  }));
  // Radix schedules a mount animation flag even without browser host nodes.
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: () => 1 });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: () => {} });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount()); renderer = undefined;
  if (originalFrame) Object.defineProperty(globalThis, 'requestAnimationFrame', originalFrame);
  else Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
  if (originalCancelFrame) Object.defineProperty(globalThis, 'cancelAnimationFrame', originalCancelFrame);
  else Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
});
async function show(canImport = true) {
  await act(async () => {
    const content = <WorkbenchCards meetingTitle="现有会议" transcriptCount={2} isRecording isPaused={false}
      recordingStatus="正在录音" canImport={canImport} transcript={<Transcript />}
      recordingControls={<RecordingControl />} />;
    if (renderer) renderer.update(content); else renderer = create(content);
  });
}
async function select(id: string) {
  await act(async () => { renderer!.root.findByType(CardWorkspace).props.onValueChange(id); });
}

describe('workbench recording continuity', () => {
  test('opens recording by default and keeps one accessible stop control across card changes', async () => {
    await show();
    expect(renderer!.root.findByType(CardWorkspace).props.value).toBe('recording');
    for (const id of ['transcript', 'import', 'recording']) {
      await select(id);
      const button = renderer!.root.findByProps({ 'aria-label': '停止并保存录音' });
      let node = button.parent;
      while (node) { expect(node.props.hidden).not.toBe(true); expect(node.props['aria-hidden']).not.toBe(true); node = node.parent; }
      await act(async () => { button.props.onClick(); });
    }
    expect(stop).toHaveBeenCalledTimes(3);
    expect(controlsMounted).toBe(1); expect(controlsUnmounted).toBe(0);
  });

  test('retains the opened transcript state while switching to import and back', async () => {
    await show(); await select('transcript');
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '转写定位' }).props.onChange({ target: { value: '已定位的发言' } }); });
    await select('import'); await select('transcript');
    expect(renderer!.root.findByProps({ 'aria-label': '转写定位' }).props.value).toBe('已定位的发言');
    expect(transcriptMounted).toBe(1);
  });

  test('uses the existing import entry only on selection and preserves its feature gate', async () => {
    await show(false); await select('import');
    const choose = () => renderer!.root.findAllByType('button').find(button => button.children.includes('选择录音文件'))!;
    expect(openImportDialog).not.toHaveBeenCalled(); expect(choose().props.disabled).toBe(true);
    await show(true);
    expect(renderer!.root.findByType(CardWorkspace).props.value).toBe('import');
    await act(async () => { choose().props.onClick(); });
    expect(openImportDialog).toHaveBeenCalledTimes(1);
    expect(openImportDialog).toHaveBeenCalledWith();
    expect(controlsMounted).toBe(1);
  });
});
