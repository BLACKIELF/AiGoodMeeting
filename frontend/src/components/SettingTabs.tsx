'use client';

import { useState } from 'react';
import { AudioLines, Info, Mic, Sparkles } from 'lucide-react';
import { CardWorkspace } from '@/components/CardWorkspace';
import { ModelConfig, ModelSettingsModal } from "./ModelSettingsModal"
import { TranscriptModelProps, TranscriptSettings } from "./TranscriptSettings"
import { RecordingSettings } from "./RecordingSettings"
import { About } from "./About";

interface SettingTabsProps {
    modelConfig: ModelConfig;
    setModelConfig: (config: ModelConfig | ((prev: ModelConfig) => ModelConfig)) => void;
    onSave: (config: ModelConfig) => void;
    transcriptModelConfig: TranscriptModelProps;
    setTranscriptModelConfig: (config: TranscriptModelProps) => void;
    onSaveTranscript: (config: TranscriptModelProps) => void;
    setSaveSuccess: (success: boolean | null) => void;
    defaultTab?: string;
}

export function SettingTabs({ 
    modelConfig, 
    setModelConfig, 
    onSave, 
    setSaveSuccess,
    defaultTab = "transcriptSettings",
    transcriptModelConfig,
    setTranscriptModelConfig,
    onSaveTranscript,
}: SettingTabsProps) {

    const [activeTab, setActiveTab] = useState(defaultTab);

    const handleTabChange = (nextTab: string) => {
        if (nextTab === activeTab) return;
        setActiveTab(nextTab);
        if (nextTab && nextTab !== activeTab) {
            setSaveSuccess(null); // Reset save success only when switching to another card
        }
    };

    return (
        <CardWorkspace
            id="setting-dialog"
            className="w-full h-[min(560px,calc(100vh-10rem))] min-h-[360px] custom-scrollbar"
            value={activeTab}
            onValueChange={handleTabChange}
            cards={[
                {
                    id: 'transcriptSettings', title: '转写', description: '选择语音转写模型', icon: AudioLines,
                    content: <TranscriptSettings transcriptModelConfig={transcriptModelConfig} setTranscriptModelConfig={setTranscriptModelConfig} />,
                },
                {
                    id: 'modelSettings', title: '会议纪要', description: '选择整理纪要的模型', icon: Sparkles,
                    content: <ModelSettingsModal modelConfig={modelConfig} setModelConfig={setModelConfig} onSave={onSave} />,
                },
                { id: 'recordingSettings', title: '录音偏好', description: '保存位置与音频设备', icon: Mic, content: <RecordingSettings /> },
                { id: 'about', title: '关于', description: '版本与开源许可', icon: Info, content: <About /> },
            ]}
        />
    )
}
