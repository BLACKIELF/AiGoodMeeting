"use client";

import { ModelConfig, ModelSettingsModal } from '@/components/ModelSettingsModal';
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DialogTitle,
} from "@/components/ui/dialog"
import { VisuallyHidden } from "@/components/ui/visually-hidden"
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sparkles, Settings, Loader2, FileText, Check, Square } from 'lucide-react';
import Analytics from '@/lib/analytics';
import { useState, useEffect, ReactNode } from 'react';

interface SummaryGeneratorButtonGroupProps {
  languageSlot?: ReactNode;
  modelConfig: ModelConfig;
  setModelConfig: (config: ModelConfig | ((prev: ModelConfig) => ModelConfig)) => void;
  onSaveModelConfig: (config?: ModelConfig) => Promise<void>;
  onGenerateSummary: (customPrompt: string) => Promise<void>;
  onStopGeneration: () => void;
  customPrompt: string;
  summaryStatus: 'idle' | 'processing' | 'summarizing' | 'regenerating' | 'completed' | 'error';
  availableTemplates: Array<{ id: string, name: string, description: string }>;
  selectedTemplate: string;
  onTemplateSelect: (templateId: string, templateName: string) => void;
  hasTranscripts?: boolean;
  hasSummary?: boolean;
  isModelConfigLoading?: boolean;
  onOpenModelSettings?: (openFn: () => void) => void;
}

export function SummaryGeneratorButtonGroup({
  modelConfig,
  setModelConfig,
  onSaveModelConfig,
  onGenerateSummary,
  onStopGeneration,
  customPrompt,
  summaryStatus,
  availableTemplates,
  selectedTemplate,
  onTemplateSelect,
  hasTranscripts = true,
  hasSummary = false,
  isModelConfigLoading = false,
  onOpenModelSettings,
  languageSlot
}: SummaryGeneratorButtonGroupProps) {
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);

  // Expose the function to open the modal via callback registration
  useEffect(() => {
    if (onOpenModelSettings) {
      // Register our open dialog function with the parent by calling the callback
      // This allows the parent to store a reference to this function
      const openDialog = () => {
        console.log('📱 Opening model settings dialog via callback');
        setSettingsDialogOpen(true);
      };

      // Call the parent's callback with our open function
      // Note: This assumes onOpenModelSettings accepts a function parameter
      // We'll need to adjust the signature
      onOpenModelSettings(openDialog);
    }
  }, [onOpenModelSettings]);

  if (!hasTranscripts) {
    return null;
  }

  const isGenerating = summaryStatus === 'processing' || summaryStatus === 'summarizing' || summaryStatus === 'regenerating';

  return (
    <div className="flex flex-wrap items-start gap-2">
      {/* Generate Summary or Stop button */}
      {isGenerating ? (
        <Button
          variant="outline"
          size="sm"
          className="border-destructive/25 bg-destructive/10 px-3 text-destructive hover:bg-destructive/15"
          onClick={() => {
            Analytics.trackButtonClick('stop_summary_generation', 'meeting_details');
            onStopGeneration();
          }}
          title="停止生成纪要"
        >
          <Square size={18} fill="currentColor" />
          <span>停止</span>
        </Button>
      ) : (
        <Button
          variant="default"
          size="sm"
          className="px-3 gap-2"
          onClick={() => {
            Analytics.trackButtonClick('generate_summary', 'meeting_details');
            void onGenerateSummary(customPrompt);
          }}
          disabled={isModelConfigLoading}
          title={
            isModelConfigLoading
              ? '正在读取模型设置…'
              : hasSummary ? '重新生成纪要' : '生成会议纪要'
          }
        >
          {isModelConfigLoading ? (
            <>
              <Loader2 className="animate-spin" size={18} />
              <span>准备中…</span>
            </>
          ) : (
            <>
              <Sparkles size={18} />
              <span>{hasSummary ? '重新生成' : '生成纪要'}</span>
            </>
          )}
        </Button>
      )}

      <details className="relative">
        <summary className="flex h-8 cursor-pointer list-none items-center rounded-md px-2.5 text-xs text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">纪要选项</summary>
        <div className="absolute left-0 top-full z-20 mt-1 flex min-w-44 flex-col items-stretch gap-2 rounded-xl border border-border bg-popover p-3 shadow-lg">
          {languageSlot}

      {/* Settings button */}
      <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            title="纪要模型设置"
            aria-label="纪要模型设置"
          >
            <Settings />
            <span>纪要模型</span>
          </Button>
        </DialogTrigger>
        <DialogContent
          aria-describedby={undefined}
        >
          <VisuallyHidden>
            <DialogTitle>纪要模型设置</DialogTitle>
          </VisuallyHidden>
          <ModelSettingsModal
            onSave={async (config) => {
              await onSaveModelConfig(config);
              setSettingsDialogOpen(false);
            }}
            modelConfig={modelConfig}
            setModelConfig={setModelConfig}
            skipInitialFetch={true}
            layout="dialog"
          />
        </DialogContent>
      </Dialog>

      {/* Template selector dropdown */}
      {availableTemplates.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              title="选择纪要模板"
              aria-label="选择纪要模板"
            >
              <FileText />
              <span>纪要模板</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {availableTemplates.map((template) => (
              <DropdownMenuItem
                key={template.id}
                onClick={() => onTemplateSelect(template.id, template.name)}
                title={template.description}
                className="flex items-center justify-between gap-2"
              >
                <span>{template.name}</span>
                {selectedTemplate === template.id && (
                  <Check className="h-4 w-4 text-primary" />
                )}
              </DropdownMenuItem>
            ))}

          </DropdownMenuContent>
        </DropdownMenu>
      )}
        </div>
      </details>
    </div>
  );
}
