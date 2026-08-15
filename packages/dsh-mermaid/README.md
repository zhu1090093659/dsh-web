# @linxin666/dsh-client-ui-mermaid

English | [中文](README.zh.md)

DSH web GUI plugin mermaid — renders mermaid diagram fences in assistant
messages as SVG figures, with a source toggle and a settings card.

## What it does

The shell renders assistant markdown fences as plain code blocks (the fence
pipeline has no diagram renderer). This plugin watches the transcript DOM,
finds fences tagged `mermaid`, and swaps each one for an SVG figure rendered
by a bundled [mermaid](https://mermaid.js.org/) runtime:

- the original source stays one click away (figure toolbar toggle);
- a broken diagram keeps the source readable and shows the parse error;
- streaming fences re-render as the source grows, settled ones render once;
- theme follows the interface brightness (`auto`) or pins one of mermaid's
  built-in themes (`default` / `dark` / `neutral` / `forest`);
- Settings -> plugin config -> Web UI plugins gains a card with the enable
  toggle and the theme choice; toggling off reverts every figure to the plain
  code block without a restart.

The mermaid library is bundled into the plugin's client artifact (~2 MB
minified), so rendering works fully offline; no CDN fetch ever happens.

## Install

### From npm (recommended)

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-mermaid
```

### From the repository (development)

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install
pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-mermaid
```

Or link the whole family at once (see the repository README) and the plugin
ships with `dsh-web-ui-all`.

## Known limitations

- Diagram rendering needs a real browser layout engine; the plugin runs only
  in the web GUI (not in terminal sessions).
- The figure enhancement is DOM-level (the SDK ships no fence-render slot):
  a future shell that changes the CodeBlock markup degrades this plugin to a
  no-op until the selectors are updated.
- `auto` theme samples the body background luminance, so a skin with a
  mid-gray background may resolve either way; pin a theme in that case.

## License

BSD-3-Clause.
