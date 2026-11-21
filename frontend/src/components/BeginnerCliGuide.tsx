'use client';

import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  Terminal,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { toUserMessage } from '@/lib/user-message';
import {
  AgentInstallationInfo,
  FEISHU_INSTALL_COMMAND,
  FEISHU_LOGIN_COMMAND,
} from '@/types/agent-handoff';

async function runInTerminalOrCopy(command: string, label: string) {
  try {
    const msg = await invoke<string>('run_command_in_terminal', { command });
    toast.success(`${label}已在终端启动`, { description: msg });
  } catch (err) {
    try {
      await navigator.clipboard.writeText(command);
      toast.info(`已复制「${label}」命令`, {
        description: '打开「终端」App 粘贴并按回车即可。',
      });
    } catch {
      toast.error(toUserMessage(err, '无法启动终端，请手动复制命令执行'));
    }
  }
}

async function copyCommand(command: string, label: string) {
  try {
    await navigator.clipboard.writeText(command);
    toast.success(`已复制${label}命令`, {
      description: '打开电脑的「终端」App，粘贴并按回车运行。',
    });
  } catch {
    toast.error('复制失败，请手动选中命令复制');
  }
}

async function openUrl(url: string) {
  try {
    await invoke('open_external_url', { url });
  } catch {
    toast.error('无法打开网页链接');
  }
}

interface FeishuBeginnerGuideProps {
  installed: boolean;
  authenticated: boolean;
  checking?: boolean;
  onRecheck: () => void | Promise<unknown>;
  compact?: boolean;
}

export function FeishuBeginnerGuide({
  installed,
  authenticated,
  checking = false,
  onRecheck,
  compact = false,
}: FeishuBeginnerGuideProps) {
  const [launching, setLaunching] = useState<string | null>(null);

  if (installed && authenticated) {
    return null;
  }

  const handleRun = async (cmd: string, key: string, label: string) => {
    setLaunching(key);
    try {
      await runInTerminalOrCopy(cmd, label);
    } finally {
      setLaunching(null);
    }
  };

  return (
    <div
      className={`rounded-xl border border-primary/25 bg-primary/5 ${compact ? 'p-3 space-y-2.5' : 'p-4 space-y-3'}`}
      role="region"
      aria-label="飞书一键连接向导"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-foreground">
            不会命令行？跟着下面 2 步点按钮就能连上飞书
          </p>
          <p className="text-[11px] text-muted-foreground">
            只需要做一次，以后每次会议都能一键生成飞书云文档并推送到群里。
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2.5 text-xs cursor-pointer"
          disabled={checking}
          onClick={() => { void onRecheck(); }}
        >
          {checking ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          <span>刷新状态</span>
        </Button>
      </div>

      {/* Step 1: Install */}
      <div className="rounded-lg border border-border bg-background/75 p-2.5 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-medium text-foreground">
            {installed ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            ) : (
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                1
              </span>
            )}
            <span>第 1 步：安装飞书连接插件{installed ? '（已装好）' : ''}</span>
          </div>
          {!installed && (
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                className="h-7 px-2.5 text-xs cursor-pointer"
                disabled={launching === 'install'}
                onClick={() => { void handleRun(FEISHU_INSTALL_COMMAND, 'install', '安装飞书插件'); }}
              >
                {launching === 'install' ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Terminal className="h-3 w-3" />
                )}
                <span>一键打开终端安装</span>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs cursor-pointer"
                onClick={() => { void copyCommand(FEISHU_INSTALL_COMMAND, '飞书安装'); }}
              >
                <Copy className="h-3 w-3" />
                <span>复制</span>
              </Button>
            </div>
          )}
        </div>
        {!installed && (
          <div className="space-y-1">
            <code className="block rounded bg-muted px-2 py-1 font-mono text-[11px] text-foreground select-all">
              {FEISHU_INSTALL_COMMAND}
            </code>
            <p className="text-[10px] text-muted-foreground">
              点「一键打开终端安装」后会自动弹出黑色终端窗口，等它跑完出现完成提示就行；如果提示找不到 npm，先点这里装{' '}
              <button
                type="button"
                className="underline text-primary cursor-pointer"
                onClick={() => { void openUrl('https://nodejs.org'); }}
              >
                Node.js 官网安装包
              </button>
              。
            </p>
          </div>
        )}
      </div>

      {/* Step 2: Login */}
      <div className="rounded-lg border border-border bg-background/75 p-2.5 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-medium text-foreground">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              2
            </span>
            <span>第 2 步：扫码登录你的飞书账号</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant={installed ? 'default' : 'outline'}
              className="h-7 px-2.5 text-xs cursor-pointer"
              disabled={launching === 'login'}
              onClick={() => { void handleRun(FEISHU_LOGIN_COMMAND, 'login', '扫码登录飞书'); }}
            >
              {launching === 'login' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Terminal className="h-3 w-3" />
              )}
              <span>一键扫码登录飞书</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs cursor-pointer"
              onClick={() => { void copyCommand(FEISHU_LOGIN_COMMAND, '飞书登录'); }}
            >
              <Copy className="h-3 w-3" />
              <span>复制</span>
            </Button>
          </div>
        </div>
        <code className="block rounded bg-muted px-2 py-1 font-mono text-[11px] text-foreground select-all">
          {FEISHU_LOGIN_COMMAND}
        </code>
        <p className="text-[10px] text-muted-foreground">
          会自动弹出浏览器页面，用手机飞书扫一下码点同意，然后回到这里点右上角「刷新状态」就完成了。
        </p>
      </div>
    </div>
  );
}

