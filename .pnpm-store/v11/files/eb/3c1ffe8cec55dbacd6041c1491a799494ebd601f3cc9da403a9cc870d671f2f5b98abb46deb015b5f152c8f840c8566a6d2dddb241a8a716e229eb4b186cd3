# tsconfck

[![npm version](https://img.shields.io/npm/v/tsconfck)](https://www.npmjs.com/package/tsconfck)
[![CI](https://github.com/dominikg/tsconfck/actions/workflows/test.yml/badge.svg)](https://github.com/dominikg/tsconfck/actions/workflows/test.yml)

A utility to find and parse tsconfig files without depending on typescript

# Why

Because no simple official api exists and tsconfig isn't actual json.

# Features

- [x] find closest tsconfig (tsconfig.json or jsconfig.json)
- [x] convert tsconfig to actual json and parse it
- [x] resolve "extends"
- [x] resolve "references" of solution-style tsconfig
- [x] optional caching for improved performance
- [x] optional findNative and parseNative to use official typescript api
- [x] zero dependencies (typescript optional)
- [x] extensive testsuite
- [x] completely async and optimized (it's [fast](https://github.com/dominikg/tsconfck/blob/main/docs/benchmark.md))
- [x] tiny [4.8KB gzip](https://pkg-size.dev/tsconfck)
- [x] unbundled esm js, no sourcemaps needed
- [x] [types](https://github.com/dominikg/tsconfck/blob/main/packages/tsconfck/types/index.d.ts) generated with [dts-buddy](https://github.com/Rich-Harris/dts-buddy)

# Users

Used by [vite](https://github.com/vitejs/vite)\*, [vite-tsconfig-paths](https://github.com/aleclarson/vite-tsconfig-paths), [astro](https://github.com/withastro/astro) and [many more](https://github.com/dominikg/tsconfck/network/dependents)

> (\*) vite bundles tsconfck so it is listed as a devDependency

# Install

```shell
npm install --save-dev tsconfck # or pnpm, yarn
```

# Usage

## without typescript installed

```js
import { parse } from 'tsconfck';
const {
	tsconfigFile, // full path to found tsconfig
	tsconfig, // tsconfig object including merged values from extended configs
	extended, // separate unmerged results of all tsconfig files that contributed to tsconfig
	solution, // solution result if tsconfig is part of a solution
	referenced // referenced tsconfig results if tsconfig is a solution
} = await parse('foo/bar.ts');
```

## with typescript

```js
import { parseNative } from 'tsconfck';
const {
	tsconfigFile, // full path to found tsconfig
	tsconfig, // tsconfig object including merged values from extended configs, normalized
	result, // output of ts.parseJsonConfigFileContent
	solution, // solution result if tsconfig is part of a solution
	referenced // referenced tsconfig results if tsconfig is a solution
} = await parseNative('foo/bar.ts');
```

## API

see [API-DOCS](docs/api.md)

## Advanced

### ignoring tsconfig for files inside node_modules

esbuild ignores node_modules so when you want to use tsconfck with esbuild, you can set `ignoreNodeModules: true`

```js
import { find, parse } from 'tsconfck';
// returns some-lib/tsconfig.json
const fooTSConfig = await find('node_modules/some-lib/src/foo.ts');

// returns null
const fooTSConfigIgnored = await find('node_modules/some-lib/src/foo.ts', {
	ignoreNodeModules: true
});

// returns empty config
const { tsconfig } = await parse('node_modules/some-lib/src/foo.ts', { ignoreNodeModules: true });
```

### caching

a TSConfckCache instance can be created and passed to find and parse functions to reduce overhead when they are called often within the same project

```js
import { find, parse, TSCOnfckCache } from 'tsconfck';
// 1. create cache instance
const cache = new TSCOnfckCache();
// 2. pass cache instance in options
const fooTSConfig = await find(('src/foo.ts', { cache })); // stores tsconfig for src in cache
const barTSConfig = await find(('src/bar.ts', { cache })); // reuses tsconfig result for src without fs call

const fooResult = await parse('src/foo.ts', { cache }); // uses cached path for tsconfig, stores parse result in cache
const barResult = await parse('src/bar.ts', { cache }); // uses cached parse result without fs call or resolving
```

#### cache invalidation

You are responsible for clearing the cache if tsconfig files are added/removed/changed after reading them during the cache lifetime.

Call `cache.clear()` and also discard all previous compilation results based previously cached configs.

#### cache mutation

Returned results are direct cache objects. If you want to modify them, deep-clone first.

#### cache reuse

Never use the same cache instance for mixed calls of find/findNative or parse/parseNative as result structures are different

### root

This option can be used to limit finding tsconfig files outside of a root directory

```js
import { parse, TSConfckCache } from 'tsconfck';
const root = '.';
const parseOptions = { root };
// these calls are not going to look for tsconfig files outside root
const fooResult = await find('src/foo.ts', parseOptions);
const barResult = await parse('src/bar.ts', parseOptions);
```

> Using the root option can lead to errors if there is no tsconfig found inside root.

### error handling

find and parse reject for errors they encounter, but return null or empty result if no config was found

If you want them to error instead, test the result and throw

```js
import { parse } from 'tsconfck';
find('some/path/without/tsconfig/foo.ts').then((result) => {
	if (result === null) {
		throw new Error('not found');
	}
	return result;
});
parse('some/path/without/tsconfig/foo.ts').then((result) => {
	if (result.tsconfigFile === null) {
		throw new Error('not found');
	}
	return result;
});
```

### TSConfig type (optional, requires typescript as devDependency)

```ts
import type { TSConfig } from 'pkg-types';
```

Check out https://github.com/unjs/pkg-types

### cli

A simple cli wrapper is included, you can use it like this

#### find

```shell
# prints /path/to/tsconfig.json on stdout
tsconfck find src/index.ts
```

#### find-all

```shell
# prints all tsconfig.json in dir on stdout
tsconfck find-all src/
```

#### parse

```shell
# print content of ParseResult.tsconfig on stdout
tsconfck parse src/index.ts

# print to file
tsconfck parse src/index.ts > output.json
```

#### parse-result

```shell
# print content of ParseResult on stdout
tsconfck parse-result src/index.ts

# print to file
tsconfck parse-result src/index.ts > output.json
```

#### help

```shell
# print usage
tsconfck -h # or --help, -?, help
```

# Links

- [changelog](CHANGELOG.md)

# Develop

This repo uses

- [pnpm](https://pnpm.io)
- [changesets](https://github.com/changesets/changesets)

In every PR you have to add a changeset by running `pnpm changeset` and following the prompts

PRs are going to be squash-merged

```shell
# install dependencies
pnpm install
# run tests
pnpm test
#run tests in watch mode (doesn't require dev in parallel)
pnpm test:watch
```

# License

[MIT](./LICENSE)
