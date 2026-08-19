/**
 * Locale dictionaries for the page-annotate panel. zh is the key source;
 * en mirrors every key (package i18n discipline).
 * @module @linxin666/dsh-page-annotate/client/locales
 */

import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** Locale namespace of the browser half. */
export const NS = 'page-annotate'

/** zh dictionary (key source). */
export const zh = {
  'tab.title': '网页批注',
  'url.placeholder': '输入网址后回车',
  'url.go': '前往',
  'url.back': '后退',
  'url.forward': '前进',
  'url.reload': '刷新',
  'mode.browse': '浏览',
  'mode.annotate': '批注',
  'action.capture': '截图',
  'action.send': '发送给模型',
  'action.clear': '清空',
  'action.undo': '撤销',
  'action.upload': '上传图片',
  'tool.rect': '矩形',
  'tool.arrow': '箭头',
  'tool.text': '文本',
  'tool.number': '序号',
  'color.red': '红',
  'color.orange': '橙',
  'color.blue': '蓝',
  'color.green': '绿',
  'color.black': '黑',
  'status.capturing': '截图中…',
  'status.sending': '发送中…',
  'status.inserted': '已插入对话草稿，补充说明后发送即可',
  'status.idle': '截图后在图上绘制批注，再发送给模型 OCR 识别',
  'error.noUrl': '请先在地址栏输入网址',
  'error.capture': '截图失败：{message}',
  'error.noEngine': '截图引擎不可用：在 DSH 桌面壳中运行使用内置 Chromium；其他环境需 Playwright Chromium（可设置 DSH_PAGE_ANNOTATE_CHROMIUM 指定浏览器路径），也可以改用「上传图片」',
  'error.upload': '图片上传失败：{message}',
  'error.send': '发送失败：{message}',
  'embed.blocked': '该网站禁止内嵌显示，仍可点击「截图」用独立内核捕获页面',
  'text.placeholder': '输入批注文本，回车确认',
  'hint.text': '点击图片位置输入文本',
  'status.captured': '已截图（{engine}）',
} as const

/** en dictionary (complete mirror of zh keys). */
export const en: Record<keyof typeof zh, string> = {
  'tab.title': 'Page Annotate',
  'url.placeholder': 'Enter a URL and press Enter',
  'url.go': 'Go',
  'url.back': 'Back',
  'url.forward': 'Forward',
  'url.reload': 'Reload',
  'mode.browse': 'Browse',
  'mode.annotate': 'Annotate',
  'action.capture': 'Screenshot',
  'action.send': 'Send to model',
  'action.clear': 'Clear',
  'action.undo': 'Undo',
  'action.upload': 'Upload image',
  'tool.rect': 'Rectangle',
  'tool.arrow': 'Arrow',
  'tool.text': 'Text',
  'tool.number': 'Number',
  'color.red': 'Red',
  'color.orange': 'Orange',
  'color.blue': 'Blue',
  'color.green': 'Green',
  'color.black': 'Black',
  'status.capturing': 'Capturing…',
  'status.sending': 'Sending…',
  'status.inserted': 'Inserted into the conversation draft — add a note and send',
  'status.idle': 'Capture a page, draw annotations, then send to the model for OCR',
  'error.noUrl': 'Enter a URL in the address bar first',
  'error.capture': 'Screenshot failed: {message}',
  'error.noEngine': 'No capture engine: inside the DSH Desktop shell the built-in Chromium is used; elsewhere a Playwright Chromium is needed (set DSH_PAGE_ANNOTATE_CHROMIUM to a browser path), or use Upload image',
  'error.upload': 'Image upload failed: {message}',
  'error.send': 'Send failed: {message}',
  'embed.blocked': 'This site refuses to be embedded; Screenshot still captures it with a separate engine',
  'text.placeholder': 'Type annotation text and press Enter',
  'hint.text': 'Click the image to place a text annotation',
  'status.captured': 'Captured ({engine})',
}

export type PageAnnotateKey = keyof typeof zh

/** Active language mirror (synced from document.lang by the apply hook). */
let active: 'zh' | 'en' = 'zh'

/** Set the active dictionary language (callers mirror the shell locale). */
export function setLanguage(language: 'zh' | 'en'): void {
  active = language
}

/** Look up one key in the active dictionary. */
export function t(key: PageAnnotateKey): string {
  return active === 'zh' ? zh[key] : en[key]
}

/** Both dictionaries keyed by language (registered via ctx.locale.register). */
export const dictionaries: Record<'zh' | 'en', Record<keyof typeof zh, string>> = { zh, en }

/** Simple t() helper: `{message}` interpolation. */
export function format(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? values[key] : match))
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The page-annotate panel copy. */
    'page-annotate': PageAnnotateKey
  }
}
