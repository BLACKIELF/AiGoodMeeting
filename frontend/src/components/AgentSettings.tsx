'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Bot,
  CheckCircle2,
  CircleAlert,
  Loader2,
  RefreshCw,
  Save,
  Search,
  Send,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { AgentBeginnerCard } from '@/components/BeginnerCliGuide';
import { toUserMessage } from '@/lib/user-message';
import {
  AgentHandoffConfig,
  AgentInstallationInfo,
  DEFAULT_AGENT_HANDOFF_CONFIG,
  FEISHU_DELIVERY_OPTIONS,
  FeishuChatItem,
  resolvePreferredAgentId,
} from '@/types/agent-handoff';

export function AgentSettings() {
  const [config, setConfig] = useState<AgentHandoffConfig>(DEFAULT_AGENT_HANDOFF_CONFIG);
  const [agents, setAgents] = useState<AgentInstallationInfo[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [chats, setChats] = useState<FeishuChatItem[]>([]);
  const [loadingChats, setLoadingChats] = useState(false);
  const [chatQuery, setChatQuery] = useState('');
  const [chatError, setChatError] = useState<string | null>(null);

  const detectAgents = useCallback(async (silent = false) => {
    setDetecting(true);
    try {
      const detected = await invoke<AgentInstallationInfo[]>('agent_detect_installations');
      setAgents(detected);
      if (!silent) {
        const execCount = detected.filter((a) => a.executable).length;
        const instCount = detected.filter((a) => a.installed).length;
        toast.success(`检测完成：发现 ${instCount} 个本地 Agent，其中 ${execCount} 个可直连执行`);
      }
      return detected;
    } catch (err) {
      const msg = toUserMessage(err, '检测本地 Agent 安装状态失败');
      if (!silent) toast.error(msg);
      return [];
    } finally {
      setDetecting(false);
    }
  }, []);

  const loadFeishuChats = useCallback(async (silent = false) => {
    setLoadingChats(true);
    setChatError(null);
    try {
      const list = await invoke<FeishuChatItem[]>('feishu_list_chats');
      setChats(list);
      if (!silent) {
        toast.success(`已拉取 ${list.length} 个飞书群聊`);
      }
    } catch (err) {
      const msg = toUserMessage(err, '获取飞书群列表失败，请确认 lark-cli 已登录');
      setChatError(msg);
      if (!silent) toast.error(msg);
    } finally {
      setLoadingChats(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        const [saved, detected] = await Promise.all([
          invoke<AgentHandoffConfig>('agent_get_config'),
          detectAgents(true),
        ]);
        if (cancelled) return;
        const merged: AgentHandoffConfig = {
          ...DEFAULT_AGENT_HANDOFF_CONFIG,
          ...saved,
          customCliPaths: saved.customCliPaths ?? {},
          modelOverrides: saved.modelOverrides ?? {},
        };
        if (detected.length > 0 && !detected.some((a) => a.id === merged.defaultAgent && a.installed)) {
          merged.defaultAgent = resolvePreferredAgentId(merged.defaultAgent, detected);
        }
        setConfig(merged);
        if (merged.feishuDeliveryMode === 'doc_and_group') {
          void loadFeishuChats(true);
        }
      } catch {
        // Keep defaults on error
      }
    };
    void init();
    return () => {
      cancelled = true;
    };
  }, [detectAgents, loadFeishuChats]);

  const filteredChats = useMemo(() => {
    const q = chatQuery.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.chatId.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q),
    );
  }, [chats, chatQuery]);

  const executableCount = useMemo(() => agents.filter((a) => a.executable).length, [agents]);
  const installedCount = useMemo(() => agents.filter((a) => a.installed).length, [agents]);
  const selectedAgentInfo = useMemo(
    () => agents.find((a) => a.id === config.defaultAgent) ?? null,
    [agents, config.defaultAgent],
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await invoke<AgentHandoffConfig>('agent_save_config', { config });
      setConfig({
        ...DEFAULT_AGENT_HANDOFF_CONFIG,
        ...saved,
        customCliPaths: saved.customCliPaths ?? {},
        modelOverrides: saved.modelOverrides ?? {},
      });
      toast.success('Agent 联动配置已保存');
      await detectAgents(true);
    } catch (err) {
      toast.error(toUserMessage(err, '保存 Agent 联动配置失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 text-foreground">
      {/* Detection Summary & Agent Matrix */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" aria-hidden="true" />
            <h3 className="text-sm font-semibold">本地 Agent 安装检测</h3>
            {agents.length > 0 && (
              <span className="agb-chip tabular-nums">
                已安装 {installedCount}/{agents.length} · 可直连 {executableCount}
              </span>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => { void detectAgents(false); }}
            disabled={detecting}
          >
            {detecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            <span>重新检测</span>
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label="默认执行 Agent">
          {agents.map((agent) => {
            const selected = config.defaultAgent === agent.id;
            const dotClass = agent.executable
              ? 'bg-emerald-500'
              : agent.installed
                ? 'bg-amber-500'
                : 'bg-muted-foreground/35';
            return (
              <button
                key={agent.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setConfig((prev) => ({ ...prev, defaultAgent: agent.id }))}
                className={`flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-colors cursor-pointer ${
                  selected
                    ? 'border-primary/60 bg-primary/10 text-foreground'
                    : agent.installed
                      ? 'border-border bg-card/50 text-foreground hover:bg-accent/40'
                      : 'border-border/60 bg-card/25 text-muted-foreground hover:bg-accent/20'
                }`}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
                    <span className="truncate text-xs font-semibold text-foreground">{agent.name}</span>
                  </div>
                  <span className="shrink-0 text-[10px] font-medium text-muted-foreground">
                    {agent.statusLabel}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                  {agent.version && (
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono tabular-nums">
                      {agent.version.slice(0, 32)}
                    </span>
                  )}
                  {agent.skillLinked && (
                    <span className="rounded bg-emerald-500/12 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-300">
                      Skill 已接入
                    </span>
                  )}
                </div>

                {(agent.cliPath || agent.appPath) && (
                  <p className="w-full truncate font-mono text-[10px] text-muted-foreground/80">
                    {agent.cliPath || agent.appPath}
                  </p>
                )}
              </button>
            );
          })}
        </div>

        {/* Beginner 1-Click Install Helper for selected uninstalled / desktop-only Agent */}
        {selectedAgentInfo && !selectedAgentInfo.executable && (
          <AgentBeginnerCard
            agent={selectedAgentInfo}
            onRecheck={() => detectAgents(false)}
          />
        )}
      </div>

      {/* Execution Behavior & Workspace */}
      <div className="space-y-4 rounded-xl border border-border bg-card/50 p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <label htmlFor="agent-auto-execute" className="text-sm font-medium">
              信息完善时直接立即执行
            </label>
            <p className="text-xs text-muted-foreground">
              预检发现缺口时会先在界面向你提问；若信息已完整则跳过确认直接开跑。
            </p>
          </div>
          <Switch
            id="agent-auto-execute"
            checked={config.autoExecuteWhenReady}
            onCheckedChange={(checked) =>
              setConfig((prev) => ({ ...prev, autoExecuteWhenReady: checked }))
            }
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="agent-workspace-dir" className="block text-xs font-medium">
            默认工作区目录
          </label>
          <Input
            id="agent-workspace-dir"
            aria-label="Agent 默认工作区目录"
            value={config.workspaceDir}
            onChange={(e) => setConfig((prev) => ({ ...prev, workspaceDir: e.target.value }))}
            placeholder="~/Documents/Projects"
          />
        </div>
      </div>

      {/* Feishu Delivery after Execution */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Send className="h-4 w-4 text-primary" aria-hidden="true" />
          <h3 className="text-sm font-semibold">执行完成后发送到飞书</h3>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="飞书交付方式">
          {FEISHU_DELIVERY_OPTIONS.map((opt) => {
            const selected = config.feishuDeliveryMode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  setConfig((prev) => ({ ...prev, feishuDeliveryMode: opt.value }));
                  if (opt.value === 'doc_and_group' && chats.length === 0) {
                    void loadFeishuChats(true);
                  }
                }}
                className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors cursor-pointer ${
                  selected
                    ? 'border-primary/60 bg-primary/10 text-foreground'
                    : 'border-border bg-card/40 text-foreground hover:bg-accent/40'
                }`}
              >
                <span className="text-xs font-semibold">{opt.label}</span>
                <span className="text-[11px] leading-relaxed text-muted-foreground">{opt.description}</span>
              </button>
            );
          })}
        </div>

        {config.feishuDeliveryMode === 'doc_and_group' && (
          <div className="space-y-2.5 rounded-xl border border-border bg-card/50 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-medium">
                默认发送飞书群
                {config.feishuChatName && (
                  <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-primary/12 px-2 py-0.5 text-[11px] text-primary">
                    <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                    {config.feishuChatName}
                  </span>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => { void loadFeishuChats(false); }}
                disabled={loadingChats}
              >
                {loadingChats ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                <span>刷新群列表</span>
              </Button>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={chatQuery}
                onChange={(e) => setChatQuery(e.target.value)}
                placeholder="搜索飞书群名（如 产品群、项目同步群、内部文件群）…"
                className="pl-8 text-xs"
                aria-label="搜索飞书群"
              />
            </div>

            {chatError && (
              <p className="flex items-center gap-1.5 text-xs text-destructive" role="alert">
                <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {chatError}
              </p>
            )}

            {filteredChats.length > 0 && (
              <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                {filteredChats.map((chat) => {
                  const picked = config.feishuChatId === chat.chatId;
                  return (
                    <button
                      key={chat.chatId}
                      type="button"
                      onClick={() =>
                        setConfig((prev) => ({
                          ...prev,
                          feishuChatId: chat.chatId,
                          feishuChatName: chat.name,
                        }))
                      }
                      className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer ${
                        picked
                          ? 'border-primary/60 bg-primary/10 font-medium text-foreground'
                          : 'border-transparent bg-background/50 text-foreground hover:border-border hover:bg-accent/40'
                      }`}
                    >
                      <span className="truncate">{chat.name}</span>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                        {chat.chatId}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
              <Input
                value={config.feishuChatId}
                onChange={(e) => setConfig((prev) => ({ ...prev, feishuChatId: e.target.value }))}
                placeholder="或手动粘贴群 chat_id（oc_...）"
                className="font-mono text-xs"
                aria-label="飞书群 chat_id"
              />
              <Input
                value={config.feishuChatName}
                onChange={(e) => setConfig((prev) => ({ ...prev, feishuChatName: e.target.value }))}
                placeholder="群显示名称（可选）"
                className="text-xs"
                aria-label="飞书群名称"
              />
            </div>
          </div>
        )}
      </div>

      {/* Advanced per-agent overrides */}
      {selectedAgentInfo && (
        <details className="rounded-xl border border-border bg-card/30 px-4 py-3">
          <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground hover:text-foreground">
            高级参数（自定义 {selectedAgentInfo.shortName} 的 CLI 路径或模型覆盖）
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="agent-custom-cli" className="block text-xs font-medium">
                {selectedAgentInfo.shortName} 可执行文件路径（可选）
              </label>
              <Input
                id="agent-custom-cli"
                value={config.customCliPaths[selectedAgentInfo.id] ?? ''}
                onChange={(e) => {
                  const val = e.target.value;
                  setConfig((prev) => ({
                    ...prev,
                    customCliPaths: { ...prev.customCliPaths, [selectedAgentInfo.id]: val },
                  }));
                }}
                placeholder={selectedAgentInfo.cliPath || '留空自动检测'}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="agent-model-override" className="block text-xs font-medium">
                {selectedAgentInfo.shortName} 指定模型（可选）
              </label>
              <Input
                id="agent-model-override"
                value={config.modelOverrides[selectedAgentInfo.id] ?? ''}
                onChange={(e) => {
                  const val = e.target.value;
                  setConfig((prev) => ({
                    ...prev,
                    modelOverrides: { ...prev.modelOverrides, [selectedAgentInfo.id]: val },
                  }));
                }}
                placeholder="留空使用该 Agent 默认模型"
                className="font-mono text-xs"
              />
            </div>
          </div>
        </details>
      )}

      {/* Save Action */}
      <div className="flex items-center justify-between gap-3 pt-1">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          任意会议详情页点击「交给 Agent」，即可预检提问、自动执行并同步飞书。
        </p>
        <Button type="button" onClick={() => { void handleSave(); }} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          <span>保存配置</span>
        </Button>
      </div>
    </div>
  );
}
