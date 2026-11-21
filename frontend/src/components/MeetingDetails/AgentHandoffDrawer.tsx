'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useRouter } from 'next/navigation';
import {
  Bot,
  Check,
  CheckCircle2,
  CircleAlert,
  Copy,
  ExternalLink,
  FolderOpen,
  History,
  Loader2,
  Play,
  RefreshCw,
  Send,
  Settings2,
  Sparkles,
  Square,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { FeishuBeginnerGuide } from '@/components/BeginnerCliGuide';
import type { FeishuStatusResponse } from '@/components/FeishuSettings';
import { toUserMessage } from '@/lib/user-message';
import {
  AgentHandoffConfig,
  AgentInstallationInfo,
  AgentProgressEvent,
  AgentRunRecord,
  AutoHandoffPlan,
  DEFAULT_AGENT_HANDOFF_CONFIG,
  FEISHU_DELIVERY_OPTIONS,
  FeishuChatItem,
  FeishuDeliveryMode,
  ManualHandoffResponse,
  buildDefaultClarificationAnswers,
  feishuDeliveryModeLabel,
  resolvePreferredAgentId,
  splitLeadAndCollaborators,
  toClarificationAnswerList,
} from '@/types/agent-handoff';

interface AgentHandoffDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meetingId: string;
  meetingTitle: string;
  autoLaunchPlan?: AutoHandoffPlan | null;
  onAutoLaunchConsumed?: () => void;
}

