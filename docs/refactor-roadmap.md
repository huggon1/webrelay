# WebRelay 重构路线图

## Phase 1: 文档与术语统一

目标：

- 在改代码前建立统一产品语言。

工作：

- 新增 PRD、核心流程、信息架构、数据模型、架构设计和重构路线图。
- 统一术语：site、configuration、recipe、transform、action preset、Codex Studio、Daily Run。
- 将当前 `ExtractionProfile` 视为未来 configuration 概念的现有实现。

验收：

- 文档能回答用户为什么使用这个插件、Codex 何时参与、一套配置包含什么、如何运行和如何修复。

## Phase 2: 数据模型扩展

目标：

- 为站点分组、多套配置、默认动作和快捷键解析准备 shared schema 与 storage 结构。

工作：

- 新增 action preset schema/type。
- 扩展保存配置，加入默认 action preset。
- 增加 last used state，支持当前站点快捷键执行。
- 决定演进 `ExtractionProfile`，或新增 `ExtractionConfiguration` 并迁移旧数据。
- 为旧 profile 增加默认 copy action 迁移逻辑。

验收：

- 旧 profile 仍可运行。
- 新配置能保存 copy、download、copy_download 默认动作。
- 扩展能解析每个站点上次成功配置，且不保存结果内容。

## Phase 3: UI 拆分

目标：

- 将当前单页实验 popup 拆成 Daily Run 和 Codex Studio。

工作：

- 当前 URL 有匹配配置时，默认显示 Daily Run。
- 将生成、反馈、修复、预览确认、保存放入 Codex Studio。
- 两个界面的 debug 都默认折叠。
- 增加 Daily Run 与 Codex Studio 的入口切换。
- 后端不可用错误只影响 Codex Studio，不阻塞已保存配置的 Daily Run。

验收：

- 用户可以不看到 Codex 控件而运行已保存配置。
- 新建或失效配置能带上下文进入 Codex Studio。
- popup 中日常执行和智能配置的职责清晰分离。

## Phase 4: 修复上下文增强

目标：

- 让失效配置修复更可靠，不要求用户重新描述完整需求。

工作：

- repair/refine 请求带上 configuration metadata、旧 recipe、transform、action preset、原始 intent、当前 DOM snapshot、execution debug、failure reason。
- prompt 明确要求除非用户反馈改变输出，否则保留原输出行为。
- 修复结果必须预览后才能保存。
- 只有用户保存时才递增 version。

验收：

- repair 请求不需要用户重述原始目标。
- 修复配置可以覆盖旧配置或另存。
- 修复失败不会破坏旧配置。

## Phase 5: 默认动作与快捷键执行

目标：

- 用户无需打开 popup 也可以完成常用抽取动作。

工作：

- 实现 copy、download、copy_download action。
- 每套配置保存默认 action preset。
- Daily Run 成功后更新 last successful configuration。
- manifest 增加 Chrome command。
- background command handler 根据当前 URL 和 last used state 选择配置。
- 快捷键失败时提示用户打开 popup，不保存抽取内容。

验收：

- Daily Run 可以执行配置并自动复制或下载结果。
- 快捷键运行当前站点上次成功配置。
- 无法解析目标配置时，用户得到明确提示。

## Phase 6: 质量与管理增强

目标：

- 在核心重构完成后改善长期可用性。

工作：

- 增加配置重命名、复制、删除、设为默认。
- 增加预览质量 warnings，例如 root match 过低、empty count 过高、required field 缺失。
- 增加下载文件名模板。
- 增加加载 `extension/dist` 的手动测试清单。

验收：

- 用户可以管理每个站点下的多套配置。
- 保存前能看到明显质量问题。
- 配置生命周期操作不破坏已有用户数据。
