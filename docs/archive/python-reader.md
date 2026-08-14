# Python 代码阅读器（dsh-aionui-panel 预览面板增强）

> 本文件汇总了对 `packages/dsh-aionui-panel` 的增强改动：把右侧预览面板的「代码」标签页从纯文本 `<pre>` 升级为 VS Code 级别的 Python 代码阅读体验。整体定位是**静态只读分析**——高亮、检查、大纲、引用、格式化、PDF 阅读，**不执行用户代码**。

---

## 一、功能清单

| 功能 | 说明 | 所在侧 |
| --- | --- | --- |
| 语法高亮 / 折叠 / 查找 / 行号 / 括号匹配 | CodeMirror 6 编辑器，所有代码/文本文件通用 | 客户端 |
| ruff 代码检查波浪线 | 宿主跑 `ruff check`（JSON），红色=错误、黄色=警告、蓝色=信息；悬停看消息，大纲里可点问题跳转 | 宿主 + 客户端 |
| AST 大纲 / 引用标注 | 宿主跑标准库 AST 解析，列出函数/类/方法；右侧「大纲」抽屉、行尾「N 处引用」标注、悬停 docstring、Ctrl/Command+点击跳定义 | 宿主 + 客户端 |
| 缩进参考线 | 按实际缩进层级、只画在够深度的行上（对齐 VS Code `editor.guides.indentation`） | 客户端 |
| 彩虹括号 | 按嵌套深度 3 色循环着色（对齐 Dark+ 的 gold/magenta/blue），跳过字符串与注释内的括号 | 客户端 |
| 格式化 | `ruff format --check --diff` 预览差异，确认后 `ruff format` 写盘并重读 | 宿主 + 客户端 |
| 轻量 PDF 阅读器 | 复用 `/aionui-panel/raw` 路由 + 浏览器原生 PDF 查看器，无 PDF.js 依赖 | 宿主 + 客户端 |
| 字体与 Dark+ 配色 | 深色主题下编辑器 chrome 对齐 VS Code Dark+（背景/前景/选区/行号/波浪线/括号/参考线等），字体 Consolas 14px | 客户端 |

---

## 二、架构

### 宿主端（Node 进程，`src/host/`）

- 新增 `py-service.ts`：`PyService` 提供三个只读/受控操作，全部经 `ctx.subprocess`（argv 数组、无 shell、输出封顶、10s 宽限）执行，过 workspace gate 与路径守卫：
  - `lint(root, rel)`：`ruff check --output-format json --no-fix <file>` → 0-based 诊断数组；
  - `symbols(root, rel)`：`python -X utf8 -c <AST脚本> <file>` → `{ defs, refs }`；
  - `format(root, rel, apply)`：`ruff format --check --diff <file>`（预览）/ `ruff format <file>`（应用）。
- `routes.ts` 新增 `/aionui-panel/py-lint`、`/aionui-panel/py-symbols`、`/aionui-panel/py-format` 三条 POST 路由。
- `index.ts` 装配 `PyService` 并传入 `registerPanelRoutes`。
- `fs-service.ts`：导出 `resolveInsideRoot`（供 PyService 复用路径守卫）；`.pdf` 走 `read()` 专属分支（只 `stat` 元数据、不把字节读进 JSON）；`imageMime` 增加 `pdf: application/pdf`。

### 客户端（`src/client/`）

- 新增 `preview/codeViewer.tsx`：CodeMirror 6 阅读器（只读），挂载语言高亮、折叠、查找、lint 槽、悬停提示、Ctrl+点击跳定义、大纲抽屉。
- 新增 `preview/indentGuides.ts`：逐行缩进参考线 ViewPlugin。
- 新增 `preview/rainbowBrackets.ts`：彩虹括号 ViewPlugin（走 lezer 语法树跳过字符串/注释）。
- `content.tsx`：代码/文本标签改用 `CodeViewer`；`PdfViewer` 改为 raw 路由 iframe。
- `PreviewPanel.tsx` / `PreviewToolbar.tsx`：接「格式化」按钮与差异确认弹窗（`ConfirmDialog` 增加 `bodyPre` 支持）。
- `store.ts`：`PanelStores` 暴露共享 `api` 实例。
- 样式：`preview.module.css`（阅读器/参考线/括号/Dark+ chrome）、`tokens.module.css`（括号配色变量、宽弹窗样式）。
- 文案：`locales.ts` 增加 `preview.code.*` 键（中英）。

---

## 三、依赖变更

### npm（`packages/dsh-aionui-panel/package.json` 新增 dependencies）

