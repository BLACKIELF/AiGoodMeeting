import { afterEach, describe, expect, mock, test } from 'bun:test';
import { useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SidebarMeetingCard } from '../../src/components/Sidebar';

const meetings = [
  { id: 'meeting-one', title: '项目会议：' + '很长的中文会议标题'.repeat(12), type: 'file' as const },
  { id: 'meeting-two', title: '第二场会议', type: 'file' as const },
];
let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
});

const card = (id: string) => renderer!.root.findAllByProps({ 'data-active': true })
  .concat(renderer!.root.findAllByProps({ 'data-active': false }))
  .find(node => node.findAllByType('button')[0].props.title === meetings.find(item => item.id === id)?.title)!;
const mainButton = (id: string) => card(id).findAllByType('button')[0];

describe('sidebar meeting cards', () => {
  test('one click opens the meeting immediately and moves the sole expanded card', async () => {
    const open = mock((_id: string) => {});
    function List() {
      const [selected, select] = useState('meeting-one');
      return <>{meetings.map(item => (
        <SidebarMeetingCard key={item.id} item={item} isActive={selected === item.id} isMeetingItem
          onOpen={() => { select(item.id); open(item.id); }} onRename={() => {}} onDelete={() => {}} />
      ))}</>;
    }
    await act(async () => { renderer = create(<List />); });
    expect(renderer!.root.findAllByProps({ 'data-active': true })).toHaveLength(1);
    expect(mainButton('meeting-one').props['aria-current']).toBe('page');
    await act(async () => { mainButton('meeting-two').props.onClick(); });
    expect(open.mock.calls).toEqual([['meeting-two']]);
    expect(mainButton('meeting-two').props['aria-expanded']).toBe(true);
    expect(mainButton('meeting-two').props['aria-current']).toBe('page');
    expect(mainButton('meeting-one').props['aria-expanded']).toBe(false);
    expect(renderer!.root.findAllByProps({ 'data-active': true })).toHaveLength(1);
  });

  test('clicking an already selected meeting collapses its tools in-place while keeping route intact', async () => {
    const open = mock((_id: string) => {});
    function List() {
      const [selected, select] = useState('meeting-one');
      return <>{meetings.map(item => (
        <SidebarMeetingCard key={item.id} item={item} isActive={selected === item.id} isMeetingItem
          onOpen={() => { select(item.id); open(item.id); }} onRename={() => {}} onDelete={() => {}} />
      ))}</>;
    }
    await act(async () => { renderer = create(<List />); });
    const buttonOne = mainButton('meeting-one');
    expect(buttonOne.props['aria-expanded']).toBe(true);

    // Re-clicking active card collapses tools in-place
    await act(async () => { buttonOne.props.onClick(); });
    expect(buttonOne.props['aria-expanded']).toBe(false);
    expect(buttonOne.props['aria-current']).toBe('page');
    expect(card('meeting-one').findByProps({ className: 'agb-meeting-card-tools' }).props['data-open']).toBe(false);

    // Clicking it again re-expands tools
    await act(async () => { buttonOne.props.onClick(); });
    expect(buttonOne.props['aria-expanded']).toBe(true);
    expect(card('meeting-one').findByProps({ className: 'agb-meeting-card-tools' }).props['data-open']).toBe(true);

    // Switching to meeting two collapses meeting one and opens meeting two (one expanded at a time)
    await act(async () => { mainButton('meeting-two').props.onClick(); });
    expect(mainButton('meeting-two').props['aria-expanded']).toBe(true);
    expect(mainButton('meeting-one').props['aria-expanded']).toBe(false);
  });

  test('closed tools are inert, absent from tab order and unable to invoke actions', async () => {
    const rename = mock(() => {}), remove = mock(() => {});
    await act(async () => {
      renderer = create(<SidebarMeetingCard item={meetings[0]} isActive={false} isMeetingItem
        onOpen={() => {}} onRename={rename} onDelete={remove} />);
    });
    const tools = renderer!.root.findByProps({ className: 'agb-meeting-card-tools' });
    expect(tools.props.inert).toBe('');
    expect(tools.props['aria-hidden']).toBe(true);
    expect(tools.props['data-open']).toBe(false);
    for (const button of tools.findAllByType('button')) {
      expect(button.props.disabled).toBe(true);
      expect(button.props.tabIndex).toBe(-1);
      expect(button.props.onClick).toBeUndefined();
    }
    expect(rename).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  test('expanded actions are separate from navigation and preserve their accessible names', async () => {
    const open = mock(() => {}), rename = mock(() => {}), remove = mock(() => {});
    await act(async () => {
      renderer = create(<SidebarMeetingCard item={meetings[1]} isActive isMeetingItem
        onOpen={open} onRename={rename} onDelete={remove} />);
    });
    const buttons = renderer!.root.findAllByType('button');
    expect(buttons[0].findAllByType('button')).toHaveLength(1);
    const tools = renderer!.root.findByProps({ className: 'agb-meeting-card-tools' });
    expect(tools.props.id).toBe(buttons[0].props['aria-controls']);
    expect(tools.props.inert).toBeUndefined();
    expect(tools.props['aria-hidden']).toBe(false);
    expect(buttons[1].props['aria-label']).toBe(`重命名：${meetings[1].title}`);
    expect(buttons[2].props['aria-label']).toBe(`删除会议：${meetings[1].title}`);
    for (const button of buttons.slice(1)) {
      expect(button.props.disabled).toBe(false);
      expect(button.props.tabIndex).toBe(0);
      await act(async () => { button.props.onClick(); });
    }
    expect(rename).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  test('long titles and genuine search text survive expansion without invented metadata', async () => {
    const match = '实际转写命中：' + '讨论内容'.repeat(35);
    const show = (active: boolean) => <SidebarMeetingCard item={meetings[0]} isActive={active} isMeetingItem
      matchContext={match} onOpen={() => {}} onRename={() => {}} onDelete={() => {}} />;
    await act(async () => { renderer = create(show(false)); });
    const title = () => renderer!.root.findAllByType('span').find(node => node.children.includes(meetings[0].title))!;
    const snippet = () => renderer!.root.findAllByType('span').find(node => node.children.includes(match))!;
    expect(title().props.className).toContain('line-clamp-2');
    expect(snippet().props.className).toContain('line-clamp-2');
    await act(async () => { renderer!.update(show(true)); });
    expect(title().props.className).not.toContain('line-clamp');
    expect(title().props.className).toContain('break-words');
    expect(title().props.className).toContain('[overflow-wrap:anywhere]');
    expect(snippet().props.className).toContain('whitespace-pre-wrap');
    expect(snippet().props.className).not.toContain('line-clamp');
    const html = renderToStaticMarkup(show(true));
    expect(html).toContain(meetings[0].title);
    expect(html).toContain(match);
    expect(html).not.toMatch(/会议时长|参会人数|暂无摘要|示例/);
  });

  test('server rendering gives each card its own controls target and leaves new-meeting navigation simple', () => {
    const html = renderToStaticMarkup(<>{meetings.map((item, i) => (
      <SidebarMeetingCard key={item.id} item={item} isActive={i === 0} isMeetingItem
        onOpen={() => {}} onRename={() => {}} onDelete={() => {}} />
    ))}</>);
    const ids = [...html.matchAll(/aria-controls="([^"]+)"/g)].map(match => match[1]);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(html).toContain(`id="${id}"`);
    const intro = renderToStaticMarkup(<SidebarMeetingCard item={{ id: 'intro-call', title: '新会议', type: 'file' }}
      isActive={false} isMeetingItem={false} onOpen={() => {}} onRename={() => {}} onDelete={() => {}} />);
    expect(intro).toContain('新建会议');
    expect(intro).not.toMatch(/aria-expanded|aria-controls|agb-meeting-card-tools/);
  });
});
