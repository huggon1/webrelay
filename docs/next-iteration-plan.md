# WebRelay 下一阶段执行计划

## 当前状态

已完成第一轮基础重构：

- 保存配置支持 `actionPreset`，旧 profile 会默认迁移为 copy。
- URL pattern 已能对常见文章 slug 做同目录泛化。
- popup 主界面开始以最终 `Output` 为核心，结构化抽取结果进入 debug 区。
- 已引入 extension sandbox，用于未来在前端隔离执行 transform。
- Daily Run 的目标已明确：运行已保存配置时不应依赖 backend；backend 只负责 Codex 生成、反馈和修复。

当前测试中仍暴露一个关键问题：

- 用户要求 Markdown 时，`Export Format` 可以生成 Markdown，但保存后 `Run Configuration` 仍可能输出 JSON。说明“生成 transform、保存 transform、本地运行 transform、展示 output”这条链路还没有稳定闭环。

## P0: 稳定 Daily Run 输出闭环

目标：

- 用户保存了 Markdown/CSV/自定义文本输出配置后，后续运行配置必须直接得到同样格式的最终 Output。
- 已保存配置的运行、复制和下载不需要启动 backend。
- recipe 抽取结果只作为 debug 信息，不作为普通用户主结果。

工作：

- 确认 `Capture Preview` 自动生成的 transform 一定写入保存的 configuration。
- 保存时如果用户 intent 包含输出格式要求但 transform 为空，必须阻止保存并提示，不能 silently fallback 到 JSON。
- 将 popup 的 `RUN_PROFILE` 路径改为：content script 执行 recipe，popup sandbox 执行 transform，popup 执行 copy，background 只负责 download 和 storage state。
- background 中保留 `/run-transform` 仅作为兼容或开发辅助，不参与 Daily Run 主路径。
- Output 区只展示最终字符串；debug 折叠区展示 structured extraction 和 execution debug。
- transform 执行失败时展示明确错误和 fallback JSON warning，但不能让用户误以为 JSON 是目标输出。

验收：

- 关闭 backend 后，运行已保存 Markdown 配置仍输出 Markdown。
- `Copy Output` 复制 Markdown，不复制 JSON。
- `Download` 下载 Markdown 文件，文件扩展名符合 format label。
- Debug 展开后才能看到结构化 JSON。
- 没有 transform 的旧配置可以 fallback JSON，并明确显示这是兼容 fallback。

## P1: Codex Studio 单一对话式创建体验

目标：

- 用户不需要理解 generate、export、refine、repair 是四个割裂按钮。
- 用户通过一个输入框多轮描述“要抽什么、怎么输出、哪里不对”，系统维护当前 artifact 并反复预览。

工作：

- 将当前 `Intent` 和 `Refine or export` 合并为一个 Codex Studio 对话输入。
- 后端请求统一围绕 artifact：recipe、transform、outputDescription、configuration metadata。
- 首轮请求可从页面生成完整 artifact；后续反馈可修改 recipe、transform 或两者。
- UI 中保留明确状态：draft artifact、preview result、output preview、save target。
- Repair 入口带着旧 configuration、失败 debug、当前 DOM snapshot 进入同一个对话框。

验收：

- 用户输入“提取标题正文，用 Markdown 输出”后，一次生成完整配置草稿。
- 用户继续输入“正文去掉推荐阅读”后，同一工作区 refine 并重新预览。
- 用户不需要先知道应该点 Export Format 还是 Refine。
- 修复失效配置时不需要重述原始需求。

## P2: 站点与配置管理

目标：

- 从单层 `profiles` 演进到用户可理解的 Site / Configuration 管理。
- 当前 URL 下多套配置可选择、重命名、复制、删除、设为默认。

工作：

- 继续兼容 `profiles` storage key，先通过迁移层读写 configuration。
- 引入 site 分组视图：默认 site name 来自 origin，URL pattern 仍由 shared helper 控制。
- 配置列表显示 name、intent、formatLabel、default action、updatedAt、version。
- 支持配置重命名、复制、删除、设为默认或设为 last used。
- 删除配置时清理无效 last used state。

验收：

- 同一站点下可以保存多套配置并切换运行。
- 删除或复制配置不破坏旧配置。
- 当前站点默认配置和上次成功配置行为清晰。

## P3: 快捷键与无弹窗执行

目标：

- 用户无需打开 popup，也能运行当前站点上次成功配置并执行默认 action。

工作：

- `manifest.json` 增加 Chrome command。
- background 根据 active tab URL、last used state 和 matching configurations 选择配置。
- 无弹窗路径需要可运行 transform；如果 background service worker 不能直接使用 sandbox iframe，则使用 Chrome offscreen document 承载 transform runtime。
- 快捷键失败时用 notification 或 badge 提示用户打开 popup。

验收：

- 快捷键可在 backend 关闭时运行已保存配置。
- 成功后执行 copy/download/copy_download。
- 无法确定配置时不保存抽取结果，并提示用户打开 popup。

## 技术原则

- Codex SDK 只存在于 backend；不要引入 OpenAI API client 或 API key 配置。
- Recipe 只负责抽取结构化数据；Transform 负责输出格式。
- Transform 可以由 Codex 生成，但必须通过受限 schema、静态校验和隔离 runtime 执行。
- Daily Run 不依赖 backend；Codex Studio 才依赖 backend。
- 抽取结果和最终 output 只存在于当前会话，不持久化写入 storage。

## 下一步建议

下一次实现应优先完成 P0。P0 完成前不要继续扩展快捷键或配置管理，否则会把尚未稳定的输出链路复制到更多入口。
