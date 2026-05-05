# WebRelay 信息架构

## 顶层界面

扩展应围绕两个子界面组织：

- Daily Run：默认日常执行入口，无 Codex 参与。
- Codex Studio：智能工作台，用于生成、预览、反馈、修复、保存配置。

当当前 URL 有匹配配置时，popup 默认进入 Daily Run。Codex Studio 从 Daily Run 中进入，用于创建新配置或修复现有配置。

## Daily Run

主要目的：

- 使用已保存配置快速抽取当前页面信息。

主要区域：

- 当前站点头部：展示当前域名或匹配站点。
- 配置选择器：展示当前站点下匹配的配置。
- 配置摘要：展示 intent、输出格式、更新时间、version、默认 action。
- 执行动作区：运行配置，并选择复制、下载或复制加下载。
- 当前结果预览：只展示本次 popup 会话中的结果。
- 状态与错误：展示运行、复制、下载状态，并提供修复入口。

主要操作：

- 运行选中配置。
- 复制结果。
- 下载结果。
- 打开 Codex Studio 创建新配置。
- 打开 Codex Studio 修复当前配置。

次级信息：

- debug 默认折叠。
- raw recipe 和 transform 不作为默认展示内容。

## Codex Studio

主要目的：

- 使用 Codex SDK 辅助创建、预览、完善和修复配置。

主要区域：

- 上下文头部：当前 URL、当前站点、当前配置。
- 交互输入区：用户 intent、refinement feedback、repair note。
- 生成控制区：从页面生成、从需求生成、refine、repair。
- 预览区：结构化抽取数据、格式化输出预览、warnings。
- debug 区：root match、field match、empty count、runtime errors。
- 保存区：配置名、站点分组、默认 action preset、保存或放弃。

主要操作：

- Generate from page analysis。
- Generate from user requirement。
- Refine current artifact。
- Repair broken configuration。
- Save as new configuration。
- Replace existing configuration version。

## Site 与 Configuration 的关系

用户应感知为“每个站点下有多套配置”：

- Site 表示 URL origin 和一组匹配规则。
- 一个 Site 可以有多套命名 Configuration。
- Configuration 属于一个 Site，但可以有更窄的 URL pattern。
- Daily Run 根据当前 URL 过滤配置。
- 快捷键根据当前站点的 last successful configuration 执行。

推荐展示字段：

- Site name：默认由 hostname 派生。
- Configuration name：用户可编辑，默认来自页面标题或抽取目的。
- Intent：配置的人类可读目的。
- Output format：来自 transform format label，若没有则显示 Raw JSON preview。
- Default action：copy、download、copy_download。

## Preview、Output 与 Debug

Preview data：

- recipe 执行后的结构化结果。
- 只存在于当前会话。
- 用于判断是否保存或修复。

Output preview：

- transform 执行后的字符串结果。
- 用于复制或下载。
- 只存在于当前会话。

Debug data：

- root match count。
- field selector match count。
- empty count。
- selector/runtime errors。
- 用于用户判断，也作为 repair 上下文传给 Codex。

## 当前 Popup 拆分方向

当前 popup 将生成、反馈、profile 选择、执行、导出、保存、debug 放在同一个实验界面中。后续应拆分为：

- 已保存配置选择与运行控制进入 Daily Run。
- intent、generate、refine、repair、preview verification、save 进入 Codex Studio。
- 两个界面都保留 debug，但默认折叠。
- 两个界面都不持久化保存结果内容。

## 空状态和错误状态

没有匹配配置：

- Daily Run 展示当前站点没有配置。
- 主操作引导用户进入 Codex Studio 创建配置。

后端不可用：

- Daily Run 仍可运行已保存本地配置。
- Codex Studio 明确提示生成、反馈、修复需要本地后端。

配置运行失败：

- Daily Run 展示失败状态并提供 Repair。
- Repair 入口带着失败配置和 debug 上下文进入 Codex Studio。

快捷键无法确定配置：

- 扩展提示用户打开 popup 选择或创建配置。
