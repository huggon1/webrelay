# WebRelay 核心流程

## 流程原则

- Codex 只参与配置创建、反馈完善、输出格式生成和失效修复。
- 已保存配置的日常执行应尽量本地完成，不依赖后端。
- 所有 Codex 生成或修复的配置都必须先预览，再由用户确认保存。
- 抽取结果内容只存在于当前会话，不持久化保存。

## 无明确需求的 Generate 流程

触发条件：

- 用户在当前网页打开 Codex Studio，直接点击 Generate。

输入：

- 当前 tab URL。
- 当前页面 DOM snapshot。
- 可选的页面标题和站点上下文。

系统动作：

- 扩展向 content script 请求 DOM snapshot。
- 后端启动短生命周期、只读、禁用网络和搜索的 Codex SDK thread。
- Codex 分析页面并返回结构化 extraction artifact。
- 扩展在当前页面本地运行 recipe。
- 界面展示结构化预览、输出说明和 debug 信息。

用户决策点：

- 保存为新配置。
- 输入反馈继续 refine。
- 放弃本次结果。

完成状态：

- 当前站点下新增一套配置，包含 recipe、可选 transform、intent 和 action preset。

失败状态：

- 无法创建 snapshot。
- 本地后端不可用。
- Codex 返回无效 JSON。
- recipe 校验失败。
- 预览失败或结果质量明显不足。

## 带需求 Generate 流程

触发条件：

- 用户先输入想抽取的信息或输出格式，再点击生成。

输入：

- 当前 tab URL。
- 当前页面 DOM snapshot。
- 用户 extraction intent。
- 可选 output request。

系统动作：

- Codex 根据用户 intent 和 DOM snapshot 生成 recipe。
- 如果请求包含输出格式，Codex 同时生成受限 transform。
- 扩展本地执行 recipe，生成预览数据。
- 若有 transform，则对预览数据运行 transform 并展示输出预览。

用户决策点：

- 保存配置。
- 修改抽取字段或输出格式并继续 refine。
- 选择或调整默认 action preset。

完成状态：

- 配置以用户 intent 作为主要语义说明保存。

失败状态：

- 与无明确需求 Generate 相同。
- 如果需求过于模糊，预览可能进入继续 refine 状态。

## 失效配置修复流程

触发条件：

- Daily Run 执行已保存配置失败。
- 用户手动选择 Repair。

输入：

- 当前 tab URL。
- 当前页面 DOM snapshot。
- 已保存配置。
- 旧 recipe。
- 旧 transform 和 action preset。
- 原始 intent。
- 执行 debug。
- 失败原因。

系统动作：

- Codex Studio 以失效配置作为上下文打开。
- 后端请求 Codex 修复 artifact。
- Codex 应默认保留原 intent 和输出行为，除非用户反馈要求改变。
- 扩展运行修复后的 recipe 并展示预览。

用户决策点：

- 覆盖旧配置并递增 version。
- 另存为新配置。
- 继续 refine。
- 放弃修复结果。

完成状态：

- 只有用户确认保存后，旧配置才被替换或产生新配置。

失败状态：

- 修复后仍无法抽取。
- 当前页面已经没有目标信息。
- 旧 intent 太模糊，必须让用户补充需求。

## Daily Run 流程

触发条件：

- 用户在当前网页打开插件，并且当前 URL 有匹配配置。

输入：

- 当前 tab URL。
- Chrome storage 中匹配当前 URL 的配置列表。
- 用户选择的配置。

系统动作：

- 扩展加载匹配配置，不请求后端。
- 用户选择并运行配置。
- content script 在当前 document 上执行 recipe。
- 扩展运行保存的 transform。
- 扩展执行保存或本次选择的 action preset。

用户决策点：

- 选择哪套配置。
- 是否临时覆盖本次 action。
- 如果结果不对，是否进入 Codex Studio 修复。

完成状态：

- 结果通过复制、下载或两者交付给用户。
- 当前站点 last successful configuration 被更新。

失败状态：

- 没有匹配配置。
- recipe 因 DOM 变化失败。
- transform 校验或执行失败。
- 复制或下载动作失败。

## 复制和下载流程

触发条件：

- Daily Run 或 Codex Studio 产生 export result。

输入：

- 输出字符串。
- format label。
- 当前 URL 或配置名。
- action preset：copy、download、copy_download。

系统动作：

- copy：将输出字符串写入剪切板。
- download：通过 Chrome download 能力保存为本地文件。
- copy_download：依次执行复制和下载，并报告局部失败。

用户决策点：

- 保存配置时选择默认 action preset。
- Daily Run 中可选是否临时覆盖本次动作。

完成状态：

- 剪切板或下载文件中包含本次输出内容。

失败状态：

- 剪切板写入失败。
- 下载权限或 API 不可用。
- export result 无法生成。

## 快捷键无弹窗流程

触发条件：

- 用户触发 Chrome extension command 快捷键。

输入：

- 当前 active tab URL。
- 当前 URL 匹配的配置。
- 当前站点 last successful configuration。

系统动作：

- background 根据当前 URL 查找匹配配置。
- 优先选择当前站点上次成功配置。
- 向 content script 发送 recipe 执行请求。
- 运行保存的 transform。
- 自动执行保存的 action preset。

用户决策点：

- 快捷键执行期间无交互。
- 如果无法确定配置，用户需要打开 popup 选择或创建配置。

完成状态：

- 不打开 popup 也完成复制、下载或两者。

失败状态：

- 没有匹配配置。
- 没有 last successful configuration。
- 被选中的配置运行失败。
- action preset 执行失败。
