import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import Image from 'next/image';
import { ExternalLink } from 'lucide-react';
import AnalyticsConsentSwitch from './AnalyticsConsentSwitch';
import { Button } from './ui/button';
import { toast } from 'sonner';

export function About() {
  const [currentVersion, setCurrentVersion] = useState<string>('0.4.1');

  useEffect(() => {
    getVersion().then(setCurrentVersion).catch(console.error);
  }, []);

  const openSource = async () => {
    try {
      await invoke('open_external_url', {
        url: 'https://github.com/BLACKIELF/AiGoodMeeting',
      });
    } catch (error) {
      console.error('Failed to open source link:', error);
      toast.error('无法打开开源项目链接');
    }
  };

  return (
    <div className="space-y-6 py-2 text-foreground">
      <div className="flex items-center gap-4">
        <Image
          src="/aigoodbro-icon.png"
          alt="AiGoodMeeting"
          width={64}
          height={64}
          className="shrink-0 rounded-2xl"
        />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">AiGoodMeeting</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">会议纪要</p>
          <p className="mt-1 text-xs tabular-nums text-muted-foreground">1113v1 · Meetily {currentVersion}</p>
        </div>
      </div>

      <p className="text-sm leading-6 text-muted-foreground">
        录音、转写、区分说话人，再整理为会议纪要。可使用本地模型；选择外部模型时，按设置中的服务处理内容。
      </p>

      <div className="agb-card rounded-xl border border-border bg-muted/40 p-4">
        <h2 className="text-sm font-medium">开源来源</h2>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">
          基于 Meetily v0.4.1 定制，上游由 Zackriya Solutions 与开源贡献者维护。皮肤源自 AiGoodBro，保留原始配色与视觉源码的 MIT 许可。
        </p>
        <Button variant="outline" size="sm" onClick={openSource} className="mt-3">
          查看源码与许可
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="border-t border-border pt-4">
        <AnalyticsConsentSwitch />
      </div>
    </div>
  );
}