export function AgentHandoffDrawer({
  open,
  onOpenChange,
  meetingId,
  meetingTitle,
  autoLaunchPlan = null,
  onAutoLaunchConsumed,
}: AgentHandoffDrawerProps) {
  const router = useRouter();
  const [config, setConfig] = useState<AgentHandoffConfig>(DEFAULT_AGENT_HANDOFF_CONFIG);
  const [agents, setAgents] = useState<AgentInstallationInfo[]>([]);
  const [feishuStatus, setFeishuStatus] = useState<FeishuStatusResponse | null>(null);
  const [chats, setChats] = useState<FeishuChatItem[]>([]);
  const [loadingChats, setLoadingChats] = useState(false);

  // Supports selecting 1 (single) or multiple (collaborative) Agents
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>(['codex']);
  const [instruction, setInstruction] = useState<string>('');
  const [deliveryMode, setDeliveryMode] = useState<FeishuDeliveryMode>('doc_and_group');
  const [selectedChatId, setSelectedChatId] = useState<string>('');
  const [selectedChatName, setSelectedChatName] = useState<string>('');

  const [activeRun, setActiveRun] = useState<AgentRunRecord | null>(null);
  const [pastRuns, setPastRuns] = useState<AgentRunRecord[]>([]);
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [isBusy, setIsBusy] = useState(false);
  const [isResendingFeishu, setIsResendingFeishu] = useState(false);
  const [liveStatusText, setLiveStatusText] = useState<string>('');
  const [liveLogs, setLiveLogs] = useState<string[]>([]);
  const [manualFallback, setManualFallback] = useState<ManualHandoffResponse | null>(null);
  const [readyForAutoLaunch, setReadyForAutoLaunch] = useState(false);

  const activeRunIdRef = useRef<string | null>(null);
  activeRunIdRef.current = activeRun?.runId ?? null;
  const autoLaunchFiredRef = useRef<AutoHandoffPlan | null>(null);

  const refreshFeishu = useCallback(async () => {
    setLoadingChats(true);
    try {
      const status = await invoke<FeishuStatusResponse>('feishu_check_status', {
        cliPath: null,
        profile: null,
      });
      setFeishuStatus(status);
      if (status.authenticated) {
        const list = await invoke<FeishuChatItem[]>('feishu_list_chats');
        setChats(list);
      }
    } catch {
      // Non-fatal
    } finally {
      setLoadingChats(false);
    }
  }, []);

  const loadDrawerState = useCallback(async () => {
    try {
      const [cfg, detected, runs] = await Promise.all([
        invoke<AgentHandoffConfig>('agent_get_config'),
        invoke<AgentInstallationInfo[]>('agent_detect_installations'),
        invoke<AgentRunRecord[]>('agent_list_runs', { meetingId }),
      ]);
      const merged: AgentHandoffConfig = { ...DEFAULT_AGENT_HANDOFF_CONFIG, ...cfg };
      setConfig(merged);
      setAgents(detected);
      setPastRuns(runs);
      if (autoLaunchPlan && autoLaunchPlan.enabledAgents.length > 0) {
        const validIds = autoLaunchPlan.enabledAgents.filter((id) =>
          detected.some((a) => a.id === id && a.installed),
        );
        setSelectedAgentIds(
          validIds.length > 0 ? validIds : [resolvePreferredAgentId(merged.defaultAgent, detected)],
        );
        setDeliveryMode(
          autoLaunchPlan.sendToFeishu ? autoLaunchPlan.feishuDeliveryMode : 'none',
        );
        setSelectedChatId(autoLaunchPlan.feishuChatId || merged.feishuChatId || '');
        setSelectedChatName(autoLaunchPlan.feishuChatName || merged.feishuChatName || '');
      } else {
        setSelectedAgentIds([resolvePreferredAgentId(merged.defaultAgent, detected)]);
        setDeliveryMode((merged.feishuDeliveryMode as FeishuDeliveryMode) || 'doc_and_group');
        setSelectedChatId(merged.feishuChatId || '');
        setSelectedChatName(merged.feishuChatName || '');
      }
      setReadyForAutoLaunch(true);
      void refreshFeishu();
    } catch (err) {
      toast.error(toUserMessage(err, '读取 Agent 联动状态失败'));
    }
  }, [meetingId, autoLaunchPlan, refreshFeishu]);

  useEffect(() => {
    if (!open) {
      setReadyForAutoLaunch(false);
      return;
    }
    setManualFallback(null);
    void loadDrawerState();
  }, [open, loadDrawerState]);

  useEffect(() => {
    if (!open) return;
    let unlisten: (() => void) | null = null;
    void listen<AgentProgressEvent>('agent-handoff-progress', (event) => {
      const payload = event.payload;
      if (payload.meetingId !== meetingId) return;
      if (activeRunIdRef.current && payload.runId !== activeRunIdRef.current) return;
      setLiveStatusText(payload.message);
      if (payload.logLine) {
        setLiveLogs((prev) => [...prev.slice(-60), payload.logLine!]);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [open, meetingId]);

  const { leadAgentId, collaboratorAgentIds } = useMemo(
    () => splitLeadAndCollaborators(selectedAgentIds),
    [selectedAgentIds],
  );
  const leadAgent = useMemo(
    () => agents.find((a) => a.id === leadAgentId) ?? null,
    [agents, leadAgentId],
  );
  const feishuReady = Boolean(feishuStatus?.installed && feishuStatus?.authenticated);

  const toggleAgentSelection = (id: string) => {
    setSelectedAgentIds((prev) => {
      if (prev.includes(id)) {
        if (prev.length === 1) return prev; // Keep at least 1 selected
        return prev.filter((x) => x !== id);
      }
      return [...prev, id];
    });
  };

  const runExecutionPhase = useCallback(
    async (
      run: AgentRunRecord,
      answers: ReturnType<typeof toClarificationAnswerList>,
      modeOverride?: FeishuDeliveryMode,
      chatIdOverride?: string,
      chatNameOverride?: string,
    ) => {
      setIsBusy(true);
      const hasCollabs = (run.collaboratorAgentIds?.length ?? 0) > 0;
      setLiveStatusText(
        hasCollabs
          ? `多 Agent 协同中（${run.agentName} + ${run.collaboratorAgentNames?.join(' + ')}）…`
          : `${run.agentName} 正在执行任务并生成成果…`,
      );
      setActiveRun({ ...run, status: 'executing' });
      try {
        const completed = await invoke<AgentRunRecord>('agent_execute_run', {
          request: {
            runId: run.runId,
            meetingId: run.meetingId,
            answers,
            collaboratorAgentIds: run.collaboratorAgentIds ?? [],
            feishuDeliveryMode: modeOverride ?? deliveryMode,
            feishuChatId: chatIdOverride ?? selectedChatId,
            feishuChatName: chatNameOverride ?? selectedChatName,
          },
        });
        setActiveRun(completed);
        setPastRuns((prev) => [completed, ...prev.filter((r) => r.runId !== completed.runId)]);
        if (completed.status === 'completed') {
          toast.success(completed.feishuDelivery?.message || 'Agent 已完成执行');
        } else {
          toast.warning(completed.feishuDelivery?.message || 'Agent 已完成产出，请查看飞书推送提示');
        }
      } catch (err) {
        const msg = toUserMessage(err, 'Agent 执行失败');
        setActiveRun((prev) => (prev ? { ...prev, status: 'error', error: msg } : null));
        toast.error(msg);
      } finally {
        setIsBusy(false);
        setLiveStatusText('');
      }
    },
    [deliveryMode, selectedChatId, selectedChatName],
  );

  const startWithSelection = useCallback(
    async (
      agentIdsToUse: string[],
      modeToUse: FeishuDeliveryMode,
      chatIdToUse: string,
      chatNameToUse: string,
    ) => {
      const { leadAgentId: leadId, collaboratorAgentIds: collabIds } =
        splitLeadAndCollaborators(agentIdsToUse);
      const chosenLead = agents.find((a) => a.id === leadId) ?? null;
      if (!chosenLead) {
        toast.error('请先选择可用的本地 Agent');
        return;
      }

      if (!chosenLead.executable) {
        try {
          setIsBusy(true);
          const res = await invoke<ManualHandoffResponse>('agent_prepare_manual_handoff', {
            meetingId,
            agentId: chosenLead.id,
            userInstruction: instruction.trim() || null,
          });
          setManualFallback(res);
          try {
            await navigator.clipboard.writeText(res.promptText);
            toast.success(`${res.message}（提示词已复制到剪贴板）`);
          } catch {
            toast.success(res.message);
          }
        } catch (err) {
          toast.error(toUserMessage(err, '准备交接包失败'));
        } finally {
          setIsBusy(false);
        }
        return;
      }

      setManualFallback(null);
      setLiveLogs([]);
      setIsBusy(true);
      const collabNames = collabIds
        .map((cid) => agents.find((a) => a.id === cid)?.shortName)
        .filter(Boolean);
      setLiveStatusText(
        collabNames.length > 0
          ? `正在由 ${chosenLead.shortName} 主控（协同：${collabNames.join(' + ')}）审阅完整转写…`
          : `正在调用 ${chosenLead.name} 审阅完整转写并检查信息完整性…`,
      );

      try {
        const preflightRun = await invoke<AgentRunRecord>('agent_start_preflight', {
          request: {
            meetingId,
            agentId: chosenLead.id,
            collaboratorAgentIds: collabIds,
            userInstruction: instruction.trim() || null,
            workspaceDir: config.workspaceDir || null,
            feishuDeliveryMode: modeToUse,
            feishuChatId: chatIdToUse,
            feishuChatName: chatNameToUse,
          },
        });
        setActiveRun(preflightRun);
        setPastRuns((prev) => [preflightRun, ...prev.filter((r) => r.runId !== preflightRun.runId)]);

        if (preflightRun.status === 'needs_clarification' && preflightRun.preflight?.questions?.length) {
          setAnswerDrafts(buildDefaultClarificationAnswers(preflightRun.preflight.questions));
          setIsBusy(false);
          setLiveStatusText('');
          toast.info('Agent 提出了几个确认问题，答完后立即执行');
          return;
        }

        if (config.autoExecuteWhenReady) {
          toast.info('信息已完善，已自动开始执行…');
          await runExecutionPhase(preflightRun, [], modeToUse, chatIdToUse, chatNameToUse);
        } else {
          setIsBusy(false);
          setLiveStatusText('');
        }
      } catch (err) {
        const msg = toUserMessage(err, 'Agent 预检失败');
        setIsBusy(false);
        setLiveStatusText('');
        toast.error(msg);
      }
    },
    [agents, config.autoExecuteWhenReady, config.workspaceDir, instruction, meetingId, runExecutionPhase],
  );

  // Auto-fire immediately when opened via first-level 「一键执行」 or post-recording/import armed plan
  useEffect(() => {
    if (
      !open ||
      !readyForAutoLaunch ||
      !autoLaunchPlan ||
      autoLaunchPlan.enabledAgents.length === 0 ||
      autoLaunchFiredRef.current === autoLaunchPlan ||
      isBusy
    ) {
      return;
    }
    autoLaunchFiredRef.current = autoLaunchPlan;
    const validIds = autoLaunchPlan.enabledAgents.filter((id) =>
      agents.some((a) => a.id === id && a.installed),
    );
    const chosenIds =
      validIds.length > 0 ? validIds : [resolvePreferredAgentId(config.defaultAgent, agents)];
    const modeToUse: FeishuDeliveryMode = autoLaunchPlan.sendToFeishu
      ? autoLaunchPlan.feishuDeliveryMode
      : 'none';
    const chatIdToUse = autoLaunchPlan.feishuChatId || config.feishuChatId || '';
    const chatNameToUse = autoLaunchPlan.feishuChatName || config.feishuChatName || '';
    onAutoLaunchConsumed?.();
    void startWithSelection(chosenIds, modeToUse, chatIdToUse, chatNameToUse);
  }, [
    open,
    readyForAutoLaunch,
    autoLaunchPlan,
    agents,
    config.defaultAgent,
    config.feishuChatId,
    config.feishuChatName,
    isBusy,
    onAutoLaunchConsumed,
    startWithSelection,
  ]);

  const handleStartOneClick = async () => {
    await startWithSelection(selectedAgentIds, deliveryMode, selectedChatId, selectedChatName);
  };

  const handleConfirmAndExecute = async () => {
    if (!activeRun) return;
    const questions = activeRun.preflight?.questions ?? [];
    const answers = toClarificationAnswerList(questions, answerDrafts);
    await runExecutionPhase(activeRun, answers);
  };

  const handleCancelActive = async () => {
    if (!activeRun?.runId) return;
    try {
      await invoke<boolean>('agent_cancel_run', { runId: activeRun.runId });
      toast.info('正在取消本次 Agent 任务…');
    } catch {
      // Ignore
    }
  };

  const handleResendFeishu = async () => {
    if (!activeRun) return;
    setIsResendingFeishu(true);
    try {
      const updated = await invoke<AgentRunRecord>('agent_resend_feishu', {
        meetingId: activeRun.meetingId,
        runId: activeRun.runId,
        deliveryMode,
        chatId: selectedChatId,
        chatName: selectedChatName,
      });
      setActiveRun(updated);
      setPastRuns((prev) => [updated, ...prev.filter((r) => r.runId !== updated.runId)]);
      if (updated.status === 'completed') {
        toast.success(updated.feishuDelivery?.message || '已发送到飞书');
      } else {
        toast.warning(updated.feishuDelivery?.message || '飞书推送仍有未完成项');
      }
    } catch (err) {
      toast.error(toUserMessage(err, '补发飞书失败'));
    } finally {
      setIsResendingFeishu(false);
    }
  };

  const handleOpenExternal = async (url: string) => {
    try {
      await invoke('open_external_url', { url });
    } catch {
      toast.error('无法打开飞书链接');
    }
  };

  const handleOpenRunFolder = async (dir: string) => {
    try {
      await invoke('agent_open_run_folder', { runDir: dir });
    } catch (err) {
      toast.error(toUserMessage(err, '打开产物目录失败'));
    }
  };

  const resetToNewRun = () => {
    setActiveRun(null);
    setLiveLogs([]);
    setLiveStatusText('');
    setManualFallback(null);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        <SheetHeader className="shrink-0 border-b border-border px-5 py-4 pr-12">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
              <span>交给 Agent 执行</span>
              {collaboratorAgentIds.length > 0 && (
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  {selectedAgentIds.length} Agent 协同
                </span>
              )}
            </SheetTitle>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground"
              onClick={() => {
                onOpenChange(false);
                router.push('/settings?tab=agent');
              }}
            >
              <Settings2 className="h-3.5 w-3.5" />
              <span>设置</span>
            </Button>
          </div>
          <SheetDescription className="truncate text-xs">
            当前会议：{meetingTitle}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Compose View */}
          {!activeRun && (
            <>
              {/* Multi-Select Agent Picker */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground">
                    勾选执行 Agent（可多选协同，首选项为主控）
                  </label>
                  <span className="text-[11px] text-muted-foreground">
                    {agents.filter((a) => a.executable).length} 个可直连
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {agents.map((agent) => {
                    const selected = selectedAgentIds.includes(agent.id);
                    const order = selected ? selectedAgentIds.indexOf(agent.id) : -1;
                    const disabled = !agent.installed;
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => toggleAgentSelection(agent.id)}
                        title={`${agent.name} — ${agent.statusLabel}`}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs transition-colors ${
                          disabled
                            ? 'cursor-not-allowed border-border/50 bg-muted/30 text-muted-foreground/50'
                            : selected
                              ? 'cursor-pointer border-primary/60 bg-primary/12 font-medium text-primary'
                              : 'cursor-pointer border-border bg-card/50 text-foreground hover:bg-accent/50'
                        }`}
                      >
                        <span
                          className={`flex h-3.5 w-3.5 items-center justify-center rounded-full ${
                            selected
                              ? 'bg-primary text-primary-foreground'
                              : agent.executable
                                ? 'border border-emerald-500/60'
                                : 'border border-muted-foreground/30'
                          }`}
                        >
                          {selected && <Check className="h-2.5 w-2.5" />}
                        </span>
                        <span>{agent.shortName}</span>
                        {selected && order === 0 && selectedAgentIds.length > 1 && (
                          <span className="text-[10px] opacity-80">主控</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Optional User Instruction */}
              <div className="space-y-1.5">
                <label htmlFor="agent-instruction" className="text-xs font-semibold text-foreground">
                  补充指令（可选）
                </label>
                <Textarea
                  id="agent-instruction"
                  rows={3}
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="留空则由 Agent 自动通读完整转写提炼任务；也可补一句你的重点要求"
                  className="resize-none text-xs leading-relaxed"
                />
              </div>

              {/* Feishu Delivery Selector or Beginner Guide */}
              <div className="space-y-2 rounded-xl border border-border bg-card/50 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-semibold">
                    <Send className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                    执行后发送飞书
                  </span>
                  {feishuReady && deliveryMode === 'doc_and_group' && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => { void refreshFeishu(); }}
                      disabled={loadingChats}
                    >
                      {loadingChats ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                      <span>刷新群</span>
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  {FEISHU_DELIVERY_OPTIONS.map((opt) => {
                    const active = deliveryMode === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          setDeliveryMode(opt.value);
                          if (opt.value === 'doc_and_group' && chats.length === 0) {
                            void refreshFeishu();
                          }
                        }}
                        className={`rounded-lg border px-2.5 py-2 text-left text-[11px] font-medium transition-colors cursor-pointer ${
                          active
                            ? 'border-primary/60 bg-primary/10 text-primary'
                            : 'border-border bg-background/50 text-foreground hover:bg-accent/40'
                        }`}
                      >
                        {opt.label.replace('（推荐）', '')}
                      </button>
                    );
                  })}
                </div>

                {deliveryMode !== 'none' && !feishuReady && (
                  <FeishuBeginnerGuide
                    installed={Boolean(feishuStatus?.installed)}
                    authenticated={Boolean(feishuStatus?.authenticated)}
                    checking={loadingChats}
                    onRecheck={refreshFeishu}
                    compact
                  />
                )}

                {feishuReady && deliveryMode === 'doc_and_group' && (
                  <div className="space-y-1.5 pt-1">
                    <select
                      aria-label="选择目标飞书群"
                      value={selectedChatId}
                      onChange={(e) => {
                        const cid = e.target.value;
                        const found = chats.find((c) => c.chatId === cid);
                        setSelectedChatId(cid);
                        setSelectedChatName(found?.name ?? '');
                      }}
                      className="flex h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="">
                        {loadingChats ? '正在拉取飞书群列表…' : '选择要发送的飞书群…'}
                      </option>
                      {selectedChatId && !chats.some((c) => c.chatId === selectedChatId) && (
                        <option value={selectedChatId}>
                          {selectedChatName || selectedChatId}
                        </option>
                      )}
                      {chats.map((c) => (
                        <option key={c.chatId} value={c.chatId}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Primary Trigger Button */}
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  className="flex-1 cursor-pointer"
                  onClick={() => { void handleStartOneClick(); }}
                  disabled={isBusy || !leadAgent?.installed}
                >
                  {isBusy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>{liveStatusText || '正在启动 Agent…'}</span>
                    </>
                  ) : leadAgent && !leadAgent.executable ? (
                    <>
                      <ExternalLink className="h-4 w-4" />
                      <span>打包上下文并打开 {leadAgent.shortName}</span>
                    </>
                  ) : collaboratorAgentIds.length > 0 ? (
                    <>
                      <Sparkles className="h-4 w-4" />
                      <span>
                        一键启动 {selectedAgentIds.length} 个 Agent 协同（先预检，完善即执行）
                      </span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      <span>
                        一键交给 {leadAgent?.shortName || 'Agent'}（先预检，完善即执行）
                      </span>
                    </>
                  )}
                </Button>
              </div>

              {/* Manual Desktop Handoff Result */}
              {manualFallback && (
                <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3.5 text-xs">
                  <p className="font-medium text-foreground">{manualFallback.message}</p>
                  <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-background/80 p-2.5 font-mono text-[11px] text-foreground">
                    {manualFallback.promptText}
                  </pre>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void navigator.clipboard.writeText(manualFallback.promptText).then(() => {
                          toast.success('提示词已复制');
                        });
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      <span>复制提示词</span>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => { void handleOpenRunFolder(manualFallback.runDir); }}
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      <span>打开交接目录</span>
                    </Button>
                  </div>
                </div>
              )}

              {/* Past Runs */}
              {pastRuns.length > 0 && (
                <div className="space-y-2 border-t border-border pt-4">
                  <h4 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                    <History className="h-3.5 w-3.5" aria-hidden="true" />
                    本场会议历史执行记录（{pastRuns.length}）
                  </h4>
                  <div className="space-y-1.5">
                    {pastRuns.slice(0, 6).map((run) => (
                      <button
                        key={run.runId}
                        type="button"
                        onClick={() => {
                          setActiveRun(run);
                          if (run.preflight?.questions?.length) {
                            setAnswerDrafts(buildDefaultClarificationAnswers(run.preflight.questions));
                          }
                        }}
                        className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-card/40 px-3 py-2 text-left transition-colors hover:bg-accent/40 cursor-pointer"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-foreground">
                            {run.executeResult?.feishuTitle ||
                              run.preflight?.suggestedFeishuTitle ||
                              run.meetingTitle}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {run.collaboratorAgentNames?.length
                              ? `${run.agentName} + ${run.collaboratorAgentNames.join(' + ')}`
                              : run.agentName}{' '}
                            · {feishuDeliveryModeLabel(run.feishuDeliveryMode, run.feishuChatName)}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {run.status === 'completed'
                            ? '已完成'
                            : run.status === 'needs_clarification'
                              ? '待确认'
                              : run.status === 'completed_feishu_warning'
                                ? '飞书待补发'
                                : run.status === 'error'
                                  ? '失败'
                                  : run.status}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Active Run View */}
          {activeRun && (
            <div className="space-y-4">
              {/* Top status bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card/60 p-3.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  {isBusy ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                  ) : activeRun.status === 'completed' ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                  ) : activeRun.status === 'error' || activeRun.status === 'cancelled' ? (
                    <CircleAlert className="h-4 w-4 shrink-0 text-destructive" />
                  ) : (
                    <Bot className="h-4 w-4 shrink-0 text-primary" />
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-foreground">
                      {activeRun.collaboratorAgentNames?.length
                        ? `${activeRun.agentName} + ${activeRun.collaboratorAgentNames.join(' + ')} 协同`
                        : activeRun.agentName}{' '}
                      ·{' '}
                      {isBusy
                        ? liveStatusText || '执行中…'
                        : activeRun.status === 'needs_clarification'
                          ? '请先确认以下问题，确认后立即执行'
                          : activeRun.status === 'ready'
                            ? '需求已完善，准备执行'
                            : activeRun.status === 'completed'
                              ? '执行与飞书发送已完成'
                              : activeRun.status === 'completed_feishu_warning'
                                ? '本地成果已完成，飞书推送有提示'
                                : activeRun.status === 'cancelled'
                                  ? '任务已取消'
                                  : '执行出错'}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      交付方式：{feishuDeliveryModeLabel(activeRun.feishuDeliveryMode, activeRun.feishuChatName)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {isBusy ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => { void handleCancelActive(); }}
                    >
                      <Square className="h-3 w-3" />
                      <span>取消</span>
                    </Button>
                  ) : (
                    <Button type="button" size="sm" variant="outline" onClick={resetToNewRun}>
                      <span>新建任务</span>
                    </Button>
                  )}
                </div>
              </div>

              {/* Preflight understanding & corrected terms */}
              {activeRun.preflight && (
                <div className="space-y-2.5 rounded-xl border border-border bg-card/40 p-3.5 text-xs">
                  {activeRun.preflight.understoodGoal && (
                    <div>
                      <span className="font-semibold text-foreground">理解目标：</span>
                      <span className="text-muted-foreground">{activeRun.preflight.understoodGoal}</span>
                    </div>
                  )}
                  {activeRun.preflight.correctedTerms.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-foreground">名词纠偏：</span>
                      {activeRun.preflight.correctedTerms.map((t, idx) => (
                        <span
                          key={`${t.heard}-${idx}`}
                          className="rounded-md border border-border bg-background/70 px-1.5 py-0.5 text-[11px]"
                        >
                          {t.heard} → <strong>{t.normalized}</strong>
                        </span>
                      ))}
                    </div>
                  )}
                  {activeRun.preflight.plannedDeliverables.length > 0 && (
                    <div className="space-y-1">
                      <span className="font-semibold text-foreground">计划产出：</span>
                      <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                        {activeRun.preflight.plannedDeliverables.map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Phase 1 Clarification Questions */}
              {!isBusy &&
                activeRun.status === 'needs_clarification' &&
                activeRun.preflight?.questions &&
                activeRun.preflight.questions.length > 0 && (
                  <div className="space-y-3">
                    {activeRun.preflight.questions.map((q, idx) => {
                      const currentVal = answerDrafts[q.id] ?? '';
                      return (
                        <div
                          key={q.id}
                          className="space-y-2 rounded-xl border border-primary/25 bg-card/60 p-3.5"
                        >
                          <p className="text-xs font-semibold text-foreground">
                            {idx + 1}. {q.question}
                          </p>
                          {q.reason && (
                            <p className="text-[11px] text-muted-foreground">{q.reason}</p>
                          )}
                          {q.suggestedOptions.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {q.suggestedOptions.map((opt) => {
                                const picked = currentVal === opt;
                                return (
                                  <button
                                    key={opt}
                                    type="button"
                                    onClick={() =>
                                      setAnswerDrafts((prev) => ({ ...prev, [q.id]: opt }))
                                    }
                                    className={`rounded-lg border px-2.5 py-1 text-xs transition-colors cursor-pointer ${
                                      picked
                                        ? 'border-primary bg-primary/12 font-medium text-primary'
                                        : 'border-border bg-background/60 text-foreground hover:bg-accent/50'
                                    }`}
                                  >
                                    {opt}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          {q.allowCustom && (
                            <Input
                              value={currentVal}
                              onChange={(e) =>
                                setAnswerDrafts((prev) => ({ ...prev, [q.id]: e.target.value }))
                              }
                              placeholder="可直接修改或补充你的具体要求…"
                              className="h-8 text-xs"
                              aria-label={`问题 ${idx + 1} 补充回答`}
                            />
                          )}
                        </div>
                      );
                    })}

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button
                        type="button"
                        className="flex-1 cursor-pointer"
                        onClick={() => { void handleConfirmAndExecute(); }}
                      >
                        <Play className="h-3.5 w-3.5" />
                        <span>确认并立即执行</span>
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="cursor-pointer"
                        onClick={() => { void runExecutionPhase(activeRun, []); }}
                      >
                        <span>按推荐直接执行</span>
                      </Button>
                    </div>
                  </div>
                )}

              {/* Ready without auto-execute */}
              {!isBusy && activeRun.status === 'ready' && (
                <Button
                  type="button"
                  className="w-full cursor-pointer"
                  onClick={() => { void runExecutionPhase(activeRun, []); }}
                >
                  <Play className="h-4 w-4" />
                  <span>需求已完善，立即执行并同步飞书</span>
                </Button>
              )}

              {/* Error Banner */}
              {activeRun.error && (
                <div
                  className="rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-xs text-destructive"
                  role="alert"
                >
                  {activeRun.error}
                </div>
              )}

              {/* Execution Result + Feishu Receipt */}
              {activeRun.executeResult && (
                <div className="space-y-3">
                  {activeRun.feishuDelivery && (
                    <div
                      className={`space-y-2 rounded-xl border p-3.5 text-xs ${
                        activeRun.status === 'completed'
                          ? 'border-emerald-500/30 bg-emerald-500/8'
                          : 'border-amber-500/35 bg-amber-500/8'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-foreground">
                          飞书交付：{activeRun.feishuDelivery.message}
                        </span>
                        {activeRun.feishuDelivery.docUrl && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 px-2.5 text-xs"
                            onClick={() => {
                              void handleOpenExternal(activeRun.feishuDelivery!.docUrl!);
                            }}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            <span>打开飞书云文档</span>
                          </Button>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <select
                          aria-label="转发或补发目标飞书群"
                          value={selectedChatId}
                          onChange={(e) => {
                            const cid = e.target.value;
                            const found = chats.find((c) => c.chatId === cid);
                            setSelectedChatId(cid);
                            setSelectedChatName(found?.name ?? '');
                            setDeliveryMode(cid ? 'doc_and_group' : 'doc_and_self');
                          }}
                          className="h-7 flex-1 min-w-[160px] rounded-md border border-input bg-background px-2 text-[11px]"
                        >
                          <option value="">飞书私聊本人 / 仅文档</option>
                          {chats.map((c) => (
                            <option key={c.chatId} value={c.chatId}>
                              群：{c.name}
                            </option>
                          ))}
                        </select>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 text-[11px]"
                          disabled={isResendingFeishu}
                          onClick={() => { void handleResendFeishu(); }}
                        >
                          {isResendingFeishu ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Send className="h-3 w-3" />
                          )}
                          <span>重发 / 转发飞书</span>
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2 rounded-xl border border-border bg-card/50 p-3.5 text-xs">
                    <h4 className="font-semibold text-foreground">执行摘要</h4>
                    <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                      {activeRun.executeResult.summary}
                    </p>

                    {activeRun.executeResult.nextActions.length > 0 && (
                      <div className="space-y-1 pt-1">
                        <span className="font-semibold text-foreground">建议下一步：</span>
                        <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                          {activeRun.executeResult.nextActions.map((act, idx) => (
                            <li key={idx}>{act}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 pt-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => { void handleOpenRunFolder(activeRun.runDir); }}
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                        <span>打开本地产物目录</span>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void navigator.clipboard
                            .writeText(activeRun.deliverablePreview || activeRun.executeResult!.summary)
                            .then(() => toast.success('已复制成果预览'));
                        }}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        <span>复制预览</span>
                      </Button>
                    </div>
                  </div>

                  {activeRun.deliverablePreview && (
                    <details className="rounded-xl border border-border bg-card/30 px-3.5 py-2.5">
                      <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground hover:text-foreground">
                        查看成果 Markdown 预览
                      </summary>
                      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-background/70 p-3 font-mono text-[11px] leading-relaxed text-foreground">
                        {activeRun.deliverablePreview}
                      </pre>
                    </details>
                  )}
                </div>
              )}

              {/* Live / Stored Logs */}
              {(liveLogs.length > 0 || activeRun.logs.length > 0) && (
                <details className="rounded-xl border border-border bg-card/30 px-3.5 py-2.5">
                  <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground hover:text-foreground">
                    运行日志（{liveLogs.length > 0 ? liveLogs.length : activeRun.logs.length} 条）
                  </summary>
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-background/70 p-2.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
                    {(liveLogs.length > 0 ? liveLogs : activeRun.logs).join('\n')}
                  </pre>
                </details>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
