import type { BlockNoteBlock, MeetingSummary, Transcript } from '@/types';
import type { SpeakerTranscript } from '@/types/speakers';
import { speakerLabel } from './speaker-transcript';
import { toSummaryPlainText } from './summary-plain-text';

export type ExportDocumentFormat = 'txt' | 'docx' | 'md';

export type DocumentNode =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'ordered'; index: number; text: string }
  | { kind: 'list'; text: string };

export interface StructuredMeetingDocument {
  title: string;
  subtitleLines: string[];
  nodes: DocumentNode[];
}

const KNOWN_SECTION_TITLES = new Set([
  '会议摘要', '核心摘要', '摘要', '总结', '会议总结', '关键决策', '决策事项', '决议',
  '行动项', '待办事项', '后续步骤', '下一步计划', '讨论要点', '主要议题', '重点内容',
  '风险与阻塞', '问题与风险', '参会人员', '背景', '目标',
  'Summary', 'Overview', 'Key Points', 'Decisions', 'Action Items', 'Next Steps',
  'Blockers', 'Participants', 'Discussion', 'Highlights', 'Notes',
]);

const SECTION_HEADING_PATTERN = /^(?:[一二三四五六七八九十]+[、.．]\s*\S.{0,36}|第[一二三四五六七八九十0-9]+[章节部分]\s*\S.{0,36})$/;
const ORDERED_ITEM_PATTERN = /^(\d+)[.)、．]\s+(.+)$/;
const XML_ILLEGAL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g;

