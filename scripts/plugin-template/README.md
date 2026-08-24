# @linxin666/dsh-client-ui-__NAME__

English | [中文](README.zh.md)

DSH web GUI plugin __NAME__ — scaffolded from scripts/plugin-template. Replace
this file with the real description once the plugin is implemented.

## What it does

<!-- Describe the plugin: which sidebar entry it adds, what it does in the web GUI. -->

## Install

### From npm (recommended)

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-__NAME__@latest
```

### From the repository (development)

```sh
git clone https://github.com/zhu1090093659/dsh-web.git
cd dsh-web
pnpm install
pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/__NAME__
```

## Known limitations

<!-- List known limitations, if any. -->

## License

BSD-3-Clause.
