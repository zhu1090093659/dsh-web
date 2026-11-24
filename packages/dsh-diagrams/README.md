# dsh-diagrams

English | [中文](README.zh.md)

Mermaid diagram rendering for the DeepSeek Harness Web GUI: a fenced ```mermaid block in the chat transcript or in the document preview panel is rendered in place as an SVG diagram instead of a code block.

## What it does

- **Renders where you read**: the chat transcript renders through the official `conversation.chat.markdown.fence` hoc slot (`key: 'mermaid'`), keeping the raw code block while streaming and replacing it with SVG once settled; Markdown surfaces that do not pass `renderCode` (such as the document preview pane) remain covered by the scoped DOM observer, which explicitly skips blocks owned by the official fence slot.
- **Renders on demand**: the mermaid runtime is served by this package's own host route and fetched only when a page actually shows a mermaid block, so a session without diagrams downloads nothing extra.
- **Follows the shell theme**: a light/dark switch re-renders diagrams from their stored source with an LRU cache, because mermaid paints colors into the SVG itself.
- **Never damages the document**: a missing runtime, a streaming fence, or a diagram the parser rejects all fall back to the untouched official code block.

## Install

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-diagrams
# Restart dsh web
dsh web
```

Installing the family bundle (`@linxin666/dsh-web-all`) mounts this package too; the row is enabled by default and can be switched off per row in the plugin manager.

## Config

No settings. The package registers one read-only host route, one official `conversation.chat.markdown.fence` slot layer, and one document-preview fallback observer; there is nothing to configure.

## Known limitations

- **The document-preview fallback still reads renderer DOM hooks.** The chat transcript uses the official `conversation.chat.markdown.fence` contract slot; Markdown surfaces that do not pass `renderCode` (such as the document preview pane) still rely on the `md-code-block` class and the banner hooks (`_infostring` / `_language`). The span shows a localized placeholder (for example `代码块` / `Code block`) for languages the highlighter does not know, mermaid among them, so the fallback falls back to the source's first mermaid keyword when the label is not a real language token; real language labels are never claimed. The pinned constants live in `src/core/contract.ts` with a contract test beside them.
- **Streaming fences render once settled.** While a reply is streaming, the official fence layer returns the source code block directly instead of parsing partial diagrams; on the document-preview fallback path, a rejected fence is retried only after a short quiet period and only once its source actually changes.
- **No diagram theme choice.** Diagrams follow the shell's light/dark state; mermaid's own theme variables are not exposed as settings.

## Security model

- The vendor route (`/api/dsh-diagrams/vendor/mermaid.js`) passes the trust fence first: loopback and host-authenticated remote connections (`connection.admit`) pass; any other unauthenticated client is refused with 403 before the asset is read.
- The route is read-only: only `GET` and `HEAD` are answered, everything else is 405.
- The runtime is served same-origin from the installed package; no CDN is contacted.
- Rendered SVG passes a second sanitizing pass (beyond mermaid's own strict security level): script-capable elements, `on*` handlers and `javascript:` URLs are stripped, and markup that still carries an executable token after cleaning is rejected — the block then stays a code block.
