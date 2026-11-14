import { useCallback, useState, RefObject, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { MeetingSummary, Transcript } from '@/types';
import type { SpeakerTranscript } from '@/types/speakers';
import { BlockNoteSummaryViewRef } from '@/components/AISummary/BlockNoteSummaryView';
import { toast } from 'sonner';
import Analytics from '@/lib/analytics';
import { invoke as invokeTauri } from '@tauri-apps/api/core';
import { hasVisibleSummaryContent } from '@/lib/summary-content';
import { toUserMessage } from '@/lib/user-message';
import {
  buildSummaryDocument,
  buildTranscriptDocument,
  ExportDocumentFormat,
  renderDocumentAsDocxBytes,
  renderDocumentAsMarkdown,
  renderDocumentAsPlainText,
  renderDocumentPayload,
  sanitizeFileName,
  StructuredMeetingDocument,
} from '@/lib/document-export';

interface UseCopyOperationsProps {
  meeting: any;
  transcripts: Transcript[];
  meetingTitle: string;
  aiSummary: MeetingSummary | null;
  blockNoteSummaryRef: RefObject<BlockNoteSummaryViewRef>;
  speakerTranscript?: SpeakerTranscript | null;
}

interface ExportDocumentResult {
  saved: boolean;
  path?: string | null;
}

interface FeishuUploadResult {
  ok: boolean;
  url?: string | null;
  token?: string | null;
  title: string;
  modeLabel: string;
  message: string;
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__);
}

