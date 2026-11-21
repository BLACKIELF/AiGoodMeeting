'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Plus,
  Send,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AgentBeginnerCard, FeishuBeginnerGuide } from '@/components/BeginnerCliGuide';
import type { FeishuStatusResponse } from '@/components/FeishuSettings';
import {
  AUTO_HANDOFF_EVENT,
  AgentHandoffConfig,
  AgentInstallationInfo,
  AutoHandoffPlan,
  DEFAULT_AUTO_HANDOFF_PLAN,
  FeishuChatItem,
  FeishuDeliveryMode,
  loadAutoHandoffPlan,
  saveAutoHandoffPlan,
  toggleAgentInPlan,
} from '@/types/agent-handoff';

function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__)
  );
}

interface QuickHandoffStripProps {
  mode: 'arm' | 'action';
  compact?: boolean;
  onExecuteNow?: (plan: AutoHandoffPlan) => void;
  className?: string;
}

export function QuickHandoffStrip({
  mode,
  compact = false,
  onExecuteNow,
  className = '',
}: QuickHandoffStripProps) {
  const [plan, setPlan] = useState<AutoHandoffPlan>(DEFAULT_AUTO_HANDOFF_PLAN);
  const [agents, setAgents] = useState<AgentInstallationInfo[]>([]);
  const [feishuStatus, setFeishuStatus] = useState<FeishuStatusResponse | null>(null);
  const [chats, setChats] = useState<FeishuChatItem[]>([]);
  const [checking, setChecking] = useState(false);
  const [showFeishuGuide, setShowFeishuGuide] = useState(false);
  const [showInstallPanel, setShowInstallPanel] = useState(false);

  const refreshEnv = useCallback(async () => {
    if (!isTauriRuntime()) return;
    setChecking(true);
    try {
      const [detected, feishu, savedCfg] = await Promise.all([
        invoke<AgentInstallationInfo[]>('agent_detect_installations').catch(() => []),
        invoke<FeishuStatusResponse>('feishu_check_status', {
          cliPath: null,
          profile: null,
        }).catch(() => null),
        invoke<AgentHandoffConfig>('agent_get_config').catch(() => null),
      ]);
      setAgents(detected);
      setFeishuStatus(feishu);
      if (feishu?.authenticated) {
        setShowFeishuGuide(false);
        const list = await invoke<FeishuChatItem[]>('feishu_list_chats').catch(() => []);
        setChats(list);
      }
      // Seed default Feishu group from saved settings if user hasn't picked one yet
      if (savedCfg) {
        setPlan((prev) => {
          if (prev.feishuChatId || !savedCfg.feishuChatId) return prev;
          const next: AutoHandoffPlan = {
            ...prev,
            feishuDeliveryMode: (savedCfg.feishuDeliveryMode as FeishuDeliveryMode) || prev.feishuDeliveryMode,
            feishuChatId: savedCfg.feishuChatId,
            feishuChatName: savedCfg.feishuChatName,
          };
          saveAutoHandoffPlan(next);
          return next;
        });
      }
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    setPlan(loadAutoHandoffPlan());
    void refreshEnv();
    if (typeof window === 'undefined') return;
    const onPlanEvent = (event: Event) => {
      const custom = event as CustomEvent<AutoHandoffPlan>;
      if (custom.detail) {
        setPlan(custom.detail);
      }
    };
    window.addEventListener(AUTO_HANDOFF_EVENT, onPlanEvent);
    return () => {
      window.removeEventListener(AUTO_HANDOFF_EVENT, onPlanEvent);
    };
  }, [refreshEnv]);

  const updatePlan = useCallback((next: AutoHandoffPlan) => {
    setPlan(next);
    saveAutoHandoffPlan(next);
  }, []);

  const readyAgents = useMemo(
    () => agents.filter((a) => a.executable),
    [agents],
  );
  const setupAgents = useMemo(
    () => agents.filter((a) => !a.executable),
    [agents],
  );
  const feishuReady = Boolean(feishuStatus?.installed && feishuStatus?.authenticated);

  // Show top 5 ready agents right on level 1 to keep strip clean; rest accessible via "+ 更多"
  const primaryAgents = readyAgents.slice(0, 5);
  const extraReadyAgents = readyAgents.slice(5);

  const selectedReadyCount = plan.enabledAgents.filter((id) =>
    readyAgents.some((a) => a.id === id),
  ).length;

  const summaryBadge = useMemo(() => {
    const parts: string[] = [];
    if (selectedReadyCount >= 2) {
      parts.push(`${selectedReadyCount} 个 Agent 协同`);
    } else if (selectedReadyCount === 1) {
      const one = readyAgents.find((a) => a.id === plan.enabledAgents[0]);
      if (one) parts.push(one.shortName);
    }
    if (plan.sendToFeishu) {
      parts.push(
        plan.feishuDeliveryMode === 'doc_and_group' && plan.feishuChatName
          ? `飞书群「${plan.feishuChatName}」`
          : plan.feishuDeliveryMode === 'doc_only'
            ? '飞书云文档'
            : '飞书私聊',
      );
    }
    if (parts.length === 0) {
      return mode === 'arm' ? '可随时勾选，录完自动执行' : '点选 Agent 直接执行';
    }
    return mode === 'arm' ? `完成后自动：${parts.join(' → ')}` : parts.join(' → ');
  }, [mode, plan, readyAgents, selectedReadyCount]);

  // Do not render empty clutter in non-Tauri unit test harnesses
  if (!isTauriRuntime() && agents.length === 0) {
    return null;
  }

  return (
    <section
      aria-label={mode === 'arm' ? '完成后自动联动' : '一键联动 Agent 与飞书'}
      className={`rounded-2xl border border-border/80 bg-card/65 backdrop-blur-md ${
        compact ? 'p-2.5 space-y-2' : 'px-3.5 py-2.5 space-y-2'
      } ${className}`}
    >
      {/* Header Line */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          <span>{mode === 'arm' ? '录完 / 转写完自动联动' : '一键交给 Agent'}</span>
          {selectedReadyCount >= 2 && (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
              多 Agent 协同
            </span>
          )}
        </div>
        <span className="text-[11px] text-muted-foreground truncate max-w-full">
          {summaryBadge}
        </span>
      </div>

      {/* First-Level Single-Row Direct Check Pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        {primaryAgents.map((agent) => {
          const checked = plan.enabledAgents.includes(agent.id);
          const order = checked ? plan.enabledAgents.indexOf(agent.id) : -1;
          return (
            <button
              key={agent.id}
              type="button"
              role="checkbox"
              aria-checked={checked}
              onClick={() => updatePlan(toggleAgentInPlan(plan, agent.id))}
              title={
                checked && order === 0 && selectedReadyCount >= 2
                  ? `${agent.name}（主控汇融）`
                  : `${agent.name}（点击勾选或取消）`
              }
              className={`inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs transition-colors cursor-pointer ${
                checked
                  ? 'border-primary/70 bg-primary/14 font-medium text-primary'
                  : 'border-border bg-background/60 text-foreground hover:bg-accent/50'
              }`}
            >
              <span
                className={`flex h-3.5 w-3.5 items-center justify-center rounded-full ${
                  checked ? 'bg-primary text-primary-foreground' : 'border border-muted-foreground/40'
                }`}
              >
                {checked && <Check className="h-2.5 w-2.5" aria-hidden="true" />}
              </span>
              <span>{agent.shortName}</span>
              {checked && order === 0 && selectedReadyCount >= 2 && (
                <span className="text-[10px] opacity-80">主</span>
              )}
            </button>
          );
        })}

        {/* Expand extra / uninstalled Agents with 1-click beginner install */}
        {(extraReadyAgents.length > 0 || setupAgents.length > 0 || readyAgents.length === 0) && (
          <button
            type="button"
            onClick={() => setShowInstallPanel((v) => !v)}
            className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-border bg-background/40 px-2.5 text-[11px] text-muted-foreground hover:bg-accent/40 hover:text-foreground cursor-pointer"
          >
            {readyAgents.length === 0 ? (
              <>
                <Wrench className="h-3 w-3" />
                <span>安装 Agent</span>
              </>
            ) : (
              <>
                <Plus className="h-3 w-3" />
                <span>更多 / 安装</span>
              </>
            )}
            {showInstallPanel ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        )}

        <span className="mx-0.5 h-4 w-px bg-border/80" aria-hidden="true" />

        {/* Feishu Direct Toggle or Beginner 1-Click Connect */}
        {feishuReady ? (
          <>
            <button
              type="button"
              role="checkbox"
              aria-checked={plan.sendToFeishu}
              onClick={() =>
                updatePlan({
                  ...plan,
                  sendToFeishu: !plan.sendToFeishu,
                  feishuDeliveryMode:
                    !plan.sendToFeishu && plan.feishuDeliveryMode === 'none'
                      ? 'doc_and_self'
                      : plan.feishuDeliveryMode,
                })
              }
              className={`inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs transition-colors cursor-pointer ${
                plan.sendToFeishu
                  ? 'border-emerald-500/60 bg-emerald-500/12 font-medium text-emerald-700 dark:text-emerald-300'
                  : 'border-border bg-background/60 text-foreground hover:bg-accent/50'
              }`}
            >
              <Send className="h-3 w-3" aria-hidden="true" />
              <span>发飞书</span>
            </button>

            {plan.sendToFeishu && (
              <select
                aria-label="选择飞书发送位置"
                value={
                  plan.feishuDeliveryMode === 'doc_and_group' && plan.feishuChatId
                    ? `group:${plan.feishuChatId}`
                    : plan.feishuDeliveryMode === 'doc_only'
                      ? 'doc_only'
                      : 'doc_and_self'
                }
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'doc_only') {
                    updatePlan({
                      ...plan,
                      feishuDeliveryMode: 'doc_only',
                      feishuChatId: '',
                      feishuChatName: '',
                    });
                  } else if (val === 'doc_and_self') {
                    updatePlan({
                      ...plan,
                      feishuDeliveryMode: 'doc_and_self',
                      feishuChatId: '',
                      feishuChatName: '',
                    });
                  } else if (val.startsWith('group:')) {
                    const cid = val.slice(6);
                    const found = chats.find((c) => c.chatId === cid);
                    updatePlan({
                      ...plan,
                      feishuDeliveryMode: 'doc_and_group',
                      feishuChatId: cid,
                      feishuChatName: found?.name || cid,
                    });
                  }
                }}
                className="h-7 max-w-[165px] rounded-full border border-border bg-background/80 px-2.5 text-[11px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="doc_and_self">云文档 + 私聊本人</option>
                <option value="doc_only">仅存飞书云文档</option>
                {plan.feishuChatId && !chats.some((c) => c.chatId === plan.feishuChatId) && (
                  <option value={`group:${plan.feishuChatId}`}>
                    群：{plan.feishuChatName || plan.feishuChatId}
                  </option>
                )}
                {chats.map((c) => (
                  <option key={c.chatId} value={`group:${c.chatId}`}>
                    群：{c.name}
                  </option>
                ))}
              </select>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={() => setShowFeishuGuide((v) => !v)}
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-amber-500/45 bg-amber-500/10 px-2.5 text-xs font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 cursor-pointer"
          >
            <Send className="h-3 w-3" aria-hidden="true" />
            <span>连接飞书（2 步新手引导）</span>
            {showFeishuGuide ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        )}

        {/* Direct Execute Button on First-Level Meeting Details */}
        {mode === 'action' && onExecuteNow && (
          <Button
            type="button"
            size="sm"
            className="ml-auto h-7 rounded-full px-3 text-xs cursor-pointer"
            onClick={() => {
              const effectiveAgents =
                plan.enabledAgents.length > 0
                  ? plan.enabledAgents
                  : readyAgents[0]
                    ? [readyAgents[0].id]
                    : [];
              onExecuteNow({
                ...plan,
                enabledAgents: effectiveAgents,
                feishuDeliveryMode: plan.sendToFeishu ? plan.feishuDeliveryMode : 'none',
              });
            }}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>
              {selectedReadyCount >= 2
                ? `一键 ${selectedReadyCount} Agent 协同执行`
                : '一键执行'}
            </span>
          </Button>
        )}
      </div>

      {/* Inline Beginner Guide for Feishu */}
      {showFeishuGuide && !feishuReady && (
        <FeishuBeginnerGuide
          installed={Boolean(feishuStatus?.installed)}
          authenticated={Boolean(feishuStatus?.authenticated)}
          checking={checking}
          onRecheck={refreshEnv}
          compact
        />
      )}

      {/* Inline Extra & Uninstalled Agents with 1-Click Beginner Installer */}
      {showInstallPanel && (
        <div className="space-y-2 rounded-xl border border-border/80 bg-background/60 p-2.5">
          {extraReadyAgents.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">其他已就绪：</span>
              {extraReadyAgents.map((agent) => {
                const checked = plan.enabledAgents.includes(agent.id);
                return (
                  <button
                    key={agent.id}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    onClick={() => updatePlan(toggleAgentInPlan(plan, agent.id))}
                    className={`inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs cursor-pointer ${
                      checked
                        ? 'border-primary/70 bg-primary/14 font-medium text-primary'
                        : 'border-border bg-card/60 text-foreground hover:bg-accent/50'
                    }`}
                  >
                    {checked && <Check className="h-3 w-3" />}
                    <span>{agent.shortName}</span>
                  </button>
                );
              })}
            </div>
          )}

          {setupAgents.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-medium text-muted-foreground">
                尚未安装的 Agent（点按钮一键在终端安装，装完点「重新检测」就能勾选）：
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {setupAgents.map((agent) => (
                  <AgentBeginnerCard key={agent.id} agent={agent} onRecheck={refreshEnv} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
