export interface SpeakerSegment {
  start: number;
  end: number;
  speaker: string;
  text: string;
}

export interface SpeakerTranscript {
  schema_version: 1;
  model: string;
  segments: SpeakerSegment[];
  speakers: string[];
  names: Record<string, string>;
  warnings: string[];
  updated_at: string;
}

export interface DiarizationProgress {
  meetingId: string;
  stage: string;
  message: string;
}
