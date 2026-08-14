# import-without-cache

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![Unit Test][unit-test-src]][unit-test-href]

Import ES modules without cache.

## Features

- Import ES modules without cache
- All dependencies are also imported without cache

## Install

```bash
npm i import-without-cache
```

## Usage

```ts
import { clearRequireCache, init, isSupported } from 'import-without-cache'

if (!isSupported) {
  throw new Error('import-without-cache is not supported in this environment.')
}

const deregister = init({
  // Optional
  skipNodeModules: false,
})

const mod = await import('some-module', { with: { cache: 'no' } })

clearRequireCache() // Optional: clear CommonJS cache if needed

// or
const mod2 = await import(`no-cache://some-module`)

expect(mod).not.toBe(mod2) // Different instances

deregister() // Optional: deregister the hooks when no longer needed
```

## Known Limitations

- Supports Node.js v22.18.0 and later; Deno is not supported.
- Yarn PnP is not supported on Node.js versions earlier than v24.
- In Bun, `clearRequireCache` works, but `init` is unnecessary because ESM imports behave the same as CommonJS requires.
- Only ESM modules are supported by default. The CommonJS cache can be cleared with `clearRequireCache`.
- `require(esm)` is supported starting in Node.js v24.13.1.

## Sponsors

<p align="center">
  <a href="https://cdn.jsdelivr.net/gh/sxzz/sponsors/sponsors.svg">
    <img src='https://cdn.jsdelivr.net/gh/sxzz/sponsors/sponsors.svg'/>
  </a>
</p>

## License

[MIT](./LICENSE) License © 2025-PRESENT [Kevin Deng](https://github.com/sxzz)

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/import-without-cache.svg
[npm-version-href]: https://npmjs.com/package/import-without-cache
[npm-downloads-src]: https://img.shields.io/npm/dm/import-without-cache
[npm-downloads-href]: https://www.npmcharts.com/compare/import-without-cache?interval=30
[unit-test-src]: https://github.com/sxzz/import-without-cache/actions/workflows/unit-test.yml/badge.svg
[unit-test-href]: https://github.com/sxzz/import-without-cache/actions/workflows/unit-test.yml