function triggerBrowserDownload(fileName: string, bytes: Uint8Array, mimeType: string) {
  const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Release even if the exporting view unmounts during the browser download.
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function useCopyOperations({
  meeting,
  transcripts,
  meetingTitle,
  aiSummary,
  blockNoteSummaryRef,
  speakerTranscript = null,
}: UseCopyOperationsProps) {
  const router = useRouter();
  const [isUploadingSummaryFeishu, setIsUploadingSummaryFeishu] = useState(false);
  const [isUploadingTranscriptFeishu, setIsUploadingTranscriptFeishu] = useState(false);

  const mountedRef = useRef(false);
  const uploadScopeRef = useRef(0);
  const uploadSummaryRef = useRef(false);
  const uploadTranscriptRef = useRef(false);
  const visibleMeetingRef = useRef(meeting.id);
  visibleMeetingRef.current = meeting.id;
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    uploadScopeRef.current += 1;
    uploadSummaryRef.current = false;
    uploadTranscriptRef.current = false;
    setIsUploadingSummaryFeishu(false);
    setIsUploadingTranscriptFeishu(false);
    return () => { uploadScopeRef.current += 1; };
  }, [meeting.id]);

  const fetchAllTranscripts = useCallback(async (meetingId: string): Promise<Transcript[]> => {
    if (!isTauriRuntime()) {
      return transcripts;
    }
    try {
      const firstPage = await invokeTauri('api_get_meeting_transcripts', {
        meetingId,
        limit: 1,
        offset: 0,
      }) as { transcripts: Transcript[]; total_count: number; has_more: boolean };

      const totalCount = firstPage.total_count;
      if (totalCount === 0) {
        return [];
      }

      const allData = await invokeTauri('api_get_meeting_transcripts', {
        meetingId,
        limit: totalCount,
        offset: 0,
      }) as { transcripts: Transcript[]; total_count: number; has_more: boolean };

      return allData.transcripts;
    } catch (error) {
      console.error('Error fetching all transcripts:', error);
      if (transcripts.length > 0) return transcripts;
      toast.error('读取转写失败，请重试');
      return [];
    }
  }, [transcripts]);

  const resolveSummaryDocument = useCallback(async (): Promise<StructuredMeetingDocument | null> => {
    if (!hasVisibleSummaryContent(aiSummary)) {
      return null;
    }
    const liveBlocks = blockNoteSummaryRef.current?.getBlocks?.() || [];
    let liveMarkdown = '';
    if (liveBlocks.length === 0 && blockNoteSummaryRef.current?.getMarkdown) {
      liveMarkdown = await blockNoteSummaryRef.current.getMarkdown();
    }
    if (!mountedRef.current || visibleMeetingRef.current !== meeting.id) return null;
    const doc = buildSummaryDocument({
      meetingTitle: meetingTitle || meeting?.title || '会议纪要',
      createdAt: meeting?.created_at,
      aiSummary,
      liveBlocks,
      liveMarkdown,
    });
    return doc.nodes.length > 0 ? doc : null;
  }, [aiSummary, blockNoteSummaryRef, meeting?.created_at, meeting?.title, meetingTitle]);

  const resolveTranscriptDocument = useCallback(async (): Promise<StructuredMeetingDocument | null> => {
    const allTranscripts = speakerTranscript && speakerTranscript.segments.length > 0
      ? transcripts
      : await fetchAllTranscripts(meeting.id);
    if (!mountedRef.current || visibleMeetingRef.current !== meeting.id) return null;
    if ((!speakerTranscript || speakerTranscript.segments.length === 0) && allTranscripts.length === 0) {
      return null;
    }
    const doc = buildTranscriptDocument({
      meetingTitle: meetingTitle || meeting?.title || '会议转写',
      createdAt: meeting?.created_at,
      transcripts: allTranscripts,
      speakerTranscript,
    });
    return doc.nodes.length > 0 ? doc : null;
  }, [fetchAllTranscripts, meeting?.created_at, meeting?.id, meeting?.title, meetingTitle, speakerTranscript, transcripts]);

  const exportDocumentToDisk = useCallback(async (
    doc: StructuredMeetingDocument,
    baseFileName: string,
    format: ExportDocumentFormat,
    label: string,
  ) => {
    const payload = renderDocumentPayload(doc, format);
    const cleanBase = sanitizeFileName(baseFileName, label);
    const fullFileName = `${cleanBase}.${payload.extension}`;

    if (!isTauriRuntime()) {
      const mime = format === 'docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : format === 'md'
          ? 'text/markdown;charset=utf-8'
          : 'text/plain;charset=utf-8';
      triggerBrowserDownload(fullFileName, payload.bytes, mime);
      toast.success(`${label}已导出为 ${payload.extension.toUpperCase()}`);
      return;
    }

    const res = await invokeTauri<ExportDocumentResult>('export_meeting_document', {
      defaultFileName: cleanBase,
      extension: payload.extension,
      bytes: Array.from(payload.bytes),
    });

    if (res.saved) {
      toast.success(`${label}已导出`, {
        description: res.path || fullFileName,
      });
    }
  }, []);

  const uploadDocumentToFeishu = useCallback(async (
    doc: StructuredMeetingDocument,
    uploadTitle: string,
    mode?: string,
  ) => {
    const docxBytes = renderDocumentAsDocxBytes(doc);
    const markdownText = renderDocumentAsMarkdown(doc);
    const plainText = renderDocumentAsPlainText(doc);

    const res = await invokeTauri<FeishuUploadResult>('feishu_upload_document', {
      title: sanitizeFileName(uploadTitle, '会议纪要'),
      mode: mode || null,
      docxBytes: Array.from(docxBytes),
      markdownText,
      plainText,
    });

    const targetUrl = res.url || undefined;
    toast.success(res.message || '已上传至飞书', {
      description: res.title,
      action: targetUrl
        ? {
            label: '打开飞书',
            onClick: () => {
              void invokeTauri('open_external_url', { url: targetUrl }).catch(() => {
                window.open(targetUrl, '_blank', 'noopener,noreferrer');
              });
            },
          }
        : undefined,
    });
  }, []);

  const handleFeishuError = useCallback((error: unknown) => {
    const msg = toUserMessage(error, '上传飞书失败，请检查飞书 CLI 配置。');
    toast.error(msg, {
      action: {
        label: '配置飞书',
        onClick: () => router.push('/settings?tab=feishu'),
      },
    });
  }, [router]);

  // Default Copy Transcript: 100% clean plain text without # or *
  const handleCopyTranscript = useCallback(async () => {
    const doc = await resolveTranscriptDocument();
    if (!doc) {
      toast.error('暂无可复制的转写内容');
      return;
    }
    const cleanText = renderDocumentAsPlainText(doc);
    try {
      await navigator.clipboard.writeText(cleanText);
    } catch (error) {
      toast.error(toUserMessage(error, '复制转写失败，请重试。'));
      return;
    }
    toast.success('转写已复制');
    await Analytics.trackCopy('transcript', {
      meeting_id: meeting.id,
      transcript_length: doc.nodes.length.toString(),
    }).catch(error => console.warn('Failed to track transcript copy:', error));
  }, [meeting?.id, resolveTranscriptDocument]);

  const handleCopyTranscriptMarkdown = useCallback(async () => {
    const doc = await resolveTranscriptDocument();
    if (!doc) {
      toast.error('暂无可复制的转写内容');
      return;
    }
    try {
      await navigator.clipboard.writeText(renderDocumentAsMarkdown(doc));
      toast.success('已复制 Markdown 格式转写');
    } catch (error) {
      toast.error(toUserMessage(error, '复制 Markdown 失败，请重试。'));
    }
  }, [resolveTranscriptDocument]);

  const handleExportTranscript = useCallback(async (format: ExportDocumentFormat) => {
    try {
      const doc = await resolveTranscriptDocument();
      if (!doc) {
        toast.error('暂无可导出的转写内容');
        return;
      }
      const baseTitle = `${meetingTitle || meeting?.title || '会议记录'} 转写`;
      await exportDocumentToDisk(doc, baseTitle, format, '转写');
    } catch (error) {
      toast.error(toUserMessage(error, '导出转写失败，请重试。'));
    }
  }, [exportDocumentToDisk, meeting?.title, meetingTitle, resolveTranscriptDocument]);

  const handleUploadTranscriptToFeishu = useCallback(async (mode?: string) => {
    if (uploadTranscriptRef.current) return;
    uploadTranscriptRef.current = true;
    const scope = uploadScopeRef.current;
    if (mountedRef.current && visibleMeetingRef.current === meeting.id) setIsUploadingTranscriptFeishu(true);
    try {
      const doc = await resolveTranscriptDocument();
      if (!doc) {
        toast.error('暂无可上传的转写内容');
        return;
      }
      const title = `${meetingTitle || meeting?.title || '会议记录'} 转写`;
      await uploadDocumentToFeishu(doc, title, mode);
    } catch (error) {
      handleFeishuError(error);
    } finally {
      if (mountedRef.current && visibleMeetingRef.current === meeting.id && scope === uploadScopeRef.current) {
        uploadTranscriptRef.current = false;
        setIsUploadingTranscriptFeishu(false);
      }
    }
  }, [handleFeishuError, isUploadingTranscriptFeishu, meeting?.title, meetingTitle, resolveTranscriptDocument, uploadDocumentToFeishu]);

  // Default Copy Summary: 100% clean plain text without # or *
  const handleCopySummary = useCallback(async () => {
    try {
      const doc = await resolveSummaryDocument();
      if (!doc) {
        toast.error('暂无可复制的纪要内容');
        return;
      }
      await navigator.clipboard.writeText(renderDocumentAsPlainText(doc));
      toast.success('纪要已复制');
      await Analytics.trackCopy('summary', {
        meeting_id: meeting.id,
        has_markdown: (!!aiSummary && 'markdown' in aiSummary).toString(),
      });
    } catch (error) {
      toast.error(toUserMessage(error, '复制纪要失败，请重试。'));
    }
  }, [aiSummary, meeting?.id, resolveSummaryDocument]);

  const handleCopySummaryMarkdown = useCallback(async () => {
    try {
      const doc = await resolveSummaryDocument();
      if (!doc) {
        toast.error('暂无可复制的纪要内容');
        return;
      }
      await navigator.clipboard.writeText(renderDocumentAsMarkdown(doc));
      toast.success('已复制 Markdown 格式纪要');
    } catch (error) {
      toast.error(toUserMessage(error, '复制 Markdown 失败，请重试。'));
    }
  }, [resolveSummaryDocument]);

  const handleExportSummary = useCallback(async (format: ExportDocumentFormat) => {
    try {
      const doc = await resolveSummaryDocument();
      if (!doc) {
        toast.error('暂无可导出的纪要内容');
        return;
      }
      const baseTitle = `${meetingTitle || meeting?.title || '会议纪要'}`;
      await exportDocumentToDisk(doc, baseTitle, format, '纪要');
    } catch (error) {
      toast.error(toUserMessage(error, '导出纪要失败，请重试。'));
    }
  }, [exportDocumentToDisk, meeting?.title, meetingTitle, resolveSummaryDocument]);

  const handleUploadSummaryToFeishu = useCallback(async (mode?: string) => {
    if (uploadSummaryRef.current) return;
    uploadSummaryRef.current = true;
    const scope = uploadScopeRef.current;
    if (mountedRef.current && visibleMeetingRef.current === meeting.id) setIsUploadingSummaryFeishu(true);
    try {
      const doc = await resolveSummaryDocument();
      if (!doc) {
        toast.error('暂无可上传的纪要内容');
        return;
      }
      const title = `${meetingTitle || meeting?.title || '会议纪要'}`;
      await uploadDocumentToFeishu(doc, title, mode);
    } catch (error) {
      handleFeishuError(error);
    } finally {
      if (mountedRef.current && visibleMeetingRef.current === meeting.id && scope === uploadScopeRef.current) {
        uploadSummaryRef.current = false;
        setIsUploadingSummaryFeishu(false);
      }
    }
  }, [handleFeishuError, isUploadingSummaryFeishu, meeting?.title, meetingTitle, resolveSummaryDocument, uploadDocumentToFeishu]);

  return {
    handleCopyTranscript,
    handleCopyTranscriptMarkdown,
    handleExportTranscript,
    handleUploadTranscriptToFeishu,
    isUploadingTranscriptFeishu,
    handleCopySummary,
    handleCopySummaryMarkdown,
    handleExportSummary,
    handleUploadSummaryToFeishu,
    isUploadingSummaryFeishu,
  };
}
