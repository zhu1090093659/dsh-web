# dsh-mermaid 插件任务交接与验证快照（2026-08-16）

一次性记录，不入长期文档。功能：新插件包 `packages/dsh-mermaid`
（`@linxin666/dsh-client-ui-mermaid`），把助手消息中的 mermaid 围栏渲染为 SVG 图表。

## 背景问题（用户报障）

`dsh web` 启动失败：profile 里聚合包 `dsh-web-ui-all` 的 `workspace:*` 子包全部
`ERR_MODULE_NOT_FOUND`。原因：`~/.dsh/profiles/node_modules/@linxin666` 链接层
缺失 + 仓库 `dist/lib` 未构建。修复：`pnpm -r build` + `node scripts/link-profile.mjs`
（24 包 junction）。此为环境修复，非代码提交内容。

## 实现要点

- SDK 无围栏渲染槽位，走 DOM 增强：`src/client/enhancer.ts` 观察
  `div.md-code-block`（banner infostring = `mermaid`），figure 作为额外尾子节点，
  源码用 data 属性隐藏，dispose 完整还原；任何一步失败降级不增强、不抛错。
- mermaid ^11 打包进 client 产物；mermaid 懒加载图型模块的动态 import 会被
  rolldown 拆成 sibling chunk（loader 单文件产物不服务），
  `shared/tsdown.client.ts` 新增 `client` 覆盖口（outputOptions 浅合并），
  dsh-mermaid 传 `inlineDynamicImports: true`，得到单文件 `lib/client.js`（约 7 MB）。
- 主题表在 `src/core/themes.ts`（两侧共享）；client 严禁 import host 半区
  `src/index.ts`（会拖入 dsh-settings 值导入，违反浏览器 bundle 纯度门）。
- 设置：host 半区注册 `mermaid` 命名空间（enabled + theme），browser 半区
  `web-ui.plugin.item` 设置卡 + scope 订阅驱动增强器启停与主题重渲染。

## 验证快照

- 单测：`pnpm --filter @linxin666/dsh-client-ui-mermaid test` 15/15 通过
  （enhancer DOM 行为：发现/渲染/失败/流式重渲染/开关还原；schema/主题归一/词典配对）。
  注意 jsdom 的 `querySelector(':scope>…')` 返回 null，测试用普通后代选择器。
- 门禁：typecheck 0 错、test:scripts、aggregate/gallery/skin-center/community/
  docs/sync-shared/runtime-deps 全绿。
- 真机（Windows，`dsh web` @127.0.0.1:3080 + 系统 Chrome headless playwright）：
  - boot manifest 含 `@linxin666/dsh-client-ui-mermaid/client.js`，bundle 200（约 7 MB 闭包工厂）；
  - 注入合法 mermaid 围栏 → 真实 SVG（81 节点，`font-family:inherit` 来自本插件配置），
    源码隐藏、按钮「查看源码」、样式表注入、页面零报错；
  - 注入 `sequenceDiagram` → 渲染成功；注入非法源码 → 中文错误条
    「Mermaid 渲染失败：No diagram type detected…」且源码保持可见；
  - 截图：`gui-test-screenshots/mermaid-verify.png` / `mermaid-verify-2.png`（不入库）。

## 遗留与注意

- 预存在（与本次无关）：`packages/dsh-pet` 的 `registry.test.ts` 在 Windows 失败
  （`codexPetsDir` 路径 join 用了 `\`，期望 `/`）；CI（Linux）不受影响。
- Windows 工作树的 `lib/*.js.map` 差异全部是 sourcesContent 吸收 CRLF 的环境噪声
  （Linux 重建即一致），提交时排除这些 map。
- gallery/skin-center/aggregate 生成物在 Windows 上需重建后再生成本地才能过 check
  （CRLF 盘上文件 vs LF 生成物）。
