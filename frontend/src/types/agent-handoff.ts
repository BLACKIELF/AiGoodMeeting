export type FeishuDeliveryMode = 'doc_and_group' | 'doc_and_self' | 'doc_only' | 'none';

export const FEISHU_INSTALL_COMMAND = 'npm install -g @larksuite/cli';
export const FEISHU_LOGIN_COMMAND = 'lark-cli auth login';
export const AUTO_HANDOFF_STORAGE_KEY = 'aigoodmeeting_auto_handoff_plan_v3';
export const AUTO_HANDOFF_EVENT = 'agb-auto-handoff-plan-updated';

export interface AgentHandoffConfig {
  defaultAgent: string;
  workspaceDir: string;
  autoExecuteWhenReady: boolean;
  feishuDeliveryMode: FeishuDeliveryMode;
  feishuChatId: string;
  feishuChatName: string;
  customCliPaths: Record<string, string>;
  modelOverrides: Record<string, string>;
}

export interface AgentInstallationInfo {
  id: string;
  name: string;
  shortName: string;
  installed: boolean;
  executable: boolean;
  cliPath?: string | null;
  appPath?: string | null;
  version?: string | null;
  skillLinked: boolean;
  statusLabel: string;
  hint: string;
  installCommand?: string | null;
  loginCommand?: string | null;
  docsUrl?: string | null;
  beginnerNote?: string;
}

export interface FeishuChatItem {
  chatId: string;
  name: string;
  chatMode: string;
  description: string;
}

export interface CorrectedTerm {
  heard: string;
  normalized: string;
  evidence: string;
}

export interface ClarificationQuestion {
  id: string;
  question: string;
  reason: string;
  suggestedOptions: string[];
  defaultOption: string;
  allowCustom: boolean;
}

export interface ClarificationAnswer {
  questionId: string;
  question: string;
  answer: string;
}

export interface PreflightResult {
  status: 'ready' | 'needs_clarification' | string;
  understoodGoal: string;
  correctedTerms: CorrectedTerm[];
  plannedDeliverables: string[];
  suggestedFeishuTitle: string;
  missingInfoSummary: string;
  questions: ClarificationQuestion[];
}

export interface ExecuteResult {
  summary: string;
  feishuTitle: string;
  feishuMessageSummary: string;
  deliverableMarkdownPath: string;
  artifactPaths: string[];
  nextActions: string[];
}

export interface FeishuDeliveryResult {
  attempted: boolean;
  deliveryMode: string;
  docOk: boolean;
  docUrl?: string | null;
  docToken?: string | null;
  messageOk: boolean;
  messageId?: string | null;
  targetLabel?: string | null;
  message: string;
}

export interface AgentRunRecord {
  runId: string;
  meetingId: string;
  meetingTitle: string;
  agentId: string;
  agentName: string;
  collaboratorAgentIds?: string[];
  collaboratorAgentNames?: string[];
  workspaceDir: string;
  userInstruction: string;
  feishuDeliveryMode: string;
  feishuChatId: string;
  feishuChatName: string;
  status:
    | 'preflighting'
    | 'needs_clarification'
    | 'ready'
    | 'executing'
    | 'delivering_feishu'
    | 'completed'
    | 'completed_feishu_warning'
    | 'cancelled'
    | 'error'
    | string;
  createdAt: string;
  updatedAt: string;
  runDir: string;
  contextPath: string;
  preflight?: PreflightResult | null;
  answers: ClarificationAnswer[];
  executeResult?: ExecuteResult | null;
  deliverablePreview?: string | null;
  feishuDelivery?: FeishuDeliveryResult | null;
  error?: string | null;
  logs: string[];
}

export interface AgentProgressEvent {
  runId: string;
  meetingId: string;
  stage: string;
  message: string;
  logLine?: string | null;
}

export interface ManualHandoffResponse {
  runDir: string;
  contextPath: string;
  promptText: string;
  launchedApp: boolean;
  message: string;
}

/**
 * Persistent first-level post-recording / post-transcription linkage plan.
 * Shared live across Workbench (before/during recording), ImportAudioDialog (during transcription),
 * and MeetingDetails (auto-trigger on arrival + instant first-level action bar).
 */
export interface AutoHandoffPlan {
  enabledAgents: string[];
  sendToFeishu: boolean;
  feishuDeliveryMode: FeishuDeliveryMode;
  feishuChatId: string;
  feishuChatName: string;
}

export const DEFAULT_AUTO_HANDOFF_PLAN: AutoHandoffPlan = {
  enabledAgents: [],
  sendToFeishu: false,
  feishuDeliveryMode: 'doc_and_self',
  feishuChatId: '',
  feishuChatName: '',
};

export const DEFAULT_AGENT_HANDOFF_CONFIG: AgentHandoffConfig = {
  defaultAgent: 'codex',
  workspaceDir: '',
  autoExecuteWhenReady: true,
  feishuDeliveryMode: 'doc_and_group',
  feishuChatId: '',
  feishuChatName: '',
  customCliPaths: {},
  modelOverrides: {},
};

