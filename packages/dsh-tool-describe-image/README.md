# dsh-tool-describe-image — 图像理解工具插件

模型侧 `describe_image` 工具：为**纯文本模型**（DeepSeek V4 等）提供图像理解能力。
每次调用加载一张图片——本地文件路径、http(s) URL，或会话附件引用——交给
OpenAI 兼容的视觉模型端点（Qwen-VL、GLM-4V、GPT-4o、本地 Ollama 等）描述；
**只有返回的文本进入对话，图片本身绝不进入会话记录**。

本包由 deepseek-harness `packages/vision/tool-describe-image` 移植（镜像仓库
[whitelonng/dsh-plugin-describe-image](https://github.com/whitelonng/dsh-plugin-describe-image)），
按 dsh-web-ui 全家桶规范适配：仅官方 NPM SDK、host 侧插件、设置区实时配置，不修改 DSH 源码。

## 能力

| 能力 | 说明 |
| --- | --- |
| 三种输入 | 本地绝对路径、http(s) URL（拒绝重定向）、`[image attachment …]` 附件引用（原样复制 JSON 即可，经附件服务读取） |
| 实时配置卡 | 设置 → 插件配置 → 「Image understanding」卡修改 `baseURL` / `model` / API key（走凭证服务），即时生效，无需重启 |
| 每次调用解析密钥 | 内联 `apiKey` → 凭证服务（`apiKeyEnv`，默认 `VISION_API_KEY`）→ 启动环境，逐级回退 |
| 安全与边界 | 所有请求拒绝重定向；`maxBytes` / `maxOutputTokens` / `timeoutMs` 上限；magic-byte 类型门；错误摘要有界（200 字符）；密钥不进日志 |
| 返回规范值 | `{ text, model, image, mimeType, bytes }`——模型只看到 `text` |

## 安全模型

- 视觉请求与图片下载均拒绝 HTTP 重定向（`redirect: 'error'`），bearer 凭证与图片字节
  不会转发到部署配置之外的源。
- 请求体携带 base64 图片但不携带密钥；不记录请求头与已解析凭证。
- 仅接受 `http(s)` URL 与本地路径，其余 URL 协议一律拒绝。
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
「有配置则加载时校验、无配置则调用时校验」。）

## 配置

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `baseURL` | —（必填） | OpenAI 兼容端点根（如 `https://dashscope.aliyuncs.com/compatible-mode/v1`），末尾斜杠自动去除 |
| `model` | —（必填） | 视觉模型 id |
| `apiKey` | — | 内联密钥；本地调试用。建议用 `!!js process.env.VISION_API_KEY` 从环境注入，勿写死明文 |
| `apiKeyEnv` | `VISION_API_KEY` | 凭证引用（环境变量名）；空字符串禁用引用解析 |
| `defaultPrompt` | 见源码 | 调用未带 `prompt` 时的指令 |
| `maxBytes` | `10485760` | 图片字节上限（本地文件与下载一致） |
| `maxOutputTokens` | `1024` | 发给端点的 `max_tokens` |
| `timeoutMs` | `60000` | 单次视觉请求超时 |

带配置的挂载示例（profile 的 `cordis.patch.yml` / 组合文件）：

```yaml
- id: describe-image
  name: '@linxin666/dsh-tool-describe-image'
  config:
    baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1
    model: qwen-vl-max
    apiKey: !!js process.env.VISION_API_KEY
```

## 已知限制

- 仅 magic-byte 门校验类型、不解码图片：头合法但内容损坏的文件会在视觉端点才报错。
- 单图单答：不支持多图输入、追问上一张图、结构化输出（坐标 / 框）。
- 抽取文本仍消耗一次 VLM 调用：仅需 OCR 的部署可把 `baseURL` 指向更便宜的 OCR 模型。
- 仅 OpenAI 兼容协议：请求 / 响应形态不同的厂商需要单独适配。

## 来源与版权

移植自 [whitelonng/dsh-plugin-describe-image](https://github.com/whitelonng/dsh-plugin-describe-image)
（deepseek-harness `packages/vision/tool-describe-image`），2026-08 迁入，全家桶许可 Apache-2.0。
测试随源码一并移植（`pnpm --filter @linxin666/dsh-tool-describe-image test`）。
