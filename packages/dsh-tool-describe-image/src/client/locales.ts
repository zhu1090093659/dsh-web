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
  'card.title': '图像理解',
  'card.description': 'describe_image 工具所调用的视觉语言端点。',
  'settings.expand': '展开设置',
  'settings.collapse': '收起设置',
  'settings.notExposed': '当前部署未暴露此命名空间，无法在此编辑；请在挂载配置中填写端点。',
  'settings.unsaved': '有未保存的修改',
  'settings.readOnly': '当前部署的设置为只读。',
  'settings.saveFailed': '保存失败，请重试。',
  'settings.discard': '放弃修改',
  'settings.save': '保存',
  'settings.saving': '保存中…',
  'settings.overridden': '已覆盖',
  'settings.reset': '重置',
  'settings.inherit': '继承',
  'settings.on': '开',
  'settings.off': '关',
  'settings.invalidNumber': '需要有效的数字',
  'field.baseURL': '接口地址',
  'field.baseURL.hint': 'OpenAI 兼容根地址；按协议追加 /chat/completions 或 /responses。',
  'field.model': '模型',
  'field.model.hint': '该端点提供的视觉模型 id。',
  'field.apiStyle': '接口协议',
  'field.apiStyle.hint': 'chat-completions 走 /chat/completions，responses 走 /responses。',
  'field.apiStyle.chatCompletions': 'Chat Completions',
  'field.apiStyle.responses': 'Responses',
  'field.apiKey': 'API Key',
  'field.apiKey.hint': '不写入设置文件。留空表示保持当前密钥。',
  'field.apiKeyEnv': '密钥环境变量',
  'field.apiKeyEnv.hint': '凭证服务解析该环境变量名；空字符串禁用。',
  'field.defaultPrompt': '默认指令',
  'field.defaultPrompt.hint': '调用未带 prompt 参数时的默认指令。',
  'field.maxBytes': '图片字节上限',
  'field.maxBytes.hint': '本地文件与下载一致的字节上限。',
  'field.maxOutputTokens': '输出 token 上限',
  'field.maxOutputTokens.hint': '发给端点的 max_tokens（responses 协议为 max_output_tokens）。',
  'field.timeoutMs': '超时（毫秒）',
  'field.timeoutMs.hint': '单次视觉请求超时。',
  'field.renderImagePreview': '会话内渲染图片预览',
  'field.renderImagePreview.hint': '开：会话里的图片引用原地显示为缩略图，点击查看大图；关：保持原始引用文本。仅影响本地显示，消息文本与模型识别不变。',
  'preview.expand': '点击查看大图',
  'preview.close': '关闭大图',
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
  'card.title': 'Image understanding',
  'card.description': 'The vision-language endpoint the describe_image tool calls.',
  'settings.expand': 'Expand settings',
  'settings.collapse': 'Collapse settings',
  'settings.notExposed': 'This deployment does not expose the namespace; configure the endpoint in the mount config instead.',
  'settings.unsaved': 'Unsaved changes',
  'settings.readOnly': 'Settings are read-only in this deployment.',
  'settings.saveFailed': 'Save failed; try again.',
  'settings.discard': 'Discard',
  'settings.save': 'Save',
  'settings.saving': 'Saving…',
  'settings.overridden': 'Overridden',
  'settings.reset': 'Reset',
  'settings.inherit': 'Inherit',
  'settings.on': 'On',
  'settings.off': 'Off',
  'settings.invalidNumber': 'A valid number is required',
  'field.baseURL': 'Base URL',
  'field.baseURL.hint': 'OpenAI-compatible root URL; /chat/completions or /responses is appended per the API style.',
  'field.model': 'Model',
  'field.model.hint': 'The vision model id this endpoint provides.',
  'field.apiStyle': 'API style',
  'field.apiStyle.hint': 'chat-completions posts to /chat/completions; responses posts to /responses.',
  'field.apiStyle.chatCompletions': 'Chat Completions',
  'field.apiStyle.responses': 'Responses',
  'field.apiKey': 'API key',
  'field.apiKey.hint': 'Never written to the settings file. Leave empty to keep the current key.',
  'field.apiKeyEnv': 'Key environment variable',
  'field.apiKeyEnv.hint': 'Resolved through the credential service; empty disables it.',
  'field.defaultPrompt': 'Default instruction',
  'field.defaultPrompt.hint': 'Used when a call omits its prompt parameter.',
  'field.maxBytes': 'Max image bytes',
  'field.maxBytes.hint': 'Byte bound for local files and downloads alike.',
  'field.maxOutputTokens': 'Max output tokens',
  'field.maxOutputTokens.hint': 'The max_tokens sent to the endpoint (max_output_tokens under the responses style).',
  'field.timeoutMs': 'Timeout (ms)',
  'field.timeoutMs.hint': 'Per-call vision request timeout.',
  'field.renderImagePreview': 'Render image preview in chat',
  'field.renderImagePreview.hint': 'On: image references in the conversation upgrade into inline thumbnails (click for full size). Off: the raw reference text stays. Display-only — the message text and model-side analysis are unchanged.',
  'preview.expand': 'Click to view full size',
  'preview.close': 'Close full image',
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
