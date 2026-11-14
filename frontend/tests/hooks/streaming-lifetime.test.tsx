import { afterEach, expect, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useTranscriptStreaming } from '../../src/hooks/useTranscriptStreaming';
import type { TranscriptSegmentData } from '../../src/types';
let state: ReturnType<typeof useTranscriptStreaming>, renderer: ReactTestRenderer | undefined;
const originalSet = globalThis.setInterval, originalClear = globalThis.clearInterval;
const timers = new Map<number, () => void>();
let counter = 0;
function View({ text }: { text: string }) {
  state = useTranscriptStreaming([{ id: 'segment', text, timestamp: 0 }], true, true); return null;
}
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount()); renderer = undefined;
  globalThis.setInterval = originalSet; globalThis.clearInterval = originalClear; timers.clear();
});
test('array replacement does not freeze streaming and text revisions start a fresh interval', async () => {
  globalThis.setInterval = ((callback: () => void) => { const id = ++counter; timers.set(id, callback); return id; }) as typeof setInterval;
  globalThis.clearInterval = ((id: number) => timers.delete(id)) as typeof clearInterval;
  const first = 'first transcript with enough characters to animate';
  await act(async () => { renderer = create(<View text={first} />); });
  await act(async () => renderer!.update(<View text={first} />));
  expect(timers.size).toBe(1);
  await act(async () => { for (let i = 0; i < 100; i++) [...timers.values()].forEach(tick => tick()); });
  expect(state.getDisplayText({ id: 'segment', text: first } as TranscriptSegmentData)).toBe(first);
  const revised = 'revised transcript with different content';
  await act(async () => renderer!.update(<View text={revised} />)); expect(timers.size).toBe(1);
  await act(async () => { for (let i = 0; i < 100; i++) [...timers.values()].forEach(tick => tick()); });
  expect(state.getDisplayText({ id: 'segment', text: revised } as TranscriptSegmentData)).toBe(revised);
  expect(timers.size).toBe(0);
});
