import { z } from 'zod';
import type { SpeakerTranscript } from '@/types/speakers';

const SpeakerTranscriptSchema = z.object({
  schema_version: z.literal(1),
  model: z.string(),
  segments: z.array(z.object({
    start: z.number().finite().nonnegative(),
    end: z.number().finite().nonnegative(),
    speaker: z.string().min(1),
    text: z.string(),
  }).refine(segment => segment.end >= segment.start)).min(1),
  speakers: z.array(z.string().min(1)),
  names: z.record(z.string()),
  warnings: z.array(z.string()),
  updated_at: z.string().min(1),
});

export function parseSpeakerTranscript(value: unknown): SpeakerTranscript {
  return SpeakerTranscriptSchema.parse(value);
}

export function speakerLabel(id: string, names: Record<string, string>): string {
  const name = names[id]?.trim();
  if (name) return name;
  if (id === 'unknown') return '未确定';
  const number = /^speaker_(\d+)$/.exec(id);
  return number ? `说话人 ${Number(number[1]) + 1}` : '说话人';
}

export function formatSpeakerTime(seconds: number): string {
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
}

export function speakerTranscriptText(transcript: SpeakerTranscript): string {
  return transcript.segments.map(segment =>
    `[${formatSpeakerTime(segment.start)}] ${speakerLabel(segment.speaker, transcript.names)}：${segment.text}`,
  ).join('\n');
}

export function readSummarySpeakerRevision(value: unknown): string | null {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!value || typeof value !== 'object') return null;
  const revision = (value as Record<string, unknown>).speaker_transcript_updated_at;
  return typeof revision === 'string' ? revision : null;
}

export function speakerErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  // The backend supplies user-facing Chinese errors. Do not expose paths or runtime traces.
  return /[\u3400-\u9fff]/.test(message) && message.length <= 240 ? message : fallback;
}

export function speakerProgressMessage(stage: string): string {
  switch (stage) {
    case 'preparing': return '正在准备录音…';
    case 'processing': return '正在识别说话人…';
    case 'saving': return '正在保存分人结果…';
    case 'completed': return '正在读取分人结果…';
    default: return '正在自动分人…';
  }
}
