'use client';

import { useState } from 'react';
import { CardWorkspace } from '@/components/CardWorkspace';
import { SidebarMeetingCard } from '@/components/Sidebar';
import { AudioLines, FileText, Mic, Sparkles, Upload, Palette, Settings2, Moon, Sun, Smartphone, Monitor } from 'lucide-react';
import { useAppearance } from '@/contexts/AppearanceContext';

export default function CardPreviewPage() {
  const [activeWorkbenchCard, setActiveWorkbenchCard] = useState('recording');
  const [activeSettingsCard, setActiveSettingsCard] = useState('appearance');
  const [selectedMeetingId, setSelectedMeetingId] = useState('meeting-1');
  const [recordingNote, setRecordingNote] = useState('这是一个未保存的会议录音要点草稿...');
  const [modelDraft, setModelDraft] = useState('qwen-plus-preview');
  const [containerWidth, setContainerWidth] = useState<'desktop' | 'compact'>('desktop');
  const [actionLog, setActionLog] = useState<string[]>(['页面就绪：准备进行卡片交互验证']);

  const log = (msg: string) => {
    setActionLog(prev => [new Date().toLocaleTimeString() + ' · ' + msg, ...prev.slice(0, 7)]);
  };

  const meetings = [
    { id: 'meeting-1', title: '周三产品设计研讨会：讨论卡片原位展开与丝滑弹簧动效规范', type: 'file' as const },
    { id: 'meeting-2', title: '本地音频模型测试与区分说话人校对进度', type: 'file' as const },
    { id: 'meeting-3', title: 'AiGoodBro 客户端多套皮肤与深色模式无障碍适配总结', type: 'file' as const },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground p-4 sm:p-6 md:p-8 flex flex-col items-center">
      {/* Header Banner */}
      <header className="w-full max-w-6xl mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary mb-2">
            测试夹具 · 交互验收专用 · 无后端依赖
          </span>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
            AiGoodMeeting 1028v5 卡片原位展开与让位动效预览
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            原生按钮 + aria-expanded/controls + 苹果式克制弹簧过渡 + 状态保持，可在独立浏览器（Safari / Chrome）直接验收
          </p>
        </div>

        {/* Viewport size toggles */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setContainerWidth('desktop')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              containerWidth === 'desktop'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-muted-foreground border-border hover:bg-muted'
            }`}
          >
            <Monitor className="w-3.5 h-3.5" /> 桌面 1240 布局
          </button>
          <button
            type="button"
            onClick={() => setContainerWidth('compact')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              containerWidth === 'compact'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-muted-foreground border-border hover:bg-muted'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" /> 紧凑 760 布局
          </button>
        </div>
      </header>

      {/* Main Preview Container */}
      <main
        className={`w-full transition-all duration-300 ease-out grid gap-6 ${
          containerWidth === 'desktop' ? 'max-w-6xl grid-cols-1 lg:grid-cols-12' : 'max-w-[760px] grid-cols-1'
        }`}
      >
        {/* Left Column: Sidebar Meeting Cards */}
        <section
          className={`agb-card rounded-2xl border border-border bg-card/60 p-4 flex flex-col ${
            containerWidth === 'desktop' ? 'lg:col-span-4' : ''
          }`}
          aria-label="会议列表卡片测试"
        >
          <div className="flex items-center justify-between pb-3 border-b border-border/60 mb-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <AudioLines className="w-4 h-4 text-primary" /> 会议列表卡片（Sidebar）
            </h2>
            <span className="text-[11px] text-muted-foreground">点已选卡片可折回</span>
          </div>
          <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
            规则：初次点击未选会议时选中并展开操作区；再次点击已选会议原位折回收起操作区；切换会议时只保留当前展开一项。
          </p>

          <div className="flex flex-col gap-2 min-h-0">
            {meetings.map(item => (
              <SidebarMeetingCard
                key={item.id}
                item={item}
                isActive={selectedMeetingId === item.id}
                isMeetingItem={true}
                matchContext={item.id === 'meeting-1' ? '命中关键词：原位展开' : undefined}
                onOpen={() => {
                  setSelectedMeetingId(item.id);
                  log(`选中会议：${item.title.slice(0, 14)}...`);
                }}
                onRename={() => log(`点击重命名：${item.title.slice(0, 14)}...`)}
                onDelete={() => log(`点击删除：${item.title.slice(0, 14)}...`)}
              />
            ))}
          </div>
        </section>

        {/* Right Column: Workbench Cards (CardWorkspace in-place) */}
        <section
          className={`agb-card rounded-2xl border border-border bg-card/60 p-4 flex flex-col ${
            containerWidth === 'desktop' ? 'lg:col-span-8' : ''
          }`}
          aria-label="工作台原位展开卡片测试"
        >
          <div className="flex items-center justify-between pb-3 border-b border-border/60 mb-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" /> 工作台原位卡片（CardWorkspace）
            </h2>
            <span className="text-[11px] text-muted-foreground">当前展开：{activeWorkbenchCard || '（全收起）'}</span>
          </div>
          <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
            规则：卡片在原位展开真实内容；再点卡头可折回收起，下方同级卡片顺滑让位。草稿输入与内部滚动完全保持。
          </p>

          <div className="flex-1 min-h-0">
            <CardWorkspace
              id="preview-workbench"
              value={activeWorkbenchCard}
              onValueChange={(val) => {
                setActiveWorkbenchCard(val);
                log(`工作台卡片变更：${val || '折回全部收起'}`);
              }}
              cards={[
                {
                  id: 'recording',
                  title: '录音',
                  description: '开始、暂停与保存会议录音（原位展开/折回）',
                  icon: Mic,
                  meta: '进行中',
                  content: (
                    <div className="p-4 sm:p-5 flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">当前录音会话草稿</span>
                        <span className="text-xs text-amber-500 font-mono">00:14:28 · 采集中</span>
                      </div>
                      <label className="text-xs text-muted-foreground">草稿保留测试输入框（收起再展开内容不丢失）：</label>
                      <textarea
                        value={recordingNote}
                        onChange={(e) => setRecordingNote(e.target.value)}
                        className="w-full h-20 p-2 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                        placeholder="输入草稿测试..."
                      />
                      <div className="flex gap-2 justify-end">
                        <button
                          type="button"
                          onClick={() => log('模拟：暂停录音')}
                          className="px-3 py-1.5 text-xs rounded-lg border border-border bg-muted hover:bg-muted/80"
                        >
                          暂停录音
                        </button>
                        <button
                          type="button"
                          onClick={() => log('模拟：停止并保存')}
                          className="px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
                        >
                          保存会议
                        </button>
                      </div>
                    </div>
                  ),
                },
                {
                  id: 'transcript',
                  title: '实时文字',
                  description: '查看与复制实时转写（测试长内容滚动与弹性伸展）',
                  icon: FileText,
                  meta: '12 段',
                  content: (
                    <div className="p-4 sm:p-5 flex flex-col gap-2">
                      <span className="text-sm font-medium mb-1">长文本段落流（卡片内单一平滑滚动，不被压扁）：</span>
                      <div className="max-h-56 overflow-y-auto custom-scrollbar flex flex-col gap-2.5 pr-2">
                        {Array.from({ length: 8 }).map((_, i) => (
                          <div key={i} className="p-2.5 rounded-lg bg-muted/40 border border-border/50 text-xs">
                            <span className="text-primary font-medium mr-2">说话人 { (i % 2) + 1 } [00:0{i}:12]:</span>
                            <span>
                              这是原位展开的第 {i + 1} 条转写文本。卡片展开后拥有完整的尺寸、圆角与低回弹弹簧过渡，相邻卡片自然向下让位。
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ),
                },
                {
                  id: 'import',
                  title: '导入音频',
                  description: '从已有音频生成会议记录',
                  icon: Upload,
                  content: (
                    <div className="p-4 sm:p-5 flex flex-col gap-3">
                      <p className="text-xs text-muted-foreground">支持 WAV, MP3, M4A, FLAC 等常见音频格式。</p>
                      <button
                        type="button"
                        onClick={() => log('模拟：点击选择录音文件')}
                        className="flex items-center justify-center gap-2 px-4 py-2 text-xs rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 w-fit"
                      >
                        <Upload className="w-3.5 h-3.5" /> 选择录音文件
                      </button>
                    </div>
                  ),
                },
              ]}
            />
          </div>
        </section>

        {/* Bottom Section: Settings Tabs in-place */}
        <section className="agb-card rounded-2xl border border-border bg-card/60 p-4 lg:col-span-12 flex flex-col">
          <div className="flex items-center justify-between pb-3 border-b border-border/60 mb-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-primary" /> 设置选项卡（SettingTabs 原位展开）
            </h2>
            <span className="text-[11px] text-muted-foreground">当前设置项：{activeSettingsCard || '（已折叠）'}</span>
          </div>

          <CardWorkspace
            id="preview-settings"
            value={activeSettingsCard}
            onValueChange={(val) => {
              setActiveSettingsCard(val);
              log(`设置卡片变更：${val || '折叠'}`);
            }}
            cards={[
              {
                id: 'appearance',
                title: '外观偏好',
                description: '皮肤材质与明暗模式',
                icon: Palette,
                content: (
                  <div className="p-4 text-xs text-muted-foreground space-y-2">
                    <p className="text-foreground font-medium">七套 AiGoodBro 原始皮肤保持完整生效：</p>
                    <p>默认浅色/深色、液态键帽、青花瓷、敦煌飞天、紫禁朱红、幽兰晨曦、千里江山。</p>
                  </div>
                ),
              },
              {
                id: 'models',
                title: '纪要模型配置',
                description: '选择或自定义纪要大模型（支持空值折叠与草稿保留）',
                icon: Sparkles,
                content: (
                  <div className="p-4 text-xs space-y-3">
                    <label className="block text-muted-foreground font-medium">自定义模型标识：</label>
                    <input
                      type="text"
                      value={modelDraft}
                      onChange={(e) => setModelDraft(e.target.value)}
                      className="px-3 py-1.5 rounded-lg border border-border bg-background text-foreground text-xs w-full max-w-sm"
                    />
                    <p className="text-muted-foreground">再次点击卡头“纪要模型配置”可原位折叠收起，重新展开时当前输入不会被重置。</p>
                  </div>
                ),
              },
            ]}
          />
        </section>
      </main>

      {/* Action Log Footer */}
      <footer className="w-full max-w-6xl mt-6 p-3 rounded-xl border border-border bg-muted/30 text-xs">
        <div className="flex items-center justify-between mb-1 text-[11px] font-medium text-muted-foreground">
          <span>真实交互日志（每次原位点击与回调）：</span>
          <span>共 {actionLog.length} 条</span>
        </div>
        <ul className="space-y-0.5 font-mono text-[11px] text-muted-foreground">
          {actionLog.map((item, idx) => (
            <li key={idx} className={idx === 0 ? 'text-primary font-medium' : ''}>
              {item}
            </li>
          ))}
        </ul>
      </footer>
    </div>
  );
}
