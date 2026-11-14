"use client";

import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import dynamic from 'next/dynamic';
import { Summary, SummaryDataResponse, SummaryFormat, BlockNoteBlock } from '@/types';
import { AISummary } from './index';
import { Block } from '@blocknote/core';
import { zh } from '@blocknote/core/locales';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import { blocksToMarkdownSafely } from '@/lib/blocknote-markdown';
import { useAppearance } from '@/contexts/AppearanceContext';
import { toUserMessage } from '@/lib/user-message';
import { summaryTextToBlocks } from '@/lib/summary-blocks';
import "@blocknote/shadcn/style.css";

// Dynamically import BlockNote Editor to avoid SSR issues
const Editor = dynamic(() => import('../BlockNoteEditor/Editor'), { ssr: false });

interface BlockNoteSummaryViewProps {
  summaryData: SummaryDataResponse | Summary | null;
  onSave?: (data: { markdown?: string; summary_json?: BlockNoteBlock[] }) => Promise<void>;
  onSummaryChange?: (summary: Summary) => void;
  status?: 'idle' | 'processing' | 'summarizing' | 'regenerating' | 'completed' | 'error';
  error?: string | null;
  onRegenerateSummary?: () => void;
  meeting?: {
    id: string;
    title: string;
    created_at: string;
  };
  onDirtyChange?: (isDirty: boolean) => void;
}

export interface BlockNoteSummaryViewRef {
  saveSummary: () => Promise<void>;
  getMarkdown: () => Promise<string>;
  getBlocks?: () => BlockNoteBlock[];
  isDirty: boolean;
}

// Format detection helper
function detectSummaryFormat(data: any): { format: SummaryFormat; data: any } {
  if (!data) {
    return { format: 'legacy', data: null };
  }

  // Priority 1: BlockNote format (has summary_json)
  if (data.summary_json && Array.isArray(data.summary_json)) {
    return { format: 'blocknote', data };
  }

  // Priority 2: Markdown format
  if (data.markdown && typeof data.markdown === 'string') {
    return { format: 'markdown', data };
  }

  // Priority 3: Legacy JSON
  const hasLegacyStructure = data.MeetingName || Object.keys(data).some(key =>
    typeof data[key] === 'object' && data[key]?.title && data[key]?.blocks
  );

  if (hasLegacyStructure) {
    return { format: 'legacy', data };
  }

  return { format: 'legacy', data: null };
}

