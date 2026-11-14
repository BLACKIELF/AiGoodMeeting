# AiGoodMeeting

本地录音、语音转文字、区分说话人、生成中文会议纪要。基于 [Meetily Community v0.4.1](https://github.com/Zackriya-Solutions/meetily) 定制，提供 AiGoodBro 七套皮肤。

当前版本为 **2.0.0 · Apple Silicon Mac**。应用、源码与校验文件见 [2.0.0 发行版](https://github.com/BLACKIELF/AiGoodMeeting/releases/tag/v2.0.0)。

## 使用

1. 在工作台开始录音、查看实时文字，或导入已有音频。
2. 打开最近会议查看转写。需要区分发言时点“自动分人”，可校对姓名和发言归属。
3. 保存录音或完成导入后，应用根据转写生成会议主题和纪要。打开“会议纪要”可编辑、复制、导出 TXT 或 Word，也可在配置飞书 CLI 后上传飞书。

新版工作台采用液态玻璃卡片，纪要用标题和列表呈现。应用遵循系统的减少透明度和减少动态效果设置。

## 安装

下载对应发行版中的 `AiGoodMeeting-2.0.0-arm64.zip` 、`AiGoodMeeting-source-2.0.0.tar.gz` 和 `SHA256SUMS-2.0.0.txt`，先比对哈希再解压。应用采用本地签名，**未经 Apple 公证**；按 macOS 正常打开流程处理，不需要关闭系统安全保护。

应用包不包含模型与分人 Python 环境。第一次安装还需以下本地组件，可复用已有文件：

| 组件 | 本次使用 | 逻辑文件大小 |
|---|---|---:|
| 转写 | Whisper Large V3 Turbo（GGML） | 1.62 GB |
| 中文纪要 | Ollama + Qwen3 8B | 模型 5.23 GB |
| 分人 | MLX Sortformer v2.1（最多四人） | 0.47 GB |
| 分人运行环境 | Python 3.12 + 固定依赖 | 约 0.45 GB |
| 桌面应用与 Ollama | arm64 | 约 0.86 GB |

核心文件合计约 **8.6 GB**，不含录音、安装归档、共享系统工具和开发缓存；文件大小不等于运行内存。建议至少预留 15 GB 用于安装，源码编译还需要额外空间。

构建说明和模型配置见 [LOCAL_BUILD.md](LOCAL_BUILD.md) 与 [分人运行时](local-diarization/README.md)。模型目录和解释器路径按目标电脑填写。

## 录音设备

录制麦克风和系统声音需在系统设置中允许对应权限。蓝牙耳机启用麦克风后可能切到通话模式、降低回放音质；可使用电脑麦克风录音、耳机播放，或结束录音后回放。

## 外观

默认、液态键帽、青花瓷、敦煌飞天、故宫红墙、蒙特雷曙霞、千里江山。每套支持浅色、深色和跟随系统。

原始皮肤包保存在 `frontend/public/aigoodbro-skins`，原始 Swift 视觉源码与逐文件校验在 [vendor/aigoodbro-skins](vendor/aigoodbro-skins)。网页层复用了原配色、玻璃参数和预览曲线；不声称 WebKit 内容背景等同于 AppKit 窗口外的透视材质。

## 本地处理与数据

选择本地 Whisper、Sortformer 和 Ollama 时，语音处理与总结可在本机完成。首次安装需下载组件；选择云端模型会按所选服务传输内容。可选使用统计可在设置关闭。

定制版应用标识 `com.meetily.local-speakers`，与官方版 `com.meetily.ai` 分开。会议和分人结果保存在当前用户应用数据目录；录音仍按数据库记录的位置读取。请保留模型、运行环境和原始录音。上游自动更新已停用，定制版从本仓库安装更新。

## 验证与边界

2.0.0 通过 161 项前端测试、TypeScript 类型检查、Apple Silicon 构建和签名校验。真实录音全流程与飞书上传仍待复验。Windows 与 Intel Mac 尚未验证。

“四人”是模型容量，并非所有场景的准确率保证。自然多人会议、远场噪声、多人重叠及多小时会议尚未全面验证。分人结果可人工校对；本地 Qwen3 8B 曾在测试中补出不存在的日期，因此姓名、日期、金额和待办应核对原文。

## 开发与许可

从源码构建见 [LOCAL_BUILD.md](LOCAL_BUILD.md)，分人运行时见 [local-diarization/README.md](local-diarization/README.md)。完整源码归档附带本次构建的辅助程序；Git 源码不包含模型、私人数据和构建缓存。

应用沿用 [MIT 许可](LICENSE.md)，保留 Meetily 和皮肤来源署名。模型各自适用其许可：Sortformer 使用 NVIDIA Open Model License，不应与应用的 MIT 许可混淆。[上游原始说明](README.upstream.md) 作为来源保留，不能视为本定制版各平台已验证的承诺。
