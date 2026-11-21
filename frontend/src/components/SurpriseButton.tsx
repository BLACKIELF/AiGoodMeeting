'use client';

import { invoke } from '@tauri-apps/api/core';
import { ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';

export function SurpriseButton() {
  async function openWebsite() {
    try {
      await invoke('open_external_url', { url: 'https://aigoodbro.com/' });
    } catch {
      toast.error('无法打开 AiGoodBro 官网');
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={openWebsite}>
      点击有惊喜
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
    </Button>
  );
}
