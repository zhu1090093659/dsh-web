# dsh-tool-describe-image — 图像理解工具插件

[English](README.md) | 中文

模型侧 `describe_image` 工具：为**纯文本模型**（DeepSeek V4 等）提供图像理解能力。
每次调用加载一张图片——本地文件路径、http(s) URL，或会话附件引用——交给
视觉模型端点（Qwen-VL、GLM-4V、GPT-4o、Claude 风格端点如 OpenCode Go、本地 Ollama 等）回答，
支持 Chat Completions / Responses / Anthropic Messages 三种协议；**只有返回的文本进入对话，图片本身绝不进入会话记录**。

本包由 deepseek-harness `packages/vision/tool-describe-image` 移植（镜像仓库
[whitelonng/dsh-plugin-describe-image](https://github.com/whitelonng/dsh-plugin-describe-image)），
按 dsh-web-ui 全家桶规范适配：仅官方 NPM SDK、host 侧插件配浏览器半部、设置区实时配置，不修改 DSH 源码。

## 能力

| 能力 | 说明 |
| --- | --- |
| 三种输入 | 本地绝对路径、http(s) URL（拒绝重定向）、完整的 `[image attachment ...]` 注记，或拖拽/粘贴产生的完整自描述 Markdown 引用（`![图片](/describe-image/raw/sha256:...?ref=...)`）。把完整 Markdown 引用直接传给工具：其中序列化的不可变元数据可在 Host 重启后及 PTC 嵌套工具调用中解析已存图片；裸 id 只作为当前进程的兼容兜底 |
| 直接发图 | 在纯文本会话里拖拽或粘贴图片，发送时被改写为自描述 describe-image 引用（`![图片](/describe-image/raw/sha256:...?ref=...)`），而不是模型读不了的图片块——图片在会话里正常渲染，模型经工具分析它。支持图片输入的模型（适配器声明 image 模态）会被自动识别：原图块直接交给模型本身的视觉，不再绕行 describe_image，且该会话的 `describe_image` 工具会被隐藏——多模态模型看不到、也无法调用它（包括 run_code 内的嵌套调用） |
| 自定义指令 | `prompt` 参数携带你的精确指令（OCR、图表解读、UI 诊断、翻译…）；`defaultPrompt` 配置设置模型未传指令时的兜底文案 |
| 实时配置卡 | 设置 → 插件配置 → Web UI 插件组 → 「图像理解」卡修改 `baseURL` / `apiStyle` / `model` / API key / 默认指令 / 各项上限（走设置服务），即时生效，无需重启 |
| 连通测试与模型获取 | 模型字段带「获取模型」控件，模型字段有值时再出现「测试连通性」控件，两者未保存也可用。获取把草稿提交到 `POST /describe-image/models`，Host 侧按密钥解析链解析凭证、只回模型 id 列表；列出成功即端点可达且鉴权通过，模型字段随之切换为已获取模型的下拉选择。测试连通性用所选模型发一次最小补全（`max_tokens` 1），回报模型本身的往返延迟 |
| 多协议 | `apiStyle: chat-completions`（默认）请求 `baseURL/chat/completions` 并读取 `message.content`，content 为空时回退 `reasoning_content`（推理模型如 Kimi K2.x 可能把全部输出预算花在思维链上——issue #637；调大 `maxOutputTokens` 或用 `model:off` 可避免）；`apiStyle: responses` 请求 `baseURL/responses`，使用 `input` / `max_output_tokens` 并读取 `output_text`，兼容只返回 SSE 流式响应的端点（自动解析 `text/event-stream`）；`apiStyle: anthropic-messages` 请求 `baseURL/v1/messages`（`x-api-key` 鉴权，Claude 风格端点如 OpenCode Go / 智谱 GLM / 月之暗面 Kimi），读取 `content[].text` |
| 思考控制 | 模型 id 带可选后缀：`model:off` 禁用思考，`model:low` / `model:medium` / `model:high` 开启思考；不带后缀则不发送控制、沿用端点默认（MiMo-V2.5、DeepSeek V4 默认开启思考） |
| 原图路由 | `GET /describe-image/raw/<id>` 回读已存字节（仅回环、内容寻址 id），让贴入的引用在会话中渲染 |
| 能力探测路由 | `GET /describe-image/capability?session=<id>` 回答该会话模型是否声明图片输入（以会话自身的请求头路由确认生效模型——恢复的会话沿用其日志模型、无请求历史的新会话取当前默认模型选择；模态经 `resolveModelInfo` 精确解析）。无路由可解析、一切未知与失败都保守回答 false，保留改写行为 |
| 原生图片开关 | rc.8：设置卡的「原生图片请求」区报告当前默认模型的图片输入状态，并经回环路由 `GET` / `POST /describe-image/native-images` 切换 DeepSeek 适配器模型目录条目（`llm-deepseek` 设置命名空间里的 `inputModalities`）。启用：发送的图片原生交给模型、`describe_image` 从该模型的工具集中隐藏；停用：沿用改写路径。未挂载适配器命名空间的宿主显示不支持提示 |
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
- 模型探测的密钥留在 Host：浏览器侧只提交连接字段草稿、只接收模型 id 列表
  或延迟数字；获取只做一次 `GET` 模型列举，连通性测试只发一次 `max_tokens` 1
  的最小补全，消耗一个输出 token。
- 模型探测路由仅接受回环同源请求（共享 `host/loopback` 围栏，与 dsh-ssh 同款）：
  跨站页面无法把已存密钥引向攻击者控制的 URL。
- 原生图片开关路由同受回环同源围栏：只经宿主设置服务写入官方 `llm-deepseek`
  模型目录（revision 栅栏、适配器 schema 校验），绝不接触凭证。

## 安装

推荐直接安装全家桶聚合包 `@linxin666/dsh-web-ui-all`（一个包装齐全部功能插件与皮肤），或单独安装本插件：

```sh
# 推荐：直接从 npm 安装
dsh plugin --profile web add @linxin666/dsh-tool-describe-image@latest
```

聚合包默认**无配置挂载**本插件：加载不受影响，首次调用会以清晰的错误提示
（`describe-image: baseURL must be an absolute http(s) URL`）告知尚未配置。
在「设置 → 插件配置 → Image understanding」卡填写端点与模型即可立即使用，无需重启。
（与上游差异：上游在加载时强校验；全家桶聚合挂载没有配置入口，故改为
「组合条目实际配置时才加载时校验、否则调用时校验」。）

## 配置

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `baseURL` | —（必填） | 端点根地址，按协议追加路径（`/chat/completions`、`/responses` 或 `/v1/messages`）。OpenAI 兼容端点如 `https://dashscope.aliyuncs.com/compatible-mode/v1`；Anthropic 风格可填写 provider 根地址（如 `https://opencode.ai/zen/go`）、常规 `/v1` API 根地址或完整 `/v1/messages` 端点。末尾斜杠自动去除 |
| `apiStyle` | `chat-completions` | 接口协议：`chat-completions` 追加 `/chat/completions`；`responses` 追加 `/responses`（OpenAI Responses API 的 `input` / `max_output_tokens` / `output_text` 形态；兼容只返回 SSE 流式响应的端点，自动解析 `text/event-stream`）；`anthropic-messages` 将地址规范化为唯一的 `/v1/messages` 端点（Claude 风格 `messages` / `max_tokens` / `content[].text`，`x-api-key` + `anthropic-version` 头） |
| `model` | —（必填） | 视觉模型 id，可带思考后缀（`:off` / `:low` / `:medium` / `:high`）。后缀在发往端点前剥除：`:off` 映射为 `thinking.type=disabled`（`chat-completions`）或 `reasoning.effort=none`（`responses`）；其余档位映射为 `enabled`，或原样作为 `reasoning.effort` 的值。不带后缀则不发送任何思考控制字段；`anthropic-messages` 协议不发送思考字段，保持端点自身默认 |
| `apiKey` | — | 内联密钥；本地调试用。建议用 `!!js process.env.VISION_API_KEY` 从环境注入，勿写死明文 |
| `apiKeyEnv` | `VISION_API_KEY` | 凭证引用（环境变量名）；空字符串禁用引用解析 |
| `defaultPrompt` | 见源码 | 调用未带 `prompt` 时的指令——按你的场景调优（OCR、UI 评审、翻译…） |
| `maxBytes` | `10485760` | 图片字节上限（本地文件与下载一致） |
| `maxOutputTokens` | `1024` | 输出 token 上限：`chat-completions` 与 `anthropic-messages` 发 `max_tokens`，`responses` 发 `max_output_tokens` |
| `timeoutMs` | `120000` | 单次视觉请求超时 |
| `renderImagePreview` | `true` | 会话里的图片引用原地升级为缩略图（点击查看大图）；`false` 保持原始引用文本。仅影响本地显示，消息文本与模型识别不变 |
| `interceptImageSend` | `true` | 发送时把带图片的发送改写为 describe-image 引用；`false` 则图片发送原样放行，让同会话的其他视觉插件拿到原始图片块（此时文本模型的改写由它们负责） |

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

模型默认开启扩展思考的端点（MiMo-V2.5、DeepSeek V4）可按调用关闭思考，避免思考 token 消耗输出预算：

```yaml
- id: describe-image
  name: '@linxin666/dsh-tool-describe-image'
  config:
    baseURL: https://api.xiaomimimo.com/v1
    model: mimo-v2.5:off
    apiKey: !!js process.env.VISION_API_KEY
```

Claude 风格端点（如 OpenCode Go——Qwen3.7 Plus 等视觉模型只走 Messages API）设置
`apiStyle: anthropic-messages`；`baseURL` 最简单的写法是 provider 根地址：

```yaml
- id: describe-image
  name: '@linxin666/dsh-tool-describe-image'
  config:
    baseURL: https://opencode.ai/zen/go
    apiStyle: anthropic-messages
    model: qwen3.7-plus
    apiKey: !!js process.env.OPENCODE_GO_API_KEY
```

provider 路径会被保留：上述示例最终请求 `https://opencode.ai/zen/go/v1/messages`。

## 使用

### 自定义指令

工具接受 `prompt` 参数：告诉视觉模型你具体要什么——「转录全部文字」、「把表格提取为 CSV」、
「诊断这个 UI 的布局问题」、「把文字翻译成中文」。针对性指令远胜泛泛描述；工具描述会引导
文本模型优先传指令。未传 `prompt` 的调用回退到 `defaultPrompt`。

### 从输入框发送图片

DSH 输入框对纯文本模型没有图片入口，因此在输入框里拖拽或粘贴图片：发送时插件会把携带图片的
发送改写为自描述 describe-image 引用（`![图片](/describe-image/raw/sha256:...?ref=...)`），而不是模型读不了的
图片块。图片字节经 host 端 `/describe-image/attach` 路由上传（校验大小与 magic bytes，持久化
到附件存储）；只有可持久解析的引用文本进入会话记录。Host 重启后或 PTC 嵌套工具调用中，都可将完整
引用原样传给 `describe_image`。Web shell 把用户消息渲染为纯文本，发送的引用本会以原始 markdown
文本留在会话里；开启 `renderImagePreview`（设置卡的「会话内渲染图片预览」开关，默认开）后客户端
把每条引用原地升级为缩略图——点击查看大图。若 raw 路由经当前访问源不可达（如反向代理未转发该
路由），缩略图加载失败，引用文本保持原样。

改写是一个实时开关——设置卡的「发送时改写图片为 describe-image 引用」(`interceptImageSend`，
默认开)。当其他视觉插件与当前会话共用、需要由它们接收原始图片块时请关闭；关闭后图片发送
原样放行。

### 原生图片请求（rc.8）

DeepSeek chat-completions 适配器（rc.8）在模型目录条目的 `inputModalities` 包含 `image` 时
把图片块原生发给模型，而官方模型设置界面未暴露该字段。设置卡的「原生图片请求」区补齐这个入口：
它显示当前默认模型的图片输入判定，并提供开关经官方设置服务改写 `llm-deepseek` 设置命名空间
（schema 校验、revision 栅栏与持久化仍由宿主负责）。启用后，默认模型原生接收发送的图片，
`describe_image` 从该模型的工具集中隐藏；停用则沿用 describe-image 改写路径。两条路由仅限回环
访问，同源围栏与附件路由一致；浏览器永远接触不到凭证。

## 已知限制

- 仅 magic-byte 门校验类型、不解码图片：头合法但内容损坏的文件会在视觉端点才报错。
- 单图单答：不支持多图输入、追问上一张图、结构化输出（坐标 / 框）。
- 抽取文本仍消耗一次 VLM 调用：仅需 OCR 的部署可把 `baseURL` 指向更便宜的 OCR 模型。
- 支持三种协议：Chat Completions（`/chat/completions`）、Responses（`/responses`）、
  Anthropic Messages（`/v1/messages`，`x-api-key` 鉴权）。Responses 协议额外兼容只返回
  SSE 流式响应的端点（`text/event-stream`，如 codex-lb 风格中继）；其他请求/响应形态的
  厂商需要单独的适配器。
- 模型思考后缀是插件简写，会向请求注入厂商专用字段（`thinking.type` / `reasoning.effort`）；
  不接受这些字段的端点（如普通 OpenAI 视觉模型）应使用不带后缀的模型 id。chat-completions
  协议没有 effort 档位，`:low` / `:medium` / `:high` 在该协议下都映射为 `thinking.type=enabled`。
  只剥除这四个已知后缀，以其他冒号变体结尾的 id（如 OpenRouter 的 `:free`）原样发送。

## 来源与版权

- **来源**：本包移植自 [whitelonng/dsh-plugin-describe-image](https://github.com/whitelonng/dsh-plugin-describe-image)
  （deepseek-harness `packages/vision/tool-describe-image`），2026-08 迁入，测试随源码一并移植
  （`pnpm --filter @linxin666/dsh-tool-describe-image test`）。
- **版权**：原代码版权归原作者（deepseek-ai / whitelonng）所有，本仓库仅托管与维护，不主张版权；
  贡献移植部分由贡献者授权以全家桶许可证发布。
- **许可证**：全家桶以 [Apache-2.0](../../LICENSE) 授权（见仓库根 LICENSE），本包 license 字段为 `Apache-2.0`。
