'use client';

import React, { useState, useEffect } from 'react';
import { ArrowLeft, Settings2, Mic, Database as DatabaseIcon, SparkleIcon, FlaskConical, Palette } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import { TranscriptSettings } from '@/components/TranscriptSettings';
import { RecordingSettings } from '@/components/RecordingSettings';
import { PreferenceSettings } from '@/components/PreferenceSettings';
import { SummaryModelSettings } from '@/components/SummaryModelSettings';
import { BetaSettings } from '@/components/BetaSettings';
import { useConfig } from '@/contexts/ConfigContext';
import { CardWorkspace } from '@/components/CardWorkspace';
import AppearanceSettings from '@/components/AppearanceSettings';

export default function SettingsPage() {
  const router = useRouter();
  const { transcriptModelConfig, setTranscriptModelConfig } = useConfig();

  const [activeTab, setActiveTab] = useState('appearance');

  // Load saved transcript configuration on mount
  useEffect(() => {
    const loadTranscriptConfig = async () => {
      try {
        const config = await invoke('api_get_transcript_config') as any;
        if (config) {
          console.log('Loaded saved transcript config:', config);
          setTranscriptModelConfig({
            provider: config.provider || 'localWhisper',
            model: config.model || 'large-v3',
            apiKey: config.apiKey || null
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
    <div className="agb-page h-screen min-w-0 flex flex-col">
      {/* Fixed Header */}
      <div className="agb-header sticky top-0 z-10 border-b border-border">
        <div className="max-w-6xl mx-auto px-5 py-5 sm:px-7">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              aria-label="返回上一页"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div><h1 className="text-xl font-semibold tracking-tight">设置</h1><p className="mt-0.5 text-xs text-muted-foreground">外观、录音与本地模型</p></div>
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto min-h-0 custom-scrollbar">
        <div className="max-w-6xl mx-auto px-5 py-5 sm:px-7">
          <CardWorkspace id="settings" cards={cards} value={activeTab} onValueChange={setActiveTab} />
        </div>
      </div>
    </div>
  );
};
