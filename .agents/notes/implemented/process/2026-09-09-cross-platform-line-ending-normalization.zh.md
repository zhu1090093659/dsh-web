# Agent Note: 跨平台换行符规范化与 gitattributes 治理

Status: implemented

## Problem

对仓库内全部 6,575 个受版本控制的文件进行跨平台行尾一致性扫描时，发现了以下问题：
1. 工作区中存在 7 个文件的行尾混用了 CRLF 与 LF（文件主体使用 LF，但在文件尾部残留了单独的 `\r\n`），导致 Git 的 `--eol` 探测将其标记为 `w/mixed`。
2. `.agents/notes/` 下的 12 篇历史 Agent Note markdown 文件被 Git 错误判定为二进制文件（`i/-text w/-text`）。原因是早期生成脚本或工具调用未对反斜杠转义，写入了不可见控制字符（`\a` BEL 0x07、`\b` BS 0x08、`\f` FF 0x0C、`\r` CR 0x0D），加之文件尾部的 CRLF，触发了 Git 的非文本二进制启发式判断。
3. `.gitattributes` 虽然配置了 `* text=auto eol=lf`，但缺少对 WebAssembly（`*.wasm`）及二进制数据（`*.bin`）的显式声明，且缺少对 Shell 脚本（`*.sh`、`scripts/*`）强制 LF 以及对 Windows 批处理脚本（`*.bat`、`*.cmd`）保留 CRLF 的显式规则。
4. `.editorconfig` 未对 Windows 批处理脚本预留 CRLF 规则。

## Decision

- 统一全仓所有文本文件的换行符为 LF。清除所有异常回车符（CR），并将全部 CRLF 序列转换为 LF。
- 修复 12 篇 Agent Note markdown 文件中因未转义而生成的异常控制字符，恢复为标准可读 ASCII 文本（如 `\rpcId`、`\approvalId`、`\apiKey`、`\failed`、`\return` 等），使 Git 正确将其识别为纯文本文件（`i/lf w/lf`）。
- 完善根目录 `.gitattributes`：
  - 补充 `*.wasm binary` 与 `*.bin binary` 显式二进制保护。
  - 显式声明 `*.sh text eol=lf` 与 `scripts/* text eol=lf`，防止跨平台、CI 或 WSL 环境执行时因 CRLF 产生 `bad interpreter` 错误。
  - 显式声明 `*.bat text eol=crlf` 与 `*.cmd text eol=crlf`。
- 完善 `.editorconfig`，增加 `[*.{bat,cmd}] end_of_line = crlf`。
- 执行 `git add --renormalize .` 彻底重刷并对齐 Git 索引。

## Alternatives considered

- 仅依赖 Windows 本地 `core.autocrlf = true`：否决——不同开发者与 CI 运行环境配置不一，容易导致工作区被标记为变更、diff 噪声以及 Linux/WSL 环境下脚本运行失败。
- 保留历史 Note 中的控制字符不变：否决——会导致 Git 持续将其判定为二进制文件，无法正常进行文本 diff、合并冲突检测以及行尾自动标准化。
- 在 Windows 上全部强制转换为 CRLF：否决——现代跨平台 JS/TS 工具链、Node 脚本及 CI 构建均以 LF 为首选基准。

## Consequences

仓库内全部 6,575 个受版本控制的文件均已完全符合 LF 换行符规范，不存在任何混合换行或孤立回车符。通过 `.gitattributes` 与 `.editorconfig` 构建了完备的跨平台行尾保障，避免了 Windows、Linux 与 macOS 协作时的换行漂移问题。所有历史文档恢复为可正常检索与 diff 的纯文本形态。