export const BlockNoteSummaryView = forwardRef<BlockNoteSummaryViewRef, BlockNoteSummaryViewProps>(({
  summaryData,
  onSave,
  onSummaryChange,
  status = 'idle',
  error = null,
  onRegenerateSummary,
  meeting,
  onDirtyChange
}, ref) => {
  const { resolvedAppearance } = useAppearance();
  const { format, data } = detectSummaryFormat(summaryData);
  const [isDirty, setIsDirty] = useState(false);
  const [currentBlocks, setCurrentBlocks] = useState<Block[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const isContentLoaded = useRef(false);

  // Create BlockNote editor for markdown parsing
  const editor = useCreateBlockNote({
    initialContent: undefined,
    dictionary: { ...zh, file_panel: { ...zh.file_panel, upload: {
      ...zh.file_panel.upload, upload_error: '上传失败，请重试。',
    } } },
  });

  // Stored minutes are plain text; show their structure as real headings and lists.
  useEffect(() => {
    if (format !== 'markdown' || !data?.markdown || !editor) return;
    isContentLoaded.current = false;
    setEditorError(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      editor.replaceBlocks(editor.document, summaryTextToBlocks(data.markdown));
      // Let the editor settle before edits start counting as unsaved changes.
      timer = setTimeout(() => { isContentLoaded.current = true; }, 100);
    } catch (err) {
      console.error('Failed to render summary text:', err);
      setEditorError(toUserMessage(err, '纪要暂时无法显示，请重新打开这场会议。'));
    }
    return () => { if (timer) clearTimeout(timer); };
  }, [format, data?.markdown, editor]);

  useEffect(() => {
    if (format !== 'blocknote' || !data?.summary_json) return;
    isContentLoaded.current = false;
    const timer = setTimeout(() => { isContentLoaded.current = true; }, 100);
    return () => clearTimeout(timer);
  }, [format, data?.summary_json]);

  const handleEditorChange = useCallback((blocks: Block[]) => {
    // Only set dirty flag if content has finished loading
    if (isContentLoaded.current) {
      setCurrentBlocks(blocks);
      setIsDirty(true);
    }
  }, []);

  // Notify parent of dirty state changes
  useEffect(() => {
    if (onDirtyChange) {
      onDirtyChange(isDirty);
    }
  }, [isDirty, onDirtyChange]);

  const handleSave = useCallback(async () => {
    if (!onSave || !isDirty) return;

    setIsSaving(true);
    try {

      // Generate markdown from current blocks; preserve BlockNote JSON even if markdown conversion fails.
      const markdownResult = await blocksToMarkdownSafely(editor, currentBlocks, {
        source: 'BlockNoteSummaryView.handleSave',
      });

      const saveData: { markdown?: string; summary_json?: BlockNoteBlock[] } = {
        summary_json: currentBlocks as unknown as BlockNoteBlock[]
      };

      if (markdownResult.markdown !== undefined) {
        saveData.markdown = markdownResult.markdown;
      }

      await onSave(saveData);
      setIsDirty(false);
    } catch (error) {
      console.error('Save failed:', error);
      throw error;
    } finally {
      setIsSaving(false);
    }
  }, [onSave, isDirty, currentBlocks, editor]);

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    saveSummary: handleSave,
    getMarkdown: async () => {
      try {

        // For markdown format - use the main editor
        if (format === 'markdown' && editor) {
          const markdownResult = await blocksToMarkdownSafely(editor, editor.document, {
            source: 'BlockNoteSummaryView.getMarkdown.markdown',
            fallbackMarkdown: data?.markdown,
          });
          return markdownResult.markdown || '';
        }

        // For blocknote format - use currentBlocks state
        if (format === 'blocknote') {
          const blocks = currentBlocks.length > 0
            ? currentBlocks
            : (data?.summary_json as unknown as Block[] | undefined) || [];

          if (blocks.length > 0 && editor) {
            const markdownResult = await blocksToMarkdownSafely(editor, blocks, {
              source: 'BlockNoteSummaryView.getMarkdown.blocknote',
              fallbackMarkdown: data?.markdown,
            });
            return markdownResult.markdown || '';
          }
          // Fallback: if we have the original data with markdown
          if (data?.markdown) {
            return data.markdown;
          }
        }

        // For legacy format - return empty (handled by parent)
        return '';
      } catch (err) {
        console.error('Failed to read summary content:', err);
        return '';
      }
    },
    getBlocks: () => {
      if (format === 'markdown' && editor) {
        return (editor.document as unknown as BlockNoteBlock[]) || [];
      }
      if (format === 'blocknote') {
        if (currentBlocks.length > 0) {
          return currentBlocks as unknown as BlockNoteBlock[];
        }
        return (data?.summary_json as BlockNoteBlock[] | undefined) || [];
      }
      return [];
    },
    isDirty
  }), [handleSave, isDirty, editor, format, currentBlocks, data]);

  // Render legacy format
  if (format === 'legacy') {
    return (
      <AISummary
        summary={summaryData as Summary}
        status={status}
        error={error}
        onSummaryChange={onSummaryChange || (() => { })}
        onRegenerateSummary={onRegenerateSummary || (() => { })}
        meeting={meeting}
      />
    );
  }

  // Render BlockNote format (has summary_json)
  if (format === 'blocknote') {
    return (
      <div className="flex flex-col w-full">
        <div className="w-full">
          <Editor
            initialContent={data.summary_json}
            onChange={handleEditorChange}
            editable={true}
          />
        </div>
      </div>
    );
  }

  // Render Markdown format (parse and display in BlockNote)
  if (format === 'markdown') {
    return (
      <div className="flex flex-col w-full">
        {editorError && <p role="alert" className="mb-3 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">{editorError}</p>}
        <div className="w-full">
          <BlockNoteView
            editor={editor}
            editable={true}
            onChange={() => {
              if (isContentLoaded.current) {
                handleEditorChange(editor.document);
              }
            }}
            theme={resolvedAppearance}
          />
        </div>
      </div>
    );
  }

  return null;
});

BlockNoteSummaryView.displayName = 'BlockNoteSummaryView';
