'use client';

import React, { useState, useEffect } from 'react';
import { ArrowLeft, Bot, Settings2, Mic, Database as DatabaseIcon, SparkleIcon, FlaskConical, Palette, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import { TranscriptSettings } from '@/components/TranscriptSettings';
import { RecordingSettings } from '@/components/RecordingSettings';
import { PreferenceSettings } from '@/components/PreferenceSettings';
import { SummaryModelSettings } from '@/components/SummaryModelSettings';
import { BetaSettings } from '@/components/BetaSettings';
import { FeishuSettings } from '@/components/FeishuSettings';
import { AgentSettings } from '@/components/AgentSettings';
import { useConfig } from '@/contexts/ConfigContext';
import { CardWorkspace } from '@/components/CardWorkspace';
import { SurpriseButton } from '@/components/SurpriseButton';
import AppearanceSettings from '@/components/AppearanceSettings';

export default function SettingsPage() {
  const router = useRouter();
  const { transcriptModelConfig, setTranscriptModelConfig } = useConfig();

  const [activeTab, setActiveTab] = useState('appearance');

  useEffect(() => {
    if (typeof window === 'undefined' || !window.location?.search) return;
    const requested = new URLSearchParams(window.location.search).get('tab');
    if (requested) {
      setActiveTab(requested);
    }
  }, []);

  // Load saved transcript configuration on mount
  useEffect(() => {
    const loadTranscriptConfig = async () => {
      try {
        const config = await invoke('api_get_transcript_config') as any;
        if (config) {
          setTranscriptModelConfig({
            provider: config.provider || 'localWhisper',
            model: config.model || 'large-v3',
            apiKey: config.apiKey || null,
          });
        }
      } catch (error) {
        console.error('Failed to load transcript config:', error);
      }
    };
    loadTranscriptConfig();
  }, [setTranscriptModelConfig]);

  const cards = [
    { id: 'appearance', title: '外观', description: '皮肤、明暗模式与材质', icon: Palette, content: <AppearanceSettings /> },
    { id: 'agent', title: 'Agent 联动', description: '检测本地 Agent 与一键执行发飞书', icon: Bot, content: <AgentSettings /> },
    { id: 'feishu', title: '飞书同步', description: '配置飞书 CLI 与默认上传目录', icon: Send, content: <FeishuSettings /> },
    { id: 'general', title: '通用', description: '通知、数据位置与使用统计', icon: Settings2, content: <PreferenceSettings /> },
    { id: 'recording', title: '录音', description: '录音保存与音频设备', icon: Mic, content: <RecordingSettings /> },
    {
      id: 'Transcriptionmodels', title: '转写模型', description: '选择本地语音转写模型', icon: DatabaseIcon,
      content: <TranscriptSettings transcriptModelConfig={transcriptModelConfig} setTranscriptModelConfig={setTranscriptModelConfig} />,
    },
    { id: 'summaryModels', title: '纪要模型', description: '整理纪要的模型与语言', icon: SparkleIcon, content: <SummaryModelSettings /> },
    { id: 'beta', title: '实验功能', description: '导入音频与重新转写', icon: FlaskConical, content: <BetaSettings /> },
  ];

  return (
    <div className="agb-page flex h-dvh min-h-0 min-w-0 flex-col">
      <header className="agb-header shrink-0 border-b border-border px-5 py-3.5 sm:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
            aria-label="返回上一页"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">设置</h1>
            <p className="text-xs text-muted-foreground">外观、飞书同步、录音与本地模型</p>
          </div>
          <div className="ml-auto shrink-0">
            <SurpriseButton />
          </div>
        </div>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden px-3 py-3 sm:px-5 sm:py-4">
        <CardWorkspace id="settings" cards={cards} value={activeTab} onValueChange={setActiveTab} className="h-full" />
      </div>
    </div>
  );
}
