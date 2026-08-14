/** `describe-image` client namespace dictionaries (composer attach button copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'attach.button.title': '插入图片引用（describe-image 图像理解）',
  'attach.button.aria': '插入图片引用，交给 describe_image 工具分析',
  'attach.uploading': '上传中…',
  'attach.success': '图片引用已插入输入框；发送后文本模型可通过 describe_image 分析这张图片。',
  'attach.error.read': '无法读取所选图片文件。',
  'attach.error.type': '不支持的图片类型，仅接受 PNG / JPEG / GIF / WebP。',
  'attach.error.size': '图片超过 10 MB 上限。',
  'attach.error.noSession': '当前没有可用会话，无法插入图片引用。',
  'attach.error.upload': '上传失败：{error}',
} satisfies Record<string, string>

/** The describe-image client namespace key union. */
export type DescribeImageClientKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'attach.button.title': 'Insert image reference (describe-image vision)',
  'attach.button.aria': 'Insert an image reference for the describe_image tool',
  'attach.uploading': 'Uploading…',
  'attach.success': 'Image reference inserted; the text model can analyze this image via describe_image once you send the message.',
  'attach.error.read': 'Could not read the selected image file.',
  'attach.error.type': 'Unsupported image type; only PNG / JPEG / GIF / WebP are accepted.',
  'attach.error.size': 'The image exceeds the 10 MB bound.',
  'attach.error.noSession': 'No active session; cannot insert an image reference.',
  'attach.error.upload': 'Upload failed: {error}',
} satisfies Record<string, string>

/** The two dictionaries, keyed by language. */
export const dictionaries: Record<string, Record<DescribeImageClientKey, string>> = { zh, en }

/** Current UI language, mirrored from the shell (defaults to zh). */
let currentLanguage: string = 'zh'

/** Switch the client copy language. */
export function setLanguage(language: string): void {
  currentLanguage = language
}

/** Format a `{name}` template with values. */
function format(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{([a-zA-Z0-9]+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match)
}

/** Translate one key; falls back to the zh dictionary for unknown keys. */
export function t(key: DescribeImageClientKey, params?: Record<string, string | number>): string {
  const table = dictionaries[currentLanguage] ?? zh
  const template = table[key] ?? zh[key]
  return params === undefined ? template : format(template, params)
}
