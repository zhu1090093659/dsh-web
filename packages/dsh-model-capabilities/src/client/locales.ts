/**
 * dsh-model-capabilities locale dictionaries (zh/en). The zh dictionary is
 * the key source; `en` mirrors its full key set (packages/AGENTS.md bilingual
 * discipline). Russian copy ships centrally in dsh-i18n.
 * @module @linxin666/dsh-client-ui-model-capabilities/client/locales
 */

/** Dictionary namespace this package registers. */
export const NS = 'model-caps'

/** Chinese copy (key source). */
export const zh = {
  'caps.title': '模型能力',
  'caps.hint': '为目录里的每个模型声明推理档位，保存写入设置文档并立即生效。',
  'caps.loading': '正在读取模型能力…',
  'caps.loadFailed': '读取失败：{error}',
  'caps.reload': '重新读取',
  'caps.empty': '此提供方还没有可编辑的模型目录。先在上方模型目录中添加模型行，再回到这里为每个模型声明能力。',
  'caps.readOnly': '当前设置文档只读，无法修改。',
  'caps.model.count': '{n} 个模型',
  'caps.model.expand': '展开模型能力',
  'caps.model.collapse': '收起模型能力',
  'caps.model.efforts': '推理档位',
  'caps.efforts.inherit': '不声明',
  'caps.efforts.none': '无推理',
  'caps.efforts.levels': '声明档位',
  'caps.efforts.inheritHint': '跟随内置目录的声明；自定义模型没有目录可跟随，等同无推理。',
  'caps.efforts.noneHint': '声明该模型不参与推理（reasoningEfforts: false），模型选择器不再提供思考档位。',
  'caps.efforts.levelsHint': '勾选模型支持的档位，并填写请求里实际发送的取值。',
  'caps.wire.label': '发送值',
  'caps.wire.placeholder': '请求参数取值',
  'caps.wire.offHint': 'off 可留空：表示「支持，但发送时不带参数」。',
  'caps.preset.common': '填入常用 low / medium / high',
  'caps.summary.noReasoning': '无推理',
  'caps.summary.efforts': '推理：{levels}',
  'caps.save': '保存',
  'caps.saving': '保存中…',
  'caps.discard': '重置',
  'caps.dirty': '有未保存的修改',
  'caps.saved': '已保存',
  'caps.staleDraft': '配置已被其他界面修改；你的未保存修改仍保留，保存时会再次校验。',
  'caps.conflict': '配置已被其他界面修改，已重新读取，请重试。',
  'caps.failed': '保存失败：{error}',
  'caps.invalid.wire': '档位 {level} 需要非空的发送值。',
  'caps.invalid.offOnly': '至少声明一个 off 以外的档位，或改选「无推理」。',
  'caps.action.disable': '禁用此提供方',
  'caps.action.enable': '启用',
  'caps.busy.disabling': '禁用中…',
  'caps.busy.enabling': '启用中…',
  'caps.disable.hint': '禁用后该提供方立即从输入框模型选择器与子代理可选模型中消失；配置会存档，可随时启用恢复。',
  'caps.state.badge': '已禁用',
  'caps.state.disabled': '该提供方已禁用：模型不出现在输入框模型选择器与子代理可选列表中。配置已存档，启用即恢复。',
  'caps.footer.title': '已禁用的提供方',
  'caps.footer.hint': '这些提供方的配置已存档；启用后恢复原配置，并重新出现在模型选择器与子代理可选列表中。',
  'caps.error.routeExists': '该提供方已存在新配置，无法恢复存档；请先移除现有配置再启用。',
  'caps.error.partialEnable': '已启用，但清理存档失败：{error}',
  'caps.error.baseProfile': '该提供方在组合层也声明了配置，禁用无法让它下线，因此不提供此操作。',
  'caps.error.unavailable': '无法切换：未找到插件的存档设置项。',
}

export type CapsKey = keyof typeof zh

