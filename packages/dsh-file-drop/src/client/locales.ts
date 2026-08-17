/**
 * Tiny zh-first copy for the drop message. No locale service dependency:
 * the message is composed from document.documentElement.lang directly.
 */

export const zh = {
  stagedNote: '（未找到原路径，已暂存副本）',
} as const

export const en = {
  stagedNote: ' (original not found; staged copy)',
} as const

export type DropKey = keyof typeof zh

/** Active dictionary, picked by the document language at call time. */
export function dictionary(): Record<DropKey, string> {
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : 'zh'
  return lang.toLowerCase().startsWith('en') ? en : zh
}
