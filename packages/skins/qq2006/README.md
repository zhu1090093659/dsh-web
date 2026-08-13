# @linxin666/dsh-client-ui-skin-qq2006

English | [中文](README.zh.md)

A lightweight QQ2006-inspired skin for the dsh web GUI. It adds compact blue window chrome, a pale status bar, classic desktop controls, and a crystal-blue palette without modifying the official DSH source.

The skin is presentation-only. Its client entry sets one scoped body attribute and adds two chrome elements plus a data-URL favicon. The lifecycle disposer removes every write. The small penguin mark is an original SVG assembled in code; the package contains no Tencent images, audio, fonts, or other binary assets.

## Installing

Prefer the aggregate package for the complete skin collection, or link this package alone:

```sh
dsh plugin --profile web add link:$(pwd)/packages/dsh-skins
# or
dsh plugin --profile web add link:$(pwd)/packages/skins/qq2006

dsh-skin use qq2006
```

Run `pnpm install && pnpm -r build` in the monorepo before a local `link:` install. Only one skin is active at a time.

## Model experience

None. This package only changes browser DOM and CSS; it does not assemble or send model requests.

## Known limitations

- The skin starts after plugin bundles load, so the earliest loading surface stays stock.
- It intentionally implements a compact visual interpretation, not a pixel-identical copy of proprietary QQ screens or behavior.