export function sanitizeFileName(rawTitle: string, fallback = '会议纪要'): string {
  const cleaned = toSummaryPlainText(rawTitle || '')
    .replace(/[\\/:*?"<>|\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const base = cleaned || fallback;
  return base.slice(0, 80);
}

export function formatMeetingDateLabel(createdAt?: string | null): string | null {
  if (!createdAt) return null;
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

export function formatTranscriptTimestamp(seconds: number | undefined, fallbackTimestamp: string): string {
  if (seconds === undefined || Number.isNaN(seconds)) {
    return toSummaryPlainText(fallbackTimestamp || '').trim() || '[00:00]';
  }
  const totalSecs = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (hours > 0) {
    return `[${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
  }
  return `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
}

function extractInlineBlockText(content: unknown): string {
  if (typeof content === 'string') return toSummaryPlainText(content);
  if (!Array.isArray(content)) {
    if (content && typeof content === 'object' && 'rows' in (content as Record<string, unknown>)) {
      const rows = (content as { rows?: Array<{ cells?: unknown[] }> }).rows || [];
      return rows
        .map(row => (row.cells || []).map(cell => extractInlineBlockText(cell)).join('\t'))
        .filter(Boolean)
        .join('\n');
    }
    return '';
  }
  const raw = content
    .map(item => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return '';
      const record = item as Record<string, unknown>;
      if (typeof record.text === 'string') return record.text;
      if (Array.isArray(record.content)) return extractInlineBlockText(record.content);
      return '';
    })
    .join('');
  return toSummaryPlainText(raw);
}

function parseBlockNoteNodes(blocks: BlockNoteBlock[]): DocumentNode[] {
  const nodes: DocumentNode[] = [];
  let orderedCounter = 0;

  const visit = (items: BlockNoteBlock[]) => {
    for (const block of items) {
      if (!block || typeof block !== 'object') continue;
      const text = extractInlineBlockText(block.content);
      if (block.type !== 'numberedListItem') {
        orderedCounter = 0;
      }
      if (text) {
        if (block.type === 'heading') {
          const rawLevel = Number(block.props?.level ?? 2);
          const level: 1 | 2 | 3 = rawLevel <= 1 ? 1 : rawLevel >= 3 ? 3 : 2;
          nodes.push({ kind: 'heading', level, text });
        } else if (block.type === 'numberedListItem') {
          orderedCounter += 1;
          nodes.push({ kind: 'ordered', index: orderedCounter, text });
        } else if (block.type === 'bulletListItem') {
          nodes.push({ kind: 'list', text });
        } else if (block.type === 'checkListItem') {
          const checked = Boolean(block.props?.checked);
          nodes.push({ kind: 'list', text: `${checked ? '已完成：' : '待办：'}${text}` });
        } else {
          for (const line of text.split('\n').map(part => part.trim()).filter(Boolean)) {
            nodes.push({ kind: 'paragraph', text: line });
          }
        }
      }
      if (Array.isArray(block.children) && block.children.length > 0) {
        visit(block.children);
      }
    }
  };

  visit(blocks);
  return nodes;
}

function isLikelyPlainSectionTitle(line: string, prevBlank: boolean, hasFollowingLine: boolean): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 36) return false;
  if (KNOWN_SECTION_TITLES.has(trimmed.replace(/[：:]$/, ''))) return true;
  if (SECTION_HEADING_PATTERN.test(trimmed)) return true;
  if (!prevBlank || !hasFollowingLine) return false;
  if (/[。！？.!?；;，,]/.test(trimmed)) return false;
  if (ORDERED_ITEM_PATTERN.test(trimmed)) return false;
  if (trimmed.startsWith('已完成：') || trimmed.startsWith('待办：')) return false;
  return trimmed.length <= 18;
}

export function parseTextIntoNodes(rawText: string): DocumentNode[] {
  const normalized = rawText.replace(/\r\n?/g, '\n');
  const rawLines = normalized.split('\n');
  const nodes: DocumentNode[] = [];
  let prevBlank = true;

  for (let i = 0; i < rawLines.length; i += 1) {
    const rawLine = rawLines[i];
    const trimmedRaw = rawLine.trim();
    if (!trimmedRaw) {
      prevBlank = true;
      continue;
    }

    // Ignore pure horizontal rule lines
    if (/^(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,}|(?:=\s*){3,})$/.test(trimmedRaw)) {
      prevBlank = true;
      continue;
    }

    // Explicit markdown heading before plain-text stripping
    const headingMatch = trimmedRaw.match(/^(#{1,6})(?:\s+|(?=[一-龯0-9A-Za-z]))(.+)$/);
    if (headingMatch) {
      const hashes = headingMatch[1].length;
      const cleanHeading = toSummaryPlainText(headingMatch[2]);
      if (cleanHeading) {
        const level: 1 | 2 | 3 = hashes <= 1 ? 1 : hashes === 2 ? 2 : 3;
        nodes.push({ kind: 'heading', level, text: cleanHeading });
      }
      prevBlank = false;
      continue;
    }

    // Explicit bullet item before stripping
    const bulletMatch = trimmedRaw.match(/^[-*+•●▪◦]\s+(.+)$/);
    if (bulletMatch) {
      const cleanItem = toSummaryPlainText(bulletMatch[1]);
      if (cleanItem) {
        nodes.push({ kind: 'list', text: cleanItem });
      }
      prevBlank = false;
      continue;
    }

    const cleanedLine = toSummaryPlainText(trimmedRaw);
    if (!cleanedLine) {
      prevBlank = true;
      continue;
    }

    for (const segment of cleanedLine.split('\n').map(s => s.trim()).filter(Boolean)) {
      const orderedMatch = segment.match(ORDERED_ITEM_PATTERN);
      if (orderedMatch) {
        nodes.push({
          kind: 'ordered',
          index: Number(orderedMatch[1]),
          text: toSummaryPlainText(orderedMatch[2]),
        });
        prevBlank = false;
        continue;
      }

      const hasFollowing = i + 1 < rawLines.length && rawLines.slice(i + 1).some(next => next.trim().length > 0);
      if (isLikelyPlainSectionTitle(segment, prevBlank, hasFollowing)) {
        nodes.push({
          kind: 'heading',
          level: 2,
          text: segment.replace(/[：:]$/, ''),
        });
      } else {
        nodes.push({ kind: 'paragraph', text: segment });
      }
      prevBlank = false;
    }
  }

  return nodes;
}

export function buildSummaryDocument(options: {
  meetingTitle: string;
  createdAt?: string | null;
  aiSummary: MeetingSummary | null;
  liveBlocks?: BlockNoteBlock[];
  liveMarkdown?: string;
}): StructuredMeetingDocument {
  const cleanTitle = toSummaryPlainText(options.meetingTitle || '').trim() || '会议纪要';
  const dateLabel = formatMeetingDateLabel(options.createdAt);
  const subtitleLines = dateLabel ? [`日期：${dateLabel}`] : [];

  let nodes: DocumentNode[] = [];
  if (options.liveBlocks && options.liveBlocks.length > 0) {
    nodes = parseBlockNoteNodes(options.liveBlocks);
  }
  if (nodes.length === 0 && options.aiSummary?.summary_json && Array.isArray(options.aiSummary.summary_json)) {
    nodes = parseBlockNoteNodes(options.aiSummary.summary_json);
  }
  if (nodes.length === 0) {
    const textSource = options.liveMarkdown || (typeof options.aiSummary?.markdown === 'string' ? options.aiSummary.markdown : '');
    if (textSource.trim()) {
      nodes = parseTextIntoNodes(textSource);
    }
  }
  if (nodes.length === 0 && options.aiSummary) {
    for (const [key, section] of Object.entries(options.aiSummary)) {
      if (['markdown', 'summary_json', '_section_order', 'MeetingName', 'english_cache', 'reasoning_stripped', 'normalization_fallback', 'speaker_transcript_updated_at'].includes(key)) {
        continue;
      }
      if (section && typeof section === 'object' && 'title' in section && 'blocks' in section) {
        const cleanSecTitle = toSummaryPlainText(String((section as { title: string }).title || ''));
        if (cleanSecTitle) {
          nodes.push({ kind: 'heading', level: 2, text: cleanSecTitle });
        }
        const secBlocks = Array.isArray((section as { blocks?: unknown[] }).blocks)
          ? ((section as { blocks: Array<{ content?: string }> }).blocks)
          : [];
        secBlocks.forEach((item, idx) => {
          const itemText = toSummaryPlainText(String(item?.content || ''));
          if (itemText) {
            nodes.push({ kind: 'ordered', index: idx + 1, text: itemText });
          }
        });
      }
    }
  }

  // Drop a redundant first heading if it simply repeats the meeting title
  if (nodes.length > 1 && nodes[0].kind === 'heading' && nodes[0].text === cleanTitle) {
    nodes = nodes.slice(1);
  }

  return {
    title: `会议纪要：${cleanTitle}`,
    subtitleLines,
    nodes,
  };
}

export function buildTranscriptDocument(options: {
  meetingTitle: string;
  createdAt?: string | null;
  transcripts: Transcript[];
  speakerTranscript?: SpeakerTranscript | null;
}): StructuredMeetingDocument {
  const cleanTitle = toSummaryPlainText(options.meetingTitle || '').trim() || '会议记录';
  const dateLabel = formatMeetingDateLabel(options.createdAt);
  const subtitleLines = dateLabel ? [`日期：${dateLabel}`] : [];
  const nodes: DocumentNode[] = [];

  if (options.speakerTranscript && options.speakerTranscript.segments.length > 0) {
    for (const seg of options.speakerTranscript.segments) {
      const time = formatTranscriptTimestamp(seg.start, '');
      const speaker = toSummaryPlainText(speakerLabel(seg.speaker, options.speakerTranscript.names)).trim() || '说话人';
      const text = toSummaryPlainText(seg.text || '').trim();
      if (!text) continue;
      nodes.push({
        kind: 'paragraph',
        text: `${time} ${speaker}：${text}`,
      });
    }
  } else {
    for (const item of options.transcripts) {
      const time = formatTranscriptTimestamp(item.audio_start_time, item.timestamp);
      const text = toSummaryPlainText(item.text || '').trim();
      if (!text) continue;
      nodes.push({
        kind: 'paragraph',
        text: `${time} ${text}`,
      });
    }
  }

  return {
    title: `会议转写：${cleanTitle}`,
    subtitleLines,
    nodes,
  };
}

export function renderDocumentAsPlainText(doc: StructuredMeetingDocument): string {
  const lines: string[] = [toSummaryPlainText(doc.title)];
  for (const sub of doc.subtitleLines) {
    const cleanSub = toSummaryPlainText(sub);
    if (cleanSub) lines.push(cleanSub);
  }
  if (doc.nodes.length > 0) {
    lines.push('');
  }

  doc.nodes.forEach((node, idx) => {
    if (node.kind === 'heading') {
      if (idx > 0 && lines[lines.length - 1] !== '') {
        lines.push('');
      }
      lines.push(toSummaryPlainText(node.text));
    } else if (node.kind === 'ordered') {
      lines.push(`${node.index}. ${toSummaryPlainText(node.text)}`);
    } else if (node.kind === 'list') {
      lines.push(toSummaryPlainText(node.text));
    } else {
      lines.push(toSummaryPlainText(node.text));
    }
  });

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function renderDocumentAsMarkdown(doc: StructuredMeetingDocument): string {
  const lines: string[] = [`# ${toSummaryPlainText(doc.title)}`];
  if (doc.subtitleLines.length > 0) {
    lines.push('');
    for (const sub of doc.subtitleLines) {
      lines.push(toSummaryPlainText(sub));
    }
  }
  if (doc.nodes.length > 0) {
    lines.push('');
  }

  doc.nodes.forEach((node, idx) => {
    if (node.kind === 'heading') {
      if (idx > 0 && lines[lines.length - 1] !== '') {
        lines.push('');
      }
      const prefix = node.level === 1 ? '##' : node.level === 2 ? '##' : '###';
      lines.push(`${prefix} ${toSummaryPlainText(node.text)}`);
      lines.push('');
    } else if (node.kind === 'ordered') {
      lines.push(`${node.index}. ${toSummaryPlainText(node.text)}`);
    } else if (node.kind === 'list') {
      lines.push(`- ${toSummaryPlainText(node.text)}`);
    } else {
      lines.push(toSummaryPlainText(node.text));
      lines.push('');
    }
  });

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function escapeXml(value: string): string {
  return value
    .replace(XML_ILLEGAL_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildWordParagraphXml(text: string, styleId: string): string {
  const safeText = escapeXml(text);
  return `<w:p><w:pPr><w:pStyle w:val="${styleId}"/></w:pPr><w:r><w:t xml:space="preserve">${safeText}</w:t></w:r></w:p>`;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZipArchive(entries: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = entry.data;
    const checksum = crc32(data);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true); // Local file header signature
    localView.setUint16(4, 20, true); // Version needed to extract (2.0)
    localView.setUint16(6, 0x0800, true); // UTF-8 filename flag
    localView.setUint16(8, 0, true); // Compression method: 0 (Store)
    localView.setUint16(10, 0x4800, true); // Mod time (09:00:00)
    localView.setUint16(12, 0x596d, true); // Mod date
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true); // Central directory file header signature
    centralView.setUint16(4, 20, true); // Version made by
    centralView.setUint16(6, 20, true); // Version needed
    centralView.setUint16(8, 0x0800, true); // UTF-8 filename flag
    centralView.setUint16(10, 0, true); // Store
    centralView.setUint16(12, 0x4800, true);
    centralView.setUint16(14, 0x596d, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    localParts.push(localHeader, data);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralSize = centralParts.reduce((acc, part) => acc + part.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(4, 0, true);
  eocdView.setUint16(6, 0, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, offset, true);
  eocdView.setUint16(20, 0, true);

  const totalLength = offset + centralSize + eocd.length;
  const output = new Uint8Array(totalLength);
  let cursor = 0;
  for (const part of [...localParts, ...centralParts, eocd]) {
    output.set(part, cursor);
    cursor += part.length;
  }
  return output;
}

export function renderDocumentAsDocxBytes(doc: StructuredMeetingDocument): Uint8Array {
  const encoder = new TextEncoder();
  const paragraphs: string[] = [
    buildWordParagraphXml(toSummaryPlainText(doc.title), 'Title'),
  ];

  for (const sub of doc.subtitleLines) {
    const cleanSub = toSummaryPlainText(sub);
    if (cleanSub) {
      paragraphs.push(buildWordParagraphXml(cleanSub, 'Subtitle'));
    }
  }

  for (const node of doc.nodes) {
    const cleanText = toSummaryPlainText(node.text);
    if (!cleanText) continue;
    if (node.kind === 'heading') {
      const styleId = node.level === 1 ? 'Heading1' : node.level === 2 ? 'Heading2' : 'Heading3';
      paragraphs.push(buildWordParagraphXml(cleanText, styleId));
    } else if (node.kind === 'ordered') {
      paragraphs.push(buildWordParagraphXml(`${node.index}. ${cleanText}`, 'ListParagraph'));
    } else if (node.kind === 'list') {
      paragraphs.push(buildWordParagraphXml(cleanText, 'ListParagraph'));
    } else {
      paragraphs.push(buildWordParagraphXml(cleanText, 'Normal'));
    }
  }

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const docRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="PingFang SC" w:cs="Calibri"/>
        <w:sz w:val="22"/>
        <w:szCs w:val="22"/>
        <w:color w:val="1F2329"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:after="140" w:line="340" w:lineRule="auto"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:before="80" w:after="100" w:line="300" w:lineRule="auto"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/><w:color w:val="111827"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle">
    <w:name w:val="Subtitle"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:after="240" w:line="280" w:lineRule="auto"/></w:pPr>
    <w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/><w:color w:val="6B7280"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:keepNext/><w:spacing w:before="280" w:after="120"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/><w:color w:val="111827"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:keepNext/><w:spacing w:before="240" w:after="100"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="25"/><w:szCs w:val="25"/><w:color w:val="1F2937"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:keepNext/><w:spacing w:before="180" w:after="80"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="23"/><w:szCs w:val="23"/><w:color w:val="374151"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph">
    <w:name w:val="List Paragraph"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:ind w:left="280"/>
      <w:spacing w:after="100" w:line="340" w:lineRule="auto"/>
    </w:pPr>
  </w:style>
</w:styles>`;

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs.join('\n    ')}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  return createZipArchive([
    { name: '[Content_Types].xml', data: encoder.encode(contentTypesXml) },
    { name: '_rels/.rels', data: encoder.encode(rootRelsXml) },
    { name: 'word/_rels/document.xml.rels', data: encoder.encode(docRelsXml) },
    { name: 'word/styles.xml', data: encoder.encode(stylesXml) },
    { name: 'word/document.xml', data: encoder.encode(documentXml) },
  ]);
}

export function renderDocumentPayload(
  doc: StructuredMeetingDocument,
  format: ExportDocumentFormat,
): { extension: ExportDocumentFormat; bytes: Uint8Array; text?: string } {
  const encoder = new TextEncoder();
  if (format === 'docx') {
    return { extension: 'docx', bytes: renderDocumentAsDocxBytes(doc) };
  }
  if (format === 'md') {
    const text = renderDocumentAsMarkdown(doc);
    return { extension: 'md', bytes: encoder.encode(text), text };
  }
  const text = renderDocumentAsPlainText(doc);
  return { extension: 'txt', bytes: encoder.encode(text), text };
}
