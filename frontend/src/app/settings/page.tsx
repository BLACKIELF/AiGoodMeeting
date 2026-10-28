'use client';

import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { ArrowLeft, Settings2, Mic, Database as DatabaseIcon, SparkleIcon, FlaskConical, Palette } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import { motion } from 'framer-motion';
import { TranscriptSettings } from '@/components/TranscriptSettings';
import { RecordingSettings } from '@/components/RecordingSettings';
import { PreferenceSettings } from '@/components/PreferenceSettings';
import { SummaryModelSettings } from '@/components/SummaryModelSettings';
import { BetaSettings } from '@/components/BetaSettings';
import { useConfig } from '@/contexts/ConfigContext';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import AppearanceSettings from '@/components/AppearanceSettings';

// Tabs configuration (constant)
const TABS = [
  { value: 'appearance', label: '外观', icon: Palette },
  { value: 'general', label: '通用', icon: Settings2 },
  { value: 'recording', label: '录音', icon: Mic },
  { value: 'Transcriptionmodels', label: '转写模型', icon: DatabaseIcon },
  { value: 'summaryModels', label: '纪要模型', icon: SparkleIcon },
  { value: 'beta', label: '实验功能', icon: FlaskConical }
] as const;

export default function SettingsPage() {
  const router = useRouter();
  const { transcriptModelConfig, setTranscriptModelConfig } = useConfig();

  // Animation state for tabs
  const [activeTab, setActiveTab] = useState('appearance');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [underlineStyle, setUnderlineStyle] = useState({ left: 0, width: 0 });

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

  // Update underline position when active tab changes
  useLayoutEffect(() => {
    const activeIndex = TABS.findIndex(tab => tab.value === activeTab);
    const activeTabElement = tabRefs.current[activeIndex];

    if (activeTabElement) {
      const { offsetLeft, offsetWidth } = activeTabElement;
      setUnderlineStyle({ left: offsetLeft, width: offsetWidth });
    }
  }, [activeTab]);

  return (
    <div className="agb-page h-screen min-w-0 flex flex-col">
      {/* Fixed Header */}
      <div className="agb-header sticky top-0 z-10 border-b border-border">
        <div className="max-w-5xl mx-auto px-5 py-5 sm:px-7">
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
        <div className="max-w-5xl mx-auto px-5 py-5 sm:px-7">
          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="bg-transparent relative rounded-none border-b border-border p-0 h-auto w-full justify-start overflow-x-auto">
              {TABS.map((tab, index) => {
                const Icon = tab.icon;
                return (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    ref={el => { tabRefs.current[index] = el }}
                    className="flex shrink-0 items-center gap-2 px-3 py-3 bg-transparent rounded-none border-0 data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none text-muted-foreground hover:text-foreground relative z-10 text-sm"
                  >
                    <Icon className="w-4 h-4" />
                    {tab.label}
                  </TabsTrigger>
                );
              })}

              <motion.div
                className="absolute bottom-0 z-20 h-0.5 bg-primary"
                layoutId="underline"
                style={{ left: underlineStyle.left, width: underlineStyle.width }}
                transition={{ type: 'spring', stiffness: 400, damping: 40 }}
              />
            </TabsList>

            <TabsContent value="appearance" className="mt-5">
              <AppearanceSettings />
            </TabsContent>
            <TabsContent value="general" className="mt-5">
              <PreferenceSettings />
            </TabsContent>
            <TabsContent value="recording" className="mt-5">
              <div className="agb-card p-5"><RecordingSettings /></div>
            </TabsContent>
            <TabsContent value="Transcriptionmodels" className="mt-5">
              <div className="agb-card p-5">
              <TranscriptSettings
                transcriptModelConfig={transcriptModelConfig}
                setTranscriptModelConfig={setTranscriptModelConfig}
              />
              </div>
            </TabsContent>
            <TabsContent value="summaryModels" className="mt-5">
              <SummaryModelSettings />
            </TabsContent>
            <TabsContent value="beta" className="mt-6">
              <BetaSettings />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
};