```
codemirror                        ^6.0.2
@codemirror/state                 ^6.5.2
@codemirror/view                  ^6.38.0
@codemirror/language              ^6.11.0
@codemirror/lint                  ^6.8.5
@codemirror/search                ^6.5.10
@codemirror/theme-one-dark        ^6.1.3
@codemirror/lang-python           ^6.2.1
@codemirror/lang-javascript       ^6.2.5
@codemirror/lang-json             ^6.0.2
@codemirror/lang-markdown         ^6.5.2
@codemirror/lang-css              ^6.3.1
@codemirror/lang-html             ^6.4.12
```

> 客户端 bundle 因此从约 190 KB 增至约 1.4 MB（内联了 CodeMirror 与各语言语法）。它们不是 `@deepseek-ai/*` 平台模块，按构建预设规则被 `noExternal` 内联进 `lib/client.js`。

### 宿主工具链（运行时依赖，非 npm）

- `ruff`（已验证 0.12.x），提供 lint + format。
- `python`（Windows 下 `python`，其他平台 `python3`），提供 AST 符号解析。

两者都可通过环境变量覆盖：`AIONUI_PANEL_RUFF`、`AIONUI_PANEL_PYTHON`。缺工具时对应功能降级为「不可用」提示，不影响面板其余部分。

---

## 四、文件清单

### 新增文件

| 文件 | 作用 |
| --- | --- |
| `packages/dsh-aionui-panel/src/host/py-service.ts` | 宿主 python 分析服务（lint/symbols/format + 内嵌 AST 脚本 + ruff JSON 解析） |
| `packages/dsh-aionui-panel/src/client/preview/codeViewer.tsx` | CodeMirror 阅读器组件 |
| `packages/dsh-aionui-panel/src/client/preview/indentGuides.ts` | 缩进参考线 ViewPlugin |
| `packages/dsh-aionui-panel/src/client/preview/rainbowBrackets.ts` | 彩虹括号 ViewPlugin |
| `packages/dsh-aionui-panel/tests/py-service.spec.ts` | `ruffSeverity` / `parseRuffJson` / `parseSymbolsJson` 单测 |
| `scripts/deploy-local.ps1` | 本地部署脚本（把构建产物复制进 web profile，含备份） |

### 修改文件

| 文件 | 改动 |
| --- | --- |
| `packages/dsh-aionui-panel/package.json` | 新增 CodeMirror 依赖 |
| `packages/dsh-aionui-panel/src/index.ts` | 装配 `PyService` 并传入路由 |
| `packages/dsh-aionui-panel/src/core/types.ts` | 新增 `PyDiagnostic`/`PyLintView`/`PySymbol`/`PyRef`/`PySymbolView`/`PyFormatResult`、`PyLintSeverity`/`PySymbolKind`、错误码 `tool-unavailable`/`tool-failed` |
| `packages/dsh-aionui-panel/src/host/fs-service.ts` | 导出 `resolveInsideRoot`；PDF 只读元数据 + `application/pdf` mime |
| `packages/dsh-aionui-panel/src/host/routes.ts` | 新增 3 条路由；`registerPanelRoutes` 增加 `py` 参数 |
| `packages/dsh-aionui-panel/src/client/api.ts` | 新增 `pyLint`/`pySymbols`/`pyFormat` |
| `packages/dsh-aionui-panel/src/client/store.ts` | `PanelStores` 增加共享 `api` 字段 |
| `packages/dsh-aionui-panel/src/client/components/overlay.tsx` | `ConfirmDialog` 增加 `bodyPre`（等宽差异/输出展示） |
| `packages/dsh-aionui-panel/src/client/preview/content.tsx` | `CodeViewer` 接入；`PdfViewer` 改 raw 路由 |
| `packages/dsh-aionui-panel/src/client/preview/PreviewPanel.tsx` | 格式化状态/处理/弹窗接线 |
| `packages/dsh-aionui-panel/src/client/preview/PreviewToolbar.tsx` | 新增「格式化」按钮 |
| `packages/dsh-aionui-panel/src/client/locales.ts` | 新增 `preview.code.*` 中英文案 |
| `packages/dsh-aionui-panel/src/client/styles/preview.module.css` | 阅读器 / 参考线 / 彩虹括号 / Dark+ chrome 样式 |
| `packages/dsh-aionui-panel/src/client/styles/tokens.module.css` | 括号配色变量、`aionui-dialog-wide`/`-pre` 样式 |
| `.gitignore` | 增加 `lib/`、`deploy/`（本地构建产物与部署备份） |

---

## 五、关键实现细节（供审阅）

1. **字体必须写在 `.cm-scroller` 上，不能写在 `.cm-editor` 上。** CodeMirror 基础主题给 `.cm-scroller` 直接设了 `font-family: monospace`；直接声明会覆盖父级继承值，所以只改 `.cm-editor` 无效。

