import { describe, expect, test } from 'bun:test';
import {
  AgentInstallationInfo,
  ClarificationQuestion,
  DEFAULT_AUTO_HANDOFF_PLAN,
  FEISHU_INSTALL_COMMAND,
  FEISHU_LOGIN_COMMAND,
  buildDefaultClarificationAnswers,
  feishuDeliveryModeLabel,
  isAutoHandoffArmed,
  parseAutoHandoffPlan,
  resolvePreferredAgentId,
  splitLeadAndCollaborators,
  toClarificationAnswerList,
  toggleAgentInPlan,
} from '../../src/types/agent-handoff';

describe('agent handoff helpers', () => {
  test('prefers configured installed agent, otherwise falls back to first executable then first installed', () => {
    const detected: AgentInstallationInfo[] = [
      {
        id: 'codex',
        name: 'Codex',
        shortName: 'Codex',
        installed: false,
        executable: false,
        skillLinked: false,
        statusLabel: '未安装',
        hint: '',
      },
      {
        id: 'workbuddy',
        name: 'WorkBuddy',
        shortName: 'WorkBuddy',
        installed: true,
        executable: false,
        skillLinked: true,
        statusLabel: '仅桌面端',
        hint: '',
      },
      {
        id: 'dsh',
        name: 'DeepSeek Harness (DSH)',
        shortName: 'DSH',
        installed: true,
        executable: true,
        skillLinked: true,
        statusLabel: '桌面端 + CLI 已就绪',
        hint: '',
      },
    ];

    expect(resolvePreferredAgentId('codex', detected)).toBe('dsh');
    expect(resolvePreferredAgentId('workbuddy', detected)).toBe('workbuddy');
    expect(
      resolvePreferredAgentId(
        'codex',
        detected.filter((a) => a.id !== 'dsh'),
      ),
    ).toBe('workbuddy');
  });

  test('builds default clarification answers and preserves custom overrides', () => {
    const questions: ClarificationQuestion[] = [
      {
        id: 'q1',
        question: '本次优先产出哪类文档？',
        reason: '决定结构深度',
        suggestedOptions: ['内部商业模式落地方案', '对外合作提案'],
        defaultOption: '内部商业模式落地方案',
        allowCustom: true,
      },
      {
        id: 'q2',
        question: '是否包含价格分成测算？',
        reason: '会议里提到 29,800 与 5,000 分层',
        suggestedOptions: ['包含三档测算模型', '暂不做金额测算'],
        defaultOption: '',
        allowCustom: true,
      },
    ];

    const defaults = buildDefaultClarificationAnswers(questions);
    expect(defaults).toEqual({
      q1: '内部商业模式落地方案',
      q2: '包含三档测算模型',
    });

    const list = toClarificationAnswerList(questions, {
      q1: '两份都要，优先内部版',
      q2: '   ',
    });
    expect(list).toEqual([
      {
        questionId: 'q1',
        question: '本次优先产出哪类文档？',
        answer: '两份都要，优先内部版',
      },
      {
        questionId: 'q2',
        question: '是否包含价格分成测算？',
        answer: '包含三档测算模型',
      },
    ]);
  });

  test('formats Feishu delivery mode labels clearly', () => {
    expect(feishuDeliveryModeLabel('doc_and_group', '产品协作群')).toBe('云文档 + 群「产品协作群」');
    expect(feishuDeliveryModeLabel('doc_and_group', '')).toBe('云文档 + 指定飞书群');
    expect(feishuDeliveryModeLabel('doc_and_self')).toBe('云文档 + 飞书私聊本人');
    expect(feishuDeliveryModeLabel('doc_only')).toBe('仅创建飞书云文档');
    expect(feishuDeliveryModeLabel('none')).toBe('仅本地完成');
  });

  test('parses, toggles, and splits multi-agent auto handoff plan cleanly', () => {
    expect(parseAutoHandoffPlan(null)).toEqual(DEFAULT_AUTO_HANDOFF_PLAN);
    expect(parseAutoHandoffPlan('not-json')).toEqual(DEFAULT_AUTO_HANDOFF_PLAN);

    const parsed = parseAutoHandoffPlan(
      JSON.stringify({
        enabledAgents: [' Codex ', 'agy', 'codex', ''],
        sendToFeishu: true,
        feishuDeliveryMode: 'doc_and_group',
        feishuChatId: 'oc_123',
        feishuChatName: '产品协作群',
      }),
    );
    expect(parsed.enabledAgents).toEqual(['codex', 'agy']);
    expect(parsed.sendToFeishu).toBe(true);
    expect(parsed.feishuDeliveryMode).toBe('doc_and_group');
    expect(isAutoHandoffArmed(parsed)).toBe(true);

    const added = toggleAgentInPlan(parsed, 'Claude');
    expect(added.enabledAgents).toEqual(['codex', 'agy', 'claude']);

    const split = splitLeadAndCollaborators(added.enabledAgents);
    expect(split).toEqual({
      leadAgentId: 'codex',
      collaboratorAgentIds: ['agy', 'claude'],
    });

    const removed = toggleAgentInPlan(parsed, 'codex');
    expect(removed.enabledAgents).toEqual(['agy']);

    const empty = { ...DEFAULT_AUTO_HANDOFF_PLAN };
    expect(isAutoHandoffArmed(empty)).toBe(false);
    expect(splitLeadAndCollaborators([])).toEqual({
      leadAgentId: null,
      collaboratorAgentIds: [],
    });
  });

  test('exposes beginner Feishu CLI install and login commands', () => {
    expect(FEISHU_INSTALL_COMMAND).toBe('npm install -g @larksuite/cli');
    expect(FEISHU_LOGIN_COMMAND).toBe('lark-cli auth login');
  });
});
