import "@blocknote/core/fonts/inter.css";
import { useCreateBlockNote } from "@blocknote/react";
import { zh } from '@blocknote/core/locales';
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import { ChangeEvent, useCallback, useEffect } from "react";

const initialMarkdown = "你好，**世界！**";

export default function BasicBlockNoteTest() {
  // Creates a new editor instance.
  const editor = useCreateBlockNote({ dictionary: { ...zh, file_panel: { ...zh.file_panel, upload: {
    ...zh.file_panel.upload, upload_error: '上传失败，请重试。',
  } } } });

  const markdownInputChanged = useCallback(
    async (e: ChangeEvent<HTMLTextAreaElement>) => {
      // Whenever the current Markdown content changes, converts it to an array of
      // Block objects and replaces the editor's content with them.
      const blocks = await editor.tryParseMarkdownToBlocks(e.target.value);
      editor.replaceBlocks(editor.document, blocks);
    },
    [editor],
  );

  // For initialization; on mount, convert the initial Markdown to blocks and replace the default editor's content
  useEffect(() => {
    async function loadInitialHTML() {
      const blocks = await editor.tryParseMarkdownToBlocks(initialMarkdown);
      editor.replaceBlocks(editor.document, blocks);
    }
    loadInitialHTML();
  }, [editor]);

  // Renders the Markdown input and editor instance.
  return (
    <div className="views">
      <div className="view-wrapper">
        <div className="view-label">标记文本输入</div>
        <div className="view">
          <code>
            <textarea
              defaultValue={initialMarkdown}
              onChange={markdownInputChanged}
            />
          </code>
        </div>
      </div>
      <div className="view-wrapper">
        <div className="view-label">编辑内容</div>
        <div className="view">
          <BlockNoteView editor={editor} editable={true} />
        </div>
      </div>
    </div>
  );
}
