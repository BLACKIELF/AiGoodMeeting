'use client';

import { toUserMessage } from '@/lib/user-message';
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, File, Settings, ChevronLeftCircle, Home, Trash2, Mic, Plus, Pencil, NotebookPen, SearchIcon, X, Upload } from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { useSidebar } from './SidebarProvider';
import type { CurrentMeeting } from '@/components/Sidebar/SidebarProvider';
import { ConfirmationModal } from '../ConfirmationModel/confirmation-modal';
import { ModelConfig } from '@/components/ModelSettingsModal';
import { TranscriptModelProps } from '@/components/TranscriptSettings';
import Analytics from '@/lib/analytics';
import { invoke } from '@tauri-apps/api/core';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useImportDialog } from '@/contexts/ImportDialogContext';
import { useConfig } from '@/contexts/ConfigContext';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog"

import Logo from '../Logo';
import Info from '../Info';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '../ui/input-group';

interface SidebarItem {
  id: string;
  title: string;
  type: 'folder' | 'file';
  children?: SidebarItem[];
}

interface SidebarMeetingCardProps {
  item: SidebarItem;
  isActive: boolean;
  isMeetingItem: boolean;
  matchContext?: string;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}

export function SidebarMeetingCard({
  item, isActive, isMeetingItem, matchContext, onOpen, onRename, onDelete,
}: SidebarMeetingCardProps) {
  const detailsId = React.useId();

  return (
    <div className="agb-meeting-card group relative min-w-0" data-active={isActive}>
      <button
        type="button"
        onClick={onOpen}
        aria-current={isActive ? 'page' : undefined}
        aria-expanded={isMeetingItem ? isActive : undefined}
        aria-controls={isMeetingItem ? detailsId : undefined}
        title={item.title}
        className="w-full min-w-0 rounded-[inherit] px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="flex min-w-0 items-start gap-2.5">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${isActive ? 'bg-primary/15 text-primary' : 'text-muted-foreground'}`}>
            {isMeetingItem ? <File className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          </span>
          <span className={`min-w-0 flex-1 break-words text-[13px] leading-5 [overflow-wrap:anywhere] ${isActive ? 'whitespace-normal font-medium text-foreground' : 'line-clamp-2 text-muted-foreground'}`}>
            {item.id.startsWith('intro-call') ? '新建会议' : item.title}
          </span>
          {isMeetingItem && (
            <ChevronDown aria-hidden="true" className={`mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none ${isActive ? 'rotate-180' : ''}`} />
          )}
        </span>
        {matchContext && (
          <span className={`ml-[38px] mt-2 block break-words text-[11px] leading-5 text-muted-foreground [overflow-wrap:anywhere] ${isActive ? 'whitespace-pre-wrap' : 'line-clamp-2'}`}>
            <span className="mr-1 text-primary">匹配</span>{matchContext}
          </span>
        )}
      </button>
      {isMeetingItem && (
        <div
          id={detailsId}
          className="agb-meeting-card-tools"
          data-open={isActive}
          aria-hidden={!isActive}
          {...(isActive ? {} : { inert: '' as unknown as boolean })}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="mx-3 mb-3 flex flex-wrap gap-1.5 border-t border-border/60 pt-2">
              <button
                type="button"
                onClick={isActive ? onRename : undefined}
                disabled={!isActive}
                tabIndex={isActive ? 0 : -1}
                className="flex min-h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
                aria-label={`重命名：${item.title}`}
              ><Pencil className="h-3.5 w-3.5 shrink-0" />重命名</button>
              <button
                type="button"
                onClick={isActive ? onDelete : undefined}
                disabled={!isActive}
                tabIndex={isActive ? 0 : -1}
                className="flex min-h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
                aria-label={`删除会议：${item.title}`}
              ><Trash2 className="h-3.5 w-3.5 shrink-0" />删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const Sidebar: React.FC = () => {
  const router = useRouter();
  const pathname = usePathname();
  const {
    currentMeeting,
    setCurrentMeeting,
    sidebarItems,
    isCollapsed,
    toggleCollapse,
    handleRecordingToggle,
    searchTranscripts,
    searchResults,
    isSearching,
    meetings,
    setMeetings,
    serverAddress
  } = useSidebar();

  // Get recording state from RecordingStateContext (single source of truth)
  const { isRecording } = useRecordingState();
  const { openImportDialog } = useImportDialog();
  const { betaFeatures } = useConfig();
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['meetings']));
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [modelConfig, setModelConfig] = useState<ModelConfig>({
    provider: 'ollama',
    model: '',
    whisperModel: '',
    apiKey: null,
    ollamaEndpoint: null
  });
  const [transcriptModelConfig, setTranscriptModelConfig] = useState<TranscriptModelProps>({
    provider: 'parakeet',
    model: 'parakeet-tdt-0.6b-v3-int8',
  });
  const [settingsSaveSuccess, setSettingsSaveSuccess] = useState<boolean | null>(null);

  // State for edit modal
  const [editModalState, setEditModalState] = useState<{ isOpen: boolean; meetingId: string | null; currentTitle: string }>({
    isOpen: false,
    meetingId: null,
    currentTitle: ''
  });
  const [editingTitle, setEditingTitle] = useState<string>('');

  // Ensure 'meetings' folder is always expanded
  useEffect(() => {
    if (!expandedFolders.has('meetings')) {
      const newExpanded = new Set(expandedFolders);
      newExpanded.add('meetings');
      setExpandedFolders(newExpanded);
    }
  }, [expandedFolders]);

  // useEffect(() => {
  //   if (settingsSaveSuccess !== null) {
  //     const timer = setTimeout(() => {
  //       setSettingsSaveSuccess(null);
  //     }, 3000);
  //   }
  // }, [settingsSaveSuccess]);


  const [deleteModalState, setDeleteModalState] = useState<{ isOpen: boolean; itemId: string | null }>({ isOpen: false, itemId: null });

  useEffect(() => {
    // Note: Don't set hardcoded defaults - let DB be the source of truth
    const fetchModelConfig = async () => {
      // Only make API call if serverAddress is loaded
      if (!serverAddress) {
        console.log('Waiting for server address to load before fetching model config');
        return;
      }

      try {
        const data = await invoke('api_get_model_config') as any;
        if (data && data.provider !== null) {
          // Fetch API key if not included and provider requires it
          if (data.provider !== 'ollama' && !data.apiKey) {
            try {
              const apiKeyData = await invoke('api_get_api_key', {
                provider: data.provider
              }) as string;
              data.apiKey = apiKeyData;
            } catch (err) {
              console.error('Failed to fetch API key:', err);
            }
          }
          setModelConfig(data);
        }
      } catch (error) {
        console.error('Failed to fetch model config:', error);
      }
    };

    fetchModelConfig();
  }, [serverAddress]);


  useEffect(() => {
    // Note: Don't set hardcoded defaults - let DB be the source of truth
    const fetchTranscriptSettings = async () => {
      // Only make API call if serverAddress is loaded
      if (!serverAddress) {
        console.log('Waiting for server address to load before fetching transcript settings');
        return;
      }

      try {
        const data = await invoke('api_get_transcript_config') as any;
        if (data && data.provider !== null) {
          setTranscriptModelConfig(data);
        }
      } catch (error) {
        console.error('Failed to fetch transcript settings:', error);
      }
    };
    fetchTranscriptSettings();
  }, [serverAddress]);

  // Listen for model config updates from other components
  useEffect(() => {
    const setupListener = async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen<ModelConfig>('model-config-updated', (event) => {
        console.log('Sidebar received model-config-updated event:', event.payload);
        setModelConfig(event.payload);
      });

      return unlisten;
    };

    let cleanup: (() => void) | undefined;
    setupListener().then(fn => cleanup = fn);

    return () => {
      cleanup?.();
    };
  }, []);



  // Handle model config save
  const handleSaveModelConfig = async (config: ModelConfig) => {
    try {
      await invoke('api_save_model_config', {
        provider: config.provider,
        model: config.model,
        whisperModel: config.whisperModel,
        apiKey: config.apiKey,
        ollamaEndpoint: config.ollamaEndpoint,
      });

      setModelConfig(config);
      console.log('Model config saved successfully');
      setSettingsSaveSuccess(true);

      // Emit event to sync other components
      const { emit } = await import('@tauri-apps/api/event');
      await emit('model-config-updated', config);

      // Track settings change
      await Analytics.trackSettingsChanged('model_config', `${config.provider}_${config.model}`);
    } catch (error) {
      console.error('Error saving model config:', error);
      setSettingsSaveSuccess(false);
    }
  };

  const handleSaveTranscriptConfig = async (updatedConfig?: TranscriptModelProps) => {
    try {
      const configToSave = updatedConfig || transcriptModelConfig;
      const payload = {
        provider: configToSave.provider,
        model: configToSave.model,
        apiKey: configToSave.apiKey ?? null
      };
      console.log('Saving transcript config with payload:', payload);

      await invoke('api_save_transcript_config', {
        provider: payload.provider,
        model: payload.model,
        apiKey: payload.apiKey,
      });


      setSettingsSaveSuccess(true);

      // Track settings change
      const transcriptConfigToSave = updatedConfig || transcriptModelConfig;
      await Analytics.trackSettingsChanged('transcript_config', `${transcriptConfigToSave.provider}_${transcriptConfigToSave.model}`);
    } catch (error) {
      console.error('Failed to save transcript config:', error);
      setSettingsSaveSuccess(false);
    }
  };

  // Handle search input changes
  const handleSearchChange = useCallback(async (value: string) => {
    setSearchQuery(value);

    // If search query is empty, just return to normal view
    if (!value.trim()) return;

    // Search through transcripts
    await searchTranscripts(value);

    // Make sure the meetings folder is expanded when searching
    if (!expandedFolders.has('meetings')) {
      const newExpanded = new Set(expandedFolders);
      newExpanded.add('meetings');
      setExpandedFolders(newExpanded);
    }
  }, [expandedFolders, searchTranscripts]);

  // Combine search results with sidebar items
  const filteredSidebarItems = useMemo(() => {
    if (!searchQuery.trim()) return sidebarItems;

    // If we have search results, highlight matching meetings
    if (searchResults.length > 0) {
      // Get the IDs of meetings that matched in transcripts
      const matchedMeetingIds = new Set(searchResults.map(result => result.id));

      return sidebarItems
        .map(folder => {
          // Always include folders in the results
          if (folder.type === 'folder') {
            if (!folder.children) return folder;

            // Filter children based on search results or title match
            const filteredChildren = folder.children.filter(item => {
              // Include if the meeting ID is in our search results
              if (matchedMeetingIds.has(item.id)) return true;

              // Or if the title matches the search query
              return item.title.toLowerCase().includes(searchQuery.toLowerCase());
            });

            return {
              ...folder,
              children: filteredChildren
            };
          }

          // For non-folder items, check if they match the search
          return (matchedMeetingIds.has(folder.id) ||
            folder.title.toLowerCase().includes(searchQuery.toLowerCase()))
            ? folder : undefined;
        })
        .filter((item): item is SidebarItem => item !== undefined); // Type-safe filter
    } else {
      // Fall back to title-only filtering if no transcript results
      return sidebarItems
        .map(folder => {
          // Always include folders in the results
          if (folder.type === 'folder') {
            if (!folder.children) return folder;

            // Filter children based on search query
            const filteredChildren = folder.children.filter(item =>
              item.title.toLowerCase().includes(searchQuery.toLowerCase())
            );

            return {
              ...folder,
              children: filteredChildren
            };
          }

          // For non-folder items, check if they match the search
          return folder.title.toLowerCase().includes(searchQuery.toLowerCase()) ? folder : undefined;
        })
        .filter((item): item is SidebarItem => item !== undefined); // Type-safe filter
    }
  }, [sidebarItems, searchQuery, searchResults, expandedFolders]);


  const handleDelete = async (itemId: string) => {
    console.log('Deleting item:', itemId);
    const payload = {
      meetingId: itemId
    };

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('api_delete_meeting', {
        meetingId: itemId,
      });
      console.log('Meeting deleted successfully');
      const updatedMeetings = meetings.filter((m: CurrentMeeting) => m.id !== itemId);
      setMeetings(updatedMeetings);

      // Track meeting deletion
      Analytics.trackMeetingDeleted(itemId);

      // Show success toast
      toast.success("会议已删除", {
        description: "相关数据已移除"
      });

      // If deleting the active meeting, navigate to home
      if (currentMeeting?.id === itemId) {
        setCurrentMeeting({ id: 'intro-call', title: '+ New Call' });
        router.push('/');
      }
    } catch (error) {
      console.error('Failed to delete meeting:', error);
      toast.error("删除会议失败", {
        description: toUserMessage(error, '操作未完成，请重试。')
      });
    }
  };

  const handleDeleteConfirm = () => {
    if (deleteModalState.itemId) {
      handleDelete(deleteModalState.itemId);
    }
    setDeleteModalState({ isOpen: false, itemId: null });
  };

  // Handle modal editing of meeting names
  const handleEditStart = (meetingId: string, currentTitle: string) => {
    setEditModalState({
      isOpen: true,
      meetingId: meetingId,
      currentTitle: currentTitle
    });
    setEditingTitle(currentTitle);
  };

  const handleEditConfirm = async () => {
    const newTitle = editingTitle.trim();
    const meetingId = editModalState.meetingId;

    if (!meetingId) return;

    // Prevent empty titles
    if (!newTitle) {
      toast.error("会议名称不能为空");
      return;
    }

    try {
      await invoke('api_save_meeting_title', {
        meetingId: meetingId,
        title: newTitle,
      });

      // Update local state
      const updatedMeetings = meetings.map((m: CurrentMeeting) =>
        m.id === meetingId ? { ...m, title: newTitle } : m
      );
      setMeetings(updatedMeetings);

      // Update current meeting if it's the one being edited
      if (currentMeeting?.id === meetingId) {
        setCurrentMeeting({ id: meetingId, title: newTitle });
      }

      // Track the edit
      Analytics.trackButtonClick('edit_meeting_title', 'sidebar');

      toast.success("会议名称已更新");

      // Close modal and reset state
      setEditModalState({ isOpen: false, meetingId: null, currentTitle: '' });
      setEditingTitle('');
    } catch (error) {
      console.error('Failed to update meeting title:', error);
      toast.error("更新会议名称失败", {
        description: toUserMessage(error, '操作未完成，请重试。')
      });
    }
  };

  const handleEditCancel = () => {
    setEditModalState({ isOpen: false, meetingId: null, currentTitle: '' });
    setEditingTitle('');
  };

  const toggleFolder = (folderId: string) => {
    // Normal toggle behavior for all folders
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(folderId)) {
      newExpanded.delete(folderId);
    } else {
      newExpanded.add(folderId);
    }
    setExpandedFolders(newExpanded);
  };

  // Expose setShowModelSettings to window for Rust tray to call
  useEffect(() => {
    (window as any).openSettings = () => {
      setShowModelSettings(true);
    };

    // Cleanup on unmount
    return () => {
      delete (window as any).openSettings;
    };
  }, []);

  const renderCollapsedIcons = () => {
    if (!isCollapsed) return null;

    const iconButton = (label: string, onClick: () => void, icon: React.ReactNode, active = false, disabled = false) => (
      <Tooltip key={label}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
          >
            {icon}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    );

    return (
      <nav aria-label="主要操作" className="flex flex-col items-center gap-2 px-2">
        {iconButton('首页', () => router.push('/'), <Home className="h-[18px] w-[18px]" />, pathname === '/')}
        {iconButton(isRecording ? '正在录音' : '开始录音', handleRecordingToggle, <Mic className="h-[18px] w-[18px]" />, false, isRecording)}
        {betaFeatures.importAndRetranscribe && iconButton('导入音频', () => openImportDialog(), <Upload className="h-[18px] w-[18px]" />)}
        {iconButton('会议记录', () => {
          toggleCollapse();
          if (!expandedFolders.has('meetings')) toggleFolder('meetings');
        }, <NotebookPen className="h-[18px] w-[18px]" />, !!pathname?.includes('/meeting-details'))}
      </nav>
    );
  };

  const findMatchingSnippet = (itemId: string) => {
    if (!searchQuery.trim() || !searchResults.length) return null;
    return searchResults.find(result => result.id === itemId);
  };

  const visibleMeetingCount = filteredSidebarItems
    .filter(item => item.id === 'meetings')
    .reduce((count, folder) => count + (folder.children?.length ?? 0), 0);

  const renderItem = (item: SidebarItem, depth = 0): React.ReactNode => {
    if (isCollapsed) return null;
    const isExpanded = expandedFolders.has(item.id);
    const isActive = item.type === 'file' && currentMeeting?.id === item.id;
    const isMeetingItem = item.id.includes('-') && !item.id.startsWith('intro-call');
    const matchingResult = isMeetingItem ? findMatchingSnippet(item.id) : null;

    if (item.type === 'folder') {
      return (
        <div key={item.id}>
          <button
            type="button"
            onClick={() => toggleFolder(item.id)}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted"
            aria-expanded={isExpanded}
          >
            <NotebookPen className="h-3.5 w-3.5" />
            <span className="min-w-0 flex-1 truncate text-left">{item.id === 'meetings' ? '会议记录' : item.title}</span>
            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
          {isExpanded && item.children?.map(child => renderItem(child, depth + 1))}
        </div>
      );
    }

    return (
      <SidebarMeetingCard
        key={item.id}
        item={item}
        isActive={isActive}
        isMeetingItem={isMeetingItem}
        matchContext={matchingResult?.matchContext}
        onOpen={() => {
          setCurrentMeeting({ id: item.id, title: item.title });
          const basePath = item.id.startsWith('intro-call') ? '/' :
            item.id.includes('-') ? `/meeting-details?id=${item.id}` : `/notes/${item.id}`;
          router.push(basePath);
        }}
        onRename={() => handleEditStart(item.id, item.title)}
        onDelete={() => setDeleteModalState({ isOpen: true, itemId: item.id })}
      />
    );
  };

  return (
    <TooltipProvider delayDuration={250}>
      <aside aria-label="会议导航" className={`agb-sidebar fixed inset-y-0 left-0 z-40 flex h-screen flex-col border-r border-border bg-card text-foreground transition-[width] duration-200 motion-reduce:transition-none ${isCollapsed ? 'w-16' : 'w-64'}`}>
        <button
          type="button"
          onClick={toggleCollapse}
          aria-label={isCollapsed ? '展开侧栏' : '收起侧栏'}
          title={isCollapsed ? '展开侧栏' : '收起侧栏'}
          className="absolute -right-3 top-6 z-50 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeftCircle className="h-3.5 w-3.5" />}
        </button>

        <div className={`flex shrink-0 items-center ${isCollapsed ? 'h-20 justify-center' : 'h-20 px-3 pr-5'}`}>
          <Logo isCollapsed={isCollapsed} />
        </div>

        {!isCollapsed && (
          <div className="shrink-0 px-3 pb-3">
            <InputGroup className="h-9 rounded-xl border-border bg-background/60 shadow-none">
              <InputGroupInput
                placeholder="搜索会议或正文"
                aria-label="搜索会议或正文"
                value={searchQuery}
                onChange={(event) => handleSearchChange(event.target.value)}
                className="text-xs"
              />
              <InputGroupAddon><SearchIcon className="h-3.5 w-3.5 text-muted-foreground" /></InputGroupAddon>
              {searchQuery && (
                <InputGroupAddon align="inline-end">
                  <InputGroupButton onClick={() => handleSearchChange('')} aria-label="清除搜索" title="清除搜索">
                    <X className="h-3.5 w-3.5" />
                  </InputGroupButton>
                </InputGroupAddon>
              )}
            </InputGroup>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col">
          {renderCollapsedIcons()}
          {!isCollapsed && (
            <>
              <nav aria-label="主要操作" className="shrink-0 space-y-1 px-3">
                <button
                  type="button"
                  onClick={() => router.push('/')}
                  aria-current={pathname === '/' ? 'page' : undefined}
                  className={`flex h-9 w-full items-center gap-2.5 rounded-xl px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${pathname === '/' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                ><Home className="h-4 w-4" />首页</button>
                <button
                  type="button"
                  onClick={handleRecordingToggle}
                  disabled={isRecording}
                  className="flex h-9 w-full items-center gap-2.5 rounded-xl bg-primary px-3 text-[13px] font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                ><Mic className="h-4 w-4" />{isRecording ? '正在录音' : '开始录音'}</button>
                {betaFeatures.importAndRetranscribe && (
                  <button
                    type="button"
                    onClick={() => openImportDialog()}
                    className="flex h-9 w-full items-center gap-2.5 rounded-xl px-3 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  ><Upload className="h-4 w-4" />导入音频</button>
                )}
              </nav>

              <div className="mt-5 flex shrink-0 items-center gap-2 px-5 pb-2 text-[11px] font-medium text-muted-foreground">
                <NotebookPen className="h-3.5 w-3.5" />
                <span>会议记录</span>
                <span className="ml-auto tabular-nums">{searchQuery.trim() ? `${visibleMeetingCount} / ${meetings.length}` : meetings.length}</span>
              </div>
              {isSearching && searchQuery.trim() && <p role="status" className="px-5 pb-2 text-[11px] text-primary">正在搜索…</p>}
              <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-3">
                {filteredSidebarItems
                  .filter(item => item.type === 'folder' && expandedFolders.has(item.id) && item.children)
                  .map(item => <div key={item.id} className="flex min-w-0 flex-col gap-2">{item.children!.map(child => renderItem(child, 1))}</div>)}
                {visibleMeetingCount === 0 && !isSearching && (
                  <p className="px-2 py-5 text-xs leading-6 text-muted-foreground">
                    {searchQuery.trim() ? '没有找到相关会议。' : '还没有会议记录。开始录音，或导入已有音频。'}
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        <div className={`flex shrink-0 flex-col gap-1 border-t border-border/70 py-3 ${isCollapsed ? 'items-center px-2' : 'px-3'}`}>
          <ThemeSwitcher compact={isCollapsed} />
          <button
            type="button"
            onClick={() => router.push('/settings')}
            aria-label="设置"
            title="设置"
            aria-current={pathname === '/settings' ? 'page' : undefined}
            className={`flex items-center gap-2 rounded-lg text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isCollapsed ? 'h-9 w-9 justify-center' : 'w-full px-2.5 py-2'} ${pathname === '/settings' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
          ><Settings className="h-4 w-4 shrink-0" />{!isCollapsed && '设置'}</button>
          <Info isCollapsed={isCollapsed} />
        </div>
      </aside>

      <ConfirmationModal
        isOpen={deleteModalState.isOpen}
        text="确定删除这场会议吗？此操作无法撤销。"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteModalState({ isOpen: false, itemId: null })}
      />

      <Dialog open={editModalState.isOpen} onOpenChange={(open) => { if (!open) handleEditCancel(); }}>
        <DialogContent className="rounded-2xl border-border bg-card text-foreground sm:max-w-[425px]">
          <DialogTitle>重命名会议</DialogTitle>
          <div className="py-2">
            <label htmlFor="meeting-title" className="mb-2 block text-xs font-medium text-muted-foreground">会议名称</label>
            <input
              id="meeting-title"
              type="text"
              value={editingTitle}
              onChange={(event) => setEditingTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleEditConfirm();
                else if (event.key === 'Escape') handleEditCancel();
              }}
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="输入会议名称"
              autoFocus
            />
          </div>
          <DialogFooter>
            <button onClick={handleEditCancel} className="rounded-lg bg-muted px-4 py-2 text-sm text-foreground hover:bg-muted/80">取消</button>
            <button onClick={handleEditConfirm} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">保存</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
};

export default Sidebar;
