import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { zh } from '@blocknote/core/locales';

const originalReactEditor = { ...await import('@blocknote/react') };
const originalView = { ...await import('@blocknote/shadcn') };
const originalAppearance = { ...await import('../../src/contexts/AppearanceContext') };
let options: any;
let listener: (() => void) | undefined;
let unsubscribed = false;
const blocks = [{ id: 'saved-block', type: 'paragraph', content: [{ type: 'text', text: '保留的会议内容' }] }];
const editor = {
  document: blocks,
  onChange: (callback: () => void) => { listener = callback; return () => { unsubscribed = true; }; },
};
mock.module('@blocknote/react', () => ({ ...originalReactEditor,
  useCreateBlockNote: (input: unknown) => { options = input; return editor; },
}));
mock.module('@blocknote/shadcn', () => ({ ...originalView, BlockNoteView: (props: any) => <div data-theme={props.theme} /> }));
mock.module('../../src/contexts/AppearanceContext', () => ({ ...originalAppearance, useAppearance: () => ({ resolvedAppearance: 'dark' }) }));
const { default: Editor } = await import('../../src/components/BlockNoteEditor/Editor');
afterAll(() => {
  mock.module('@blocknote/react', () => originalReactEditor);
  mock.module('@blocknote/shadcn', () => originalView);
  mock.module('../../src/contexts/AppearanceContext', () => originalAppearance);
});
let renderer: ReactTestRenderer | undefined;
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; });

describe('Chinese editor integration', () => {
  test('uses official Chinese menus with the current appearance and preserves edits and cleanup', async () => {
    unsubscribed = false;
    const onChange = mock(() => {});
    await act(async () => { renderer = create(<Editor initialContent={blocks as any} onChange={onChange} />); });
    expect(options.initialContent).toBe(blocks);
    expect(options.dictionary.slash_menu).toBe(zh.slash_menu);
    expect(options.dictionary.formatting_toolbar).toBe(zh.formatting_toolbar);
    expect(options.dictionary.placeholders).toBe(zh.placeholders);
    expect(options.dictionary.file_panel.upload.upload_error).not.toMatch(/\bError\b/);
    expect(renderer!.root.findByProps({ 'data-theme': 'dark' })).toBeDefined();
    await act(async () => { listener!(); });
    expect(onChange).toHaveBeenCalledWith(blocks);
    await act(async () => { renderer!.unmount(); }); renderer = undefined;
    expect(unsubscribed).toBe(true);
  });
});
