# @linxin666/dsh-file-drop

[English](README.md) | 中文

把文件拖进 DSH Web 窗口，输入框自动填入文件的**原路径**（无需手输深路径），你补上任务说明后发送，agent 直接从磁盘读取该文件。

## 功能

- **整窗监听拖拽**（capture 阶段），GUI 内部拖拽处理器无法抢先吞掉事件。
- **宿主落盘**：文件上传到 `~/.dsh/dsh-file-drop/`，文件名安全清洗、重名自动加序号；agent 始终有一份可用副本。
- **原路径解析**（按优先级）：
  1. OS 拖拽携带的 `file://` uri-list（宿主校验存在后采信）。
  2. `~/Downloads` / `~/Desktop` / `~/Documents` 顶层精确文件名匹配（唯一命中才用）。
  3. Spotlight（`mdfind`）全盘精确文件名匹配——覆盖深目录场景（唯一命中才用）。
  4. 以上均失败 → 暂存副本路径，并标注「未找到原路径，已暂存副本」。
- **只填输入框、不自动发送**：填入纯路径，你补充任务说明后再发送。
- 中文、空格等非 ASCII 文件名经 URI 编码传输，宿主侧解码。

## 为什么拿不到原始绝对路径

桌面壳（DeepSeek Harness.app）的渲染器是沙箱渲染（`sandbox: true`），preload 未暴露 `webUtils`；浏览器也从不提供拖拽路径。因此本插件用 uri-list + 精确文件名扫描 + Spotlight 三层尽力恢复原位置——不碰 DSH 与桌面壳即可实现。

## 配置

- `enabled` — 总开关（默认 true）。
- `destDir` — 覆盖落盘目录（默认 `~/.dsh/dsh-file-drop`）。

在 `~/.dsh/settings.yaml` 的 `file-drop` 设置命名空间下配置。

## 安装

推荐安装全家桶聚合包 `@linxin666/dsh-web-ui-all`（一个包装齐全部功能插件与皮肤），或单独安装本插件：

```sh
dsh plugin --profile web add @linxin666/dsh-file-drop
```

或从仓库安装（开发调试）：

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-file-drop
```

安装后重启 `dsh web`，然后把文件拖进窗口即可。

## 构建

```sh
cd packages/dsh-file-drop
pnpm run build      # lib/index.js（宿主路由）+ lib/client.js（浏览器 bundle）
pnpm run typecheck
pnpm test           # vitest：清洗 / 解析 / 消息 / 输入框填充
```

## 数据位置

- 文件落盘 `~/.dsh/dsh-file-drop/`（工作副本；消息指向解析到的原路径时以原路径为准）。
- 上传路由仅限 loopback（`/api/dsh-file-drop/upload`）。

## 已知限制

- 沙箱渲染器拿不到拖入文件的原始绝对路径；依赖 uri-list + 精确文件名扫描 + Spotlight 恢复。Spotlight 尚未索引的文件可能回退到暂存副本。
- 同名文件仅在唯一命中时解析；有歧义则回退到暂存副本。
- 始终有一份暂存副本作为工作文件；消息在解析到原路径时以原路径为准。

## 目录结构

```
src/index.ts      # 宿主半边：上传路由注册（enabled/destDir 配置）
src/routes.ts     # 上传路由、安全文件名、原路径解析（uri-list + 目录 + mdfind）
src/client/index.ts  # drop 监听、上传、输入框填充（纯路径）
src/client/locales.ts # 中英文案
src/invariant.ts  # invariant 伴生插件
tests/*.spec.ts   # 清洗 / 解析 / 消息 / 输入框填充 测试
```