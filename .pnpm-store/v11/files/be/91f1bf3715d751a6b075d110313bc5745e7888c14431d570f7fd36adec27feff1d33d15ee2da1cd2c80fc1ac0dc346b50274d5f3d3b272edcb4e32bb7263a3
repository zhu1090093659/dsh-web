# Oniguruma (鬼車) to ES

“I think \[Oniguruma-To-ES] is very wonderful”<br>
— K. Kosako, creator of Oniguruma

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]

[Oniguruma](https://github.com/kkos/oniguruma) is a regular expression engine written in C that's used in Ruby (via a fork named Onigmo), PHP (`mb_ereg`, etc.), TextMate grammars (used by VS Code, [Shiki](https://shiki.style/), etc. for syntax highlighting), and many other tools.

Oniguruma-To-ES is an advanced **Oniguruma to JavaScript regex translator** that runs in the browser or the server, with support for ~99.99% of Oniguruma regexes (more details below). Use it to:

- Take advantage of Oniguruma's many extended regex features in JavaScript.
- Run regexes written for Oniguruma from JavaScript.
- Share regexes across your Ruby or PHP and JavaScript code.

Compared to running the Oniguruma C library via WASM using [vscode-oniguruma](https://github.com/microsoft/vscode-oniguruma), this library is ~4% of the size and its regexes often run much faster (even including transpilation time) since they run as native JavaScript.

> [!TIP]
> You can further reduce bundle size (and increase run-time performance) by precompiling your regexes. In many cases, that avoids the need for any run-time dependency. Conversions for regexes that use certain advanced features rely on a `RegExp` subclass, in which case the tree-shakable `EmulatedRegExp` (3 kB minzip) is still needed after precompilation.

Oniguruma-To-ES deeply understands the hundreds of large and small differences between Oniguruma and JavaScript regex syntax and behavior, across multiple JavaScript version targets. It's *obsessive* about ensuring that the emulated features it supports have exactly the same behavior, even in extreme edge cases. And it's been battle-tested on tens of thousands of real-world Oniguruma regexes used in TextMate grammars. It's built on top of [oniguruma-parser](https://github.com/slevithan/oniguruma-parser) and [Regex+](https://github.com/slevithan/regex), both by the same author as this library.

## 🧪 [Try the demo REPL](https://slevithan.github.io/oniguruma-to-es/demo/)

## 📜 Contents

- [Examples](#-examples)
- [Install and use](#️-install-and-use)
- [API](#-api): [`toRegExp`](#toregexp), [`toRegExpDetails`](#toregexpdetails), [`EmulatedRegExp`](#emulatedregexp)
- [Options](#-options): [`accuracy`](#accuracy), [`avoidSubclass`](#avoidsubclass), [`flags`](#flags), [`global`](#global), [`hasIndices`](#hasindices), [`lazyCompileLength`](#lazycompilelength), [`rules`](#rules), [`target`](#target), [`verbose`](#verbose)
- [Supported features](#-supported-features)
- [Unsupported features](#-unsupported-features)
- [Unicode](#-unicode)

## 🪧 Examples

```js
import {toRegExp} from 'oniguruma-to-es';

toRegExp(String.raw`(?x)
  (?<n>\d) (?<n>\p{greek}) \k<n>
  ([0a-z&&\h]){,2}
`);
// → /(?<n>\p{Nd})(\p{sc=Greek})(?>\2|\1)(?:[[0a-z]&&\p{AHex}]){0,2}/v
```

Although the example above is fairly straightforward, it shows several kinds of differences being translated:

- **New flags:** JavaScript regexes don't support flag `x` for insignificant whitespace and comments.
- **New syntax:** JavaScript doesn't include standalone flag modifiers like `(?x)` or the `\h` hex-digit shorthand. *Note: ES2025 added support for flag groups like `(?i:…)`.*
- **Different syntax rules:** JavaScript doesn't allow duplicate group names in the same alternation path, requires a prefix and specific casing for Unicode scripts like `Greek`, requires nested character classes for intersection of union and ranges, and doesn't allow an implicit `0` min for `{…}` quantifiers.
- **Different behavior:** Oniguruma's `\d` is Unicode based by default, backreferences to duplicate group names match the captured value of any of the groups, and `(…)` groups are noncapturing by default if named groups are present.

Many advanced features are supported that would produce more complicated transformations.

> [!NOTE]
> The `(?>…)` atomic group shown in the result was a simplification for readability. Since JavaScript doesn't support atomic groups, the actual result uses `(?=(\2|\1))\3` for the same effect, and then uses a `RegExp` subclass to automatically remove the added capturing group from reported matches.

This next example shows support for Unicode case folding with mixed case-sensitivity. Notice that code points `ſ` ([U+017F](https://codepoints.net/U+017F)) and `K` ([U+212A](https://codepoints.net/U+212A)) are added to the second, case-insensitive range if using a `target` prior to `ES2025`, and that modern JavaScript regex features (like flag groups) are used if supported by the `target`.

```js
toRegExp('[a-z](?i)[a-z]', {target: 'ES2018'});
// → /[a-z][a-zA-ZſK]/u
toRegExp('[a-z](?i)[a-z]', {target: 'ES2025'});
// → /[a-z](?i:[a-z])/v
```

## 🕹️ Install and use

```sh
npm install oniguruma-to-es
```

```js
import {toRegExp} from 'oniguruma-to-es';

const str = '…';
const pattern = '…';
// Works with all string/regexp methods since it returns a native regexp
str.match(toRegExp(pattern));
```

<details>
  <summary>Using a CDN and global name</summary>

```html
<script src="https://cdn.jsdelivr.net/npm/oniguruma-to-es/dist/index.min.js"></script>
<script>
  const {toRegExp} = OnigurumaToEs;
</script>
```
</details>

## 🔑 API

### `toRegExp`

Accepts an Oniguruma pattern and returns an equivalent JavaScript `RegExp`.

> [!TIP]
> Try it in the [demo REPL](https://slevithan.github.io/oniguruma-to-es/demo/).

```ts
function toRegExp(
  pattern: string,
  options?: ToRegExpOptions
): RegExp | EmulatedRegExp;
```

#### Type `ToRegExpOptions`

```ts
type ToRegExpOptions = {
  accuracy?: 'default' | 'strict';
  avoidSubclass?: boolean;
  flags?: string;
  global?: boolean;
  hasIndices?: boolean;
  lazyCompileLength?: number;
  rules?: {
    allowOrphanBackrefs?: boolean;
    asciiWordBoundaries?: boolean;
    captureGroup?: boolean;
    recursionLimit?: number;
    singleline?: boolean;
  };
  target?: 'auto' | 'ES2025' | 'ES2024' | 'ES2018';
  verbose?: boolean;
};
```

See [Options](#-options) for more details.

### `toRegExpDetails`

Accepts an Oniguruma pattern and returns the details needed to construct an equivalent JavaScript `RegExp`.

```ts
function toRegExpDetails(
  pattern: string,
  options?: ToRegExpOptions
): {
  pattern: string;
  flags: string;
  options?: EmulatedRegExpOptions;
};
```

Note that the returned `flags` might also be different than those provided, as a result of the emulation process. The returned `pattern`, `flags`, and `options` properties can be provided as arguments to the `EmulatedRegExp` constructor to produce the same result as `toRegExp`.

If the only keys returned are `pattern` and `flags`, they can optionally be provided to JavaScript's `RegExp` constructor instead. Setting option `avoidSubclass` to `true` ensures that this is always the case (resulting in an error for any patterns that require `EmulatedRegExp`'s additional handling).

### `EmulatedRegExp`

Works the same as JavaScript's native `RegExp` constructor in all contexts, but can be given results from `toRegExpDetails` to produce the same result as `toRegExp`.

```ts
class EmulatedRegExp extends RegExp {
  constructor(pattern: string, flags?: string, options?: EmulatedRegExpOptions);
  constructor(pattern: EmulatedRegExp, flags?: string);
  rawOptions: EmulatedRegExpOptions;
}
```

The `rawOptions` property of `EmulatedRegExp` instances can be used for serialization.

#### Type `EmulatedRegExpOptions`

```ts
type EmulatedRegExpOptions = {
  hiddenCaptures?: Array<number>;
  lazyCompile?: boolean;
  strategy?: string | null;
  transfers?: Array<[number, Array<number>]>;
};
```

## 🔩 Options

The following options are shared by functions [`toRegExp`](#toregexp) and [`toRegExpDetails`](#toregexpdetails).

### `accuracy`

One of `'default'` *(default)* or `'strict'`.

Sets the level of emulation rigor/strictness.

- **Default:** Permits a few close approximations in order to support additional features.
- **Strict:** Error if the pattern can't be emulated with identical behavior (even in rare edge cases) for the given `target`.

<details>
  <summary>More details</summary>

Using default `accuracy` adds support for the following features, depending on `target`:

- All targets (`ES2025` and earlier):
  - Enables use of `\X` using a close approximation of a Unicode extended grapheme cluster.
  - Enables combining lookbehind with uncommon uses of `\G` that rely on subclass-based emulation.
- `ES2024` and earlier:
  - Enables use of case-insensitive backreferences to case-sensitive groups.
- `ES2018`:
  - Enables use of POSIX classes `[:graph:]` and `[:print:]` using ASCII versions rather than the Unicode versions available for `ES2024` and later. Other POSIX classes are always Unicode based.
</details>

### `avoidSubclass`

*Default: `false`.*

Disables advanced emulation that relies on returning a `RegExp` subclass. In cases when a subclass would otherwise have been used, this results in one of the following:

- An error is thrown for patterns that are not emulatable without a subclass.
- Some patterns can still be emulated accurately without a subclass, but in this case *subpattern* match details might differ from Oniguruma.
  - This is only relevant if you access the subpattern details of match results in your code (via subpattern array indices, `groups`, and `indices`).

### `flags`

Oniguruma flags; a string with `i`, `m`, `x`, `D`, `S`, `W`, `y{g}` in any order (all optional).

Flags `i`, `m`, `x` can also be specified via modifiers in the pattern.

> [!IMPORTANT]
> Oniguruma and JavaScript both have an `m` flag but with different meanings. Oniguruma's `m` is equivalent to JavaScript's `s` (`dotAll`).

### `global`

*Default: `false`.*

Include JavaScript flag `g` (`global`) in the result.

### `hasIndices`

*Default: `false`.*

Include JavaScript flag `d` (`hasIndices`) in the result.

### `lazyCompileLength`

*Default: `Infinity`. In other words, lazy compilation is off by default.*

Delay regex construction until first use if the transpiled pattern is at least this length.

Although regex construction in JavaScript is fast, it can sometimes be helpful to defer the cost for extremely long patterns. Lazy compilation defers the time JavaScript spends inside the `RegExp` constructor (building the transpiled pattern into a regex object) until the first time the regex is used in a search. The regex object is outwardly identical before and after deferred compilation.

Lazy compilation relies on the `EmulatedRegExp` class.

### `rules`

Advanced options that override standard behavior, error checking, and flags when enabled.

- `allowOrphanBackrefs`: Useful with TextMate grammars that merge backreferences across patterns.
- `asciiWordBoundaries`: Use ASCII `\b` and `\B`, which increases search performance of generated regexes.
- `captureGroup`: Allow unnamed captures and numbered calls (backreferences and subroutines) when using named capture.
  - This is Oniguruma option `ONIG_OPTION_CAPTURE_GROUP`; on by default in `vscode-oniguruma`.
- `recursionLimit`: Change the recursion depth limit from Oniguruma's `20` to an integer `2`–`20`.
- `singleline`: `^` as `\A`; `$` as `\Z`. Improves search performance of generated regexes without changing the meaning if searching line by line.
  - This is Oniguruma option `ONIG_OPTION_SINGLELINE`.

### `target`

One of `'auto'` *(default)*, `'ES2025'`, `'ES2024'`, or `'ES2018'`.

JavaScript version used for generated regexes. Using `auto` detects the best value for your environment. Later targets enable faster transpilation, simpler generated source, and support for additional features.

<details>
  <summary>More details</summary>

- `ES2018`: Uses JS flag `u`.
  - Emulation restrictions: Character class intersection and some uses of nested, negated character classes aren't supported.
  - Generated regexes might use ES2018 features that require Node.js 10 or a browser version released during 2018 to 2023 (in Safari's case). Minimum requirement for any regex is Node.js 6 or a 2016-era browser.
- `ES2024`: Uses JS flag `v`.
  - No emulation restrictions.
  - Generated regexes require Node.js 20 or any 2023-era browser ([compat table](https://caniuse.com/mdn-javascript_builtins_regexp_unicodesets)).
- `ES2025`: Uses JS flag `v` and allows use of flag groups.
  - Benefits: Faster transpilation, simpler generated source.
  - Generated regexes might use features that require Node.js 23 or a browser version released during 2024 to 2025 (in Safari's case).
</details>

### `verbose`

*Default: `false`.*

Disables minifications that simplify the pattern without changing the meaning.

Example: By default, unneeded noncapturing groups might be removed during transpilation. Setting this option to `true` disables such changes.

> [!TIP]
> The [oniguruma-parser](https://github.com/slevithan/oniguruma-parser) library includes a [regex optimizer](https://github.com/slevithan/oniguruma-parser/blob/main/src/optimizer/README.md) that goes far beyond the basic, built-in minifications. If desired, you can call the optimizer first, and then use its result for transpilation. That isn't appropropriate in all cases (since it adds performance overhead and increases bundle size), but the benefits of optimization do pass through to the transpiled, JavaScript version of a regex.

## ✅ Supported features

Following are the supported features by target. The official Oniguruma [syntax doc](https://github.com/kkos/oniguruma/blob/master/doc/RE) doesn't cover many of the finer details described here.

> [!NOTE]
> Targets `ES2024` and `ES2025` have the same emulation capabilities. Resulting regexes might have different source and flags, but they match the same strings. See [`target`](#target).

🆕 = Syntax not available in JavaScript.<br>
🆚 = JavaScript uses slightly different syntax for the same concept; ex: `\x{…}` → `\u{…}`.

Even for features not marked with one of the above symbols, notice that nearly every feature below has at least subtle differences from JavaScript. Unsupported features throw an error.

<table>
  <tr>
    <th colspan="2">Feature</th>
    <th>Example</th>
    <th>ES2018</th>
    <th>ES2024+</th>
    <th>Subfeatures &amp; JS differences</th>
  </tr>

  <tr valign="top">
    <th align="left" rowspan="9">Characters</th>
    <td>Literal</td>
    <td><code>E</code>, <code>!</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Code point based matching (same as JS with flag <code>u</code>, <code>v</code>)<br>
      ✔ Standalone <code>]</code>, <code>{</code>, <code>}</code> don't require escaping<br>
    </td>
  </tr>
  <tr valign="top">
    <td>Identity escape</td>
    <td><code>\E</code>, <code>\!</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Different set than JS<br>
      ✔ Allows multibyte chars<br>
    </td>
  </tr>
  <tr valign="top">
    <td>Escaped metachar</td>
    <td><code>\\</code>, <code>\.</cpde></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Same as JS<br>
    </td>
  </tr>
  <tr valign="top">
    <td>Control code escape</td>
    <td><code>\t</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ The JS set plus <code>\a</code>, <code>\e</code><br>
    </td>
  </tr>
  <tr valign="top">
    <td><code>\xNN</code></td>
    <td><code>\x7F</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Allows 1 hex digit<br>
      ✔ Above <code>7F</code>, is UTF-8 encoded byte (≠ JS)<br>
      ✔ Error for invalid encoded bytes<br>
    </td>
  </tr>
  <tr valign="top">
    <td><code>\uNNNN</code></td>
    <td><code>\uFFFF</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Same as JS with flag <code>u</code>, <code>v</code><br>
    </td>
  </tr>
  <tr valign="top">
    <td>🆚 <code>\x{…}</code></td>
    <td><code>\x{A}</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Allows leading 0s up to 8 total hex digits<br>
    </td>
  </tr>
  <tr valign="top">
    <td>Escaped num</td>
    <td><code>\20</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Can be backref, error, null, octal, identity escape, or any of these combined with literal digits, based on complex rules that differ from JS<br>
      ✔ Always handles escaped single digit 1-9 outside char class as backref<br>
      ✔ Allows null with 1-3 0s<br>
      ✔ Error for octal ≥ <code>200</code><br>
    </td>
  </tr>
  <tr valign="top">
    <td>Caret notation</td>
    <td>
      <code>\cA</code>,<br>
      🆚 <code>\C-A</code>
    </td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ With A-Za-z (JS: only <code>\c</code> form)<br>
    </td>
  </tr>

  <tr valign="top">
    <th align="left" rowspan="10">Character sets</th>
    <td>Digit</td>
    <td><code>\d</code>, <code>\D</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Unicode by default (≠ JS)<br>
    </td>
  </tr>
  <tr valign="top">
    <td>Word</td>
    <td><code>\w</code>, <code>\W</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Unicode by default (≠ JS)<br>
    </td>
  </tr>
  <tr valign="top">
    <td>Whitespace</td>
    <td><code>\s</code>, <code>\S</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Unicode by default<br>
      ✔ No JS adjustments to Unicode set (−<code>\uFEFF</code>, +<code>\x85</code>)<br>
    </td>
  </tr>
  <tr valign="top">
    <td>🆕 Hex digit</td>
    <td><code>\h</code>, <code>\H</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ ASCII<br>
    </td>
  </tr>
  <tr valign="top">
    <td>Dot</td>
    <td><code>.</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Excludes only <code>\n</code> (≠ JS)<br>
    </td>
  </tr>
  <tr valign="top">
    <td>🆕 Any</td>
    <td><code>\O</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Any char (with any flags)<br>
      ✔ Identity escape in char class<br>
    </td>
  </tr>
  <tr valign="top">
    <td>🆕 Not <code>\n</code></td>
    <td><code>\N</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Identity escape in char class<br>
    </td>
  </tr>
  <tr valign="top">
    <td>🆕 Newline</td>
    <td><code>\R</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Matched atomically<br>
      ✔ Identity escape in char class<br>
    </td>
  </tr>
  <tr valign="top">
    <td>🆕 Grapheme</td>
    <td><code>\X</code></td>
    <td align="middle">☑️</td>
    <td align="middle">☑️</td>
    <td>
      ● Uses a close approximation<br>
      ✔ Matched atomically<br>
      ✔ Identity escape in char class<br>
    </td>
  </tr>
  <tr valign="top">
    <td>Unicode property</td>
    <td>
      <code>\p{L}</code>,<br>
      <code>\P{L}</code>
    </td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Binary properties<br>
      ✔ Categories<br>
      ✔ Scripts<br>
      ✔ Aliases<br>
      ✔ POSIX properties<br>
      ✔ Invert with <code>\p{^…}</code>, <code>\P{^…}</code><br>
      ✔ Insignificant spaces, hyphens, underscores, and casing in names<br>
      ✔ <code>\p</code>, <code>\P</code> without <code>{</code> is an identity escape<br>
      ✔ Error for key prefixes<br>
      ✔ Error for props of strings<br>
      ❌ Blocks (wontfix<sup>[1]</sup>)<br>
    </td>
  </tr>

  <tr valign="top">
    <th align="left" rowspan="5">Character classes</th>
    <td>Base</td>
    <td><code>[…]</code>, <code>[^…]</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Unescaped <code>-</code> outside of range is literal in some contexts (different than JS rules in any mode)<br>
      ✔ Leading unescaped <code>]</code> is literal<br>
      ✔ Fewer chars require escaping than JS<br>
    </td>
  </tr>
  <tr valign="top">
    <td>Range</td>
    <td><code>[a-z]</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Same as JS with flag <code>u</code>, <code>v</code><br>
      ✔ Allows <code>\x{…}</code> above <code>10FFFF</code> at end of range to mean last valid code point<br>
    </td>
  </tr>
  <tr valign="top">
    <td>🆕 POSIX class</td>
    <td>
      <code>[[:word:]]</code>,<br>
      <code>[[:^word:]]</code>
    </td>
    <td align="middle">☑️<sup>[2]</sup></td>
    <td align="middle">✅</td>
    <td>
      ✔ All use Unicode definitions<br>
    </td>
  </tr>
  <tr valign="top">
    <td>Nested class</td>
    <td><code>[…[…]]</code></td>
    <td align="middle">☑️<sup>[3]</sup></td>
    <td align="middle">✅</td>
    <td>
      ✔ Same as JS with flag <code>v</code><br>
    </td>
  </tr>
  <tr valign="top">
    <td>Intersection</td>
    <td><code>[…&amp;&amp;…]</code></td>
    <td align="middle">❌</td>
    <td align="middle">✅</td>
    <td>
      ✔ Doesn't require nested classes for intersection of union and ranges<br>
      ✔ Allows empty segments<br>
    </td>
  </tr>

  <tr valign="top">
    <th align="left" rowspan="6">Assertions</th>
    <td>Line start, end</td>
    <td><code>^</code>, <code>$</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Always "multiline"<br>
      ✔ Only <code>\n</code> as newline<br>
      ✔ <code>^</code> doesn't match after string-terminating <code>\n</code><br>
    </td>
  </tr>
  <tr valign="top">
    <td>🆕 String start, end</td>
    <td><code>\A</code>, <code>\z</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Same as JS <code>^</code> <code>$</code> without JS flag <code>m</code><br>
    </td>
  </tr>
  <tr valign="top">
    <td>🆕 String end or before terminating newline</td>
    <td><code>\Z</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Only <code>\n</code> as newline<br>
    </td>
  </tr>
  <tr valign="top">
    <td>🆕 Search start</td>
    <td><code>\G</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Matches at start of match attempt (not end of prev match; advances after 0-length match)<br>
    </td>
  </tr>
  <tr valign="top">
    <td>Word boundary</td>
    <td><code>\b</code>, <code>\B</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Unicode based (≠ JS)<br>
    </td>
  </tr>
  <tr valign="top">
    <td>Lookaround</td>
    <td>
      <code>(?=…)</code>,<br>
      <code>(?!…)</code>,<br>
      <code>(?&lt;=…)</code>,<br>
      <code>(?&lt;!…)</code>
    </td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Allows variable-length quantifiers and alternation within lookbehind<br>
      ✔ Lookahead invalid within lookbehind<br>
      ✔ Capturing groups invalid within negative lookbehind<br>
      ✔ Negative lookbehind invalid within positive lookbehind<br>
    </td>
  </tr>

  <tr valign="top">
    <th align="left" rowspan="3">Quantifiers</th>
    <td>Greedy, lazy</td>
    <td><code>*</code>, <code>+?</code>, <code>{2,}</code>, etc.</td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Includes all JS forms<br>
      ✔ Adds <code>{,n}</code> for min 0<br>
      ✔ Explicit bounds have upper limit of 100,000 (unlimited in JS)<br>
      ✔ Error with assertions (same as JS with flag <code>u</code>, <code>v</code>) and directives<br>
    </td>
  </tr>
  <tr valign="top">
    <td>🆕 Possessive</td>
    <td><code>?+</code>, <code>*+</code>, <code>++</code>, <code>{3,2}</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ <code>+</code> suffix doesn't make <code>{…}</code> quantifiers possessive (creates a quantifier chain)<br>
      ✔ Reversed <code>{…}</code> ranges are possessive<br>
    </td>
  </tr>
  <tr valign="top">
    <td>🆕 Chained</td>
    <td><code>**</code>, <code>??+*</code>, <code>{2,3}+</code>, etc.</td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Further repeats the preceding repetition<br>
    </td>
  </tr>

  <tr valign="top">
    <th align="left" rowspan="4">Groups</th>
    <td>Noncapturing</td>
    <td><code>(?:…)</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Same as JS<br>
    </td>
  </tr>
  <tr valign="top">
    <td>🆕 Atomic</td>
    <td><code>(?>…)</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Supported<br>
    </td>
  </tr>
  <tr valign="top">
    <td>Capturing</td>
    <td><code>(…)</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Is noncapturing if named capture present<br>
    </td>
  </tr>
  <tr valign="top">
    <td>Named capturing</td>
    <td>
      <code>(?&lt;a>…)</code>,<br>
      🆚 <code>(?'a'…)</code>
    </td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Duplicate names allowed (including within the same alternation path) unless directly referenced by a subroutine<br>
      ✔ Error for names invalid in Oniguruma (more permissive than JS)<br>
    </td>
  </tr>

  <tr valign="top">
    <th align="left" rowspan="4">Backreferences</th>
    <td>Numbered</td>
    <td><code>\1</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Error if named capture used<br>
      ✔ Refs the most recent of a capture/subroutine set<br>
    </td>
  </tr>
  <tr valign="top">
    <td>🆕 Enclosed numbered, relative</td>
    <td>
      <code>\k&lt;1></code>,<br>
      <code>\k'1'</code>,<br>
      <code>\k&lt;-1></code>,<br>
      <code>\k'-1'</code>
    </td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Error if named capture used<br>
      ✔ Allows leading 0s<br>
      ✔ Refs the most recent of a capture/subroutine set<br>
      ✔ <code>\k</code> without <code>&lt;</code> or <code>'</code> is an identity escape<br>
    </td>
  </tr>
  <tr valign="top">
    <td>Named</td>
    <td>
      <code>\k&lt;a></code>,<br>
      🆚 <code>\k'a'</code>
    </td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ For duplicate group names, rematch any of their matches (multiplex), atomically<br>
      ✔ Refs the most recent of a capture/subroutine set (no multiplex)<br>
      ✔ Combination of multiplex and most recent of capture/subroutine set if duplicate name is indirectly created by a subroutine<br>
      ✔ Error for backref to valid group name that includes <code>-</code>/<code>+</code><br>
    </td>
  </tr>
  <tr valign="top">
    <td colspan="2">To nonparticipating groups</td>
    <td align="middle">☑️</td>
    <td align="middle">☑️</td>
    <td>
      ✔ Error if group to the right<sup>[4]</sup><br>
      ✔ Duplicate names (and subroutines) to the right not included in multiplex<br>
      ✔ Fail to match (or don't include in multiplex) ancestor groups and groups in preceding alternation paths<br>
      ❌ Some rare cases are indeterminable at compile time and use the JS behavior of matching an empty string<br>
    </td>
  </tr>

  <tr valign="top">
    <th align="left" rowspan="2">Subroutines</th>
    <td>🆕 Numbered, relative</td>
    <td>
      <code>\g&lt;1></code>,<br>
      <code>\g'1'</code>,<br>
      <code>\g&lt;-1></code>,<br>
      <code>\g'-1'</code>,<br>
      <code>\g&lt;+1></code>,<br>
      <code>\g'+1'</code>
    </td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Error if named capture used<br>
      ✔ Allows leading 0s<br>
      <br>
      <i>All subroutines (incl. named):</i><br>
      ✔ Allowed before reffed group<br>
      ✔ Can be nested (any depth)<br>
      ✔ Reuses flags from the reffed group (ignores local flags)<br>
      ✔ Replaces most recent captured values (for backrefs)<br>
      ✔ <code>\g</code> without <code>&lt;</code> or <code>'</code> is an identity escape<br>
    </td>
  </tr>
  <tr valign="top">
    <td>🆕 Named</td>
    <td>
      <code>\g&lt;a></code>,<br>
      <code>\g'a'</code>
    </td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ● Same behavior as numbered<br>
      ✔ Error if reffed group uses duplicate name<br>
    </td>
  </tr>

  <tr valign="top">
    <th align="left" rowspan="2">Recursion</th>
    <td>🆕 Full pattern</td>
    <td>
      <code>\g&lt;0></code>,<br>
      <code>\g'0'</code>
    </td>
    <td align="middle">☑️<sup>[5]</sup></td>
    <td align="middle">☑️<sup>[5]</sup></td>
    <td>
      ✔ 20-level depth limit<br>
    </td>
  </tr>
  <tr valign="top">
    <td>🆕 Numbered, relative, named</td>
    <td>
      <code>(…\g&lt;1>?…)</code>,<br>
      <code>(…\g&lt;-1>?…)</code>,<br>
      <code>(?&lt;a>…\g&lt;a>?…)</code>, etc.
    </td>
    <td align="middle">☑️<sup>[5]</sup></td>
    <td align="middle">☑️<sup>[5]</sup></td>
    <td>
      ✔ 20-level depth limit<br>
    </td>
  </tr>

  <tr valign="top">
    <th align="left" rowspan="7">Other</th>
    <td>Alternation</td>
    <td><code>…|…</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Same as JS<br>
    </td>
  </tr>
  <tr valign="top">
    <td>🆕 Absence repeater<sup>[6]</sup></td>
    <td><code>(?~…)</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Supported<br>
    </td>
  </tr>
  <tr valign="top">
    <td>🆕 Comment group</td>
    <td><code>(?#…)</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Allows escaping <code>\)</code>, <code>\\</code><br>
      ✔ Comments allowed between a token and its quantifier<br>
      ✔ Comments between a quantifier and the <code>?</code>/<code>+</code> that makes it lazy/possessive changes it to a quantifier chain<br>
    </td>
  </tr>
  <tr valign="top">
    <td>🆕 Fail<sup>[7]</sup></td>
    <td><code>(*FAIL)</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Supported<br>
    </td>
  </tr>
  <tr valign="top">
    <td>🆕 Keep</td>
    <td><code>\K</code></td>
    <td align="middle">☑️</td>
    <td align="middle">☑️</td>
    <td>
      ● Supported at top level if no top-level alternation is used<br>
    </td>
  </tr>
  <tr valign="top">
    <td colspan="2">JS features unknown to Oniguruma are handled using Oniguruma syntax rules</td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ <code>\u{…}</code> is an error<br>
      ✔ <code>[]</code>, <code>[^]</code> are errors<br>
      ✔ <code>[\q{…}]</code> matches <code>q</code>, etc.<br>
      ✔ <code>[a--b]</code> includes the invalid reversed range <code>a</code> to <code>-</code><br>
    </td>
  </tr>
  <tr valign="top">
    <td colspan="2">Invalid Oniguruma syntax</td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Error<br>
    </td>
  </tr>

  <tr valign="top">
    <th align="left" rowspan="9">Flags</th>
    <td colspan="5"><i>Supported in top-level flags and flag modifiers</i></td>
  </tr>
  <tr valign="top">
    <td>Ignore case</td>
    <td><code>i</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Unicode case folding (same as JS with flag <code>u</code>, <code>v</code>)<sup>[8]</sup><br>
    </td>
  </tr>
  <tr valign="top">
    <td>🆚 Dot all</td>
    <td><code>m</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Equivalent to JS flag <code>s</code><br>
    </td>
  </tr>
  <tr valign="top">
    <td>🆕 Extended</td>
    <td><code>x</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Unicode whitespace ignored<br>
      ✔ Line comments with <code>#</code><br>
      ✔ Whitespace/comments allowed between a token and its quantifier<br>
      ✔ Whitespace/comments between a quantifier and the <code>?</code>/<code>+</code> that makes it lazy/possessive changes it to a quantifier chain<br>
      ✔ Whitespace/comments separate tokens (ex: <code>\1 0</code>)<br>
      ✔ Whitespace and <code>#</code> not ignored in char classes<br>
    </td>
  </tr>
  <tr valign="top">
    <td colspan="5"><i>Currently supported only in top-level flags</i></td>
  </tr>
  <tr valign="top">
    <td>🆕 Digit is ASCII</td>
    <td><code>D</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ ASCII <code>\d</code>, <code>\p{Digit}</code>, etc.<br>
    </td>
  </tr>
  <tr valign="top">
    <td>🆕 Space is ASCII</td>
    <td><code>S</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ ASCII <code>\s</code>, <code>\p{Space}</code>, etc.<br>
    </td>
  </tr>
  <tr valign="top">
    <td>🆕 Word is ASCII<sup>[9]</sup></td>
    <td><code>W</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ ASCII <code>\w</code>, <code>\p{Word}</code>, <code>\b</code>, etc.<br>
    </td>
  </tr>
  <tr valign="top">
    <td>🆕 Text segment mode is grapheme</td>
    <td><code>y{g}</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Grapheme based <code>\X</code>, <code>\y</code><br>
    </td>
  </tr>

  <tr valign="top">
    <th align="left" rowspan="2" valign="top">Flag modifiers</th>
    <td>Group</td>
    <td><code>(?im-x:…)</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Unicode case folding for <code>i</code><br>
      ✔ Allows enabling and disabling the same flag (priority: disable)<br>
      ✔ Allows lone or multiple <code>-</code><br>
    </td>
  </tr>
  <tr valign="top">
    <td>🆕 Directive</td>
    <td><code>(?im-x)</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Continues until end of pattern or group (spanning alternatives)<br>
    </td>
  </tr>

  <tr valign="top">
    <th align="left" rowspan="2">Compile-time options</th>
    <td colspan="2"><code>ONIG_OPTION_CAPTURE_GROUP</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ Unnamed captures and numbered calls allowed when using named capture<br>
    </td>
  </tr>
  <tr valign="top">
    <td colspan="2"><code>ONIG_OPTION_SINGLELINE</code></td>
    <td align="middle">✅</td>
    <td align="middle">✅</td>
    <td>
      ✔ <code>^</code> → <code>\A</code><br>
      ✔ <code>$</code> → <code>\Z</code><br>
    </td>
  </tr>
</table>

The table above doesn't include all aspects that Oniguruma-To-ES emulates (including error handling, subpattern details on match results, most aspects that work the same as in JavaScript, and many aspects of non-JavaScript features that work the same in the other regex flavors that support them). Where applicable, Oniguruma-To-ES follows the latest version of Oniguruma (6.9.10).

### Footnotes

1. Unicode blocks (which in Oniguruma are specified with an `In` prefix) are easily emulatable but their character data would significantly increase library weight. They're also rarely used, fundamentally flawed, and arguably unuseful given the availability of Unicode scripts and other properties.
2. With target `ES2018`, the specific POSIX classes `[:graph:]` and `[:print:]` use ASCII versions rather than the Unicode versions available for target `ES2024` and later, and they result in an error if using strict `accuracy`.
3. Target `ES2018` has limited support for nested, negated character classes.
4. It's not an error for *numbered* backreferences to come before their referenced group in Oniguruma, but an error is the best path for Oniguruma-To-ES because ① most placements are mistakes and can never match (based on the Oniguruma behavior for backreferences to nonparticipating groups), ② erroring matches the behavior of named backreferences, and ③ the edge cases where they're matchable rely on rules for backreference resetting within quantified groups that are different in JavaScript and aren't emulatable. Note that it's not a backreference in the first place if using `\10` or higher and not as many capturing groups are defined to the left (it's an octal or identity escape).
5. Oniguruma's recursion depth limit is `20`. Oniguruma-To-ES uses the same limit by default but allows customizing it via the `rules.recursionLimit` option. Two rare uses of recursion aren't yet supported: overlapping recursions, and use of backreferences when a recursed subpattern contains captures. Patterns that would trigger an infinite recursion error in Oniguruma might find a match in Oniguruma-To-ES (since recursion is bounded), but future versions will detect this and error at transpilation time.
6. Other absence function types aren't yet supported. They start with `(?~|` and are extremely rare. Note that absence functions behave differently in Oniguruma and Onigmo.
7. Other named callouts aren't yet supported. They use the syntax `(*…)` and are extremely rare.
8. When using flag `i`, in rare cases Oniguruma can change the length of certain matches based on Unicode case conversion rules. That behavior isn't reproduced in this library because ① the rules are applied inconsistently ([report](https://github.com/kkos/oniguruma/issues/351)) and ② Oniguruma planned to disable case conversion length changes by default in future versions.
9. Combining flags `W` and `i` can result in edge case Oniguruma bugs ([report](https://github.com/kkos/oniguruma/issues/349)) that aren't reproduced in this library.

## ❌ Unsupported features

The following throw errors since they aren't yet supported. They're all extremely rare.

- Supportable:
  - Rarely-used character specifiers: Non-A-Za-z with `\cx` `\C-x`, meta `\M-x` `\M-\C-x`, octal code points `\o{…}`, and octal encoded bytes ≥ `\200`.
  - Code point sequences: `\x{H H …}` `\o{O O …}`.
  - Flags `P` (POSIX is ASCII) and `y{w}` (text segment mode is word), and whole-pattern flag `C` (don't capture group).
- Supportable for some uses:
  - Conditionals: `(?(…)…)`, etc.
  - Whole-pattern flags `I` (ignore-case is ASCII) and `L` (find longest).
  - Named callout `(*SKIP)`.
- Not supportable:
  - Text segment boundaries: `\y` `\Y`.
  - Callouts via `(?{…})`, and most named callouts.

See also the [supported features](#-supported-features) table (above), which describes some additional, rarely-used sub-features that aren't yet supported.

Despite these gaps, ~99.99% of real-world Oniguruma regexes are supported, based on a sample of ~55k regexes used in TextMate grammars. Conditionals were used in three regexes, *overlapping* recursions in three regexes, and other unsupported features weren't used at all. Some Oniguruma features are so exotic that they aren't used in *any* public code on GitHub.

## 🌏 Unicode

Oniguruma-To-ES fully supports mixed case-sensitivity (ex: `(?i)a(?-i)a`) and handles the Unicode edge cases regardless of JavaScript [target](#target).

Oniguruma-To-ES focuses on being lightweight to make it better for use in browsers. This is partly achieved by not including heavyweight Unicode character data, which imposes a few minor/rare restrictions:

- Character class intersection and some uses of nested, negated character classes are unsupported with target `ES2018`. Use target `ES2024` (supported by Node.js 20 and 2023-era browsers) or later if you need support for these features.
- With targets before `ES2025`, a handful of Unicode properties that target a specific character case (ex: `\p{Lower}`) can't be used case-insensitively in patterns that contain other characters with a specific case that are used case-sensitively.
  - In other words, almost every usage is fine, including `A\p{Lower}`, `(?i)A\p{Lower}`, `(?i:A)\p{Lower}`, `(?i)A(?-i)\p{Lower}`, and `\w(?i)\p{Lower}`, but not `A(?i)\p{Lower}`.
  - Using these properties case-insensitively is basically never done intentionally, so you're unlikely to encounter this error unless it's catching a mistake.
- Oniguruma-To-ES uses the version of Unicode supported natively by your JavaScript environment. Using Unicode properties via `\p{…}` that were added in a later version of Unicode than the environment supports results in a runtime error. This is an extreme edge case since modern JavaScript environments support recent versions of Unicode.

## 🧩 Contributing

Contributions are welcome. See the [guide](https://github.com/slevithan/oniguruma-to-es/blob/main/CONTRIBUTING.md) to help you get started.

## 👀 Similar projects

[JsRegex](https://github.com/jaynetics/js_regex) transpiles Ruby regexes to JavaScript. Ruby uses Onigmo, a fork of Oniguruma. Although JsRegex and this library have important differences, JsRegex might be a better fit for some Ruby projects.

<details>
  <summary>Some high-level differences</summary>

- Although Oniguruma and Onigmo are quite similar, there are a variety of syntax and behavior differences. Where they differ, Oniguruma typically offers the superior capabilities (for example, more flexible lookbehind).
- JsRegex is written in Ruby, so regexes must be pre-transpiled on the server to use them in JavaScript.
- JsRegex is somewhat less rigorous in its translations. It doesn't always translate edge case behavior differences, include the same level of support for advanced features, or accurately reproduce subpattern results. Sometimes these are bugs that can be fixed, but in other cases it results from more fundamental limitations such as its lack of support for subclass-based emulation.
- JsRegex isn't designed for use with TextMate grammars, so it doesn't include features that would be needed to handle them accurately.
</details>

## 🏷️ About

Oniguruma-To-ES was created by [Steven Levithan](https://github.com/slevithan) and [contributors](https://github.com/slevithan/oniguruma-to-es/graphs/contributors).

### Sponsors and backers

[<img src="https://github.com/roboflow.png" width="40" height="40">](https://github.com/roboflow)

### Past sponsors

[<img src="https://github.com/antfu.png" width="40" height="40">](https://github.com/antfu)
[<img src="https://github.com/brc-dd.png" width="40" height="40">](https://github.com/brc-dd)

### Special thanks

- [Anthony Fu](https://github.com/antfu) for inspiring the project and adopting it in Shiki.
- [RedCMD](https://github.com/RedCMD) and [tonco-miyazawa](https://github.com/tonco-miyazawa) for their deep Oniguruma expertise and frequent advice.
- [K. Kosako](https://github.com/kkos) for creating Oniguruma and maintaining it for 23 years.

If you use or want to support this project, I'd love your help by contributing improvements ([guide](https://github.com/slevithan/oniguruma-to-es/blob/main/CONTRIBUTING.md)), sharing it with others, or [sponsoring](https://github.com/sponsors/slevithan) maintenance and development.

MIT License.

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/oniguruma-to-es?color=78C372
[npm-version-href]: https://npmjs.com/package/oniguruma-to-es
[npm-downloads-src]: https://img.shields.io/npm/dm/oniguruma-to-es?color=78C372
[npm-downloads-href]: https://npmjs.com/package/oniguruma-to-es
[bundle-src]: https://img.shields.io/bundlejs/size/oniguruma-to-es?color=78C372&label=minzip
[bundle-href]: https://bundlejs.com/?q=oniguruma-to-es&treeshake=[*]
