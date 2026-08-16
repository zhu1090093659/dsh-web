/**
 * Stylesheet that merges the live TPS slot into the official StatsLine row —
 * always on ONE line, no wrapping at any width.
 *
 * The composer dock (`conversation.composer.dock`) is a list slot: every
 * registered entry renders, and the renderer emits them inside a wrapper —
 * `<div data-slot="conversation.composer.dock" style="display: contents">`.
 * While the TPS slot is mounted the merge turns that wrapper into a
 * horizontal flex row (the inline `display: contents` is overridden with
 * `!important`, which only affects layout — the wrapper still carries no
 * visual box), so the official StatsLine and the TPS sit side by side as one
 * compact, centered unit:
 *
 * - the official row shrinks to its content width (capped at 620px so the
 *   merged line stays compact even on very wide docks; its own
 *   `white-space: nowrap` + ellipsis handle the rest — the row can never
 *   wrap);
 * - the TPS slot is a fixed-width item right after it, separated by a `·`
 *   in the official separator style (hidden while the slot has no content).
 *
 * The TPS slot stays mounted even when no rate sample exists yet (it renders
 * empty instead of unmounting), so the merged layout — and the official
 * row's width — never flips between content width and full width when a
 * stream starts or ends.
 *
 * Selector notes (all verified against the real rendered DOM):
 * - the slot renderer wraps entries in `div[data-slot="conversation.composer.dock"]`,
 *   so the entries are its direct children — selectors must anchor on the
 *   wrapper;
 * - nested `:has()` (a `:has()` whose argument contains another `:has()`
 *   with a combinator) fails to parse and the whole rule is silently dropped
 *   by the engine, so the merge uses flat selectors only: `:has(> ...)` on
 *   the wrapper (scoping the merge to the moment the TPS slot is mounted)
 *   and the plain sibling combinator `* + [data-dsh-live-tps]` for the slot.
 *
 * When the plugin is inactive the slot does not exist and no merge rule
 * matches: the dock keeps its original full-width look. While the slot is
 * mounted but the official row is absent, the TPS alone stays visible and
 * centered.
 */
export const MERGE_CSS = `
/* 官方行缺席时的兜底：TPS 独立成行、居中 */
[data-dsh-live-tps] {
  align-self: center;
}

/* ── 合并：官方统计行 + 实时 TPS 恒为一行 ──
   仅当 TPS 槽位存在（插件激活）时，把渲染器的槽位包装层（内联
   display: contents）覆盖为横向 flex 行：两个条目并排、整体居中、
   永不换行。插件未激活时此规则不匹配，官方行保持原样。 */

div[data-slot="conversation.composer.dock"]:has(> [data-dsh-live-tps]) {
  display: flex !important;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: center;
  width: 100%;
  box-sizing: border-box;
}

/* 官方行：收缩为内容宽度（上限 620px）；清掉官方 margin/padding 的横向
   占位，保留 4px 上内边距与文字行高对齐。极窄容器下由 flex 收缩
   （0 1 auto + min-width: 0 + 省略号）让位给 TPS 槽位，无需负值
   max-width 兜底。
   hover/focus 时官方 Tooltip 会把气泡 span 插到统计行与 TPS 之间
   （DOM: [统计行, span[role=tooltip], TPS]），所以同时匹配两种相邻形态：
   「下一兄弟是 TPS」或「下一兄弟是气泡、再下一兄弟是 TPS」，
   否则气泡一出现统计行就回退官方样式、变宽把 TPS 挤走。 */
div[data-slot="conversation.composer.dock"] > *:not([role="tooltip"]):has(+ [data-dsh-live-tps], + [role="tooltip"] + [data-dsh-live-tps]) {
  width: auto;
  max-width: 620px;
  min-width: 0;
  margin: 0;
  padding: 4px 0 0;
  flex: 0 1 auto;
}

/* TPS 槽位：固定宽度条目，紧跟官方行 */
div[data-slot="conversation.composer.dock"] > * + [data-dsh-live-tps] {
  flex: 0 0 auto;
}

/* 与官方行同风格的分隔符（仅合并态、且槽位有内容时显示） */
div[data-slot="conversation.composer.dock"] > * + [data-dsh-live-tps]::before {
  content: '\\B7';
  color: var(--dsw-alias-separator-primary);
  margin: 0 10px;
}

/* 无速率样本时槽位为空：隐藏分隔符，保持布局稳定 */
div[data-slot="conversation.composer.dock"] > * + [data-dsh-live-tps]:empty::before {
  content: none;
}

/* 官方行 hover 的 Tooltip 气泡：按内容宽度单行显示（官方默认最大
   半视口宽，长统计文本会折行）；窄屏时受视口限制自动回退换行 */
div[data-slot="conversation.composer.dock"] > [role="tooltip"] {
  width: max-content;
  max-width: calc(100vw - 32px);
}
`.trim()

/** Injected-once guard for the merge stylesheet (one tag per page load). */
let mergeCssInjected = false

/** Inject the merge stylesheet once; no-op outside the browser or when already present. */
export function ensureMergeCss(): void {
  if (mergeCssInjected || typeof document === 'undefined') return
  mergeCssInjected = true
  if (document.querySelector('style[data-dsh-live-stats-merge]') !== null) return
  const style = document.createElement('style')
  style.dataset.dshLiveStatsMerge = ''
  style.textContent = MERGE_CSS
  document.head.appendChild(style)
}
