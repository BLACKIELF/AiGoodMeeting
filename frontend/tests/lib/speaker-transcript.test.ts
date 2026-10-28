import { describe, expect, test } from 'bun:test';
import { readSummarySpeakerRevision, speakerErrorMessage, speakerLabel, speakerTranscriptText } from '../../src/lib/speaker-transcript';

describe('speaker transcript presentation', () => {
  test('uses saved human names, clear anonymous labels and uncertain attribution', () => {
    expect(speakerLabel('speaker_0', {})).toBe('说话人 1');
    expect(speakerLabel('speaker_0', { speaker_0: '小李' })).toBe('小李');
    expect(speakerLabel('unknown', {})).toBe('未确定');
    expect(speakerTranscriptText({
      schema_version: 1, model: 'local-test', updated_at: 'revision-1',
      speakers: ['speaker_0'], names: { speaker_0: '小李' }, warnings: [],
      segments: [{ start: 65.9, end: 69, speaker: 'speaker_0', text: 'Um, keep every original word.' }],
    })).toBe('[01:05] 小李：Um, keep every original word.');
  });

  test('reads the exact summary attribution revision and leaves older summaries stale', () => {
    expect(readSummarySpeakerRevision({ markdown: 'old summary' })).toBeNull();
    expect(readSummarySpeakerRevision({ speaker_transcript_updated_at: 'revision-1' })).toBe('revision-1');
    expect(readSummarySpeakerRevision('{"speaker_transcript_updated_at":"revision-2"}')).toBe('revision-2');
    expect(readSummarySpeakerRevision({ speaker_transcript_updated_at: 12 })).toBeNull();
  });

  test('shows user-facing setup errors without exposing technical traces', () => {
    expect(speakerErrorMessage('本地说话人模型尚未配置，暂时无法自动区分。', 'failed')).toContain('尚未配置');
    expect(speakerErrorMessage(new Error('/private/runtime/bin/python: exit status 1'), '自动分人失败。')).toBe('自动分人失败。');
  });
});
