# dsh-provider-signin

给 dsh Web GUI 的「模型」设置页补上**订阅登录入口**的插件。

## 为什么需要它

dsh 的 llm-pi-ai 适配器为每个内置 provider 注册了完整的授权流（`ctx.authorization.registerFlow`）—— ChatGPT（ChatGPT Plus/Pro 订阅）、xAI（SuperGrok / X Premium 设备码）等等 —— 但 Models 设置页只有 API key 输入框：订阅类 provider 在 GUI 里没有可用的认证入口。上游的 slot 契约（`settings.models.provider-card`）正是为这种"不改核心页面"的扩展预留的席位。

## 功能

- 每个 llm-pi-ai provider 卡片上渲染该 provider 的 OAuth 登录方法（只渲染带 `oauth` 方法的流；API key 类 provider 留给核心编辑器）
- 登录过程的完整中继：通知（打开某页面、输入某代码）、提问（选择方式 / 输入代码 / 粘贴回调地址）、取消
- 状态行：该 provider 当前是 未登录 / 已登录（订阅授权）/ 已存 API key

## 架构

```
浏览器卡片 (settings.models.provider-card 槽位)
   │  同源 fetch, 轮询快照
   ▼
host 半 /api/provider-signin/*  (loopback 栅栏)
   │  ctx.authorization.begin({interaction}) 中继
   ▼
授权 seam (llm-pi-ai 注册的流) → ctx.credentials 写入凭据记录
```

- host 半只中继会话，不拥有协议；凭据仍由流自己（单一写者）提交
- 仅接受 `llm-pi-ai/` 作用域的 key
- 凭据内容永不离开 host：卡片只看到 configured/kind

## 安装

```sh
dsh plugin --profile <name> add link:<repo>/packages/dsh-provider-signin
```

## 开发

```sh
pnpm --filter @linxin666/dsh-provider-signin build
pnpm --filter @linxin666/dsh-provider-signin test
```
