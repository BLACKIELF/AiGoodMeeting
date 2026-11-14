"use client";

import { useEffect } from "react";
import type { PartialBlock, Block } from "@blocknote/core";
import { zh } from '@blocknote/core/locales';
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import "@blocknote/core/fonts/inter.css";
import { useAppearance } from '@/contexts/AppearanceContext';

interface EditorProps {
  initialContent?: Block[];
  onChange?: (blocks: Block[]) => void;
  editable?: boolean;
}

export default function Editor({ initialContent, onChange, editable = true }: EditorProps) {
  const { resolvedAppearance } = useAppearance();

  const editor = useCreateBlockNote({
    initialContent: initialContent as PartialBlock[] | undefined,
    dictionary: { ...zh, file_panel: { ...zh.file_panel, upload: {
      ...zh.file_panel.upload, upload_error: '上传失败，请重试。',
    } } },
  });


  // Handle content changes
  useEffect(() => {
    if (!onChange) return;

    const handleChange = () => {
      onChange(editor.document);
    };

    const unsubscribe = editor.onChange(handleChange);

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [editor, onChange]);

  return <BlockNoteView editor={editor} editable={editable} theme={resolvedAppearance} />;
}