interface AgentBeginnerCardProps {
  agent: AgentInstallationInfo;
  onRecheck?: () => void | Promise<unknown>;
}

export function AgentBeginnerCard({ agent, onRecheck }: AgentBeginnerCardProps) {
  const [busy, setBusy] = useState(false);

  const handleInstall = async () => {
    if (!agent.installCommand) return;
    setBusy(true);
    try {
      await runInTerminalOrCopy(agent.installCommand, `安装 ${agent.shortName}`);
    } finally {
      setBusy(false);
    }
  };

  const handleLogin = async () => {
    if (!agent.loginCommand) return;
    setBusy(true);
    try {
      await runInTerminalOrCopy(agent.loginCommand, `登录 ${agent.shortName}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-background/75 p-2.5 space-y-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-foreground">{agent.name}</span>
        <span className="text-[10px] text-muted-foreground">{agent.statusLabel}</span>
      </div>
      {agent.beginnerNote && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">{agent.beginnerNote}</p>
      )}
      {agent.installCommand && (
        <code className="block rounded bg-muted px-2 py-1 font-mono text-[11px] text-foreground select-all">
          {agent.installCommand}
        </code>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {agent.installCommand && (
          <>
            <Button
              type="button"
              size="sm"
              className="h-7 px-2.5 text-[11px] cursor-pointer"
              disabled={busy}
              onClick={() => { void handleInstall(); }}
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Terminal className="h-3 w-3" />}
              <span>一键打开终端安装</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px] cursor-pointer"
              onClick={() => { void copyCommand(agent.installCommand!, `${agent.shortName} 安装`); }}
            >
              <Copy className="h-3 w-3" />
              <span>复制命令</span>
            </Button>
          </>
        )}
        {agent.loginCommand && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px] cursor-pointer"
            disabled={busy}
            onClick={() => { void handleLogin(); }}
          >
            <Terminal className="h-3 w-3" />
            <span>一键登录</span>
          </Button>
        )}
        {agent.docsUrl && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px] cursor-pointer"
            onClick={() => { void openUrl(agent.docsUrl!); }}
          >
            <ExternalLink className="h-3 w-3" />
            <span>官网</span>
          </Button>
        )}
        {onRecheck && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto h-7 px-2 text-[11px] cursor-pointer"
            onClick={() => { void onRecheck(); }}
          >
            <RefreshCw className="h-3 w-3" />
            <span>重新检测</span>
          </Button>
        )}
      </div>
    </div>
  );
}
