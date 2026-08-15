# dsh-tool-describe-image — 图像理解工具插件

[English](README.md) | 中文

模型侧 `describe_image` 工具：为**纯文本模型**（DeepSeek V4 等）提供图像理解能力。
每次调用加载一张图片——本地文件路径、http(s) URL，或会话附件引用——交给
OpenAI 兼容的视觉模型端点（Qwen-VL、GLM-4V、GPT-4o、本地 Ollama 等）回答，
支持 Chat Completions 与 Responses 两种协议；**只有返回的文本进入对话，图片本身绝不进入会话记录**。

本包由 deepseek-harness `packages/vision/tool-describe-image` 移植（镜像仓库
[whitelonng/dsh-plugin-describe-image](https://github.com/whitelonng/dsh-plugin-describe-image)），
按 dsh-web-ui 全家桶规范适配：仅官方 NPM SDK、host 侧插件配浏览器半部、设置区实时配置，不修改 DSH 源码。

## 能力

| 能力 | 说明 |
| --- | --- |
| 三种输入 | 本地绝对路径、http(s) URL（拒绝重定向）、`[image attachment …]` JSON 附件引用，或拖拽/粘贴产生的短 markdown 引用（`![图片](/describe-image/raw/sha256:…)`——模型取 URL 中的 id 传入，进程内附件注册表解析，存储侧摘要校验照常执行） |
| 直接发图 | 在纯文本会话里拖拽或粘贴图片，发送时被改写为 describe-image 引用（`![图片](/describe-image/raw/sha256:…)`），而不是模型读不了的图片块——图片在会话里正常渲染，模型经工具分析它 |
| 自定义指令 | `prompt` 参数携带你的精确指令（OCR、图表解读、UI 诊断、翻译…）；`defaultPrompt` 配置设置模型未传指令时的兜底文案 |
| 实时配置卡 | 设置 → 插件配置 → Web UI 插件组 → 「图像理解」卡修改 `baseURL` / `apiStyle` / `model` / API key / 默认指令 / 各项上限（走设置服务），即时生效，无需重启 |
| 双协议 | `apiStyle: chat-completions`（默认）请求 `baseURL/chat/completions`；`apiStyle: responses` 请求 `baseURL/responses`，使用 `input` / `max_output_tokens` 并读取 `output_text` |
| 原图路由 | `GET /describe-image/raw/<id>` 回读已存字节（仅回环、内容寻址 id），让贴入的引用在会话中渲染 |
| 每次调用解析密钥 | 内联 `apiKey` → 凭证服务（`apiKeyEnv`，默认 `VISION_API_KEY`）→ 启动环境，逐级回退 |
| 安全与边界 | 所有请求拒绝重定向；`maxBytes` / `maxOutputTokens` / `timeoutMs` 上限；magic-byte 类型门；错误摘要有界（200 字符）；密钥不进日志 |
| 返回规范值 | `{ text, model, image, mimeType, bytes }`——模型只看到 `text` |

## 安全模型

- 视觉请求与图片下载均拒绝 HTTP 重定向（`redirect: 'error'`），bearer 凭证与图片字节
  不会转发到部署配置之外的源。
- 请求体携带 base64 图片但不携带密钥；不记录请求头与已解析凭证。
- 仅接受 `http(s)` URL 与本地路径，其余 URL 协议一律拒绝。
- attach 路由先校验 base64、magic bytes 与字节上限，再交给附件存储持久化；
  只有引用 JSON（文本）进入会话。
- 响应体先按上限（`maxOutputTokens * 8 + 64 KiB`）截断再解析。

## 安装

推荐直接安装全家桶聚合包 `@linxin666/dsh-web-ui-all`（一个包装齐全部功能插件与皮肤），或单独安装本插件：

```sh
# 推荐：直接从 npm 安装
dsh plugin --profile web add @linxin666/dsh-tool-describe-image
```

聚合包默认**无配置挂载**本插件：加载不受影响，首次调用会以清晰的错误提示
（`describe-image: baseURL must be an absolute http(s) URL`）告知尚未配置。
在「设置 → 插件配置 → Image understanding」卡填写端点与模型即可立即使用，无需重启。
（与上游差异：上游在加载时强校验；全家桶聚合挂载没有配置入口，故改为
「组合条目实际配置时才加载时校验、否则调用时校验」。）

## 配置

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `baseURL` | —（必填） | OpenAI 兼容端点根（如 `https://dashscope.aliyuncs.com/compatible-mode/v1`），末尾斜杠自动去除 |
| `apiStyle` | `chat-completions` | 接口协议：`chat-completions` 追加 `/chat/completions`；`responses` 追加 `/responses`（OpenAI Responses API 的 `input` / `max_output_tokens` / `output_text` 形态） |
| `model` | —（必填） | 视觉模型 id |
| `apiKey` | — | 内联密钥；本地调试用。建议用 `!!js process.env.VISION_API_KEY` 从环境注入，勿写死明文 |
| `apiKeyEnv` | `VISION_API_KEY` | 凭证引用（环境变量名）；空字符串禁用引用解析 |
| `defaultPrompt` | 见源码 | 调用未带 `prompt` 时的指令——按你的场景调优（OCR、UI 评审、翻译…） |
| `maxBytes` | `10485760` | 图片字节上限（本地文件与下载一致） |
| `maxOutputTokens` | `1024` | 输出 token 上限：`chat-completions` 发 `max_tokens`，`responses` 发 `max_output_tokens` |
| `timeoutMs` | `60000` | 单次视觉请求超时 |
| `renderImagePreview` | `true` | 会话里的图片引用原地升级为缩略图（点击查看大图）；`false` 保持原始引用文本。仅影响本地显示，消息文本与模型识别不变 |

带配置的挂载示例（profile 的 `cordis.patch.yml` / 组合文件）：

```yaml
- id: describe-image
  name: '@linxin666/dsh-tool-describe-image'
  config:
    baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1
    model: qwen-vl-max
    apiKey: !!js process.env.VISION_API_KEY
```

只开放 Responses API 的端点设置 `apiStyle: responses`：

```yaml
- id: describe-image
  name: '@linxin666/dsh-tool-describe-image'
  config:
    baseURL: https://api.openai.com/v1
    apiStyle: responses
    model: gpt-4o-mini
    apiKey: !!js process.env.VISION_API_KEY
```

## 使用

### 自定义指令

工具接受 `prompt` 参数：告诉视觉模型你具体要什么——「转录全部文字」、「把表格提取为 CSV」、
「诊断这个 UI 的布局问题」、「把文字翻译成中文」。针对性指令远胜泛泛描述；工具描述会引导
文本模型优先传指令。未传 `prompt` 的调用回退到 `defaultPrompt`。

### 从输入框发送图片

DSH 输入框对纯文本模型没有图片入口，因此在输入框里拖拽或粘贴图片：发送时插件会把携带图片的
发送改写为 describe-image 引用（`![图片](/describe-image/raw/sha256:…)`），而不是模型读不了的
图片块。图片字节经 host 端 `/describe-image/attach` 路由上传（校验大小与 magic bytes，持久化
到附件存储）；只有引用文本进入会话记录。Web shell 把用户消息渲染为纯文本，发送的引用本会
以原始 markdown 文本留在会话里；开启 `renderImagePreview`（设置卡的「会话内渲染图片预览」
开关，默认开）后客户端把每条引用原地升级为缩略图——点击查看大图。若 raw 路由经当前访问源
不可达（如反向代理未转发该路由），缩略图加载失败，引用文本保持原样。

## 已知限制

- 仅 magic-byte 门校验类型、不解码图片：头合法但内容损坏的文件会在视觉端点才报错。
- 单图单答：不支持多图输入、追问上一张图、结构化输出（坐标 / 框）。
- 抽取文本仍消耗一次 VLM 调用：仅需 OCR 的部署可把 `baseURL` 指向更便宜的 OCR 模型。
- 仅 OpenAI 兼容协议：支持 Chat Completions（`/chat/completions`）与 Responses（`/responses`）
  两种形态，请求 / 响应形态不同的厂商需要单独适配。

## 来源与版权

- **来源**：本包移植自 [whitelonng/dsh-plugin-describe-image](https://github.com/whitelonng/dsh-plugin-describe-image)
  （deepseek-harness `packages/vision/tool-describe-image`），2026-08 迁入，测试随源码一并移植
  （`pnpm --filter @linxin666/dsh-tool-describe-image test`）。
- **版权**：原代码版权归原作者（deepseek-ai / whitelonng）所有，本仓库仅托管与维护，不主张版权；
  贡献移植部分由贡献者授权以全家桶许可证发布。
- **许可证**：全家桶以 [Apache-2.0](../../LICENSE) 授权（见仓库根 LICENSE），本包 license 字段为 `Apache-2.0`。
