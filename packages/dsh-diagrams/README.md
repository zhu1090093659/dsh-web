# dsh-diagrams

English | [中文](README.zh.md)

Mermaid diagram rendering for the DeepSeek Harness Web GUI: a fenced ```mermaid block in the chat transcript or in the document preview panel is rendered in place as an SVG diagram instead of a code block.

## What it does

- **Renders where you read**: the chat transcript and the document preview pane are covered from one observer, because both render through the same official markdown component.
- **Renders on demand**: the mermaid runtime is served by this package's own host route and fetched only when a page actually shows a mermaid block, so a session without diagrams downloads nothing extra.
- **Follows the shell theme**: a light/dark switch re-renders the diagrams from their stored source, because mermaid paints colors into the SVG itself.
- **Never damages the document**: a missing runtime, a half-streamed fence or a diagram the parser rejects all leave the original code block exactly as the renderer drew it, and the block's copy button keeps copying the source.

## Install

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-diagrams
# Restart dsh web
dsh web
```

Installing the family bundle (`@linxin666/dsh-web-all`) mounts this package too; the row is enabled by default and can be switched off per row in the plugin manager.

## Config

No settings. The package registers one read-only host route and one page-side observer; there is nothing to configure.

## Known limitations

- **The integration point is the renderer's DOM, not a contract.** The official markdown renderer publishes no code-block extension seam, so this package finds fenced blocks by the `md-code-block` class and reads the fence language from the banner's infostring element. A host release that renames either one stops diagram rendering (the fences stay ordinary code blocks — nothing breaks); the pinned constants live in `src/core/contract.ts` with a test beside them.
- **Streaming fences render late by design.** While a reply is still streaming, an unclosed fence cannot be rendered. A rejected fence is retried only after a short quiet period and only once its source actually changes, so a half-written diagram is never re-parsed on every DOM change and a fence the parser rejects is never parsed again.
- **No diagram theme choice.** Diagrams follow the shell's light/dark state; mermaid's own theme variables are not exposed as settings.

## Security model

- The vendor route (`/api/dsh-diagrams/vendor/mermaid.js`) passes the family trust fence first: loopback always passes, and a live paired-device cookie allows remote access when `dsh-remote-web-ui` is loaded. Any other client is refused with 403 before the asset is read.
- The route is read-only: only `GET` and `HEAD` are answered, everything else is 405.
- The runtime is served same-origin from the installed package; no CDN is contacted.
- Rendered SVG passes a second sanitizing pass (beyond mermaid's own strict security level): script-capable elements, `on*` handlers and `javascript:` URLs are stripped, and markup that still carries an executable token after cleaning is rejected — the block then stays a code block.
