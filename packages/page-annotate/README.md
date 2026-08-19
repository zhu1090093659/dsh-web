# dsh-page-annotate

English | [中文](README.zh.md)

A right-side web page annotator for the dsh web GUI: browse ordinary pages in a sandboxed iframe, or explicitly open a persistent Electron browser for sign-in flows, navigation, and sites that refuse embedding. Capture the current authenticated page, draw rectangle / arrow / text / number annotations, and send the composited image to the model for OCR through the describe-image attach seam.

## Features

- Right-panel tab (dsh-better-sidebar, closable): URL bar plus a sandboxed iframe browser; Enter or Go performs real navigation so forms, sign-in flows, and ordinary links remain interactive.
- Real interactive browsing: Interactive browser opens a separate Electron Chromium window on explicit user action; sign-in, forms, links, and navigation work normally, and Capture interactive window captures that same authenticated page.
- Anonymous capture engine: Electron offscreen BrowserWindow inside the DSH Desktop shell first, headless Playwright Chromium as fallback, local image upload as last resort.
- Annotation stage: rectangle, arrow, text, and auto-numbered markers in five colors and three stroke widths, with undo and clear; rectangles can bind editable region comments rendered into the exported image.
- Send-to-model: the annotated image is composited at 2x and inserted into the conversation draft as a durable image reference, so the model can OCR it.
- All annotation coordinates are normalized to 0..1, so drawings survive any display size without tainting the canvas.
- Bilingual UI copy (zh/en) registered through ctx.locale.register.

## Usage

1. Open the page-annotate tab in the right panel.
2. Use Enter or Go for ordinary embeddable pages. For sign-in, real navigation, or sites that reject iframes, press Interactive browser and complete the flow in the separate window.
3. Press Capture interactive window to capture its current authenticated page; use Anonymous screenshot when no session is needed. In Annotate mode, draw markers and enter the comment bound to each rectangle.
4. Press Send to push the annotated image into the current conversation draft.
5. Send the draft; the model reads the annotations from the image.

## Capture engines

- Persistent Electron interactive BrowserWindow (inside DSH Desktop, with a dedicated `persist:page-annotate` session partition).
- Electron offscreen BrowserWindow (anonymous capture inside the DSH Desktop shell).
- Headless Playwright Chromium (bundled Chromium from the ms-playwright cache; override with DSH_PAGE_ANNOTATE_CHROMIUM or PLAYWRIGHT_BROWSERS_PATH).
- Local image upload when no engine is available.

## Security model

- The screenshot route is loopback-fenced (127/8, ::1, Host header, same-origin markers) like the sibling plugin families.
- Only http(s) URLs are accepted; file:, data:, javascript: and friends are refused.
- The iframe grants `allow-same-origin` only to preserve page sign-in state; the parent still cannot read cross-origin DOM, and annotations operate only on host-captured pixels.
- Sites protected by `X-Frame-Options` or CSP `frame-ancestors` refuse embedding; use the explicitly opened interactive browser window instead.
- The interactive window keeps site cookies and LocalStorage in a dedicated persistent partition. It accepts only http(s), disables Node integration, and enables sandbox, contextIsolation, and webSecurity. It is shown only after an explicit click and destroyed when the plugin unloads; the plugin does not read or log page credentials.
- Uploaded images are validated (mime sniffing, 16 MB cap, strict base64) and the attachment registry is capped at 128 entries.

## Comparison with dsh-annotate

- dsh-annotate is a Chrome extension plus WebSocket bridge; this plugin is a pure GUI-side panel with no extension install.
- This plugin captures through a real Chromium engine hosted by the GUI itself, so it works on any page, including ones that refuse iframes.
- The annotation model here is screenshot-pixel based (post-capture drawing), which avoids cross-origin canvas tainting and scroll alignment issues.

## Install

```sh
dsh plugin --profile web add link:/path/to/dsh-web-ui/packages/page-annotate
```

## Development

```sh
pnpm --filter @linxin666/dsh-page-annotate typecheck
pnpm --filter @linxin666/dsh-page-annotate test
pnpm --filter @linxin666/dsh-page-annotate build
```

## License

Apache-2.0