2. **lint 波浪线改色**：CodeMirror 的 `.cm-lintRange-error/warning/info/hint` 用内联 SVG 数据 URL 画波浪线（颜色烧死在 SVG 里）。改为 `background-image: none` + `text-decoration: underline wavy <color>` 覆盖，深色下对齐 Dark+ 的 `#F14C4C / #CCA700 / #59A4F9`。

3. **缩进参考线逐行绘制**：每个可见行按前导空格算深度（空格 + 制表符感知，`floor(cols / indentUnit)`），深度 N 的行注入 N 条零宽 widget 竖线；空白行/浅行不画。用 `ch` 单位对齐等宽字体。VS Code 的 `activeIndentGuide`（活跃作用域加深）未实现，见限制。

4. **彩虹括号**：3 色循环（Dark+ gold/magenta/blue），开括号着色后 `depth++`、闭括号 `depth--` 后着色，保证配对同色；通过 `syntaxTree` 收集字符串/注释/正则区间并跳过，避免误着色 `f"..."` 或注释里的括号。

5. **AST 符号解析**：内嵌一段标准库脚本（`ast`，无第三方依赖），用作用域栈做词法解析——函数/类/方法定义、参数、import、赋值、`global`/`nonlocal`、lambda、推导式等；`Name(Load)` 沿作用域链解析到定义行，产出 `refs`（引用→定义行）供跳转与计数。未解析到（跨文件、动态）时静默忽略，不影响阅读。

6. **PDF 阅读器**：`read()` 对 `.pdf` 只 `stat` 元数据（避免把字节读进 JSON），`PdfViewer` 用 `<iframe src="/aionui-panel/raw?...">` 交给浏览器原生查看器渲染。raw 路由对 `.pdf` 返回 `application/pdf`。

7. **Dark+ 配色作用域**：所有 VS Code 颜色都用 `body[data-ds-dark-theme]` 限定，仅深色主题生效；浅色主题保持原 `--aion-*` 令牌（未定制 Light+）。

---

## 六、部署与验证

```sh
# 1. 构建（tsc 类型检查 + tsdown 打包）
pnpm --filter @linxin666/dsh-client-ui-aionui-panel build

# 2. 部署到当前 web profile（会备份被覆盖文件到 deploy/backup-<时间戳>）
#    需要写权限；把 lib/client.js、client.js.map、index.js 复制进
#    ~/.dsh/profiles/web/node_modules/@linxin666/dsh-client-ui-aionui-panel/lib
powershell -File scripts/deploy-local.ps1

# 3. 生效
#    客户端改动：刷新页面（建议 Ctrl+Shift+R 强刷）
#    宿主改动：重启 dsh web（新路由 py-lint/py-symbols/py-format 需进程重载）
```

验证方式：打开任意 `.py` 文件，应看到高亮、波浪线、大纲、参考线、彩虹括号；工具栏「格式化」可预览差异并应用；打开 `.pdf` 可翻页。

---

## 七、范围与限制

- **不执行代码**：阅读器是纯静态分析。曾实现过「运行」按钮，已按要求移除，未纳入本变更。
- **语义高亮**：VS Code 的 `semanticHighlighting` 依赖 Pylance/语言服务器（类型/变量着色），CodeMirror 无此层；目前是词法 token 高亮（关键字/字符串/注释）。对齐需要接入 pyright，属更大工程，未做。
- **Dark+ 语法 token 色**：关键字/类型/字符串等 token 颜色仍用 oneDark 高亮，未逐条映射 Dark+ 的 50+ token scope。
- **活跃括号对参考线**（`editorIndentGuide.activeBackground1`、活跃作用域加深）未做。
- **未覆盖项**：补全建议框、内嵌提示（inlay hint）、缩略图（minimap）、链接检测、选中词高亮（selectionHighlight）、浅色主题（Light+）定制。
- **lint 槽图标**：gutter 标记沿用 CodeMirror 默认小图标色，未按 Dark+ 精确改色（波浪线本体已对齐）。

---

## 八、已知环境注意点

- 本增强在 Windows（Node 24、Python 3.13、ruff 0.12）下开发与验证；宿主工具路径为 `python`/`ruff`，Linux/macOS 或 WSL 环境若默认名为 `python3` 会自动回退，也可用环境变量覆盖。
- `scripts/deploy-local.ps1` 依赖 PowerShell，仅用于本地快速部署；正式发布仍走 `dsh-web-ui-all` 聚合包 + 版本号。
- `vitest` 在当前开发机的受限 shell 下因 spawn EPERM 无法运行；`py-service.spec.ts` 可在常规终端 `pnpm test` 执行。
