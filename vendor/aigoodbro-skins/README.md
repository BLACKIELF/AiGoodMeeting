# AiGoodBro 原皮肤来源快照

快照版本：1028v1。来源记录与逐文件哈希见 [SOURCE.json](SOURCE.json) 和 [SOURCE.sha256](SOURCE.sha256)。

从用户指定的 AiGoodBro 工作区复制，Git revision 为 `622e76ea8c8edf5847bb01711b68c3b5867ea04a`。源工作区另有未提交修改，但本次复制的 7 套原包、5 个 Swift 视觉源与根许可证路径均与该 revision 一致；已逐文件 SHA-256 回读核对。

## 原包对应

| 原包 | 本项目公开目录 | 文件 | 原始 SVG |
| --- | --- | ---: | ---: |
| `codexu.default` | `frontend/public/aigoodbro-skins/default/` | 8 | 0 |
| `codexu.liquid-keycap` | `frontend/public/aigoodbro-skins/liquid-keycap/` | 8 | 0 |
| `codexu.blue-white-porcelain` | `frontend/public/aigoodbro-skins/blue-white-porcelain/` | 20 | 12 |
| `codexu.dunhuang-apsara` | `frontend/public/aigoodbro-skins/dunhuang-apsara/` | 8 | 0 |
| `codexu.forbidden-city-red` | `frontend/public/aigoodbro-skins/forbidden-city-red/` | 8 | 0 |
| `codexu.orchid-dawn` | `frontend/public/aigoodbro-skins/orchid-dawn/` | 8 | 0 |
| `codexu.thousand-li-landscape` | `frontend/public/aigoodbro-skins/thousand-li-landscape/` | 8 | 0 |

公开目录完整保留原包的 `manifest.json`、浅深色 `tokens`、本地化、README、`assets/manifest.json` 与 `LICENSE`，共 68 个文件。

6 套皮肤的资产列表为空，不能称为各自已有纹理。青花瓷的 12 个 SVG 是原始资产：浅、深色各有 `quota-primary-ring.svg`、`quota-secondary-ring.svg`、`quota-primary-cap.svg`、`quota-secondary-cap.svg`、`progress-linear.svg`、`chart-bar.svg`。

原 `assets/manifest.json` 将 `progress.linear` 指定为 `tileX`，由宿主负责圆角裁切；横向重复时保持原图 240 × 32 的比例。接入约定：仅在青花瓷使用对应浅/深色原图，其余皮肤的纹理变量为 `none`。共享 `ui/progress.tsx` 目前无消费，本归档没有为它新增用途；实际进度条的 CSS 接入由主题适配负责。配额环与图表素材按原包保存，不为会议应用新增无关控件。

## 视觉源码快照

仅复制以下 5 个源文件，保持原始目录与内容，不编译进应用，也不引入账户功能：

- `Sources/CodexUsageWidget/DesignSystem/WorkspaceGlass.swift`
- `Sources/CodexUsageWidget/Domain/WorkspaceGlassPreferences.swift`
- `Sources/CodexUsageWidget/UI/PaletteSettingsView.swift`
- `Sources/CodexUsageWidget/UI/PaletteVisuals.swift`
- `Sources/CodexUsageWidget/DesignSystem/FixedVisualPalette.swift`

## 许可与适配边界

Swift 快照遵循复制的根 [LICENSE](LICENSE)：MIT，版权为 2026 Guomeiqing。每套皮肤保留各自 MIT `LICENSE` 与作者/来源字段，不以本项目品牌替换原版权。

这些文件证明原包和参考源码的来源。Web 主题仍需将 SwiftUI 材质、阴影、背景层与 token 映射到浏览器；保存 Swift 源码并不代表 SwiftUI 已在 Web 中执行，色值保真也不等于不同渲染器逐像素相同。实际 Web 适配与进度消费由主题代码及其验证记录负责。

回退时可移除主题对 `/aigoodbro-skins/` 的引用，再删除本次新增目录；不需要修改原始 AiGoodBro 工作区。
