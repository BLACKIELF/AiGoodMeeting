'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CheckCircle2, CircleAlert, Loader2, RefreshCw, Save, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toUserMessage } from '@/lib/user-message';

export interface FeishuConfig {
  cliPath: string;
  identity: 'user' | 'bot' | 'auto';
  profile: string;
  defaultUploadMode: 'docx' | 'file_docx' | 'file_txt' | 'file_md';
  destination: string;
}

export interface FeishuStatusResponse {
  installed: boolean;
  resolvedCliPath?: string | null;
  version?: string | null;
  authenticated: boolean;
  brand?: string | null;
  activeIdentity?: string | null;
  userName?: string | null;
  userReady: boolean;
  botReady: boolean;
  message: string;
}

const DEFAULT_CONFIG: FeishuConfig = {
  cliPath: '',
  identity: 'user',
  profile: '',
  defaultUploadMode: 'docx',
  destination: '',
};

const UPLOAD_MODES: Array<{
  value: FeishuConfig['defaultUploadMode'];
  label: string;
  description: string;
}> = [
  {
    value: 'docx',
    label: '飞书在线云文档（推荐）',
    description: '直接创建可在线协作编辑的飞书文档',
  },
  {
    value: 'file_docx',
    label: 'Word 文档（.docx）',
    description: '生成标准 Word 文件并上传至飞书云盘或知识库',
  },
  {
    value: 'file_txt',
    label: '纯文本（.txt）',
    description: '上传纯文本文件至飞书云盘',
  },
];

