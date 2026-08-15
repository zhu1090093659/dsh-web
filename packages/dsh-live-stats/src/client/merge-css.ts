/**
 * Stylesheet that merges the live TPS row into the official StatsLine row —
 * always on ONE line, no wrapping at any width.
 *
 * The composer dock (`conversation.composer.dock`) is a list slot: every
 * registered entry renders, and the renderer emits them inside a wrapper —
 * `<div data-slot="conversation.composer.dock" style="display: contents">`.
 * The merge turns that wrapper into a horizontal flex row (the inline
 * `display: contents` is overridden with `!important`, which only affects
 * layout — the wrapper still carries no visual box), so the official
 * StatsLine and the TPS sit side by side as one compact, centered unit:
 *
 * - the official row shrinks to its content width (capped so the merged
 *   line stays compact; its own `white-space: nowrap` + ellipsis handle the
 *   rest — the row can never wrap);
 * - the TPS row is a fixed-width item right after it, separated by a `·`
 *   in the official separator style.
 *
 * Selector notes (all verified against the real rendered DOM):
 * - the slot renderer wraps entries in `div[data-slot="conversation.composer.dock"]`,
 *   so the entries are its direct children — selectors must anchor on the
 *   wrapper;
 * - nested `:has()` (a `:has()` whose argument contains another `:has()`
 *   with a combinator) fails to parse and the whole rule is silently dropped
 *   by the engine, so the merge uses flat selectors only: `*:has(+ ...)` for
 *   the official row (find the element right before the TPS) and the plain
 *   sibling combinator `* + [data-dsh-live-tps]` for the TPS row.
 *
 * When only one of the two entries is present the rules degrade gracefully:
 * the official row alone keeps its original full-width look (the stats rule
 * does not match), and the TPS alone stays visible and centered.
 */
export const MERGE_CSS = `
/* 官方行缺席时的兜底：TPS 独立成行、居中 */
[data-dsh-live-tps] {
  align-self: center;
}

/* ── 合并：官方统计行 + 实时 TPS 恒为一行 ──
   把渲染器的槽位包装层（内联 display: contents）覆盖为横向 flex 行：
   两个条目并排、整体居中、永不换行。仅官方行时它保持原样
   （官方行 width:100% 填满整行，视觉不变）。 */

div[data-slot="conversation.composer.dock"] {
  display: flex !important;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: center;
  width: 100%;
  box-sizing: border-box;
}

/* 官方行：收缩为内容宽度（上限 min(620px, 容器-150px)，行窄时省略截断）；
   清掉官方 margin/padding 的横向占位，保留 4px 上内边距与文字行高对齐。
   hover/focus 时官方 Tooltip 会把气泡 span 插到统计行与 TPS 之间
   （DOM: [统计行, span[role=tooltip], TPS]），所以同时匹配两种相邻形态：
   「下一兄弟是 TPS」或「下一兄弟是气泡、再下一兄弟是 TPS」，
   否则气泡一出现统计行就回退官方样式、变宽把 TPS 挤走。 */
div[data-slot="conversation.composer.dock"] > *:not([role="tooltip"]):has(+ [data-dsh-live-tps], + [role="tooltip"] + [data-dsh-live-tps]) {
  width: auto;
  max-width: min(620px, calc(100% - 150px));
  min-width: 0;
  margin: 0;
  padding: 4px 0 0;
  flex: 0 1 auto;
}

/* TPS：固定宽度条目，紧跟官方行 */
div[data-slot="conversation.composer.dock"] > * + [data-dsh-live-tps] {
  flex: 0 0 auto;
}

/* 与官方行同风格的分隔符（仅合并态显示） */
div[data-slot="conversation.composer.dock"] > * + [data-dsh-live-tps]::before {
  content: '\\B7';
  color: var(--dsw-alias-separator-primary);
  margin: 0 10px;
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
