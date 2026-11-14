import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import CardPreviewPage from '../fixtures/CardPreview';
import { CardWorkspace } from '../../src/components/CardWorkspace';
import { SidebarMeetingCard } from '../../src/components/Sidebar';

let renderer: ReactTestRenderer | undefined;
const originalGlobals = ['window', 'requestAnimationFrame', 'cancelAnimationFrame'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
beforeEach(() => {
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (cb: any) => 1 });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: () => {} });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    },
  });
});

afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

describe('CardPreview interactive fixture acceptance', () => {
  test('workbench cards in-place toggle: collapse on re-click, re-expand, and switch with natural shift', async () => {
    await act(async () => { renderer = create(<CardPreviewPage />); });

    // Find workbench workspace
    const workspaces = renderer!.root.findAllByType(CardWorkspace);
    const workbench = workspaces.find(w => w.props.id === 'preview-workbench')!;
    expect(workbench).toBeDefined();
    expect(workbench.props.value).toBe('recording');

    // Find all triggers for workbench
    const getTriggers = () => renderer!.root
      .findAllByProps({ id: 'preview-workbench' })[0]
      .findAllByType('button')
      .filter(b => typeof b.props['aria-expanded'] === 'boolean');

    const triggers = getTriggers();
    expect(triggers).toHaveLength(3);

    // Initial: "录音" is expanded
    expect(triggers[0].props['aria-expanded']).toBe(true);
    expect(triggers[1].props['aria-expanded']).toBe(false);

    // 1. Re-clicking "录音" card collapses it in-place
    await act(async () => { triggers[0].props.onClick(); });
    expect(getTriggers()[0].props['aria-expanded']).toBe(false);
    expect(getTriggers()[1].props['aria-expanded']).toBe(false);

    // 2. Clicking "录音" again re-expands it in-place
    await act(async () => { getTriggers()[0].props.onClick(); });
    expect(getTriggers()[0].props['aria-expanded']).toBe(true);

    // 3. Clicking "实时文字" switches to transcript and collapses recording (single expanded item)
    await act(async () => { getTriggers()[1].props.onClick(); });
    expect(getTriggers()[0].props['aria-expanded']).toBe(false);
    expect(getTriggers()[1].props['aria-expanded']).toBe(true);
    expect(getTriggers()[2].props['aria-expanded']).toBe(false);
  });

  test('sidebar meeting card in-place toggle: collapse on re-click and retain sole expanded item on switch', async () => {
    await act(async () => { renderer = create(<CardPreviewPage />); });

    const meetingCards = renderer!.root.findAllByType(SidebarMeetingCard);
    expect(meetingCards).toHaveLength(3);

    // Meeting 1 is selected initially
    expect(meetingCards[0].props.isActive).toBe(true);
    const getMeetingBtn = (idx: number) => meetingCards[idx].findAllByType('button')[0];
    const getTools = (idx: number) => meetingCards[idx].findByProps({ className: 'agb-meeting-card-tools' });

    expect(getMeetingBtn(0).props['aria-expanded']).toBe(true);
    expect(getTools(0).props['data-open']).toBe(true);

    // 1. Re-clicking selected meeting 1 collapses its tools in-place while keeping route active
    await act(async () => { getMeetingBtn(0).props.onClick(); });
    expect(getMeetingBtn(0).props['aria-expanded']).toBe(false);
    expect(getTools(0).props['data-open']).toBe(false);

    // 2. Re-clicking meeting 1 again re-expands tools in-place
    await act(async () => { getMeetingBtn(0).props.onClick(); });
    expect(getMeetingBtn(0).props['aria-expanded']).toBe(true);
    expect(getTools(0).props['data-open']).toBe(true);

    // 3. Switching to meeting 2 collapses meeting 1 and opens meeting 2
    await act(async () => { getMeetingBtn(1).props.onClick(); });
    expect(getMeetingBtn(1).props['aria-expanded']).toBe(true);
    expect(getTools(1).props['data-open']).toBe(true);
    expect(getMeetingBtn(0).props['aria-expanded']).toBe(false);
    expect(getTools(0).props['data-open']).toBe(false);
  });

  test('settings card workspace preserves draft inputs across collapse and re-expansion', async () => {
    await act(async () => { renderer = create(<CardPreviewPage />); });

    const settingsWorkspace = renderer!.root
      .findAllByType(CardWorkspace)
      .find(w => w.props.id === 'preview-settings')!;
    expect(settingsWorkspace).toBeDefined();

    // Switch to 'models' card
    const modelTrigger = renderer!.root
      .findAllByProps({ id: 'preview-settings' })[0]
      .findAllByType('button')
      .find(b => b.findAllByType('span').some(s => s.children.includes('纪要模型配置')))!;

    await act(async () => { modelTrigger.props.onClick(); });

    // Modify draft value
    const input = renderer!.root.findByProps({ value: 'qwen-plus-preview' });
    await act(async () => { input.props.onChange({ target: { value: 'custom-model-draft-123' } }); });

    // Collapse 'models' card in-place
    await act(async () => { modelTrigger.props.onClick(); });

    // Re-expand 'models' card in-place
    await act(async () => { modelTrigger.props.onClick(); });

    // Draft is strictly preserved without reset
    const inputAfter = renderer!.root.findByProps({ value: 'custom-model-draft-123' });
    expect(inputAfter).toBeDefined();
  });
});
