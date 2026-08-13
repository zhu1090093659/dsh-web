/**
 * Skin-center locale dictionaries. The plugin-card name, its description,
 * and every control of the in-GUI skin center is localized through the
 * standard `t` seat.
 */

/** Copy keys owned by this plugin. */
export type SkinCenterKey =
  | 'title'
  | 'cardDescription'
  | 'expand'
  | 'collapse'
  | 'intro'
  | 'official'
  | 'officialTagline'
  | 'active'
  | 'tryingOn'
  | 'tryOn'
  | 'exitTryOn'
  | 'apply'
  | 'applying'
  | 'restore'
  | 'applyFailed'
  | 'appliedUnconfirmed'
  | 'theme'
  | 'themeLight'
  | 'themeDark'
  | 'tryOnError'
  | 'backgroundOpacity'
  | 'backgroundHint'
  | 'backgroundHintInert'

export const en: Record<SkinCenterKey, string> = {
  title: 'Skin Center',
  cardDescription: 'Try on any installed skin live in the GUI — exit restores instantly, applying persists in one click.',
  expand: 'Expand',
  collapse: 'Collapse',
  intro: 'Try on any skin live — it takes effect instantly, exit restores the current look. Apply persists it across restarts.',
  official: 'Official default',
  officialTagline: 'The stock DSH look with no skin applied.',
  active: 'Active',
  tryingOn: 'Trying on',
  tryOn: 'Try on',
  exitTryOn: 'Exit try-on',
  apply: 'Apply',
  applying: 'Applying…',
  restore: 'Restore',
  applyFailed: 'Apply failed',
  appliedUnconfirmed: 'Applied, but the change has not been confirmed — refresh the page if the skin did not switch',
  theme: 'Theme preview',
  themeLight: 'Light',
  themeDark: 'Dark',
  tryOnError: 'Try-on failed — see console',
  backgroundOpacity: 'Background occlusion',
  backgroundHint: 'Instantly veils the backdrop behind the panels — higher values obscure the art to help you focus.',
  backgroundHintInert: 'Only applies to skins that paint a backdrop (Blue Fantasy / Whale Song). Applies to the official default automatically once such a skin is active.',
}

export const zh: Record<SkinCenterKey, string> = {
  title: '皮肤中心',
  cardDescription: '在 GUI 内即时试穿任意皮肤，退出即完全还原；应用一键完成并自动刷新。',
  expand: '展开',
  collapse: '收起',
  intro: '任意皮肤可即时试穿，退出即完全还原；「应用」一键持久化，页面自动刷新生效。',
  official: '官方默认',
  officialTagline: '还原 DSH 官方默认外观，不应用任何皮肤。',
  active: '当前激活',
  tryingOn: '试穿中',
  tryOn: '试穿',
  exitTryOn: '退出试穿',
  apply: '应用',
  applying: '应用中…',
  restore: '恢复默认',
  applyFailed: '应用失败',
  appliedUnconfirmed: '已写入配置但尚未确认生效——若皮肤未切换请手动刷新页面',
  theme: '主题预览',
  themeLight: '亮色',
  themeDark: '暗色',
  tryOnError: '试穿失败，详见控制台',
  backgroundOpacity: '背景遮挡',
  backgroundHint: '即时为面板背后的背景加遮罩——数值越高越能弱化插画，帮你集中注意力。',
  backgroundHintInert: '仅对带背景图插画的皮肤（蓝色幻想 / 鲸吟）生效；官方默认无背景图，该滑块对这些皮肤自动生效。',
}