export const FEISHU_DELIVERY_OPTIONS: Array<{
  value: FeishuDeliveryMode;
  label: string;
  description: string;
}> = [
  {
    value: 'doc_and_group',
    label: '飞书云文档 + 指定飞书群（推荐）',
    description: '生成可编辑飞书云文档，并自动发送摘要与链接到所选飞书群',
  },
  {
    value: 'doc_and_self',
    label: '飞书云文档 + 飞书私聊本人',
    description: '生成飞书云文档后发消息给自己，适合先自检再转发',
  },
  {
    value: 'doc_only',
    label: '仅创建飞书云文档',
    description: '按飞书同步目录/知识库归档云文档，不发送群或私聊消息',
  },
  {
    value: 'none',
    label: '仅本地完成，不发飞书',
    description: '成果保存在本地工作区与任务目录，稍后可随时一键补发飞书',
  },
];

export function parseAutoHandoffPlan(raw: string | null | undefined): AutoHandoffPlan {
  if (!raw) return { ...DEFAULT_AUTO_HANDOFF_PLAN };
  try {
    const parsed = JSON.parse(raw) as Partial<AutoHandoffPlan>;
    const enabledAgents = Array.isArray(parsed.enabledAgents)
      ? Array.from(
          new Set(
            parsed.enabledAgents
              .filter((x): x is string => typeof x === 'string')
              .map((s) => s.trim().toLowerCase())
              .filter(Boolean),
          ),
        )
      : [];
    const validModes: FeishuDeliveryMode[] = ['doc_and_group', 'doc_and_self', 'doc_only', 'none'];
    const mode = validModes.includes(parsed.feishuDeliveryMode as FeishuDeliveryMode)
      ? (parsed.feishuDeliveryMode as FeishuDeliveryMode)
      : DEFAULT_AUTO_HANDOFF_PLAN.feishuDeliveryMode;
    return {
      enabledAgents,
      sendToFeishu: Boolean(parsed.sendToFeishu),
      feishuDeliveryMode: mode,
      feishuChatId: typeof parsed.feishuChatId === 'string' ? parsed.feishuChatId : '',
      feishuChatName: typeof parsed.feishuChatName === 'string' ? parsed.feishuChatName : '',
    };
  } catch {
    return { ...DEFAULT_AUTO_HANDOFF_PLAN };
  }
}

export function loadAutoHandoffPlan(): AutoHandoffPlan {
  if (typeof window === 'undefined') return { ...DEFAULT_AUTO_HANDOFF_PLAN };
  try {
    return parseAutoHandoffPlan(window.localStorage.getItem(AUTO_HANDOFF_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_AUTO_HANDOFF_PLAN };
  }
}

export function saveAutoHandoffPlan(plan: AutoHandoffPlan): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(AUTO_HANDOFF_STORAGE_KEY, JSON.stringify(plan));
    window.dispatchEvent(new CustomEvent<AutoHandoffPlan>(AUTO_HANDOFF_EVENT, { detail: plan }));
  } catch {
    // Ignore restricted storage
  }
}

export function toggleAgentInPlan(plan: AutoHandoffPlan, agentId: string): AutoHandoffPlan {
  const id = agentId.trim().toLowerCase();
  if (!id) return plan;
  const exists = plan.enabledAgents.includes(id);
  const nextAgents = exists
    ? plan.enabledAgents.filter((a) => a !== id)
    : [...plan.enabledAgents, id];
  return { ...plan, enabledAgents: nextAgents };
}

export function isAutoHandoffArmed(plan: AutoHandoffPlan): boolean {
  return plan.enabledAgents.length > 0 || plan.sendToFeishu;
}

export function splitLeadAndCollaborators(agentIds: string[]): {
  leadAgentId: string | null;
  collaboratorAgentIds: string[];
} {
  const clean = Array.from(
    new Set(agentIds.map((s) => s.trim().toLowerCase()).filter(Boolean)),
  );
  if (clean.length === 0) {
    return { leadAgentId: null, collaboratorAgentIds: [] };
  }
  return {
    leadAgentId: clean[0],
    collaboratorAgentIds: clean.slice(1),
  };
}

export function feishuDeliveryModeLabel(mode: string, chatName?: string): string {
  switch (mode) {
    case 'doc_and_group':
      return chatName ? `云文档 + 群「${chatName}」` : '云文档 + 指定飞书群';
    case 'doc_and_self':
      return '云文档 + 飞书私聊本人';
    case 'doc_only':
      return '仅创建飞书云文档';
    case 'none':
      return '仅本地完成';
    default:
      return mode;
  }
}

export function resolvePreferredAgentId(
  configuredId: string,
  agents: AgentInstallationInfo[],
): string {
  const configured = agents.find((a) => a.id === configuredId);
  if (configured && configured.installed) {
    return configured.id;
  }
  const firstExec = agents.find((a) => a.executable);
  if (firstExec) {
    return firstExec.id;
  }
  const firstInstalled = agents.find((a) => a.installed);
  if (firstInstalled) {
    return firstInstalled.id;
  }
  return configuredId || 'codex';
}

export function buildDefaultClarificationAnswers(
  questions: ClarificationQuestion[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const q of questions) {
    map[q.id] = q.defaultOption || q.suggestedOptions[0] || '';
  }
  return map;
}

export function toClarificationAnswerList(
  questions: ClarificationQuestion[],
  drafts: Record<string, string>,
): ClarificationAnswer[] {
  return questions.map((q) => {
    const chosen = (drafts[q.id] ?? '').trim();
    const fallback = q.defaultOption || q.suggestedOptions[0] || '按 Agent 推荐处理';
    return {
      questionId: q.id,
      question: q.question,
      answer: chosen || fallback,
    };
  });
}
