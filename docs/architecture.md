# WebRelay 架构设计

## 系统概览

WebRelay 是一个 TypeScript npm workspace，包含三个边界清晰的 package：

- `shared`：共享 schema、配置类型、URL 匹配、DOM snapshot、recipe runtime。
- `backend`：本地 Express 后端，使用 Codex SDK 生成、反馈、格式化和修复 extraction artifact。
- `extension`：Chrome MV3 扩展，负责页面 snapshot、本地 recipe 执行、配置存储和用户界面。

架构上的核心分离是：智能配置工作与日常执行工作分离。Codex SDK 参与 Codex Studio；Daily Run 使用已保存配置本地运行。

## Shared Package

职责：

- 定义 extraction recipe、transform、execution result、debug data、saved configuration 的 Zod schema。
- 提供 `createDomSnapshot`，生成适合抽取分析的 DOM snapshot。
- 提供 `executeRecipe`，供 content script 在当前页面本地执行 recipe。
- 提供 URL pattern 创建与匹配 helper。
- 保持 JSON 合同明确且窄。

约束：

- `shared` 不依赖 Chrome API。
- recipe 校验属于 `shared`。
- 不把任意生成代码加入 recipe 合同。

## Backend Package

职责：

- 提供本地 HTTP endpoint 支持 Codex Studio。
- 构建 generate、transform、refine、repair prompt。
- 启动短生命周期 Codex SDK thread。
- 使用 shared Zod schema 校验 Codex final response。
- 在当前实现中校验并运行受限 transform。

Codex 集成规则：

- 使用 `@openai/codex-sdk`，不使用 OpenAI API client。
- 不引入 `OPENAI_API_KEY`。
- 不添加 chat/completions/responses API 路径。
- 使用 `new Codex()`、`codex.startThread(...)`、`thread.run(...)`。
- thread 配置为只读、approval never、禁用网络、禁用 web search。
- Codex final response 必须是结构化 JSON artifact。

当前 endpoint 职责：

- `/generate-recipe`：根据 URL、intent、DOM snapshot 生成 recipe。
- `/repair-recipe`：根据旧 recipe、debug、失败原因和当前 snapshot 修复 recipe。
- `/transform`：生成并运行受限输出 transform。
- `/run-transform`：对已有 transform 和抽取数据运行格式化。
- `/refine`：根据用户反馈 refine recipe 和/或 transform。

后续方向：

- endpoint 语义逐步围绕 Codex Studio artifact 对齐，而不是让用户感知 recipe 和 transform 是割裂概念。
- repair/refine 请求中加入完整 existing configuration context。
- Daily Run 的复制、下载和快捷键行为应主要留在 extension 侧。

## Extension Package

职责：

- 管理 Chrome MV3 popup 和 background service worker。
- 通过 content script 捕获当前页面 DOM snapshot。
- 在当前页面本地执行已保存 recipe。
- 在 Chrome storage 中保存 site、configuration、action preset、last used state。
- 执行复制、下载等本地结果动作。
- 将 Codex Studio 请求转发给本地 backend。

当前组成：

- `content.ts`：处理 DOM snapshot 和 recipe 执行。
- `background.ts`：处理中台消息、active tab、storage、content script 通信、backend 请求。
- `popup.ts`：当前将生成、反馈、profile 执行、导出、复制、保存和 debug 混在一个界面。

目标拆分：

- Daily Run 成为 popup 默认路径，用于执行已保存配置。
- Codex Studio 承载 generate、refine、repair、preview、save。
- 快捷键逻辑放在 background command handling 中，并复用 Daily Run 的本地运行管线。

## 数据流

### Codex Studio Generate

1. popup 请求 active tab 和 DOM snapshot。
2. background 将 generate 请求发给 backend。
3. backend 启动只读 Codex SDK thread。
4. Codex 返回结构化 recipe 或 artifact。
5. backend 校验响应。
6. extension 本地运行 recipe 生成预览。
7. 用户确认后保存配置。

### Daily Run

1. popup 获取 active tab URL。
2. background 从 Chrome storage 加载匹配配置。
3. 用户选择配置并运行。
4. content script 在当前 document 上执行 recipe。
5. extension 应用保存的 transform 和 action preset。
6. 更新当前站点 last successful configuration。

### Repair

1. Daily Run 检测失败，或用户选择 Repair。
2. Codex Studio 带 existing configuration 和 debug context 打开。
3. backend 请求 Codex 修复 artifact。
4. extension 预览修复结果。
5. 用户确认覆盖旧配置或另存为新配置。

## 安全与隐私

- Codex thread 必须只读、禁用网络、禁用 web search。
- recipe 必须是结构化 JSON，不包含任意网页脚本。
- transform 必须受限、校验并隔离运行。
- 抽取结果内容不持久化。
- 后端依赖本地 Codex CLI 登录，不要求 API key。
- Daily Run 应尽量在后端未运行时仍可使用已保存配置。

## 测试影响

- `shared` 测试覆盖 schema 封闭性、recipe runtime、URL 匹配、未来 action preset 校验。
- `backend` 测试 mock Codex SDK，覆盖响应校验、危险 transform 拒绝、repair context。
- `extension` 手动或自动测试覆盖 Daily Run、Codex Studio、storage migration、copy/download、shortcut resolution。
