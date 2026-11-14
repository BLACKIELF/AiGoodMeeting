import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import sharedCases from '../fixtures/summary-plain-text.json';
import { sanitizeSummaryText, toSummaryPlainText } from '../../src/lib/summary-plain-text';
import {
  buildSummaryDocument,
  buildTranscriptDocument,
  renderDocumentAsDocxBytes,
  renderDocumentAsMarkdown,
  renderDocumentAsPlainText,
} from '../../src/lib/document-export';

describe('summary plain-text rules and export formats', () => {
  test('matches shared fixture cases and stays idempotent', () => {
    for (const item of sharedCases) {
      const output = toSummaryPlainText(item.input);
      expect(output).toBe(item.output);
      expect(toSummaryPlainText(output)).toBe(output);
    }
  });

  test('sanitizes nested summary objects without mutating IDs or URLs', () => {
    const cleaned = sanitizeSummaryText({
      id: 'meeting#99',
      markdown: '# 产品评审\n- **确认排期**：周五前完成',
      summary_json: [
        {
          id: 'block#1',
          type: 'heading',
          props: { level: 2 },
          content: [{ type: 'text', text: '## **行动项**', href: 'https://feishu.cn/docx/abc#top' }],
        },
      ],
    });
    expect(cleaned.id).toBe('meeting#99');
    expect(cleaned.markdown).toBe('产品评审\n确认排期：周五前完成');
    expect(cleaned.summary_json[0].id).toBe('block#1');
    expect(cleaned.summary_json[0].content[0].text).toBe('行动项');
    expect(cleaned.summary_json[0].content[0].href).toBe('https://feishu.cn/docx/abc#top');
  });

  test('renders clean TXT, valid Word (.docx), and optional Markdown (.md) from summary', () => {
    const doc = buildSummaryDocument({
      meetingTitle: '**11月产品升级评审**',
      createdAt: '2026-11-13T10:30:00.000Z',
      aiSummary: {
        markdown: '## 关键决策\n1. **默认导出 TXT 与 Word**\n2. *保留可选 Markdown*\n---\n## 后续步骤\n- 接入 `lark-cli` 一键上传飞书',
      } as any,
    });

    const txt = renderDocumentAsPlainText(doc);
    expect(txt).toContain('会议纪要：11月产品升级评审');
    expect(txt).toContain('关键决策');
    expect(txt).toContain('1. 默认导出 TXT 与 Word');
    expect(txt).toContain('接入 lark-cli 一键上传飞书');
    expect(txt).not.toMatch(/[*#`]/);
    expect(txt).not.toContain('---');

    const md = renderDocumentAsMarkdown(doc);
    expect(md).toContain('# 会议纪要：11月产品升级评审');
    expect(md).toContain('## 关键决策');
    expect(md).toContain('1. 默认导出 TXT 与 Word');
    expect(md).toContain('## 后续步骤');
    expect(md).toContain('- 接入 lark-cli 一键上传飞书');

    const docxBytes = renderDocumentAsDocxBytes(doc);
    // ZIP PK\x03\x04 signature
    expect(docxBytes[0]).toBe(0x50);
    expect(docxBytes[1]).toBe(0x4b);
    expect(docxBytes[2]).toBe(0x03);
    expect(docxBytes[3]).toBe(0x04);

    // Verify macOS native Cocoa DOCX parser (textutil) reads our generated .docx cleanly
    if (process.platform === 'darwin') {
      const dir = mkdtempSync(join(tmpdir(), 'agm-docx-'));
      try {
        const docxPath = join(dir, 'summary.docx');
        writeFileSync(docxPath, docxBytes);
        const converted = spawnSync('/usr/bin/textutil', ['-convert', 'txt', '-stdout', docxPath], {
          encoding: 'utf8',
        });
        expect(converted.status).toBe(0);
        expect(converted.stdout).toContain('会议纪要：11月产品升级评审');
        expect(converted.stdout).toContain('关键决策');
        expect(converted.stdout).toContain('1. 默认导出 TXT 与 Word');
        expect(converted.stdout).not.toMatch(/[*#`]/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  test('builds speaker-attributed transcript without raw markdown symbols', () => {
    const doc = buildTranscriptDocument({
      meetingTitle: '研发例会',
      createdAt: '2026-11-13T10:30:00.000Z',
      transcripts: [],
      speakerTranscript: {
        schema_version: 1,
        model: 'local',
        updated_at: '2026-11-13T10:31:00Z',
        speakers: ['speaker_0', 'speaker_1'],
        names: { speaker_0: '阳锦晨' },
        warnings: [],
        segments: [
          { start: 5, end: 12, speaker: 'speaker_0', text: '**确认**飞书 CLI 已就绪' },
          { start: 13, end: 20, speaker: 'speaker_1', text: '收到，导出 Word 与 TXT 均正常' },
        ],
      },
    });
    const txt = renderDocumentAsPlainText(doc);
    expect(txt).toContain('会议转写：研发例会');
    expect(txt).toContain('[00:05] 阳锦晨：确认飞书 CLI 已就绪');
    expect(txt).toContain('[00:13] 说话人 2：收到，导出 Word 与 TXT 均正常');
    expect(txt).not.toMatch(/[*#]/);
  });
});
