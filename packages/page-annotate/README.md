# dsh-page-annotate

English | [中文](README.zh.md)

A right-side web page annotator for the dsh web GUI: browse a page in an embedded iframe, capture a real Chromium screenshot, draw rectangle / arrow / text / number annotations, and send the composited image to the model for OCR through the describe-image attach seam.

## Features

- Right-panel tab (dsh-better-sidebar, closable): URL bar plus a sandboxed iframe browser.
- Host-side capture engine: Electron offscreen BrowserWindow inside the DSH Desktop shell first, headless Playwright Chromium as fallback, local image upload as last resort.
- Annotation stage: rectangle, arrow, text, and auto-numbered markers in five colors and three stroke widths, with undo and clear.
- Send-to-model: the annotated image is composited at 2x and inserted into the conversation draft as a durable image reference, so the model can OCR it.
- All annotation coordinates are normalized to 0..1, so drawings survive any display size without tainting the canvas.
- Bilingual UI copy (zh/en) registered through ctx.locale.register.

## Usage

1. Open the page-annotate tab in the right panel.
2. Type a URL (or click an http(s) external link to pre-load it) and press Capture.
3. Switch to the annotate tab and draw markers on the screenshot with the toolbar tools.
4. Press Send to push the annotated image into the current conversation draft.
5. Send the draft; the model reads the annotations from the image.

## Capture engines

- Electron offscreen BrowserWindow (used inside the DSH Desktop shell, where the plugin host half runs in the main process).
- Headless Playwright Chromium (bundled Chromium from the ms-playwright cache; override with DSH_PAGE_ANNOTATE_CHROMIUM or PLAYWRIGHT_BROWSERS_PATH).
- Local image upload when no engine is available.

## Security model

- The screenshot route is loopback-fenced (127/8, ::1, Host header, same-origin markers) like the sibling plugin families.
- Only http(s) URLs are accepted; file:, data:, javascript: and friends are refused.
- The iframe runs sandboxed without allow-same-origin, and annotations never read the page DOM, so cross-origin content cannot leak into the image.
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
