import type { MarketKey } from './locales.ts'

/** Canonical category ids (scripts/community-index mirrors this set). */
export const CATEGORY_IDS = ['ui', 'agent', 'tools', 'knowledge', 'integration', 'security', 'utility'] as const
/** Canonical category → subcategory mapping (scripts/community-index mirrors this). */
export const SUBCATEGORY_IDS: Record<string, readonly string[]> = {
  ui: ['terminal', 'chat', 'render', 'panel'],
  agent: ['preset'],
  tools: ['context', 'browser', 'api', 'model', 'dev'],
  knowledge: ['memory', 'reading', 'qa'],
  integration: ['remote', 'bridge', 'sync', 'external-ai'],
  security: ['access', 'policy'],
  utility: ['cleanup', 'stats', 'notify', 'net'],
}
/**
 * Canonical preset category ids (scripts/market-build mirrors this set). A
 * preset catalog entry may omit the field; the manifest then says 'other'.
 */
export const PRESET_CATEGORY_IDS = ['roleplay'] as const
/** Preset category → second-level ids; a category with no list renders one row. */
export const PRESET_SUBCATEGORY_IDS: Record<string, readonly string[]> = {
  roleplay: [],
}
/** Locale-key lookup for preset category ids (shares the plugin category keys). */
export const PRESET_CATEGORY_LABEL_KEY: Record<string, MarketKey> = {
  roleplay: 'category.roleplay',
  other: 'category.other',
}
/** Locale-key lookup for category ids (including the manifest default 'other'). */
export const CATEGORY_LABEL_KEY: Record<string, MarketKey> = {
  ui: 'category.ui',
  agent: 'category.agent',
  tools: 'category.tools',
  knowledge: 'category.knowledge',
  integration: 'category.integration',
  security: 'category.security',
  utility: 'category.utility',
  other: 'category.other',
}
/** Locale-key lookup for subcategory ids. */
export const SUBCATEGORY_LABEL_KEY: Record<string, MarketKey> = {
  terminal: 'subcategory.terminal',
  chat: 'subcategory.chat',
  render: 'subcategory.render',
  panel: 'subcategory.panel',
  preset: 'subcategory.preset',
  context: 'subcategory.context',
  browser: 'subcategory.browser',
  api: 'subcategory.api',
  model: 'subcategory.model',
  dev: 'subcategory.dev',
  memory: 'subcategory.memory',
  reading: 'subcategory.reading',
  qa: 'subcategory.qa',
  remote: 'subcategory.remote',
  bridge: 'subcategory.bridge',
  sync: 'subcategory.sync',
  'external-ai': 'subcategory.external-ai',
  access: 'subcategory.access',
  policy: 'subcategory.policy',
  cleanup: 'subcategory.cleanup',
  stats: 'subcategory.stats',
  notify: 'subcategory.notify',
  net: 'subcategory.net',
}