/** English copy (full key parity with zh). */
export const en: Record<CapsKey, string> = {
  'caps.title': 'Model capabilities',
  'caps.hint': 'Declare reasoning efforts per catalog model; saving writes the settings document and applies immediately.',
  'caps.loading': 'Loading model capabilities…',
  'caps.loadFailed': 'Failed to load: {error}',
  'caps.reload': 'Reload',
  'caps.empty': 'No editable model catalog for this provider yet. Add model rows in the catalog above, then come back here to declare capabilities per model.',
  'caps.readOnly': 'The settings document is read-only; changes are disabled.',
  'caps.model.count': '{n} models',
  'caps.model.expand': 'Expand model capabilities',
  'caps.model.collapse': 'Collapse model capabilities',
  'caps.model.efforts': 'Reasoning efforts',
  'caps.efforts.inherit': 'Undeclared',
  'caps.efforts.none': 'No reasoning',
  'caps.efforts.levels': 'Declare levels',
  'caps.efforts.inheritHint': 'Follows the built-in catalog; a hand-declared model has nothing to follow, which behaves like no reasoning.',
  'caps.efforts.noneHint': 'Declare this model as non-reasoning (reasoningEfforts: false); the model picker stops offering thinking levels.',
  'caps.efforts.levelsHint': 'Check the levels the model supports and fill in the wire value each one sends.',
  'caps.wire.label': 'Wire value',
  'caps.wire.placeholder': 'request parameter value',
  'caps.wire.offHint': 'off may stay empty: "supported, but send nothing when chosen".',
  'caps.preset.common': 'Fill the common low / medium / high',
  'caps.summary.noReasoning': 'no reasoning',
  'caps.summary.efforts': 'reasoning: {levels}',
  'caps.save': 'Save',
  'caps.saving': 'Saving…',
  'caps.discard': 'Reset',
  'caps.dirty': 'Unsaved changes',
  'caps.saved': 'Saved',
  'caps.staleDraft': 'The configuration changed in another surface; your unsaved changes are kept and re-checked when you save.',
  'caps.conflict': 'The configuration changed in another surface; reloaded — please retry.',
  'caps.failed': 'Save failed: {error}',
  'caps.invalid.wire': 'Level {level} needs a non-empty wire value.',
  'caps.invalid.offOnly': 'Declare at least one level beyond off, or switch to "No reasoning".',
  'caps.action.disable': 'Disable provider',
  'caps.action.enable': 'Enable',
  'caps.busy.disabling': 'Disabling…',
  'caps.busy.enabling': 'Enabling…',
  'caps.disable.hint': 'A disabled provider leaves the composer model picker and the subagent selection immediately; its configuration is archived and can be restored at any time.',
  'caps.state.badge': 'disabled',
  'caps.state.disabled': 'This provider is disabled: its models are absent from the composer picker and the subagent selection. The configuration is archived; enabling restores it.',
  'caps.footer.title': 'Disabled providers',
  'caps.footer.hint': 'These providers have archived configurations; enabling restores the original profile and puts it back into the model picker and the subagent selection.',
  'caps.error.routeExists': 'The provider already has a newer configuration; the archive cannot be restored. Remove the current configuration first, then enable.',
  'caps.error.partialEnable': 'Enabled, but clearing the archive failed: {error}',
  'caps.error.baseProfile': 'The composition layer also declares this provider, so disabling cannot take it down; the action is not offered.',
  'caps.error.unavailable': 'Cannot toggle: the plugin archive settings entry is not served.',
}

/**
 * Active dictionary, picked by the document language at call time (the same
 * tiny resolution every family settings card uses).
 */
export function dictionary(): Record<CapsKey, string> {
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : 'zh'
  return lang.toLowerCase().startsWith('en') ? en : zh
}

/** Translate a key with optional `{name}` template params; missing keys degrade to the key. */
export function t(key: CapsKey, params?: Record<string, unknown>): string {
  let text: string = dictionary()[key] ?? key
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-model-capabilities UI copy. */
    'model-caps': CapsKey
  }
}
