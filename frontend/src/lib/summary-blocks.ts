import type { PartialBlock } from '@blocknote/core';
import { parseTextIntoNodes } from './document-export';

/**
 * Turns stored plain-text minutes into editor blocks so section titles and
 * numbered items are shown as real headings and lists, never as syntax marks.
 */
export function summaryTextToBlocks(text: string): PartialBlock[] {
  const blocks: PartialBlock[] = parseTextIntoNodes(text || '').map(node => {
    if (node.kind === 'heading') {
      return { type: 'heading', props: { level: node.level === 1 ? 2 : node.level }, content: node.text };
    }
    if (node.kind === 'ordered') return { type: 'numberedListItem', content: node.text };
    if (node.kind === 'list') return { type: 'bulletListItem', content: node.text };
    return { type: 'paragraph', content: node.text };
  });
  return blocks.length > 0 ? blocks : [{ type: 'paragraph', content: '' }];
}
