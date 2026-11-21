---
name: aigoodmeeting-agent-handoff
description: 将 AiGoodMeeting 本地会议转写与纪要一键交接给本地 Agent（Codex、Antigravity、DSH、Claude Code、WorkBuddy/CodeBuddy、Kimi、Gemini、Hermes、OpenCode 等）执行，支持多 Agent 协同、两阶段智能预检（有关键缺口先提 1-4 个问题，信息完善直接执行）以及自动生成飞书云文档并推送至飞书群或本人私聊。
---

# AiGoodMeeting × Agent 联动执行协议

把一次本地会议记录直接变成**可执行成果并交付飞书**，而不是停在静态摘要。

## 核心规则

1. **以完整原始转写（及说话人校对稿）为唯一事实源**
   - 本地小模型生成的纪要可能出现日期误差、专有名词听错或遗漏数字与行动项。
   - **不要只读纪要就开始执行**；必须阅读完整转写，并结合用户当前工作区上下文还原同音专有名词。不确定的人物、金额与时间点须保留原话或标注待确认，绝不编造。
2. **两阶段闸门：先看清，再决定问还是直接干**
   - **信息已完善 → 直接立即执行**，不为走流程额外提问。
   - **存在关键缺口或高影响歧义 → 先提出 1～4 个高价值问题**（每题附 2～4 个推荐选项并允许自定义补充），确认后立刻执行。
3. **多 Agent 协同与脱敏交付**
   - 当勾选 2 个及以上 Agent 时，首个 Agent 作为主控，其余 Agent 并行从不同视角分析并回传要点，由主 Agent 整合为一份结构清晰的最终交付物 `deliverable.md`。
   - 外发至多人飞书群或对外文档前，自动去除口语粗话、私下人身评价与未授权敏感口径。
   - 按用户配置通过 `lark-cli` 创建飞书在线云文档（`docs +create --doc-format markdown`），并在开启群发/私聊时调用 `lark-cli im +messages-send` 发送高密度摘要与可点击文档链接（使用 `--idempotency-key` 防重；若用户态缺少 `im:message.send_as_user` 权限则自动回退 `--as bot`）。

## 命令行快速导出本地会议

使用内置只读脚本读取本地 AiGoodMeeting SQLite 数据库（不会锁库）：

```bash
# 列出最近 15 场会议
python3 scripts/export_meeting.py list

# 按关键词或 meeting_id 导出完整会议上下文（含说话人分人稿与完整转写）
python3 scripts/export_meeting.py export --query "产品规划" --output /tmp/meeting-context.md
```

## 飞书 CLI 纯小白两步接入

```bash
# 第一步：安装官方飞书命令行工具（需先安装 Node.js）
npm install -g @larksuite/cli

# 第二步：打开浏览器用手机飞书扫码登录授权
lark-cli auth login
```

登录完成后，可在 AiGoodMeeting 一级面板或「设置 → 飞书同步 / Agent 联动」中点击「刷新状态」自动加载飞书群列表。
