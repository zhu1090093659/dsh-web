<div align="center">
  <img src="https://github.com/terkelg/globrex/raw/master/globrex.png" alt="globrex" width="500" />
</div>

<h1 align="center">globrex</h1>

<div align="center">
  <a href="https://npmjs.org/package/globrex">
    <img src="https://img.shields.io/npm/v/globrex.svg" alt="version" />
  </a>
  <a href="https://travis-ci.org/terkelg/globrex">
    <img src="https://img.shields.io/travis/terkelg/globrex.svg" alt="travis" />
  </a>
  <a href="https://ci.appveyor.com/project/terkelg/globrex">
    <img src="https://ci.appveyor.com/api/projects/status/ecbnb3whibj5iqcj?svg=true" alt="appveyor" />
  </a>
  <a href="https://npmjs.org/package/globrex">
    <img src="https://img.shields.io/npm/dm/globrex.svg" alt="downloads" />
  </a>
</div>

<div align="center">Simple but powerful glob to regular expression compiler.</div>

<br />


## Install

```
npm install globrex --save
```


## Core Features

- 💪 **extended globbing:** transform advance `ExtGlob` features
- 📦 **simple**: no dependencies
- 🛣️ **paths**: split paths into multiple `RegExp` segments


## Usage

```js
const globrex = require('globrex');

const result = globrex('p*uck')
// => { regex: /^p.*uck$/, string: '^p.*uck$', segments: [ /^p.*uck$/ ] }

result.regex.test('pluck'); // true
```


## API

### globrex(glob, options)

Type: `function`<br>
Returns: `Object`

Transform globs intp regular expressions.
Returns object with the following properties:


#### regex

Type: `RegExp`

JavaScript `RegExp` instance.

> **Note**: Read more about how to use [RegExp](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp) on MDN.


#### path

This property only exists if the option `filepath` is true.

> **Note:** `filepath` is `false` by default

#### path.segments

Type: `Array`

Array of `RegExp` instances seperated by `/`. 
This can be usable when working with file paths or urls. 

Example array could be:
```js
[ /^foo$/, /^bar$/, /^([^\/]*)$/, '^baz\\.(md|js|txt)$' ]
```


#### path.regex

Type: `RegExp`

JavaScript `RegExp` instance build for testign against paths.
The regex have different path seperators depending on host OS.


### glob

Type: `String`

Glob string to transform.


### options.extended

Type: `Boolean`<br>
Default: `false`

Enable all advanced features from `extglob`.

Matching so called "extended" globs pattern like single character matching, matching ranges of characters, group matching, etc.

> **Note**: Interprets `[a-d]` as `[abcd]`. To match a literal `-`, include it as first or last character.


### options.globstar

Type: `Boolean`<br>
Default: `false`

When globstar is `false` globs like `'/foo/*'` are transformed to the following
`'^\/foo\/.*$'` which will match any string beginning with `'/foo/'`.

When the globstar option is `true`, the same `'/foo/*'` glob is transformed to
`'^\/foo\/[^/]*$'` which will match any string beginning with `'/foo/'` that **does not have** a `'/'` to the right of it. `'/foo/*'` will match: `'/foo/bar'`, `'/foo/bar.txt'` but not `'/foo/bar/baz'` or `'/foo/bar/baz.txt'`.

> **Note**: When globstar is `true`, `'/foo/**'` is equivelant to `'/foo/*'` when globstar is `false`.


### options.strict

Type: `Boolean`<br>
Default: `false`

Be forgiving about mutiple slashes, like `///` and make everything after the first `/` optional. This is how bash glob works.


### options.flags

Type: `String`<br>
Default: `''`

RegExp flags (e.g. `'i'` ) to pass to the RegExp constructor.


### options.filepath

Type: `Boolean`<br>
Default: `false`

Parse input strings as it was a file path for special path related features. This feature only makes sense if the input is a POSIX path like `/foo/bar/hello.js` or URLs.

When `true` the returned object will have an additional `path` object.

- `segment`: Array containing a `RegExp` object for each path segment.
- `regex`: OS specific file path `RegExp`. Path seperator used is based on the operating system.
- `globstar`: Regex string used to test for globstars.

> **Note: Please only use forward-slashes in file path glob expressions**
> Though windows uses either `/` or `\` as its path separator, only `/`
> characters are used by this glob implementation.  You must use
> forward-slashes **only** in glob expressions. Back-slashes will always
> be interpreted as escape characters, not path separators.


## References

Learn more about advanced globbing here
- [mywiki.wooledge.org/glob](http://mywiki.wooledge.org/glob)
- [linuxjournal](http://www.linuxjournal.com/content/bash-extended-globbing)


## License

MIT © [Terkel Gjervig](https://terkel.com)
