# WebRelay 数据模型

## 存储原则

- Chrome storage 保存配置和必要使用状态。
- 不持久化保存抽取结果内容。
- recipe schema 必须保持封闭，拒绝任意额外字段。
- 不保存任意可执行网页脚本。
- 后端 Codex thread 是短生命周期会话，不作为长期状态。

## Site

Site 用于组织同一网站或一组相关 URL 下的配置。

推荐字段：

- `id`：稳定生成 ID。
- `name`：用户可见站点名，默认 hostname。
- `origin`：URL origin，例如 `https://example.com`。
- `urlPatterns`：用于匹配页面的一组 URL pattern。
- `createdAt`：ISO datetime。
- `updatedAt`：ISO datetime。

说明：

- 当前实现已有 URL pattern helper，后续仍应放在 `shared`。
- Site 是管理概念；实际运行仍以 URL pattern 匹配配置。

## Configuration

Configuration 是核心可复用单元。

推荐字段：

- `id`：稳定生成 ID。
- `siteId`：所属站点 ID。
- `name`：用户可见配置名。
- `urlPattern`：匹配页面的 URL pattern。
- `intent`：原始用户需求或生成出的用途说明。
- `recipe`：封闭 extraction recipe。
- `transform`：可选受限本地 transform。
- `outputDescription`：可选输出说明。
- `actionPreset`：默认输出动作。
- `createdAt`：ISO datetime。
- `updatedAt`：ISO datetime。
- `version`：正整数，覆盖保存时递增。

兼容说明：

- 当前 `ExtractionProfile` 已覆盖大部分字段。
- 后续可以选择演进 `ExtractionProfile`，也可以新增 `ExtractionConfiguration` 并迁移旧 storage。

## Recipe

Recipe 是由扩展运行时执行的安全抽取合同。

当前字段：

- `version`：当前为 `1`。
- `mode`：`single` 或 `list`。
- `rootSelector`：single 可选，list 必填。
- `fields`：字段规则数组。

Field rule：

- `name`：输出字段名。
- `selector`：CSS selector；list mode 下相对 root。
- `value`：`textContent`、`innerText`、`attribute`、`href`、`src`。
- `attribute`：仅 `value` 为 `attribute` 时需要。
- `required`：空值是否视为错误。

规则：

- 拒绝额外字段。
- Codex 输出必须是 JSON，不是 JavaScript。
- selector 应优先使用语义属性和稳定结构，避免长 `nth-child` 链。

## Transform

Transform 将抽取数据格式化为用于复制或下载的字符串。

当前字段：

- `version`：当前为 `1`。
- `formatLabel`：短标签，例如 Markdown、CSV、JSON。
- `outputDescription`：一句话说明输出。
- `code`：受限 JavaScript function body，必须返回字符串。

规则：

- transform 不是网页脚本。
- transform 禁止访问网络、文件系统、shell、浏览器自动化、DOM、timer、import、`eval`、`Function`。
- 当前 transform 在后端沙箱中执行；若未来迁移到扩展端，需要等价的校验和隔离策略。

## Action Preset

Action preset 决定配置运行成功后的默认动作。

推荐枚举：

- `copy`：写入剪切板。
- `download`：下载为文件。
- `copy_download`：复制并下载。

推荐字段：

- `type`：上述枚举之一。
- `downloadFilenameTemplate`：可选，用站点、配置、日期、格式生成文件名。

默认值：

- 旧配置或未设置时使用 `copy`。

## Last Used State

Last used state 用于支持快捷键无弹窗执行。

推荐字段：

- `siteId`：匹配站点。
- `configurationId`：该站点上次成功运行的配置。
- `urlPattern`：成功运行时匹配的 pattern。
- `lastRunAt`：ISO datetime。
- `lastActionPreset`：成功运行时使用的 action preset。

规则：

- 仅在抽取和 action 都成功后更新。
- 不保存抽取结果内容。
- 如果配置被删除或不再匹配当前 URL，快捷键应提示用户打开 popup。

## Session-Only State

以下状态只存在于当前会话，不写入 storage：

- 当前 DOM snapshot。
- 当前 preview data。
- 当前 export result content。
- 当前 Codex thread 原始响应。
- 当前失败 debug，除非正在立即传入 repair 请求。

## Chrome Storage 建议布局

近期可以保持简单：

- `profiles` 或 `configurations`：保存配置记录。
- `sites`：实现站点分组时保存站点记录。
- `lastUsedBySite`：快捷键解析所需状态。

迁移建议：

- 尽量保留已有 profile。
- 为旧记录补充默认 `actionPreset: copy`。
- 根据旧 profile 的 URL pattern 和 hostname 派生 site。
