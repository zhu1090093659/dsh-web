/**
 * dsh-pet-maid locale dictionaries (zh/en).
 * @module @linxin666/dsh-pet-maid/client/locales
 */

/** Dictionary namespace this package registers. */
export const NS = 'pet-maid'

/** Chinese copy. */
export const zh = {
  'pet.feed': '喂食',
  'pet.hide': '隐藏',
  'pet.rename': '改名',
  'pet.confirm': '确定',
  'pet.namePlaceholder': '输入新名字',
  'pet.summon': '召唤{name}',
  'pet.rank': '亲密度 {rank}',
  'pet.points': '{points} 点',
  'pet.treats': '小鱼干 ×{n}',
  'pet.parallel': '并行工作 ×{n}',
  'pet.asset': '素材 {source}',
  'pet.assetLocal': '本地主题',
  'pet.assetBundled': '内置兜底',
  'pet.state.loading': '女仆鲸鱼娘正在赶来…',
  'pet.state.error': '女仆鲸鱼娘迷路了（连接失败）',
  // 插件设置卡片（settings.plugin.item 席位）。
  'settings.title': '女仆鲸鱼娘',
  'settings.description': '女仆鲸鱼娘的显示布局、交互与名字。',
  'settings.enabled': '启用宠物',
  'settings.enabledHint': '关闭后隐藏宠物并停止轮询，可在设置里重新启用。',
  'settings.visible': '显示宠物',
  'settings.visibleHint': '关闭后宠物隐藏，可从聊天输入区重新召唤。',
  'settings.size': '大小（px）',
  'settings.sizeHint': '精灵单元高度，范围 32–512。',
  'settings.right': '距右侧（px）',
  'settings.rightHint': '距视口右边缘的水平内缩距离。',
  'settings.bottom': '距底部（px）',
  'settings.bottomHint': '距视口底边的垂直内缩距离。',
  'settings.name': '名字',
  'settings.nameHint': '宠物显示名，1–20 个字符。',
  'settings.eyeTracking': '眼部跟随',
  'settings.eyeTrackingHint': '空闲时目光跟随鼠标（最大偏移 4px）。',
  'settings.miniMode': '迷你模式',
  'settings.miniModeHint': '拖到右边缘时收进迷你形态，悬停探出。',
  'settings.inherit': '继承',
  'settings.on': '开',
  'settings.off': '关',
  'settings.overridden': '已覆盖',
  'settings.reset': '恢复默认',
  'settings.notExposed': '当前 DSH 版本未向设置页暴露本插件的配置命名空间，表单不可用。可编辑 ~/.dsh/settings.yaml 直接配置，或为 dsh-host-apiproxy 的 WEB_SETTINGS_NAMESPACES 白名单补充本命名空间后重启。',
  'settings.readOnly': '当前部署的设置只读。',
  'settings.expand': '展开设置',
  'settings.collapse': '收起设置',
  'settings.save': '保存',
  'settings.saving': '保存中…',
  'settings.discard': '放弃',
  'settings.unsaved': '未保存',
  'settings.saveFailed': '部署未接受这些值，已保留供你修改。',
  'settings.invalidNumber': '请输入数字，留空则使用默认值。',
} as const

/** English copy. */
export const en = {
  'pet.feed': 'Feed',
  'pet.hide': 'Hide',
  'pet.rename': 'Rename',
  'pet.confirm': 'OK',
  'pet.namePlaceholder': 'Enter a new name',
  'pet.summon': 'Summon {name}',
  'pet.rank': 'Affinity {rank}',
  'pet.points': '{points} pts',
  'pet.treats': 'Treats ×{n}',
  'pet.parallel': 'Parallel ×{n}',
  'pet.asset': 'Atlas {source}',
  'pet.assetLocal': 'local theme',
  'pet.assetBundled': 'bundled',
  'pet.state.loading': 'The whale maid is on her way…',
  'pet.state.error': 'The whale maid is lost (connection failed)',
  // Plugin settings card (the `settings.plugin.item` seat).
  'settings.title': 'Whale Maid',
  'settings.description': 'The whale maid\u2019s display layout, interactions and name.',
  'settings.enabled': 'Enable the pet',
  'settings.enabledHint': 'When off, the pet hides and polling stops; re-enable it here.',
  'settings.visible': 'Show the pet',
  'settings.visibleHint': 'When off, the pet hides; summon it again from the input row.',
  'settings.size': 'Size (px)',
  'settings.sizeHint': 'Sprite cell height, 32\u2013512.',
  'settings.right': 'Right inset (px)',
  'settings.rightHint': 'Horizontal inset from the viewport right edge.',
  'settings.bottom': 'Bottom inset (px)',
  'settings.bottomHint': 'Vertical inset from the viewport bottom edge.',
  'settings.name': 'Name',
  'settings.nameHint': 'The pet\u2019s display name, 1\u201320 characters.',
  'settings.eyeTracking': 'Eye tracking',
  'settings.eyeTrackingHint': 'Idle poses follow the cursor (max 4px offset).',
  'settings.miniMode': 'Mini mode',
  'settings.miniModeHint': 'Dragging to the right edge tucks the pet in; hover to peek.',
  'settings.inherit': 'Inherit',
  'settings.on': 'On',
  'settings.off': 'Off',
  'settings.overridden': 'Overridden',
  'settings.reset': 'Reset to default',
  'settings.notExposed': 'This DSH version does not expose this plugin\'s settings namespace to the configuration page, so the form is unavailable. Edit ~/.dsh/settings.yaml directly, or add the namespace to dsh-host-apiproxy\'s WEB_SETTINGS_NAMESPACES allowlist and restart.',
  'settings.readOnly': 'This deployment stores settings read-only.',
  'settings.expand': 'Show settings',
  'settings.collapse': 'Hide settings',
  'settings.save': 'Save',
  'settings.saving': 'Saving\u2026',
  'settings.discard': 'Discard',
  'settings.unsaved': 'Unsaved',
  'settings.saveFailed': 'The deployment did not accept these values; they were left for you to correct.',
  'settings.invalidNumber': 'Enter a number, or leave blank to use the default.',
} as const

/** Key union for this namespace. */
export type PetKey = keyof typeof zh

/** The settings-card slice of the pet dictionary. */
export type SettingsCardKey = PetKey

/**
 * Active dictionary, picked by the document language at call time. The pet
 * mounts as a global floating surface (not a session-scoped slot), so it has
 * no framework locale seat and resolves its copy the same tiny way the
 * task-board's DOM-injected surface does.
 */
export function dictionary(): Record<PetKey, string> {
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : 'zh'
  return lang.toLowerCase().startsWith('en') ? en : zh
}

/**
 * Translate a key with optional `{name}` template params. Mirrors the slot
 * `Translate` contract `(key, params?) => string` so it can be handed to the
 * same components that used to receive the framework-injected `t` seat. The
 * key is typed loosely (`string`) so the function is assignable to the slot's
 * `TranslateNS<'pet-maid'>` (whose key domain also spans the shared common
 * vocabulary); a missing key degrades to the key itself rather than throwing.
 */
export function t(key: string, params?: Record<string, unknown>): string {
  let text: string = (dictionary() as Record<string, string>)[key] ?? key
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-pet-maid UI copy. */
    'pet-maid': PetKey
  }
}
