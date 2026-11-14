import { afterEach, beforeEach, expect, test } from 'bun:test';
import { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { FileText } from 'lucide-react';
import { motion } from 'framer-motion';
import { CardWorkspace } from '../../src/components/CardWorkspace';

let renderer: ReactTestRenderer | undefined;
const originals = ['window', 'requestAnimationFrame', 'cancelAnimationFrame'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
let change: (() => void) | undefined;
let reduced = false;
let removed = false;
beforeEach(() => {
  reduced = false; removed = false; change = undefined;
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: () => 0 });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: () => {} });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { matchMedia: () => ({
    get matches() { return reduced; },
    addEventListener: (_type: string, listener: () => void) => { change = listener; },
    removeEventListener: (_type: string, listener: () => void) => { removed = listener === change; },
  }) } });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

function Harness() {
  const [selected, select] = useState('one');
  return <CardWorkspace id="card-test" value={selected} onValueChange={select} cards={[
    { id: 'one', title: '第一张', icon: FileText, content: <input aria-label="第一张内容" defaultValue="草稿一" /> },
    { id: 'two', title: '第二张', icon: FileText, content: <input aria-label="第二张内容" defaultValue="草稿二" /> },
  ]} />;
}

test('native buttons control expandable panels in place with aria-expanded and controls', async () => {
  await act(async () => { renderer = create(<Harness />); });
  const triggers = () => renderer!.root.findAllByType('button').filter(node => typeof node.props['aria-expanded'] === 'boolean');
  const panels = () => renderer!.root.findAllByType('div').filter(node => node.props.role === 'region' && node.props['aria-labelledby']);
  const motionPanels = () => renderer!.root.findAllByType(motion.div);

  expect(triggers()).toHaveLength(2);
  expect(panels()).toHaveLength(2);
  expect(motionPanels()).toHaveLength(2);

  // Initially card 'one' is expanded, card 'two' is collapsed as a horizontal spine
  const cards = () => renderer!.root.findAllByType('div').filter(node => node.props['data-card-id']);
  expect(cards()[0].props['data-expanded']).toBe(true);
  expect(cards()[0].props['data-spine']).toBe(false);
  expect(cards()[1].props['data-expanded']).toBe(false);
  expect(cards()[1].props['data-spine']).toBe(true);

  expect(triggers()[0].props['aria-expanded']).toBe(true);
  expect(triggers()[0].props['aria-controls']).toBe(panels()[0].props.id);
  expect(panels()[0].props.hidden).toBe(false);
  expect(panels()[0].props['aria-hidden']).toBe(false);
  expect(panels()[0].props.style.display).toBe('block');

  expect(triggers()[1].props['aria-expanded']).toBe(false);
  expect(triggers()[1].props['aria-controls']).toBe(panels()[1].props.id);
  expect(panels()[1].props.hidden).toBe(true);
  expect(panels()[1].props.inert).toBe('');
  expect(panels()[1].props['aria-hidden']).toBe(true);
  expect(panels()[1].props.style.display).toBe('none');

  // Switch to card 'two'
  await act(async () => { triggers()[1].props.onClick(); });
  expect(triggers()[0].props['aria-expanded']).toBe(false);
  expect(triggers()[1].props['aria-expanded']).toBe(true);

  // During collapse animation, inert and aria-hidden take effect immediately to block focus/screen-readers,
  // while hidden remains false and display remains block to avoid height flash
  expect(panels()[0].props['aria-hidden']).toBe(true);
  expect(panels()[0].props.inert).toBe('');
  expect(panels()[0].props.hidden).toBe(false);
  expect(panels()[0].props.style.display).toBe('block');

  expect(panels()[1].props.hidden).toBe(false);
  expect(panels()[1].props['aria-hidden']).toBe(false);
  expect(panels()[1].props.style.display).toBe('block');

  // When collapse animation completes, hidden becomes true and display becomes none
  await act(async () => { motionPanels()[0].props.onAnimationComplete(); });
  expect(panels()[0].props.hidden).toBe(true);
  expect(panels()[0].props.style.display).toBe('none');

  // Both draft inputs remain mounted to preserve user state
  expect(renderer!.root.findAllByProps({ 'aria-label': '第一张内容' })).toHaveLength(1);
  expect(renderer!.root.findAllByProps({ 'aria-label': '第二张内容' })).toHaveLength(1);

  // Clicking the currently expanded card collapses it in-place
  await act(async () => { triggers()[1].props.onClick(); });
  expect(triggers()[0].props['aria-expanded']).toBe(false);
  expect(triggers()[1].props['aria-expanded']).toBe(false);
  expect(panels()[1].props['aria-hidden']).toBe(true);
  expect(panels()[1].props.inert).toBe('');

  await act(async () => { motionPanels()[1].props.onAnimationComplete(); });
  expect(panels()[0].props.hidden).toBe(true);
  expect(panels()[1].props.hidden).toBe(true);
});

test('rapid switching redirects cleanly and preserves unmounted-safe draft state', async () => {
  await act(async () => { renderer = create(<Harness />); });
  const triggers = () => renderer!.root.findAllByType('button').filter(node => typeof node.props['aria-expanded'] === 'boolean');
  const panels = () => renderer!.root.findAllByType('div').filter(node => node.props.role === 'region' && node.props['aria-labelledby']);
  const motionPanels = () => renderer!.root.findAllByType(motion.div);

  // Rapidly toggle back and forth
  await act(async () => {
    triggers()[1].props.onClick();
    triggers()[0].props.onClick();
    triggers()[1].props.onClick();
  });

  // Exactly the final destination (card two) is expanded
  expect(triggers()[1].props['aria-expanded']).toBe(true);
  expect(panels()[1].props.hidden).toBe(false);
  expect(panels()[1].props['aria-hidden']).toBe(false);

  expect(triggers()[0].props['aria-expanded']).toBe(false);
  expect(panels()[0].props['aria-hidden']).toBe(true);
  expect(panels()[0].props.inert).toBe('');

  await act(async () => { motionPanels()[0].props.onAnimationComplete(); });
  expect(panels()[0].props.hidden).toBe(true);
  expect(panels()[0].props.style.display).toBe('none');
});

test('keyboard navigation removes movement and changing reduced-motion preference is observed and cleaned up', async () => {
  await act(async () => { renderer = create(<Harness />); });
  const root = () => renderer!.root.findAllByType('div').find(node => node.props['data-motion'])!;
  await act(async () => { root().props.onKeyDownCapture(); });
  expect(renderer!.root.findAllByType(motion.div).every(node => node.props.transition.duration === 0)).toBe(true);
  await act(async () => { root().props.onPointerDownCapture(); reduced = true; change!(); });
  const panels = renderer!.root.findAllByType(motion.div);
  expect(panels.every(node => node.props.animate.transform === 'translateY(0px)')).toBe(true);
  expect(panels.every(node => node.props.transition.duration <= 0.1)).toBe(true);
  await act(async () => { renderer!.unmount(); }); renderer = undefined;
  expect(removed).toBe(true);
});
