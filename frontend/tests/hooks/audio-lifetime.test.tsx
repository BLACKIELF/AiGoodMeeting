import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const originalCore = { ...await import('@tauri-apps/api/core') };
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalRaf = globalThis.requestAnimationFrame, originalCancel = globalThis.cancelAnimationFrame;
const reads: { path: string; resolve: (value: number[]) => void }[] = [];
const decodes: ((value: AudioBuffer) => void)[] = [];
const sources: { onended: (() => void) | null; stop: ReturnType<typeof mock>; disconnect: ReturnType<typeof mock>; connect: () => void; start: () => void; buffer: AudioBuffer | null }[] = [];
const invoke = mock((_command: string, args: { filePath: string }) => new Promise<number[]>(resolve => reads.push({ path: args.filePath, resolve })));
class FakeAudioContext {
  state = 'running'; currentTime = 0; destination = {};
  resume = async () => {}; close = async () => { this.state = 'closed'; };
  decodeAudioData(_bytes: ArrayBuffer, resolve: (value: AudioBuffer) => void) { decodes.push(resolve); }
  createBufferSource() {
    const source = { onended: null, stop: mock(() => {}), disconnect: mock(() => {}), connect() {}, start() {}, buffer: null };
    sources.push(source); return source;
  }
}
mock.module('@tauri-apps/api/core', () => ({ ...originalCore, invoke }));
const { useAudioPlayer } = await import('../../src/hooks/useAudioPlayer');
let state: ReturnType<typeof useAudioPlayer>, renderer: ReactTestRenderer | undefined;
function View({ path }: { path: string | null }) { state = useAudioPlayer(path); return null; }
beforeEach(() => {
  reads.length = 0; decodes.length = 0; sources.length = 0;
  mock.module('@tauri-apps/api/core', () => ({ ...originalCore, invoke }));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { AudioContext: FakeAudioContext } });
  globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount()); renderer = undefined;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
  globalThis.requestAnimationFrame = originalRaf; globalThis.cancelAnimationFrame = originalCancel;
});
afterAll(() => mock.module('@tauri-apps/api/core', () => originalCore));
async function show(path: string | null) { await act(async () => { if (renderer) renderer.update(<View path={path} />); else renderer = create(<View path={path} />); }); }
const buffer = (duration: number) => ({ duration } as AudioBuffer);
test('late decoding of A cannot overwrite the loaded audio for B', async () => {
  await show('A'); await act(async () => reads[0].resolve([1]));
  await show('B'); await act(async () => reads[1].resolve([2]));
  await act(async () => decodes[1](buffer(20))); expect(state.duration).toBe(20);
  await act(async () => decodes[0](buffer(10))); expect(state.duration).toBe(20);
  await show(null); expect(state.duration).toBe(0); expect(state.isPlaying).toBe(false);
});
test('pause detaches the previous ended callback before a new playback starts', async () => {
  await show('A'); await act(async () => reads[0].resolve([1]));
  await act(async () => decodes[0](buffer(20)));
  await act(async () => state.play()); expect(state.isPlaying).toBe(true);
  await act(async () => state.pause()); expect(sources[0].onended).toBeNull();
  await act(async () => state.play()); expect(state.isPlaying).toBe(true);
  expect(sources[0].stop).toHaveBeenCalledTimes(1);
  await act(async () => renderer!.unmount()); renderer = undefined;
  expect(sources[1].onended).toBeNull(); expect(sources[1].stop).toHaveBeenCalledTimes(1);
});