export function FeishuSettings() {
  const [config, setConfig] = useState<FeishuConfig>(DEFAULT_CONFIG);
  const [status, setStatus] = useState<FeishuStatusResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const checkConnection = useCallback(async (cliPath?: string, profile?: string, silent = false) => {
    setChecking(true);
    try {
      const result = await invoke<FeishuStatusResponse>('feishu_check_status', {
        cliPath: cliPath ?? null,
        profile: profile ?? null,
      });
      setStatus(result);
      if (!silent) {
        if (result.authenticated) {
          toast.success(result.message);
        } else {
          toast.warning(result.message);
        }
      }
    } catch (err) {
      const msg = toUserMessage(err, '检测飞书 CLI 状态失败，请检查本地环境。');
      setStatus({
        installed: false,
        authenticated: false,
        userReady: false,
        botReady: false,
        message: msg,
      });
      if (!silent) toast.error(msg);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        const saved = await invoke<FeishuConfig>('feishu_get_config');
        if (cancelled) return;
        const merged: FeishuConfig = { ...DEFAULT_CONFIG, ...saved };
        setConfig(merged);
        setLoaded(true);
        await checkConnection(merged.cliPath, merged.profile, true);
      } catch {
        if (!cancelled) setLoaded(true);
      }
    };
    void init();
    return () => {
      cancelled = true;
    };
  }, [checkConnection]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await invoke<FeishuConfig>('feishu_save_config', { config });
      setConfig({ ...DEFAULT_CONFIG, ...saved });
      toast.success('飞书同步配置已保存');
      await checkConnection(saved.cliPath, saved.profile, true);
    } catch (err) {
      toast.error(toUserMessage(err, '保存飞书配置失败，请检查填写内容。'));
    } finally {
      setSaving(false);
    }
  };

  const statusReady = Boolean(status?.installed && status?.authenticated);

  return (
    <div className="space-y-6 text-foreground">
      {/* Connection Status Card */}
      <div className="rounded-xl border border-border bg-card/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <span
              className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                statusReady
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {checking ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : statusReady ? (
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              ) : (
                <CircleAlert className="h-4 w-4" aria-hidden="true" />
              )}
            </span>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">飞书 CLI 连接状态</h3>
                {status?.version && (
                  <span className="agb-chip tabular-nums">{status.version}</span>
                )}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground" role="status">
                {status ? status.message : loaded ? '尚未检测飞书 CLI 状态' : '正在读取飞书配置…'}
              </p>
              {status?.resolvedCliPath && (
                <p className="text-[11px] font-mono text-muted-foreground/80 break-all">
                  路径：{status.resolvedCliPath}
                </p>
              )}
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => { void checkConnection(config.cliPath, config.profile, false); }}
            disabled={checking}
          >
            {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            <span>检测连接</span>
          </Button>
        </div>
      </div>

      {/* Default Upload Mode */}
      <div className="space-y-2.5">
        <label className="block text-sm font-medium">默认上传格式</label>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label="默认上传格式">
          {UPLOAD_MODES.map((item) => {
            const selected = config.defaultUploadMode === item.value;
            return (
              <button
                key={item.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setConfig(prev => ({ ...prev, defaultUploadMode: item.value }))}
                className={`flex flex-col items-start gap-1 rounded-xl border p-3.5 text-left transition-colors cursor-pointer ${
                  selected
                    ? 'border-primary/60 bg-primary/10 text-foreground'
                    : 'border-border bg-card/40 text-foreground hover:bg-accent/40'
                }`}
              >
                <span className="text-xs font-semibold">{item.label}</span>
                <span className="text-[11px] leading-relaxed text-muted-foreground">{item.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Destination Folder / Wiki */}
      <div className="space-y-2">
        <label htmlFor="feishu-destination" className="block text-sm font-medium">
          默认上传位置（可选）
        </label>
        <Input
          id="feishu-destination"
          aria-label="飞书默认上传位置"
          value={config.destination}
          onChange={(e) => setConfig(prev => ({ ...prev, destination: e.target.value }))}
          placeholder="粘贴飞书云盘文件夹链接（/drive/folder/...）或知识库节点链接（/wiki/...），留空上传至云盘根目录"
        />
        <p className="text-xs text-muted-foreground">
          留空时直接上传至个人飞书云盘根目录；粘贴文件夹或知识库链接后会自动归档到对应目录。
        </p>
      </div>

      {/* Advanced CLI Configuration */}
      <details className="rounded-xl border border-border bg-card/30 px-4 py-3">
        <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground hover:text-foreground">
          高级 CLI 参数（路径、执行身份与多账号 Profile）
        </summary>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="feishu-cli-path" className="block text-xs font-medium">
              lark-cli 可执行文件路径
            </label>
            <Input
              id="feishu-cli-path"
              aria-label="飞书 CLI 路径"
              value={config.cliPath}
              onChange={(e) => setConfig(prev => ({ ...prev, cliPath: e.target.value }))}
              placeholder="留空自动检测（支持 ~/.local/bin/lark-cli、/opt/homebrew/bin/lark-cli）"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="feishu-identity" className="block text-xs font-medium">
              上传身份
            </label>
            <select
              id="feishu-identity"
              aria-label="飞书上传身份"
              value={config.identity}
              onChange={(e) =>
                setConfig(prev => ({ ...prev, identity: e.target.value as FeishuConfig['identity'] }))
              }
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="user">个人账号（user，推荐）</option>
              <option value="bot">应用机器人（bot）</option>
              <option value="auto">跟随 CLI 默认（auto）</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="feishu-profile" className="block text-xs font-medium">
              CLI Profile 名称（可选）
            </label>
            <Input
              id="feishu-profile"
              aria-label="飞书 CLI Profile"
              value={config.profile}
              onChange={(e) => setConfig(prev => ({ ...prev, profile: e.target.value }))}
              placeholder="默认留空；多工作区填写 profile 名"
            />
          </div>
        </div>
      </details>

      {/* Save Action */}
      <div className="flex items-center justify-between gap-3 pt-1">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Send className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          配置完成后，可在任意会议纪要或转写工具栏点击“上传飞书”一键直传。
        </p>
        <Button type="button" onClick={() => { void handleSave(); }} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          <span>保存配置</span>
        </Button>
      </div>
    </div>
  );
}
