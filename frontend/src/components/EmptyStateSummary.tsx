'use client';

import { motion } from 'framer-motion';
import { FileQuestion, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toUserMessage } from '@/lib/user-message';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface EmptyStateSummaryProps {
  onGenerate: () => void;
  hasModel: boolean;
  isGenerating?: boolean;
  error?: string | null;
}

export function EmptyStateSummary({
  onGenerate,
  hasModel,
  isGenerating = false,
  error = null,
}: EmptyStateSummaryProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex min-h-0 flex-1 flex-col items-center justify-center p-8 text-center"
    >
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-muted/60">
        <FileQuestion className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="mb-2 text-base font-semibold text-foreground">
        这场会议还没有纪要
      </h3>
      <p className="mb-5 max-w-xs text-sm leading-relaxed text-muted-foreground">
        从会议转写中整理讨论重点、决策与待办。
      </p>

      {error && (
        <p role="alert" className="mb-4 max-w-md rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {toUserMessage(error, '纪要生成失败，请检查模型设置后重试。')}
        </p>
      )}

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div>
              <Button
                onClick={onGenerate}
                disabled={!hasModel || isGenerating}
                className="gap-2"
              >
                <Sparkles className="w-4 h-4" />
                {isGenerating ? '正在生成…' : error ? '重新生成纪要' : '生成会议纪要'}
              </Button>
            </div>
          </TooltipTrigger>
          {!hasModel && (
            <TooltipContent>
              <p>请先在模型设置中选择纪要模型</p>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>

      {!hasModel && (
        <p className="mt-3 text-xs text-muted-foreground">
          请先在模型设置中选择纪要模型
        </p>
      )}
    </motion.div>
  );
}
