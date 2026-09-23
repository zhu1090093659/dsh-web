# Agent Note: Cross-platform line ending normalization and gitattributes hygiene

Status: implemented

## Problem

Across the repository's 6,575 tracked files, an audit for line ending consistency and cross-platform compatibility revealed several defects:
1. 7 files in the working tree contained mixed line endings with a solitary trailing CRLF (`\r\n`) at EOF while other lines used LF (`\n`), causing Git's `--eol` checks to report them as `w/mixed`.
2. 12 historical Agent Note markdown files under `.agents/notes/` were misclassified by Git as binary (`i/-text w/-text`) due to literal non-printable control characters (`\a` BEL 0x07, `\b` BS 0x08, `\f` FF 0x0C, `\r` CR 0x0D) introduced by unescaped backslashes in past generator tool calls, combined with a trailing CRLF at EOF.
3. `.gitattributes` defined `* text=auto eol=lf` and a common list of binary assets, but lacked explicit definitions for WebAssembly (`*.wasm`) and binary buffers (`*.bin`), as well as explicit `eol=lf` guarantees for shell scripts (`*.sh`, `scripts/*`) and `eol=crlf` overrides for Windows batch scripts (`*.bat`, `*.cmd`).
4. `.editorconfig` lacked an explicit rule for Windows batch scripts if introduced in the future.

## Decision

- Enforce LF line endings across all tracked text files in the repository. Stripped stray carriage return bytes and converted all CRLF sequences to LF.
- Repaired corrupted control character sequences in the 12 Agent Note markdown files back to valid printable ASCII text (e.g. `\rpcId`, `\approvalId`, `\apiKey`, `\failed`, `\return`), enabling Git to recognize them as proper LF text files (`i/lf w/lf`).
- Extended `.gitattributes` with:
  - Binary declarations for `*.wasm binary` and `*.bin binary`.
  - Explicit LF enforcement for shell and executable scripts: `*.sh text eol=lf` and `scripts/* text eol=lf` to prevent bad interpreter errors on Linux/WSL/macOS and CI environments.
  - Windows batch script CRLF declaration: `*.bat text eol=crlf` and `*.cmd text eol=crlf`.
- Extended `.editorconfig` with `[*.{bat,cmd}] end_of_line = crlf`.
- Renormalized the repository index via `git add --renormalize .`.

## Alternatives considered

- Relying solely on `core.autocrlf = true` on Windows: rejected because host environment settings vary across contributors and CI nodes, leading to dirty working trees, diff churn, and broken shell script interpreters.
- Leaving legacy note control characters intact: rejected because Git's text detection heuristics permanently treated them as binary blobs, preventing diffing, merge resolution, and gitattribute line ending normalization.
- Forcing CRLF for all files on Windows: rejected because cross-platform JavaScript/TypeScript tooling, Node.js scripts, and CI runners require consistent LF line endings.

## Consequences

All 6,575 tracked repository files now strictly conform to uniform LF line endings without mixed CRLF/LF occurrences. Git attributes and EditorConfig provide a fail-safe configuration for cross-platform checkouts across Windows, Linux, and macOS. Historical markdown notes are now fully diffable and searchable as standard text files.
