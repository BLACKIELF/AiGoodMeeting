# AiGoodMeeting 3.0.0 构建说明

基于官方 Community v0.4.1，提交 `a2cb62e827da7ef59f65064c97233efb2313878e`，保留上游 MIT 许可。当前验证平台：Apple M4 Pro、48 GiB、macOS 27.0。3.0.0 在 2.0.0 基础上新增完整「多 Agent 协同与小白一键飞书联动」体系：支持 9 个本地 Agent 自动检测与并行协同执行（Codex / Antigravity / DSH / Claude Code / WorkBuddy / Kimi / Gemini / Hermes / OpenCode）、一级面板全阶段预设（录音前 / 录音中 / 转写中）、面向纯小白的一键打开终端安装与浏览器扫码引导、两阶段预检追问/直通执行，以及执行后自动创建飞书云文档并推送至指定飞书群或本人私聊（内置 `--as bot` 权限兜底）。

## 功能与数据

录音结束或导入音频后，会议页点击“自动分人”。支持改姓名、合并、逐段纠正和取消；姓名变化会提示重新生成纪要。纪要输入包含当前校对后的姓名和发言。分人结果保存在应用数据目录 `diarization/<meeting-id>.json`，原始转写不被覆盖。Agent 联动的每次预检、问答与交付产物独立保存在应用数据目录 `agent-runs/<meeting-id>/<run-id>/`，与共享 Skill `aigoodmeeting-agent-handoff` 配套工作。

本机构建标识为 `com.meetily.local-speakers`，与原版 `com.meetily.ai` 分开。复制旧数据时使用 SQLite 在线备份，不直接复制正在写入的数据库。录音按会议原有目录读取；不要删除仍被数据库引用的音频。

## 本机数据与运行环境

- 本机数据：`~/Library/Application Support/com.meetily.local-speakers`
- 外部运行时由该目录的 `diarization-runtime.json` 指定，必须使用另一台电脑自己的绝对路径，不能直接照搬本机路径。
- 当前运行时说明、固定依赖、模型来源及验收在 `local-diarization/README.md`、`requirements.lock` 和 `runtime-manifest-1028v1.json`。

配置字段示意：`python`（Python 3.12 隔离环境）、`script`（transcribe.py）、`model`（本地 Sortformer 模型目录）、`whisper_model`（GGML 文件）、`whisper_cli`、`ffmpeg`、`language`（zh 或 auto）。所有路径必须为已存在的绝对路径。运行时只读本地模型，不在处理会议时下载模型或调用云服务。

## 皮肤源码

七套皮肤直接复用 AiGoodBro 原始包：默认、液态键帽、青花瓷、敦煌飞天、故宫红墙、蒙特雷曙霞、千里江山。原始包在 `frontend/public/aigoodbro-skins/`，只读原 Swift 视觉源码快照与逐文件哈希在 `vendor/aigoodbro-skins/`。颜色令牌直接复用；共享背景、玻璃表面、边缘及预览曲线按原源码适配为网页组件。青花瓷自带 12 个 SVG，其余六套原包为颜色令牌加共享材质，没有虚构额外纹理。

当前技术为 Tauri / WebKit，内容区的材质可复用，原生 AppKit 窗口外的透视模糊不等同于网页背景。保留亮色、暗色、跟随系统和本地记忆；不引入 AiGoodBro 账号或额度模块。源包的 MIT 许可随包保留。

## 从源码构建

先检查已有依赖并复用。本次使用 Node、pnpm 9.15.9、Rust 1.99.1、CMake 4.4.4、Ninja 1.13.2 和 Xcode 工具链。锁文件仍使用上游格式，不用 pnpm 11 自动改写。

在 `frontend` 目录执行：

```sh
npx --yes --package=pnpm@9.15.9 pnpm install --frozen-lockfile
CMAKE_POLICY_VERSION_MINIMUM=3.5 node_modules/.bin/tauri build --config src-tauri/tauri.local.conf.json --bundles app
```

本次复用官方 v0.4.1 arm64 应用的 `ffmpeg` 与 `llama-helper`，放入 `frontend/src-tauri/binaries/`，文件名分别为 `ffmpeg-aarch64-apple-darwin` 和 `llama-helper-aarch64-apple-darwin`。这两个受忽略的构建辅助文件在完整源码归档中单独包含，Git 仓库不含二进制。

构建输出为项目根 `target/release/bundle/macos/AiGoodMeeting.app`。安装时先比较已有版本、保留原版，再复制新构建；用 `codesign --verify --deep --strict` 校验。配置关闭了本定制版的官方更新地址，避免被官方版本覆盖。

## 运行时重建

仅适用于 Apple Silicon。复用已有 uv；创建 Python 3.12 独立环境后，以该环境为目标执行 `uv pip install --python <环境/bin/python> --no-deps -r local-diarization/requirements.lock`。固定列表包含本次需要的传递依赖，MLX Audio 锁定官方 Git 提交。不要安装到系统 Python。

从模型官方仓库 `mlx-community/diar_streaming_sortformer_4spk-v2.1-fp32` 的提交 `8541fc3db304f350b544bbcab1cfae4f3eeb2356` 取得模型及配置。权重 SHA-256：`dd18528b0e74a130501cde9beb655f9fc011e8718682728e2e88a981184cf282`。保留 NVIDIA Open Model License；模型许可不等于应用的 MIT 许可。

## 验证及边界

分人部分的前端、Rust 后端与运行时检查均已通过；皮肤已完成七套切换、明暗及系统外观、持久化和原生标题栏检查。3.0.0 通过 166 项前端测试、TypeScript 类型检查、18 项 Rust 后端测试（含多 Agent 命令规划、终端一键安装脚本构造、飞书群列表与消息回退解析）与 Apple Silicon 构建。独立运行时在系统禁止联网后仍能处理三声音合成样本。两声音、三声音和 131 秒跨分块样本通过匿名分组验收；四人是模型容量，尚未验证四人自然会议或多小时准确率。重叠、相近音色、噪声和词语时间点不可靠时需人工校对。

本地 Qwen3 8B 能使用已命名发言生成负责人，但仍可能捏造日期或推断主持人；验收保留错误原始结果。日期、姓名、金额及待办要与录音核对。

运行不需要 `target/` 或 `frontend/node_modules/`。如后续清理构建缓存，开发时按锁文件恢复依赖；已安装应用和 Python 运行环境必须保留。
