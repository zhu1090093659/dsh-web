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
  'field.baseURL.hint': '接口根地址；chat-completions 追加 /chat/completions，responses 追加 /responses，anthropic-messages 追加 /v1/messages。',
  'field.model': '模型',
  'field.model.hint': '该端点提供的视觉模型 id。',
  'field.apiStyle': '接口协议',
  'field.apiStyle.hint': 'chat-completions 走 /chat/completions，responses 走 /responses，anthropic-messages 走 /v1/messages（x-api-key 鉴权）。',
  'field.apiStyle.chatCompletions': 'Chat Completions',
  'field.apiStyle.responses': 'Responses',
  'field.apiStyle.anthropicMessages': 'Anthropic Messages',
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
  'field.interceptImageSend': '发送时改写图片为 describe-image 引用',
  'field.interceptImageSend.hint': '开（默认）：发往纯文本模型的带图发送在提交时被改写为 describe-image 引用；支持图片输入的模型会被自动识别，原图直接交给模型本身。关：发送原样放行，图片与附件块交给会话（与其他视觉插件共用时需要关闭）。',
  'probe.fetchModels': '获取模型',
  'probe.connectivity': '测试连通性',
  'probe.running': '测试中…',
  'probe.hint': '请求当前填写的接口地址与密钥（未保存也可测）：列出成功即端点可达且鉴权通过，返回的模型填充下拉选择。',
  'probe.testHint': '用当前模型发一次最小补全请求（max_tokens 1），测模型本身的往返延迟，消耗极少 token。',
  'probe.fetched': '已获取 {count} 个模型',
  'probe.success': '成功：{ms} ms',
  'probe.error': '失败：{error}',
  'preview.expand': '点击查看大图',
  'preview.close': '关闭大图',
  'native.title': '原生图片请求',
  'native.loading': '读取中…',
  'native.enable': '启用',
  'native.disable': '停用',
  'native.busy': '写入中…',
  'native.enabled': '当前默认模型「{model}」已启用原生图片输入；发送的图片直接交给模型，describe_image 会从该模型的工具集中隐藏。',
  'native.disabled': '当前默认模型「{model}」未启用原生图片输入；发送的图片会被改写为 describe-image 引用。',
  'native.unknownModel': '当前没有可用的默认模型选择。',
  'native.unsupported': '当前宿主未挂载 llm-deepseek 设置命名空间，无法在此配置。',
  'native.failed': '写入失败：{error}',
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
  'field.baseURL.hint': 'Endpoint root; /chat/completions, /responses, or /v1/messages is appended per the API style.',
  'field.model': 'Model',
  'field.model.hint': 'The vision model id this endpoint provides.',
  'field.apiStyle': 'API style',
  'field.apiStyle.hint': 'chat-completions posts to /chat/completions; responses posts to /responses; anthropic-messages posts to /v1/messages with x-api-key auth.',
  'field.apiStyle.chatCompletions': 'Chat Completions',
  'field.apiStyle.responses': 'Responses',
  'field.apiStyle.anthropicMessages': 'Anthropic Messages',
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
  'field.interceptImageSend': 'Rewrite image sends into describe-image references',
  'field.interceptImageSend.hint': 'On (default): image-bearing sends to text-only models are rewritten into describe-image references at submit; models that accept image input are detected automatically and receive the raw images natively. Off: sends pass through untouched, handing the raw image blocks to other vision plugins.',
  'probe.fetchModels': 'Fetch models',
  'probe.connectivity': 'Test connectivity',
  'probe.running': 'Testing…',
  'probe.hint': 'Requests the endpoint and key currently filled in (works before saving): a model listing proves the endpoint is reachable and the key authenticates, and fills the model dropdown.',
  'probe.testHint': 'Sends one minimal completion call (max_tokens 1) with the current model to measure that model\'s own round-trip latency; spends a single output token.',
  'probe.fetched': 'Fetched {count} models',
  'probe.success': 'OK: {ms} ms',
  'probe.error': 'Failed: {error}',
  'preview.expand': 'Click to view full size',
  'preview.close': 'Close full image',
  'native.title': 'Native image requests',
  'native.loading': 'Loading…',
  'native.enable': 'Enable',
  'native.disable': 'Disable',
  'native.busy': 'Saving…',
  'native.enabled': 'Native image input is enabled for the default model "{model}"; sent images reach the model directly and describe_image is hidden from its toolset.',
  'native.disabled': 'Native image input is disabled for the default model "{model}"; sent images are rewritten into describe-image references.',
  'native.unknownModel': 'No default model selection is available.',
  'native.unsupported': 'This host does not expose the llm-deepseek settings namespace; configuration is unavailable here.',
  'native.failed': 'Write failed: {error}',
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
