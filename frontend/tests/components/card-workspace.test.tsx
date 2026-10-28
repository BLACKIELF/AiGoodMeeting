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
    { id: 'one', title: '第一张', icon: FileText, content: <input aria-label="第一张内容" /> },
    { id: 'two', title: '第二张', icon: FileText, content: <input aria-label="第二张内容" /> },
  ]} />;
}

test('exactly one panel is visible and inactive content cannot receive focus after switching', async () => {
  await act(async () => { renderer = create(<Harness />); });
  const panels = () => renderer!.root.findAllByType('div').filter(node => node.props.role === 'tabpanel');
  const tabs = () => renderer!.root.findAllByType('button').filter(node => node.props.role === 'tab');
  expect(panels().filter(node => !node.props.hidden)).toHaveLength(1);
  await act(async () => { tabs()[1].props.onClick(); });
  expect(panels()[0].props.hidden).toBe(true);
  expect(panels()[0].props.inert).toBe('');
  expect(panels()[1].props.hidden).toBe(false);
  expect(tabs()[1].props['aria-selected']).toBe(true);
  expect(tabs()[1].props['aria-controls']).toBe(panels()[1].props.id);
  expect(renderer!.root.findAllByProps({ 'aria-label': '第一张内容' })).toHaveLength(1);
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
