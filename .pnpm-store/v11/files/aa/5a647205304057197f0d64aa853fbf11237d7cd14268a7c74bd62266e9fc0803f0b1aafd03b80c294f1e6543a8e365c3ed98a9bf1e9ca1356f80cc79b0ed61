# oniguruma-parser 🌿

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]

A TypeScript library for parsing, validating, traversing, transforming, and optimizing [Oniguruma](https://github.com/kkos/oniguruma) regular expressions.

> [!NOTE]
> Oniguruma is a regular expression engine written in C that's used in Ruby (via a fork named Onigmo), PHP (`mb_ereg`, etc.), TextMate grammars (used by VS Code, [Shiki](https://shiki.style/), etc.), and many other tools.

This library has been battle-tested by [Oniguruma-To-ES](https://github.com/slevithan/oniguruma-to-es) and [tm-grammars](https://github.com/shikijs/textmate-grammars-themes), which are used by Shiki to process tens of thousands of real-world Oniguruma regexes.

## 📜 Contents

- [Install and use](#️-install-and-use)
- [Convert a pattern to an AST](#-convert-a-pattern-to-an-ast)
- [Traverse and transform an AST](#-traverse-and-transform-an-ast)
- [Convert an AST to a pattern](#️-convert-an-ast-to-a-pattern)
- [Optimize regexes](#-optimize-regexes)
- [Known differences](#-known-differences)
- [Oniguruma version](#-oniguruma-version)

## 🕹️ Install and use

```sh
npm install oniguruma-parser
```

```js
import {toOnigurumaAst} from 'oniguruma-parser';

const ast = toOnigurumaAst('^.*');
```

<details>
  <summary>Using CommonJS require</summary>

```js
const {toOnigurumaAst} = require('oniguruma-parser-cjs');
```

> **Note:** [oniguruma-parser-cjs](https://github.com/RedCMD/oniguruma-parser-cjs) is a third-party CommonJS wrapper for this library. It might not always be up to date with the latest version.
</details>

<details>
  <summary>Using a CDN and global name</summary>

```html
<script src="https://cdn.jsdelivr.net/npm/oniguruma-parser/dist/oniguruma-parser.min.js"></script>
<script>
  const {toOnigurumaAst} = OnigurumaParser;
</script>
```

> **Note:** This bundle includes a subset of all available exports. See [`src/bundle.ts`](https://github.com/slevithan/oniguruma-parser/blob/main/src/bundle.ts).
</details>

### Additional modules

The following modules are available in addition to the root `'oniguruma-parser'` export:

- [Parser](https://github.com/slevithan/oniguruma-parser/blob/main/src/parser/README.md): Includes numerous functions and types for constructing and working with `OnigurumaAst` nodes. Also includes the core `parse` function that's wrapped by `toOnigurumaAst`.
- [Traverser](https://github.com/slevithan/oniguruma-parser/blob/main/src/traverser/README.md): Traverse and transform an `OnigurumaAst`.
- [Generator](https://github.com/slevithan/oniguruma-parser/blob/main/src/generator/README.md): Convert an `OnigurumaAst` to pattern and flags strings.
- [Optimizer](https://github.com/slevithan/oniguruma-parser/blob/main/src/optimizer/README.md): Minify and improve the performance of Oniguruma regexes.

## 🌲 Convert a pattern to an AST

Call `toOnigurumaAst` to parse an Oniguruma pattern (with optional flags and compile-time options) and return an AST. It uses the following type definition:

```ts
function toOnigurumaAst(
  pattern: string,
  options?: {
    flags?: string;
    rules?: {
      captureGroup?: boolean;
      singleline?: boolean;
    };
  }
): OnigurumaAst;
```

For example:

```js
import {toOnigurumaAst} from 'oniguruma-parser';

const ast = toOnigurumaAst('^.*');
console.log(ast);
/* →
{ type: 'Regex',
  body: [
    { type: 'Alternative',
      body: [
        { type: 'Assertion',
          kind: 'line_start',
        },
        { type: 'Quantifier',
          kind: 'greedy',
          min: 0,
          max: Infinity,
          body: {
            type: 'CharacterSet',
            kind: 'dot',
          },
        },
      ],
    },
  ],
  flags: {
    type: 'Flags',
    ignoreCase: false,
    dotAll: false,
    extended: false,
    digitIsAscii: false,
    posixIsAscii: false,
    spaceIsAscii: false,
    wordIsAscii: false,
    textSegmentMode: null,
  },
}
*/
```

An error is thrown if the provided pattern or flags aren't valid in Oniguruma.

> **Note:** `toOnigurumaAst` is a wrapper around the [parser module](https://github.com/slevithan/oniguruma-parser/blob/main/src/parser/README.md)'s `parse` function that automatically provides the appropriate Unicode property validation data.

## 🌀 Traverse and transform an AST

See details and examples in the [traverser module](https://github.com/slevithan/oniguruma-parser/blob/main/src/traverser/README.md)'s readme.

## ↩️ Convert an AST to a pattern

See details and examples in the [generator module](https://github.com/slevithan/oniguruma-parser/blob/main/src/generator/README.md)'s readme.

## 🪄 Optimize regexes

This library includes one of the few implementations (for any regex flavor) of a "regex optimizer" that can minify and improve the performance and readability of regexes prior to use.

Example:

```
(?x) (?:\!{1,}) (\b(?:ark|arm|art)\b) [[^0-9A-Fa-f]\P{^Nd}\p{ Letter }]
```

Becomes:

```
!+\b(ar[kmt])\b[\H\d\p{L}]
```

Optimized regexes always match exactly the same strings.

See more details and examples in the [optimizer module](https://github.com/slevithan/oniguruma-parser/blob/main/src/optimizer/README.md)'s readme.

> [!TIP]
> 🧪 Try the [optimizer demo](https://slevithan.github.io/oniguruma-parser/demo/).

## 🆚 Known differences

Known differences will be resolved in future versions.

### Unsupported features

The following rarely-used features throw errors since they aren't yet supported:

- Rarely-used character specifiers: Non-A-Za-z with `\cx` `\C-x`, meta `\M-x` `\M-\C-x`, octal code points `\o{…}`, and octal encoded bytes ≥ `\200`.
- Code point sequences: `\x{H H …}` `\o{O O …}`.
- Absence expressions `(?~|…|…)`, stoppers `(?~|…)`, and clearers `(?~|)`.
- Conditionals: `(?(…)…)`, etc.
- Non-built-in callouts: `(?{…})`, etc.
- Numbered *forward* backreferences (incl. relative `\k<+N>`) and backreferences with recursion level (`\k<N+N>`, etc.).
- Flags `D` `P` `S` `W` `y{g}` `y{w}` within pattern modifiers, and whole-pattern flags `C` `I` `L` ([#26](https://github.com/slevithan/oniguruma-parser/issues/26)).

Despite these gaps, more than 99.99% of real-world Oniguruma regexes are supported, based on a sample of ~55k regexes used in TextMate grammars (conditionals were used in three regexes, and other unsupported features weren't used at all). Some of the Oniguruma features above are so exotic that they aren't used in *any* public code on GitHub.

<details>
  <summary>More details about numbered forward backreferences</summary>

This library currently treats it as an error if a numbered backreference comes before its referenced group. This is a rare issue because:

- Most such placements are mistakes and can never match, due to Oniguruma's behavior for backreferences to nonparticipating groups.
- Erroring matches the correct behavior of named backreferences.
- For unenclosed backreferences, this only affects `\1`–`\9` since it's not a backreference in the first place if using `\10` or higher and not as many capturing groups are defined to the left (it's an octal or identity escape).
</details>

<details>
  <summary>Unsupported validation errors</summary>

The following don't yet throw errors, but should:

- Special characters that are invalid in backreference names even when referencing a valid group with that name.
  - Named backreferences should use a more limited set of allowed characters than named groups and subroutines.
  - Note that an error is already correctly thrown for any backreference name that includes `-` or `+` (which is separate from how these symbols are used in relative *numbered* backreferences).
- Subroutines used in ways that resemble infinite recursion ([#5](https://github.com/slevithan/oniguruma-parser/issues/5)).
  - Such subroutines error at compile time in Oniguruma.
</details>

<details>
  <summary>Future AST node types</summary>

Support for most of the currently unsupported features above will be added to the `OnigurumaAst` structure using existing node types (`Character`, `AbsenceFunction`, `Backreference`, etc.). However, the following node types will be added when their corresponding features are supported:

- `CharacterSequence`: New node type for code point sequences; will contain two or more `Character` nodes.
- `Conditional`: New node type for all conditional kinds.
- `Callout`: New node type for unnamed callouts.
</details>

### Behavior differences

#### Unenclosed four-digit backreferences

Although any number of digits are supported for enclosed `\k<…>`/`\k'…'` backreferences (assuming the backreference refers to a valid capturing group), unenclosed backreferences currently support only up to three digits (`\999`). In other words, `\1000` is handled as `\100` followed by `0` even if 1,000+ captures appear to the left.

> **Note:** An apparent bug in vscode-oniguruma (v2.0.1 tested) prevents any regex with more than 999 captures from working. They fail to match anything, with no error.

#### Erroring on patterns that trigger Oniguruma bugs

This library intentionally doesn't reproduce bugs, and it currently throws errors for several edge cases that trigger Oniguruma bugs and undefined behavior.

<details>
  <summary>Nested absence functions</summary>

Although nested absence functions like `(?~(?~…))` don't throw an error in Oniguruma, they produce self-described "strange" results, and Oniguruma's docs state that "nested absent functions are not supported and the behavior is undefined".

In this library, nested absence functions throw an error. In future versions, parsing of nested absence functions will follow Oniguruma and no longer error.
</details>

<details>
  <summary>Bare <code>\x</code> as a <code>NUL</code> character</summary>

In Oniguruma, `\x` is an escape for the `NUL` character (equivalent to `\0`, `\x00`, etc.) if it's not followed by `{` or a hexadecimal digit.

In this library, bare `\x` throws an error.

Additional behavior details for `\x` in Oniguruma:

- `\x` is an error if followed by a `{` that's followed by a hexadecimal digit but doesn't form a valid `\x{…}` code point escape. Ex: `\x{F` and `\x{0,2}` are errors.
- `\x` matches a literal `x` if followed by a `{` that isn't followed by a hexadecimal digit. Ex: `\x{` matches `x{`, `\x{G` matches `x{G`, and `\x{,2}` matches 0–2 `x` characters, since `{,2}` is a quantifier with an implicit 0 min.
- In Oniguruma 6.9.10 and earlier ([report](https://github.com/kkos/oniguruma/issues/343)), `\x` matches a literal `x` if it appears at the very end of a pattern. *This is a bug.*

In future versions, parsing of `\x` will follow the Oniguruma rules above (excluding bugs), removing some cases where it currently errors.
</details>

<details>
  <summary>Pattern-terminating bare <code>\u</code></summary>

Normally, any incomplete `\uHHHH` (including bare `\u`) throws an error. However, in Oniguruma 6.9.10 and earlier ([report](https://github.com/kkos/oniguruma/issues/343)), bare `\u` matches a literal `u` if it appears at the very end of a pattern. *This is a bug.*

In this library, incomplete `\u` is always an error.
</details>

<details>
  <summary>Invalid standalone encoded bytes <code>\x80</code> to <code>\xFF</code></summary>

> **Context:** Unlike `\uHHHH` and enclosed `\x{H…}` (which match code points), Oniguruma's unenclosed `\xHH` represents an encoded byte, which means that, unlike in other regex flavors, `\x80` to `\xFF` are treated as fragments of a code unit. Ex: `[\0-\xE2\x82\xAC]` is equivalent to `[\0-\u20AC]`.

Invalid standalone encoded bytes should throw an error, but several related bugs are present in Oniguruma 6.9.10 and earlier ([report](https://github.com/kkos/oniguruma/issues/345)).

In this library, they always throw an error.

Behavior details in Oniguruma:

- Standalone `\x80` to `\xF4` throw an error.
- Standalone `\xF5` to `\xFF` fail to match anything, but don't throw. *This is a bug.*
- When used as the end value of a character class range:
  - Standalone `\x80` to `\xBF` and `\xF5` to `\xFF` are treated as `\x7F`. *This is a bug.*
  - If the range is within a negated, non-nested character class (ex: `[^\0-\xFF]`), `\xF5` to `\xFF` are treated as `\x{10FFFF}`. *This is a bug.*
</details>

## 🔢 Oniguruma version

All versions of this library to date have followed the rules of Oniguruma 6.9.10 (released 2025-01-01), which uses Unicode 16.0.0.

At least since Oniguruma 6.0.0 (released 2016-05-09), regex syntax changes in [new versions](https://github.com/kkos/oniguruma/blob/master/HISTORY) have been backward compatible. Some versions added new syntax that was previously an error (such as new Unicode property names), and in a few cases, edge case parsing bugs were fixed.

> Oniguruma 6.9.8 (released 2022-04-29) is an important baseline for JavaScript projects, since that's the version used by [vscode-oniguruma](https://github.com/microsoft/vscode-oniguruma) 1.7.0 to the latest 2.0.1. It's therefore used in recent versions of various projects, including VS Code and Shiki. However, the regex syntax differences between Oniguruma 6.9.8 and 6.9.10 are so minor that this is a non-issue.

## 🧩 Contributing

Contributions are welcome. See the [guide](https://github.com/slevithan/oniguruma-parser/blob/main/CONTRIBUTING.md) to help you get started.

## 🏷️ About

Created by [Steven Levithan](https://github.com/slevithan) and [contributors](https://github.com/slevithan/oniguruma-parser/graphs/contributors).

### Sponsors and backers

[<img src="https://github.com/roboflow.png" width="40" height="40">](https://github.com/roboflow)

### Past sponsors

[<img src="https://github.com/antfu.png" width="40" height="40">](https://github.com/antfu)
[<img src="https://github.com/brc-dd.png" width="40" height="40">](https://github.com/brc-dd)

If you want to support this project, I'd love your help by contributing improvements ([guide](https://github.com/slevithan/oniguruma-parser/blob/main/CONTRIBUTING.md)), sharing it with others, or [sponsoring](https://github.com/sponsors/slevithan) ongoing development.

© 2025–present. MIT License.

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/oniguruma-parser?color=78C372
[npm-version-href]: https://npmjs.com/package/oniguruma-parser
[npm-downloads-src]: https://img.shields.io/npm/dm/oniguruma-parser?color=78C372
[npm-downloads-href]: https://npmjs.com/package/oniguruma-parser
[bundle-src]: https://img.shields.io/bundlejs/size/oniguruma-parser?color=78C372&label=minzip
[bundle-href]: https://bundlejs.com/?q=oniguruma-parser&treeshake=[*]
