import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const originalCore = { ...await import('@tauri-apps/api/core') };
const originalEvent = { ...await import('@tauri-apps/api/event') };
const originalAnalytics = { ...await import('../../src/lib/analytics') };
const originalPreferences = { ...await import('../../src/lib/summary-language-preferences') };
function deferred() {
  let resolve!: (value: any) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const listeners: { name: string; callback: (event: any) => void; registration: ReturnType<typeof deferred>; release: ReturnType<typeof mock> }[] = [];
const requests: ReturnType<typeof deferred>[] = [];
const listen = mock((name: string, callback: (event: any) => void) => {
  const registration = deferred(), release = mock(() => {});
  listeners.push({ name, callback, registration, release }); return registration.promise;
});
const invoke = mock(() => { const request = deferred(); requests.push(request); return request.promise; });
const track = mock(async () => {});
function installMocks() {
  mock.module('@tauri-apps/api/core', () => ({ ...originalCore, invoke }));
  mock.module('@tauri-apps/api/event', () => ({ ...originalEvent, listen }));
  mock.module('../../src/lib/analytics', () => ({ ...originalAnalytics, default: { ...originalAnalytics.default, track, trackError: track } }));
  mock.module('../../src/lib/summary-language-preferences', () => ({ ...originalPreferences, applyPinnedSummaryLanguageToMeeting: async () => true }));
}
installMocks();
const { useModalState } = await import('../../src/hooks/useModalState');
const { useImportAudio } = await import('../../src/hooks/useImportAudio');
const { useTranscriptionModels } = await import('../../src/hooks/useTranscriptionModels');
let renderer: ReactTestRenderer | undefined;
let importState: ReturnType<typeof useImportAudio>;
let modelState: ReturnType<typeof useTranscriptionModels>;
const completed = mock(() => {});
function ModalView() { useModalState(); return null; }
function ImportView() { importState = useImportAudio({ onComplete: completed }); return null; }
function ModelView() { modelState = useTranscriptionModels(undefined); return null; }
beforeEach(() => { listeners.length = 0; requests.length = 0; completed.mockClear(); track.mockReset(); track.mockImplementation(async () => {}); installMocks(); });
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; });
afterAll(() => {
  mock.module('@tauri-apps/api/core', () => originalCore);
  mock.module('@tauri-apps/api/event', () => originalEvent);
  mock.module('../../src/lib/analytics', () => originalAnalytics);
  mock.module('../../src/lib/summary-language-preferences', () => originalPreferences);
});
async function mount(view: React.ReactElement) { await act(async () => { renderer = create(view); }); }
async function registerAll() {
  for (let index = 0; index < listeners.length; index++) await act(async () => listeners[index].registration.resolve(listeners[index].release));
}
const result = { meeting_id: 'imported', title: '会议', segments_count: 3, duration_seconds: 10 };
describe('hook async lifetime cleanup', () => {
  test('modal listeners resolving after unmount are all released', async () => {
    await mount(<ModalView />); expect(listeners).toHaveLength(3);
    await act(async () => renderer!.unmount()); renderer = undefined;
    await registerAll(); listeners.forEach(listener => expect(listener.release).toHaveBeenCalledTimes(1));
  });
  test('failed modal registrations are handled', async () => {
    await mount(<ModalView />);
    await act(async () => listeners.forEach(listener => listener.registration.reject(new Error('unavailable'))));
    expect(listeners).toHaveLength(3);
  });
  test('failed import setup releases earlier subscriptions', async () => {
    await mount(<ImportView />);
    await act(async () => listeners[0].registration.resolve(listeners[0].release));
    await act(async () => listeners[1].registration.reject(new Error('listen failed')));
    expect(listeners[0].release).toHaveBeenCalledTimes(1);
  });
  test('telemetry rejection cannot prevent import completion', async () => {
    track.mockImplementation(async () => { throw new Error('telemetry offline'); });
    await mount(<ImportView />); await registerAll();
    await act(async () => listeners.find(item => item.name === 'import-complete')!.callback({ payload: result }));
    expect(importState.status).toBe('complete'); expect(completed).toHaveBeenCalledWith(result);
  });
  test('completion suspended in telemetry cannot update a reset import', async () => {
    const pending = deferred(); track.mockImplementation(() => pending.promise);
    await mount(<ImportView />); await registerAll();
    await act(async () => listeners.find(item => item.name === 'import-complete')!.callback({ payload: result }));
    await act(async () => importState.reset()); await act(async () => pending.resolve(undefined));
    expect(importState.status).toBe('idle'); expect(completed).not.toHaveBeenCalled();
  });
  test('completion events arriving after reset are ignored until another import starts', async () => {
    await mount(<ImportView />); await registerAll();
    await act(async () => importState.reset());
    await act(async () => listeners.find(item => item.name === 'import-complete')!.callback({ payload: result }));
    expect(importState.status).toBe('idle'); expect(completed).not.toHaveBeenCalled();
  });
  test('older validation cannot overwrite the latest file', async () => {
    await mount(<ImportView />); let first!: Promise<unknown>, second!: Promise<unknown>;
    await act(async () => { first = importState.validateFile('old'); second = importState.validateFile('new'); });
    const file = { path: 'new', filename: 'new.wav', duration_seconds: 5, size_bytes: 10, format: 'wav' };
    await act(async () => { requests[1].resolve(file); await second; });
    await act(async () => { requests[0].resolve({ ...file, path: 'old' }); await first; });
    expect(importState.fileInfo?.path).toBe('new');
  });
  test('older model fetch cannot overwrite newer results', async () => {
    await mount(<ModelView />); let first!: Promise<void>, second!: Promise<void>;
    await act(async () => { first = modelState.fetchModels(); second = modelState.fetchModels(); });
    await act(async () => requests[1].resolve([{ name: 'new', status: 'Available', size_mb: 1 }]));
    await act(async () => { requests[2].resolve([]); await second; });
    await act(async () => requests[0].resolve([{ name: 'old', status: 'Available', size_mb: 1 }]));
    await act(async () => { requests[3].resolve([]); await first; });
    expect(modelState.availableModels.map(item => item.name)).toEqual(['new']);
    expect(modelState.selectedModelKey).toBe('whisper:new');
  });
});
