# 智能体决策记录：深海女仆工坊浅色模式输入框 Lexical 编辑器文字对比度

状态：已实现

## 问题描述

Issue #1405：在 DSH 0.1.2-rc.1 中，对话输入区（composer）升级为基于 Lexical 的 contenteditable 输入元素（`[data-composer-input]`、`[data-lexical-editor]`、`[contenteditable="true"]`、`.uV2eYG_input`）。原先针对 #1085 的修复依赖壳层通过高亮 backdrop 层（`[class*="backdrop"]` 与 `[data-input-mirror]`）渲染文字；在当前 DOM 中已不存在该结构。输入框文字颜色回退至浅色主题变量 `--dsw-alias-label-primary`（深墨色 `#172347`），与皮肤常驻深蓝背景的卡片（`rgba(13, 25, 59, 0.72)`）几乎同色，导致打字文字不可见。

## 决策

更新 `packages/skins/skin-center/skins/maid-atelier/patches.css`，在 `[data-composer-card]` 作用域下针对 Lexical 输入框 DOM 结构进行样式覆盖：
- 为 `[data-composer-input]`、`[data-lexical-editor]`、`[contenteditable="true"]`、`.uV2eYG_input` 设置浅色文字 `#eef3fc`。
- 将子元素 `span` 的颜色设为 `color: inherit`。
- 为 contenteditable 输入框与 textarea 统一设置光标颜色 `caret-color: #bcd2ff`。
- 确保占位符规则覆盖 `[class*="placeholder"]` 与 `[data-placeholder]`，保持 `#b6c2e0`。

## 测试验证

- 新增单元测试：`packages/skins/skin-center/tests/maid-composer-input-color.spec.ts`（3 项测试通过），断言相关选择器均被绑定为 `#eef3fc` 与 `#bcd2ff`。
- 皮肤中心全量测试：`pnpm --filter @linxin666/dsh-client-ui-skin-center test`（34 个测试文件，610 项全部通过）。
- 资产目录检查：`pnpm skin-center:check` 通过。
