# dsh-aionui-panel — DSH Web GUI right-panel system

English | [中文](README.zh.md)

> **Unsupported**: this panel is no longer maintained, tested, or covered by CI gates, and it can no longer be enabled — the provider choice was removed and the right panel is always [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar); this package now only carries the Side Card settings card and will be removed from the family aggregate in a future release. The panel feature descriptions below are a historical record.

> A pixel-faithful re-implementation of AionUi's right-panel system (Apache-2.0 licensed reference implementation, not a copy): Explorer project panel (file tree / filename search / Git changes) + Preview panel (multi-tab preview of 10+ formats) + a unified draggable layout system, with per-project preference persistence.

## Install

Install the family aggregate package `@linxin666/dsh-web-all` (all plugins and skins in one) or this plugin alone:

```sh
# Recommended: install directly from npm
dsh plugin --profile web add @linxin666/dsh-client-ui-aionui-panel@latest

# Or from the repository (development loop)
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-aionui-panel

```

After installing, **restart `dsh web`** and open a project session to see the "预览" (Preview) and "文件/变更" (Files/Changes) panels to the right of the chat area.

## Usage

When a project session (the current session has a working directory) is open, two panels appear to the right of the chat area:

- **Explorer (rightmost column, default 260px, range 220–500px)**: `File / Changes` two tabs; clicking a row in the file tree expands/collapses a folder, clicking a file opens it in the preview panel, and the top filename search (150ms debounce, clicking a result locates it in the tree without interrupting flow); the `Changes` tab reads the real git status and supports stage / unstage / discard (untracked via delete, tracked via restore, bulk discard asks for confirmation).
- **File-tree context menu**: right-clicking a file or folder opens a menu — copy path, copy name, reveal in file manager, open with default app (files only), rename, new file, new folder, delete (with confirmation); every operation goes through the workspace gate (loopback fence + .git refusal), and reveal uses `explorer /select` on Windows, `open -R` on macOS, falling back to opening the parent directory on Linux desktops.
- **Drag a file to the input box**: file rows in the tree can be dragged (except directory rows); dropping onto the chat input area inserts the relative path (e.g. `deploy/base/deployment.yaml`) at the cursor of the current draft, and the agent reads the file itself once the message arrives — no need to type the path by hand; a highlighted hint bar shows above the input while dragging.
- **Preview (second column from right, default 480px, range 340–1200px)**: multi-tab preview supporting markdown / html / code / diff / csv / pdf / word / excel / ppt / image / text / url (code previews are syntax-highlighted via the official shiki core); source/preview toggle, split-screen editing (ratio persisted), save (mtime conflict detection), download, refresh (4-state: dead buttons are not rendered), dirty dot, middle-click close, right-click menu batch close (dirty confirm), and tab-overflow gradient indicator.
- **Mermaid diagrams**: fenced ```mermaid blocks render as diagrams in the markdown preview. The mermaid runtime is bundled in the package and served same-origin via `/aionui-panel/vendor/mermaid.js` (no CDN, offline-friendly, loopback-fenced); diagrams follow the shell's light/dark theme and re-render on theme flips; a diagram with syntax errors falls back to the plain code block.
- **Side card settings** (settings → Web Plugins → Side Card): the collapsed-by-default card declares that the right panel is the side card from [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) and, once expanded, edits its everyday settings inline (open for new conversations, default width percent, chat file opens, position compatibility mode, plus the sidebar tab and file viewer switches), applying changes immediately; the first-level settings nav no longer shows a Side Card entry. Finer per-feature settings (terminal font, sandbox switches, and the like) live in the `dsh-better-sidebar` namespace of ~/.dsh/settings.yaml. The historical record below describes the retired aionui panel. Selecting aionui-panel mounts both panels, shows the floating expand button, and registers the `/aionui-panel/*` routes (workspace fs watching and git polling behind them); selecting DSH-better-sidebar keeps this panel unmounted and stops those routes and watchers. The choice is mutually exclusive: better-sidebar reads the same setting and does not mount while `Use aionui-panel` is selected (requires dsh-better-sidebar >= 0.13.0). The aionui panel is **temporarily disabled by default** until its features are fully migrated to dsh-better-sidebar — switching back is possible but not recommended before the migration completes. The choice is the same everywhere (standalone installs and the `dsh-web-all` aggregate bundle alike).

Interaction details:

- Drag the left edge handle to resize (merged per frame via rAF, body user-select:none); double-click the handle to reset to the default width.
- Two-level width clamping (Explorer first, Preview second) mathematically guarantees the chat area stays >= 360px; out-of-range values are written back to persistence.
- Collapse = width shrinks to 0 while the component stays mounted (tree expanded state / preview tabs are not lost), no transition animation; after collapsing, a floating expand button appears at the top-right corner, just below the conversation header's divider line, so it never overlaps the header chrome.
- Light/dark themes follow the GUI (`body[data-ds-dark-theme]`), and prefers-reduced-motion globally disables animations.
- Preferences persist per project (localStorage keys matching AionUi): `chat-workspace-width-px` / `chat-preview-width-px` / `preview-panel-split-ratio` / `project-panel-collapse:<root>` / `explorer-ui:<root>` / `scm-ui:<root>` / `preview-ui:<root>` (LRU capped at 12 scopes). Reads are always range-checked; invalid values fall back to defaults.

## Data sources

The real filesystem and the real git repository, no mocks:

- The host half (`src/index.ts` + `src/host/`) serves directory listing, file reads (text capped at 80k chars / image data URLs), writes (mtime conflict detection), filename search (skipping .git / node_modules), git status (porcelain v1 -z) / stage / unstage / discard, and an SSE change stream (fs watching + git polling) over the `/aionui-panel/*` HTTP routes. It also serves the vendored mermaid IIFE bundle (`lib/assets/mermaid.min.js`, copied from the pinned npm dependency at build time) at `/aionui-panel/vendor/mermaid.js` with etag revalidation. The SSE change stream is shared across tabs through a cross-tab leader relay (Web Locks + BroadcastChannel): one stream per project browser-wide, so opening the same project in multiple tabs no longer exhausts the same-origin HTTP connection pool and hangs the panel (#383).
- All operations pass through a workspace guard: paths must fall inside a registered workspace (realpath normalization + prefix check); the browser can only read/write relative paths under the project root.
- Every `/aionui-panel/*` route (JSON operations, raw reads, and the SSE events stream) is loopback-only by default: non-loopback clients get `403 forbidden: loopback-only` before any workspace access, matching the dsh-ssh fence. When `dsh-remote-web-ui` is also loaded, a live paired-device cookie is an additional allow path (the same cookie `api/gate` already checks); unpaired and revoked devices stay 403. The panel does not depend on the remote plugin.
- The recursive watcher ignores changes under `node_modules` / `.git`; the SCM poll runs every 30s per workspace (each probe bounded by a 15s deadline), and roots that are not git repositories stop being re-probed thanks to a TTL cache. File edits surface via the watcher immediately; `.git`-only changes (commits/checkouts from other tools) appear within one poll interval or on window focus (throttled to once per 5s).
- The browser half (`src/client/`) treats the current session cwd as the project root; switching sessions switches projects.

## Structure

- `src/index.ts` — host half entry (cordis plugin: route registration + systemPrompt announcement).
- `src/host/` — fs/git data services and the route layer (workspace gate).
- `src/core/types.ts` — shared wire types across both halves.
- `src/client/` — browser half: framework-agnostic state core (`store.ts`), drag engine (`drag.ts` + `hooks/useResizableSplit.ts`), DOM layout controller (`layout.ts`, appending panel tracks to the shell's three-column grid), React components (explorer / scm / preview), and the mermaid enhancement (`preview/mermaid.ts` + `chat/mermaid-chat.tsx`).
- `tests/` — pure-logic tests for the clamp formula, porcelain parsing, persistence validation, markdown/csv rendering, store behavior, etc. (vitest, 37 tests).

## Build

```sh
export NPM_TOKEN='<token>'   # only if private scope auth is still required
pnpm install
pnpm -r build
```

## Attribution

This project is a re-implementation of the AionUi (iOfficeAI/AionUi, Apache-2.0) right-panel system: sizes, colors, motions and interaction parameters come from measured research against v2.1.53 (research report and screenshots live in the aionui-research repository), the implementation is entirely new code and does not copy the source in bulk. Upstream copyright belongs to the AionUi project; this project preserves attribution under the Apache-2.0 convention.
