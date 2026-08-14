var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.js
var index_exports = {};
__export(index_exports, {
  EmulatedRegExp: () => EmulatedRegExp,
  toRegExp: () => toRegExp,
  toRegExpDetails: () => toRegExpDetails
});
module.exports = __toCommonJS(index_exports);

// src/utils.js
var cp = String.fromCodePoint;
var r = String.raw;
var envFlags = {};
var globalRegExp = globalThis.RegExp;
envFlags.flagGroups = (() => {
  try {
    new globalRegExp("(?i:)");
  } catch {
    return false;
  }
  return true;
})();
envFlags.unicodeSets = (() => {
  try {
    new globalRegExp("[[]]", "v");
  } catch {
    return false;
  }
  return true;
})();
envFlags.bugFlagVLiteralHyphenIsRange = envFlags.unicodeSets ? (() => {
  try {
    new globalRegExp(r`[\d\-a]`, "v");
  } catch {
    return true;
  }
  return false;
})() : false;
envFlags.bugNestedClassIgnoresNegation = envFlags.unicodeSets && new globalRegExp("[[^a]]", "v").test("a");
function getNewCurrentFlags(current, { enable, disable }) {
  return {
    dotAll: !disable?.dotAll && !!(enable?.dotAll || current.dotAll),
    ignoreCase: !disable?.ignoreCase && !!(enable?.ignoreCase || current.ignoreCase)
  };
}
function getOrInsert(map, key, defaultValue) {
  if (!map.has(key)) {
    map.set(key, defaultValue);
  }
  return map.get(key);
}
function isMinTarget(target, min) {
  return EsVersion[target] >= EsVersion[min];
}
function throwIfNullish(value, msg) {
  if (value == null) {
    throw new Error(msg ?? "Value expected");
  }
  return value;
}

// src/options.js
var EsVersion = {
  ES2025: 2025,
  ES2024: 2024,
  ES2018: 2018
};
var Target = (
  /** @type {const} */
  {
    auto: "auto",
    ES2025: "ES2025",
    ES2024: "ES2024",
    ES2018: "ES2018"
  }
);
function getOptions(options = {}) {
  if ({}.toString.call(options) !== "[object Object]") {
    throw new Error("Unexpected options");
  }
  if (options.target !== void 0 && !Target[options.target]) {
    throw new Error(`Unexpected target "${options.target}"`);
  }
  const opts = {
    // Sets the level of emulation rigor/strictness.
    accuracy: "default",
    // Disables advanced emulation that relies on returning a `RegExp` subclass, resulting in
    // certain patterns not being emulatable.
    avoidSubclass: false,
    // Oniguruma flags; a string with `i`, `m`, `x`, `D`, `S`, `W`, `y{g}` in any order (all
    // optional). Oniguruma's `m` is equivalent to JavaScript's `s` (`dotAll`).
    flags: "",
    // Include JavaScript flag `g` (`global`) in the result.
    global: false,
    // Include JavaScript flag `d` (`hasIndices`) in the result.
    hasIndices: false,
    // Delay regex construction until first use if the transpiled pattern is at least this length.
    lazyCompileLength: Infinity,
    // JavaScript version used for generated regexes. Using `auto` detects the best value based on
    // your environment. Later targets allow faster processing, simpler generated source, and
    // support for additional features.
    target: "auto",
    // Disables minifications that simplify the pattern without changing the meaning.
    verbose: false,
    ...options,
    // Advanced options that override standard behavior, error checking, and flags when enabled.
    rules: {
      // Useful with TextMate grammars that merge backreferences across patterns.
      allowOrphanBackrefs: false,
      // Use ASCII `\b` and `\B`, which increases search performance of generated regexes.
      asciiWordBoundaries: false,
      // Allow unnamed captures and numbered calls (backreferences and subroutines) when using
      // named capture. This is Oniguruma option `ONIG_OPTION_CAPTURE_GROUP`; on by default in
      // `vscode-oniguruma`.
      captureGroup: false,
      // Change the recursion depth limit from Oniguruma's `20` to an integer `2`–`20`.
      recursionLimit: 20,
      // `^` as `\A`; `$` as`\Z`. Improves search performance of generated regexes without changing
      // the meaning if searching line by line. This is Oniguruma option `ONIG_OPTION_SINGLELINE`.
      singleline: false,
      ...options.rules
    }
  };
  if (opts.target === "auto") {
    opts.target = envFlags.flagGroups ? "ES2025" : envFlags.unicodeSets ? "ES2024" : "ES2018";
  }
  return opts;
}

// node_modules/.pnpm/oniguruma-parser@0.12.2/node_modules/oniguruma-parser/dist/utils.js
function r2(e) {
  if ([...e].length !== 1) throw new Error(`Expected "${e}" to be a single code point`);
  return e.codePointAt(0);
}
function l(e, t, n) {
  return e.has(t) || e.set(t, n), e.get(t);
}
var i = /* @__PURE__ */ new Set(["alnum", "alpha", "ascii", "blank", "cntrl", "digit", "graph", "lower", "print", "punct", "space", "upper", "word", "xdigit"]);
var o = String.raw;
function u(e, t) {
  if (e == null) throw new Error(t ?? "Value expected");
  return e;
}

// node_modules/.pnpm/oniguruma-parser@0.12.2/node_modules/oniguruma-parser/dist/tokenizer/tokenize.js
var m = o`\[\^?`;
var b = `c.? | C(?:-.?)?|${o`[pP]\{(?:\^?[-\x20_]*[A-Za-z][-\x20\w]*\})?`}|${o`x[89A-Fa-f]\p{AHex}(?:\\x[89A-Fa-f]\p{AHex})*`}|${o`u(?:\p{AHex}{4})? | x\{[^\}]*\}? | x\p{AHex}{0,2}`}|${o`o\{[^\}]*\}?`}|${o`\d{1,3}`}`;
var y = /[?*+][?+]?|\{(?:\d+(?:,\d*)?|,\d+)\}\??/;
var C = new RegExp(o`
  \\ (?:
    ${b}
    | [gk]<[^>]*>?
    | [gk]'[^']*'?
    | .
  )
  | \( (?:
    \? (?:
      [:=!>({]
      | <[=!]
      | <[^>]*>
      | '[^']*'
      | ~\|?
      | #(?:[^)\\]|\\.?)*
      | [^:)]*[:)]
    )?
    | \*[^\)]*\)?
  )?
  | (?:${y.source})+
  | ${m}
  | .
`.replace(/\s+/g, ""), "gsu");
var T = new RegExp(o`
  \\ (?:
    ${b}
    | .
  )
  | \[:(?:\^?\p{Alpha}+|\^):\]
  | ${m}
  | &&
  | .
`.replace(/\s+/g, ""), "gsu");
function M(e, n = {}) {
  const t = { flags: "", ...n, rules: { captureGroup: false, singleline: false, ...n.rules } };
  if (typeof e != "string") throw new Error("String expected as pattern");
  const o3 = Y(t.flags), s2 = [o3.extended], a2 = { captureGroup: t.rules.captureGroup, getCurrentModX() {
    return s2.at(-1);
  }, numOpenGroups: 0, popModX() {
    s2.pop();
  }, pushModX(u2) {
    s2.push(u2);
  }, replaceCurrentModX(u2) {
    s2[s2.length - 1] = u2;
  }, singleline: t.rules.singleline };
  let r4 = [], i2;
  for (C.lastIndex = 0; i2 = C.exec(e); ) {
    const u2 = F(a2, e, i2[0], C.lastIndex);
    u2.tokens ? r4.push(...u2.tokens) : u2.token && r4.push(u2.token), u2.lastIndex !== void 0 && (C.lastIndex = u2.lastIndex);
  }
  const l3 = [];
  let c = 0;
  r4.filter((u2) => u2.type === "GroupOpen").forEach((u2) => {
    u2.kind === "capturing" ? u2.number = ++c : u2.raw === "(" && l3.push(u2);
  }), c || l3.forEach((u2, S2) => {
    u2.kind = "capturing", u2.number = S2 + 1;
  });
  const g = c || l3.length;
  return { tokens: r4.map((u2) => u2.type === "EscapedNumber" ? ee(u2, g) : u2).flat(), flags: o3 };
}
function F(e, n, t, o3) {
  const [s2, a2] = t;
  if (t === "[" || t === "[^") {
    const r4 = K(n, t, o3);
    return { tokens: r4.tokens, lastIndex: r4.lastIndex };
  }
  if (s2 === "\\") {
    if ("AbBGyYzZ".includes(a2)) return { token: w(t, t) };
    if (/^\\g[<']/.test(t)) {
      if (!/^\\g(?:<[^>]+>|'[^']+')$/.test(t)) throw new Error(`Invalid group name "${t}"`);
      return { token: R(t) };
    }
    if (/^\\k[<']/.test(t)) {
      if (!/^\\k(?:<[^>]+>|'[^']+')$/.test(t)) throw new Error(`Invalid group name "${t}"`);
      return { token: A(t) };
    }
    if (a2 === "K") return { token: I("keep", t) };
    if (a2 === "N" || a2 === "R") return { token: k("newline", t, { negate: a2 === "N" }) };
    if (a2 === "O") return { token: k("any", t) };
    if (a2 === "X") return { token: k("text_segment", t) };
    const r4 = x(t, { inCharClass: false });
    return Array.isArray(r4) ? { tokens: r4 } : { token: r4 };
  }
  if (s2 === "(") {
    if (a2 === "*") return { token: j(t) };
    if (t === "(?{") throw new Error(`Unsupported callout "${t}"`);
    if (t.startsWith("(?#")) {
      if (n[o3] !== ")") throw new Error('Unclosed comment group "(?#"');
      return { lastIndex: o3 + 1 };
    }
    if (/^\(\?[-imx]+[:)]$/.test(t)) return { token: L(t, e) };
    if (e.pushModX(e.getCurrentModX()), e.numOpenGroups++, t === "(" && !e.captureGroup || t === "(?:") return { token: f("group", t) };
    if (t === "(?>") return { token: f("atomic", t) };
    if (t === "(?=" || t === "(?!" || t === "(?<=" || t === "(?<!") return { token: f(t[2] === "<" ? "lookbehind" : "lookahead", t, { negate: t.endsWith("!") }) };
    if (t === "(" && e.captureGroup || t.startsWith("(?<") && t.endsWith(">") || t.startsWith("(?'") && t.endsWith("'")) return { token: f("capturing", t, { ...t !== "(" && { name: t.slice(3, -1) } }) };
    if (t.startsWith("(?~")) {
      if (t === "(?~|") throw new Error(`Unsupported absence function kind "${t}"`);
      return { token: f("absence_repeater", t) };
    }
    throw t === "(?(" ? new Error(`Unsupported conditional "${t}"`) : new Error(`Invalid or unsupported group option "${t}"`);
  }
  if (t === ")") {
    if (e.popModX(), e.numOpenGroups--, e.numOpenGroups < 0) throw new Error('Unmatched ")"');
    return { token: Q(t) };
  }
  if (e.getCurrentModX()) {
    if (t === "#") {
      const r4 = n.indexOf(`
`, o3);
      return { lastIndex: r4 === -1 ? n.length : r4 };
    }
    if (/^\s$/.test(t)) {
      const r4 = /\s+/y;
      return r4.lastIndex = o3, { lastIndex: r4.exec(n) ? r4.lastIndex : o3 };
    }
  }
  if (t === ".") return { token: k("dot", t) };
  if (t === "^" || t === "$") {
    const r4 = e.singleline ? { "^": o`\A`, $: o`\Z` }[t] : t;
    return { token: w(r4, t) };
  }
  return t === "|" ? { token: P(t) } : y.test(t) ? { tokens: te(t) } : { token: d(r2(t), t) };
}
function K(e, n, t) {
  const o3 = [E(n[1] === "^", n)];
  let s2 = 1, a2;
  for (T.lastIndex = t; a2 = T.exec(e); ) {
    const r4 = a2[0];
    if (r4[0] === "[" && r4[1] !== ":") s2++, o3.push(E(r4[1] === "^", r4));
    else if (r4 === "]") {
      if (o3.at(-1).type === "CharacterClassOpen") o3.push(d(93, r4));
      else if (s2--, o3.push(z(r4)), !s2) break;
    } else {
      const i2 = X(r4);
      Array.isArray(i2) ? o3.push(...i2) : o3.push(i2);
    }
  }
  return { tokens: o3, lastIndex: T.lastIndex || e.length };
}
function X(e) {
  if (e[0] === "\\") return x(e, { inCharClass: true });
  if (e[0] === "[") {
    const n = /\[:(?<negate>\^?)(?<name>[a-z]+):\]/.exec(e);
    if (!n || !i.has(n.groups.name)) throw new Error(`Invalid POSIX class "${e}"`);
    return k("posix", e, { value: n.groups.name, negate: !!n.groups.negate });
  }
  return e === "-" ? U(e) : e === "&&" ? H(e) : d(r2(e), e);
}
function x(e, { inCharClass: n }) {
  const t = e[1];
  if (t === "c" || t === "C") return Z(e);
  if ("dDhHsSwW".includes(t)) return q(e);
  if (e.startsWith(o`\o{`)) throw new Error(`Incomplete, invalid, or unsupported octal code point "${e}"`);
  if (/^\\[pP]\{/.test(e)) {
    if (e.length === 3) throw new Error(`Incomplete or invalid Unicode property "${e}"`);
    return V(e);
  }
  if (/^\\x[89A-Fa-f]\p{AHex}/u.test(e)) try {
    const o3 = e.split(/\\x/).slice(1).map((i2) => parseInt(i2, 16)), s2 = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true }).decode(new Uint8Array(o3)), a2 = new TextEncoder();
    return [...s2].map((i2) => {
      const l3 = [...a2.encode(i2)].map((c) => `\\x${c.toString(16)}`).join("");
      return d(r2(i2), l3);
    });
  } catch {
    throw new Error(`Multibyte code "${e}" incomplete or invalid in Oniguruma`);
  }
  if (t === "u" || t === "x") return d(J(e), e);
  if ($.has(t)) return d($.get(t), e);
  if (/\d/.test(t)) return W(n, e);
  if (e === "\\") throw new Error(o`Incomplete escape "\"`);
  if (t === "M") throw new Error(`Unsupported meta "${e}"`);
  if ([...e].length === 2) return d(e.codePointAt(1), e);
  throw new Error(`Unexpected escape "${e}"`);
}
function P(e) {
  return { type: "Alternator", raw: e };
}
function w(e, n) {
  return { type: "Assertion", kind: e, raw: n };
}
function A(e) {
  return { type: "Backreference", raw: e };
}
function d(e, n) {
  return { type: "Character", value: e, raw: n };
}
function z(e) {
  return { type: "CharacterClassClose", raw: e };
}
function U(e) {
  return { type: "CharacterClassHyphen", raw: e };
}
function H(e) {
  return { type: "CharacterClassIntersector", raw: e };
}
function E(e, n) {
  return { type: "CharacterClassOpen", negate: e, raw: n };
}
function k(e, n, t = {}) {
  return { type: "CharacterSet", kind: e, ...t, raw: n };
}
function I(e, n, t = {}) {
  return e === "keep" ? { type: "Directive", kind: e, raw: n } : { type: "Directive", kind: e, flags: u(t.flags), raw: n };
}
function W(e, n) {
  return { type: "EscapedNumber", inCharClass: e, raw: n };
}
function Q(e) {
  return { type: "GroupClose", raw: e };
}
function f(e, n, t = {}) {
  return { type: "GroupOpen", kind: e, ...t, raw: n };
}
function D(e, n, t, o3) {
  return { type: "NamedCallout", kind: e, tag: n, arguments: t, raw: o3 };
}
function _(e, n, t, o3) {
  return { type: "Quantifier", kind: e, min: n, max: t, raw: o3 };
}
function R(e) {
  return { type: "Subroutine", raw: e };
}
var B = /* @__PURE__ */ new Set(["COUNT", "CMP", "ERROR", "FAIL", "MAX", "MISMATCH", "SKIP", "TOTAL_COUNT"]);
var $ = /* @__PURE__ */ new Map([["a", 7], ["b", 8], ["e", 27], ["f", 12], ["n", 10], ["r", 13], ["t", 9], ["v", 11]]);
function Z(e) {
  const n = e[1] === "c" ? e[2] : e[3];
  if (!n || !/[A-Za-z]/.test(n)) throw new Error(`Unsupported control character "${e}"`);
  return d(r2(n.toUpperCase()) - 64, e);
}
function L(e, n) {
  let { on: t, off: o3 } = /^\(\?(?<on>[imx]*)(?:-(?<off>[-imx]*))?/.exec(e).groups;
  o3 ??= "";
  const s2 = (n.getCurrentModX() || t.includes("x")) && !o3.includes("x"), a2 = v(t), r4 = v(o3), i2 = {};
  if (a2 && (i2.enable = a2), r4 && (i2.disable = r4), e.endsWith(")")) return n.replaceCurrentModX(s2), I("flags", e, { flags: i2 });
  if (e.endsWith(":")) return n.pushModX(s2), n.numOpenGroups++, f("group", e, { ...(a2 || r4) && { flags: i2 } });
  throw new Error(`Unexpected flag modifier "${e}"`);
}
function j(e) {
  const n = /\(\*(?<name>[A-Za-z_]\w*)?(?:\[(?<tag>(?:[A-Za-z_]\w*)?)\])?(?:\{(?<args>[^}]*)\})?\)/.exec(e);
  if (!n) throw new Error(`Incomplete or invalid named callout "${e}"`);
  const { name: t, tag: o3, args: s2 } = n.groups;
  if (!t) throw new Error(`Invalid named callout "${e}"`);
  if (o3 === "") throw new Error(`Named callout tag with empty value not allowed "${e}"`);
  const a2 = s2 ? s2.split(",").filter((g) => g !== "").map((g) => /^[+-]?\d+$/.test(g) ? +g : g) : [], [r4, i2, l3] = a2, c = B.has(t) ? t.toLowerCase() : "custom";
  switch (c) {
    case "fail":
    case "mismatch":
    case "skip":
      if (a2.length > 0) throw new Error(`Named callout arguments not allowed "${a2}"`);
      break;
    case "error":
      if (a2.length > 1) throw new Error(`Named callout allows only one argument "${a2}"`);
      if (typeof r4 == "string") throw new Error(`Named callout argument must be a number "${r4}"`);
      break;
    case "max":
      if (!a2.length || a2.length > 2) throw new Error(`Named callout must have one or two arguments "${a2}"`);
      if (typeof r4 == "string" && !/^[A-Za-z_]\w*$/.test(r4)) throw new Error(`Named callout argument one must be a tag or number "${r4}"`);
      if (a2.length === 2 && (typeof i2 == "number" || !/^[<>X]$/.test(i2))) throw new Error(`Named callout optional argument two must be '<', '>', or 'X' "${i2}"`);
      break;
    case "count":
    case "total_count":
      if (a2.length > 1) throw new Error(`Named callout allows only one argument "${a2}"`);
      if (a2.length === 1 && (typeof r4 == "number" || !/^[<>X]$/.test(r4))) throw new Error(`Named callout optional argument must be '<', '>', or 'X' "${r4}"`);
      break;
    case "cmp":
      if (a2.length !== 3) throw new Error(`Named callout must have three arguments "${a2}"`);
      if (typeof r4 == "string" && !/^[A-Za-z_]\w*$/.test(r4)) throw new Error(`Named callout argument one must be a tag or number "${r4}"`);
      if (typeof i2 == "number" || !/^(?:[<>!=]=|[<>])$/.test(i2)) throw new Error(`Named callout argument two must be '==', '!=', '>', '<', '>=', or '<=' "${i2}"`);
      if (typeof l3 == "string" && !/^[A-Za-z_]\w*$/.test(l3)) throw new Error(`Named callout argument three must be a tag or number "${l3}"`);
      break;
    case "custom":
      throw new Error(`Undefined callout name "${t}"`);
    default:
      throw new Error(`Unexpected named callout kind "${c}"`);
  }
  return D(c, o3 ?? null, s2?.split(",") ?? null, e);
}
function O(e) {
  let n = null, t, o3;
  if (e[0] === "{") {
    const { minStr: s2, maxStr: a2 } = /^\{(?<minStr>\d*)(?:,(?<maxStr>\d*))?/.exec(e).groups, r4 = 1e5;
    if (+s2 > r4 || a2 && +a2 > r4) throw new Error("Quantifier value unsupported in Oniguruma");
    if (t = +s2, o3 = a2 === void 0 ? +s2 : a2 === "" ? 1 / 0 : +a2, t > o3 && (n = "possessive", [t, o3] = [o3, t]), e.endsWith("?")) {
      if (n === "possessive") throw new Error('Unsupported possessive interval quantifier chain with "?"');
      n = "lazy";
    } else n || (n = "greedy");
  } else t = e[0] === "+" ? 1 : 0, o3 = e[0] === "?" ? 1 : 1 / 0, n = e[1] === "+" ? "possessive" : e[1] === "?" ? "lazy" : "greedy";
  return _(n, t, o3, e);
}
function q(e) {
  const n = e[1].toLowerCase();
  return k({ d: "digit", h: "hex", s: "space", w: "word" }[n], e, { negate: e[1] !== n });
}
function V(e) {
  const { p: n, neg: t, value: o3 } = /^\\(?<p>[pP])\{(?<neg>\^?)(?<value>[^}]+)/.exec(e).groups;
  return k("property", e, { value: o3, negate: n === "P" && !t || n === "p" && !!t });
}
function v(e) {
  const n = {};
  return e.includes("i") && (n.ignoreCase = true), e.includes("m") && (n.dotAll = true), e.includes("x") && (n.extended = true), Object.keys(n).length ? n : null;
}
function Y(e) {
  const n = { ignoreCase: false, dotAll: false, extended: false, digitIsAscii: false, posixIsAscii: false, spaceIsAscii: false, wordIsAscii: false, textSegmentMode: null };
  for (let t = 0; t < e.length; t++) {
    const o3 = e[t];
    if (!"imxDPSWy".includes(o3)) throw new Error(`Invalid flag "${o3}"`);
    if (o3 === "y") {
      if (!/^y{[gw]}/.test(e.slice(t))) throw new Error('Invalid or unspecified flag "y" mode');
      n.textSegmentMode = e[t + 2] === "g" ? "grapheme" : "word", t += 3;
      continue;
    }
    n[{ i: "ignoreCase", m: "dotAll", x: "extended", D: "digitIsAscii", P: "posixIsAscii", S: "spaceIsAscii", W: "wordIsAscii" }[o3]] = true;
  }
  return n;
}
function J(e) {
  if (/^(?:\\u(?!\p{AHex}{4})|\\x(?!\p{AHex}{1,2}|\{\p{AHex}{1,8}\}))/u.test(e)) throw new Error(`Incomplete or invalid escape "${e}"`);
  const n = e[2] === "{" ? /^\\x\{\s*(?<hex>\p{AHex}+)/u.exec(e).groups.hex : e.slice(2);
  return parseInt(n, 16);
}
function ee(e, n) {
  const { raw: t, inCharClass: o3 } = e, s2 = t.slice(1);
  if (!o3 && (s2 !== "0" && s2.length === 1 || s2[0] !== "0" && +s2 <= n)) return [A(t)];
  const a2 = [], r4 = s2.match(/^[0-7]+|\d/g);
  for (let i2 = 0; i2 < r4.length; i2++) {
    const l3 = r4[i2];
    let c;
    if (i2 === 0 && l3 !== "8" && l3 !== "9") {
      if (c = parseInt(l3, 8), c > 127) throw new Error(o`Octal encoded byte above 177 unsupported "${t}"`);
    } else c = r2(l3);
    a2.push(d(c, (i2 === 0 ? "\\" : "") + l3));
  }
  return a2;
}
function te(e) {
  const n = [], t = new RegExp(y, "gy");
  let o3;
  for (; o3 = t.exec(e); ) {
    const s2 = o3[0];
    if (s2[0] === "{") {
      const a2 = /^\{(?<min>\d+),(?<max>\d+)\}\??$/.exec(s2);
      if (a2) {
        const { min: r4, max: i2 } = a2.groups;
        if (+r4 > +i2 && s2.endsWith("?")) {
          t.lastIndex--, n.push(O(s2.slice(0, -1)));
          continue;
        }
      }
    }
    n.push(O(s2));
  }
  return n;
}

// node_modules/.pnpm/oniguruma-parser@0.12.2/node_modules/oniguruma-parser/dist/parser/node-utils.js
function o2(e, t) {
  if (!Array.isArray(e.body)) throw new Error("Expected node with body array");
  if (e.body.length !== 1) return false;
  const r4 = e.body[0];
  return !t || Object.keys(t).every((n) => t[n] === r4[n]);
}
function s(e) {
  return y2.has(e.type);
}
var y2 = /* @__PURE__ */ new Set(["AbsenceFunction", "Backreference", "CapturingGroup", "Character", "CharacterClass", "CharacterSet", "Group", "Quantifier", "Subroutine"]);

// node_modules/.pnpm/oniguruma-parser@0.12.2/node_modules/oniguruma-parser/dist/parser/parse.js
function J2(e, r4 = {}) {
  const n = { flags: "", normalizeUnknownPropertyNames: false, skipBackrefValidation: false, skipLookbehindValidation: false, skipPropertyNameValidation: false, unicodePropertyMap: null, ...r4, rules: { captureGroup: false, singleline: false, ...r4.rules } }, o3 = M(e, { flags: n.flags, rules: { captureGroup: n.rules.captureGroup, singleline: n.rules.singleline } }), i2 = (p, N) => {
    const u2 = o3.tokens[t.nextIndex];
    switch (t.parent = p, t.nextIndex++, u2.type) {
      case "Alternator":
        return b2();
      case "Assertion":
        return W2(u2);
      case "Backreference":
        return X2(u2, t);
      case "Character":
        return m2(u2.value, { useLastValid: !!N.isCheckingRangeEnd });
      case "CharacterClassHyphen":
        return ee2(u2, t, N);
      case "CharacterClassOpen":
        return re(u2, t, N);
      case "CharacterSet":
        return ne(u2, t);
      case "Directive":
        return I2(u2.kind, { flags: u2.flags });
      case "GroupOpen":
        return te2(u2, t, N);
      case "NamedCallout":
        return U2(u2.kind, u2.tag, u2.arguments);
      case "Quantifier":
        return oe(u2, t);
      case "Subroutine":
        return ae(u2, t);
      default:
        throw new Error(`Unexpected token type "${u2.type}"`);
    }
  }, t = { capturingGroups: [], hasNumberedRef: false, namedGroupsByName: /* @__PURE__ */ new Map(), nextIndex: 0, normalizeUnknownPropertyNames: n.normalizeUnknownPropertyNames, parent: null, skipBackrefValidation: n.skipBackrefValidation, skipLookbehindValidation: n.skipLookbehindValidation, skipPropertyNameValidation: n.skipPropertyNameValidation, subroutines: [], tokens: o3.tokens, unicodePropertyMap: n.unicodePropertyMap, walk: i2 }, d2 = B2(T2(o3.flags));
  let s2 = d2.body[0];
  for (; t.nextIndex < o3.tokens.length; ) {
    const p = i2(s2, {});
    p.type === "Alternative" ? (d2.body.push(p), s2 = p) : s2.body.push(p);
  }
  const { capturingGroups: a2, hasNumberedRef: l3, namedGroupsByName: c, subroutines: f2 } = t;
  if (l3 && c.size && !n.rules.captureGroup) throw new Error("Numbered backref/subroutine not allowed when using named capture");
  for (const { ref: p } of f2) if (typeof p == "number") {
    if (p > a2.length) throw new Error("Subroutine uses a group number that's not defined");
    p && (a2[p - 1].isSubroutined = true);
  } else if (c.has(p)) {
    if (c.get(p).length > 1) throw new Error(o`Subroutine uses a duplicate group name "\g<${p}>"`);
    c.get(p)[0].isSubroutined = true;
  } else throw new Error(o`Subroutine uses a group name that's not defined "\g<${p}>"`);
  return d2;
}
function W2({ kind: e }) {
  return F2(u({ "^": "line_start", $: "line_end", "\\A": "string_start", "\\b": "word_boundary", "\\B": "word_boundary", "\\G": "search_start", "\\y": "text_segment_boundary", "\\Y": "text_segment_boundary", "\\z": "string_end", "\\Z": "string_end_newline" }[e], `Unexpected assertion kind "${e}"`), { negate: e === o`\B` || e === o`\Y` });
}
function X2({ raw: e }, r4) {
  const n = /^\\k[<']/.test(e), o3 = n ? e.slice(3, -1) : e.slice(1), i2 = (t, d2 = false) => {
    const s2 = r4.capturingGroups.length;
    let a2 = false;
    if (t > s2) if (r4.skipBackrefValidation) a2 = true;
    else throw new Error(`Not enough capturing groups defined to the left "${e}"`);
    return r4.hasNumberedRef = true, k2(d2 ? s2 + 1 - t : t, { orphan: a2 });
  };
  if (n) {
    const t = /^(?<sign>-?)0*(?<num>[1-9]\d*)$/.exec(o3);
    if (t) return i2(+t.groups.num, !!t.groups.sign);
    if (/[-+]/.test(o3)) throw new Error(`Invalid backref name "${e}"`);
    if (!r4.namedGroupsByName.has(o3)) throw new Error(`Group name not defined to the left "${e}"`);
    return k2(o3);
  }
  return i2(+o3);
}
function ee2(e, r4, n) {
  const { tokens: o3, walk: i2 } = r4, t = r4.parent, d2 = t.body.at(-1), s2 = o3[r4.nextIndex];
  if (!n.isCheckingRangeEnd && d2 && d2.type !== "CharacterClass" && d2.type !== "CharacterClassRange" && s2 && s2.type !== "CharacterClassOpen" && s2.type !== "CharacterClassClose" && s2.type !== "CharacterClassIntersector") {
    const a2 = i2(t, { ...n, isCheckingRangeEnd: true });
    if (d2.type === "Character" && a2.type === "Character") return t.body.pop(), L2(d2, a2);
    throw new Error("Invalid character class range");
  }
  return m2(r2("-"));
}
function re({ negate: e }, r4, n) {
  const { tokens: o3, walk: i2 } = r4, t = [C2()], d2 = o3[r4.nextIndex];
  let s2 = z2(d2);
  for (; s2.type !== "CharacterClassClose"; ) {
    if (s2.type === "CharacterClassIntersector") t.push(C2()), r4.nextIndex++;
    else {
      const l3 = t.at(-1);
      l3.body.push(i2(l3, n));
    }
    s2 = z2(o3[r4.nextIndex], d2);
  }
  const a2 = C2({ negate: e });
  return t.length === 1 ? a2.body = t[0].body : (a2.kind = "intersection", a2.body = t.map((l3) => l3.body.length === 1 ? l3.body[0] : l3)), r4.nextIndex++, a2;
}
function ne({ kind: e, negate: r4, value: n }, o3) {
  const { normalizeUnknownPropertyNames: i2, skipPropertyNameValidation: t, unicodePropertyMap: d2 } = o3;
  if (e === "property") {
    const s2 = w2(n);
    if (i.has(s2) && !d2?.has(s2)) e = "posix", n = s2;
    else return Q2(n, { negate: r4, normalizeUnknownPropertyNames: i2, skipPropertyNameValidation: t, unicodePropertyMap: d2 });
  }
  return e === "posix" ? R2(n, { negate: r4 }) : E2(e, { negate: r4 });
}
function te2(e, r4, n) {
  const { tokens: o3, capturingGroups: i2, namedGroupsByName: t, skipLookbehindValidation: d2, walk: s2 } = r4, a2 = ie(e), l3 = a2.type === "AbsenceFunction", c = $2(a2), f2 = c && a2.negate;
  if (a2.type === "CapturingGroup" && (i2.push(a2), a2.name && l(t, a2.name, []).push(a2)), l3 && n.isInAbsenceFunction) throw new Error("Nested absence function not supported by Oniguruma");
  let p = D2(o3[r4.nextIndex]);
  for (; p.type !== "GroupClose"; ) {
    if (p.type === "Alternator") a2.body.push(b2()), r4.nextIndex++;
    else {
      const N = a2.body.at(-1), u2 = s2(N, { ...n, isInAbsenceFunction: n.isInAbsenceFunction || l3, isInLookbehind: n.isInLookbehind || c, isInNegLookbehind: n.isInNegLookbehind || f2 });
      if (N.body.push(u2), (c || n.isInLookbehind) && !d2) {
        const v2 = "Lookbehind includes a pattern not allowed by Oniguruma";
        if (f2 || n.isInNegLookbehind) {
          if (M2(u2) || u2.type === "CapturingGroup") throw new Error(v2);
        } else if (M2(u2) || $2(u2) && u2.negate) throw new Error(v2);
      }
    }
    p = D2(o3[r4.nextIndex]);
  }
  return r4.nextIndex++, a2;
}
function oe({ kind: e, min: r4, max: n }, o3) {
  const i2 = o3.parent, t = i2.body.at(-1);
  if (!t || !s(t)) throw new Error("Quantifier requires a repeatable token");
  const d2 = _2(e, r4, n, t);
  return i2.body.pop(), d2;
}
function ae({ raw: e }, r4) {
  const { capturingGroups: n, subroutines: o3 } = r4;
  let i2 = e.slice(3, -1);
  const t = /^(?<sign>[-+]?)0*(?<num>[1-9]\d*)$/.exec(i2);
  if (t) {
    const s2 = +t.groups.num, a2 = n.length;
    if (r4.hasNumberedRef = true, i2 = { "": s2, "+": a2 + s2, "-": a2 + 1 - s2 }[t.groups.sign], i2 < 1) throw new Error("Invalid subroutine number");
  } else i2 === "0" && (i2 = 0);
  const d2 = O2(i2);
  return o3.push(d2), d2;
}
function G(e, r4) {
  if (e !== "repeater") throw new Error(`Unexpected absence function kind "${e}"`);
  return { type: "AbsenceFunction", kind: e, body: h(r4?.body) };
}
function b2(e) {
  return { type: "Alternative", body: V2(e?.body) };
}
function F2(e, r4) {
  const n = { type: "Assertion", kind: e };
  return (e === "word_boundary" || e === "text_segment_boundary") && (n.negate = !!r4?.negate), n;
}
function k2(e, r4) {
  const n = !!r4?.orphan;
  return { type: "Backreference", ref: e, ...n && { orphan: n } };
}
function P2(e, r4) {
  const n = { name: void 0, isSubroutined: false, ...r4 };
  if (n.name !== void 0 && !se(n.name)) throw new Error(`Group name "${n.name}" invalid in Oniguruma`);
  return { type: "CapturingGroup", number: e, ...n.name && { name: n.name }, ...n.isSubroutined && { isSubroutined: n.isSubroutined }, body: h(r4?.body) };
}
function m2(e, r4) {
  const n = { useLastValid: false, ...r4 };
  if (e > 1114111) {
    const o3 = e.toString(16);
    if (n.useLastValid) e = 1114111;
    else throw e > 1310719 ? new Error(`Invalid code point out of range "\\x{${o3}}"`) : new Error(`Invalid code point out of range in JS "\\x{${o3}}"`);
  }
  return { type: "Character", value: e };
}
function C2(e) {
  const r4 = { kind: "union", negate: false, ...e };
  return { type: "CharacterClass", kind: r4.kind, negate: r4.negate, body: V2(e?.body) };
}
function L2(e, r4) {
  if (r4.value < e.value) throw new Error("Character class range out of order");
  return { type: "CharacterClassRange", min: e, max: r4 };
}
function E2(e, r4) {
  const n = !!r4?.negate, o3 = { type: "CharacterSet", kind: e };
  return (e === "digit" || e === "hex" || e === "newline" || e === "space" || e === "word") && (o3.negate = n), (e === "text_segment" || e === "newline" && !n) && (o3.variableLength = true), o3;
}
function I2(e, r4 = {}) {
  if (e === "keep") return { type: "Directive", kind: e };
  if (e === "flags") return { type: "Directive", kind: e, flags: u(r4.flags) };
  throw new Error(`Unexpected directive kind "${e}"`);
}
function T2(e) {
  return { type: "Flags", ...e };
}
function A2(e) {
  const r4 = e?.atomic, n = e?.flags;
  if (r4 && n) throw new Error("Atomic group cannot have flags");
  return { type: "Group", ...r4 && { atomic: r4 }, ...n && { flags: n }, body: h(e?.body) };
}
function K2(e) {
  const r4 = { behind: false, negate: false, ...e };
  return { type: "LookaroundAssertion", kind: r4.behind ? "lookbehind" : "lookahead", negate: r4.negate, body: h(e?.body) };
}
function U2(e, r4, n) {
  return { type: "NamedCallout", kind: e, tag: r4, arguments: n };
}
function R2(e, r4) {
  const n = !!r4?.negate;
  if (!i.has(e)) throw new Error(`Invalid POSIX class "${e}"`);
  return { type: "CharacterSet", kind: "posix", value: e, negate: n };
}
function _2(e, r4, n, o3) {
  if (r4 > n) throw new Error("Invalid reversed quantifier range");
  return { type: "Quantifier", kind: e, min: r4, max: n, body: o3 };
}
function B2(e, r4) {
  return { type: "Regex", body: h(r4?.body), flags: e };
}
function O2(e) {
  return { type: "Subroutine", ref: e };
}
function Q2(e, r4) {
  const n = { negate: false, normalizeUnknownPropertyNames: false, skipPropertyNameValidation: false, unicodePropertyMap: null, ...r4 };
  let o3 = n.unicodePropertyMap?.get(w2(e));
  if (!o3) {
    if (n.normalizeUnknownPropertyNames) o3 = de(e);
    else if (n.unicodePropertyMap && !n.skipPropertyNameValidation) throw new Error(o`Invalid Unicode property "\p{${e}}"`);
  }
  return { type: "CharacterSet", kind: "property", value: o3 ?? e, negate: n.negate };
}
function ie({ flags: e, kind: r4, name: n, negate: o3, number: i2 }) {
  switch (r4) {
    case "absence_repeater":
      return G("repeater");
    case "atomic":
      return A2({ atomic: true });
    case "capturing":
      return P2(i2, { name: n });
    case "group":
      return A2({ flags: e });
    case "lookahead":
    case "lookbehind":
      return K2({ behind: r4 === "lookbehind", negate: o3 });
    default:
      throw new Error(`Unexpected group kind "${r4}"`);
  }
}
function h(e) {
  if (e === void 0) e = [b2()];
  else if (!Array.isArray(e) || !e.length || !e.every((r4) => r4.type === "Alternative")) throw new Error("Invalid body; expected array of one or more Alternative nodes");
  return e;
}
function V2(e) {
  if (e === void 0) e = [];
  else if (!Array.isArray(e) || !e.every((r4) => !!r4.type)) throw new Error("Invalid body; expected array of nodes");
  return e;
}
function M2(e) {
  return e.type === "LookaroundAssertion" && e.kind === "lookahead";
}
function $2(e) {
  return e.type === "LookaroundAssertion" && e.kind === "lookbehind";
}
function se(e) {
  return /^[\p{Alpha}\p{Pc}][^)]*$/u.test(e);
}
function de(e) {
  return e.trim().replace(/[- _]+/g, "_").replace(/[A-Z][a-z]+(?=[A-Z])/g, "$&_").replace(/[A-Za-z]+/g, (r4) => r4[0].toUpperCase() + r4.slice(1).toLowerCase());
}
function w2(e) {
  return e.replace(/[- _]+/g, "").toLowerCase();
}
function z2(e, r4) {
  const n = r4;
  return u(e, `Unclosed character class${n?.type === "Character" && n.value === 93 && n.raw === "]" ? ' (started with "]")' : ""}`);
}
function D2(e) {
  return u(e, "Unclosed group");
}

// src/unicode.js
var asciiSpaceChar = "[	-\r ]";
var CharsWithoutIgnoreCaseExpansion = /* @__PURE__ */ new Set([
  cp(304),
  // İ
  cp(305)
  // ı
]);
var defaultWordChar = r`[\p{L}\p{M}\p{N}\p{Pc}]`;
function getIgnoreCaseMatchChars(char) {
  if (CharsWithoutIgnoreCaseExpansion.has(char)) {
    return [char];
  }
  const set = /* @__PURE__ */ new Set();
  const lower = char.toLowerCase();
  const upper = lower.toUpperCase();
  const title = LowerToTitleCaseMap.get(lower);
  const altLower = LowerToAlternativeLowerCaseMap.get(lower);
  const altUpper = LowerToAlternativeUpperCaseMap.get(lower);
  if ([...upper].length === 1) {
    set.add(upper);
  }
  altUpper && set.add(altUpper);
  title && set.add(title);
  set.add(lower);
  altLower && set.add(altLower);
  return [...set];
}
var JsUnicodePropertyMap = /* @__PURE__ */ new Map(
  `C Other
Cc Control cntrl
Cf Format
Cn Unassigned
Co Private_Use
Cs Surrogate
L Letter
LC Cased_Letter
Ll Lowercase_Letter
Lm Modifier_Letter
Lo Other_Letter
Lt Titlecase_Letter
Lu Uppercase_Letter
M Mark Combining_Mark
Mc Spacing_Mark
Me Enclosing_Mark
Mn Nonspacing_Mark
N Number
Nd Decimal_Number digit
Nl Letter_Number
No Other_Number
P Punctuation punct
Pc Connector_Punctuation
Pd Dash_Punctuation
Pe Close_Punctuation
Pf Final_Punctuation
Pi Initial_Punctuation
Po Other_Punctuation
Ps Open_Punctuation
S Symbol
Sc Currency_Symbol
Sk Modifier_Symbol
Sm Math_Symbol
So Other_Symbol
Z Separator
Zl Line_Separator
Zp Paragraph_Separator
Zs Space_Separator
ASCII
ASCII_Hex_Digit AHex
Alphabetic Alpha
Any
Assigned
Bidi_Control Bidi_C
Bidi_Mirrored Bidi_M
Case_Ignorable CI
Cased
Changes_When_Casefolded CWCF
Changes_When_Casemapped CWCM
Changes_When_Lowercased CWL
Changes_When_NFKC_Casefolded CWKCF
Changes_When_Titlecased CWT
Changes_When_Uppercased CWU
Dash
Default_Ignorable_Code_Point DI
Deprecated Dep
Diacritic Dia
Emoji
Emoji_Component EComp
Emoji_Modifier EMod
Emoji_Modifier_Base EBase
Emoji_Presentation EPres
Extended_Pictographic ExtPict
Extender Ext
Grapheme_Base Gr_Base
Grapheme_Extend Gr_Ext
Hex_Digit Hex
IDS_Binary_Operator IDSB
IDS_Trinary_Operator IDST
ID_Continue IDC
ID_Start IDS
Ideographic Ideo
Join_Control Join_C
Logical_Order_Exception LOE
Lowercase Lower
Math
Noncharacter_Code_Point NChar
Pattern_Syntax Pat_Syn
Pattern_White_Space Pat_WS
Quotation_Mark QMark
Radical
Regional_Indicator RI
Sentence_Terminal STerm
Soft_Dotted SD
Terminal_Punctuation Term
Unified_Ideograph UIdeo
Uppercase Upper
Variation_Selector VS
White_Space space
XID_Continue XIDC
XID_Start XIDS`.split(/\s/).map((p) => [w2(p), p])
);
var LowerToAlternativeLowerCaseMap = /* @__PURE__ */ new Map([
  ["s", cp(383)],
  // s, ſ
  [cp(383), "s"]
  // ſ, s
]);
var LowerToAlternativeUpperCaseMap = /* @__PURE__ */ new Map([
  [cp(223), cp(7838)],
  // ß, ẞ
  [cp(107), cp(8490)],
  // k, K (Kelvin)
  [cp(229), cp(8491)],
  // å, Å (Angstrom)
  [cp(969), cp(8486)]
  // ω, Ω (Ohm)
]);
var LowerToTitleCaseMap = new Map([
  titleEntry(453),
  titleEntry(456),
  titleEntry(459),
  titleEntry(498),
  ...titleRange(8072, 8079),
  ...titleRange(8088, 8095),
  ...titleRange(8104, 8111),
  titleEntry(8124),
  titleEntry(8140),
  titleEntry(8188)
]);
var PosixClassMap = /* @__PURE__ */ new Map([
  ["alnum", r`[\p{Alpha}\p{Nd}]`],
  ["alpha", r`\p{Alpha}`],
  ["ascii", r`\p{ASCII}`],
  ["blank", r`[\p{Zs}\t]`],
  ["cntrl", r`\p{Cc}`],
  ["digit", r`\p{Nd}`],
  ["graph", r`[\P{space}&&\P{Cc}&&\P{Cn}&&\P{Cs}]`],
  ["lower", r`\p{Lower}`],
  ["print", r`[[\P{space}&&\P{Cc}&&\P{Cn}&&\P{Cs}]\p{Zs}]`],
  ["punct", r`[\p{P}\p{S}]`],
  // Updated value from Onig 6.9.9; changed from Unicode `\p{punct}`
  ["space", r`\p{space}`],
  ["upper", r`\p{Upper}`],
  ["word", r`[\p{Alpha}\p{M}\p{Nd}\p{Pc}]`],
  ["xdigit", r`\p{AHex}`]
]);
function range(start, end) {
  const range2 = [];
  for (let i2 = start; i2 <= end; i2++) {
    range2.push(i2);
  }
  return range2;
}
function titleEntry(codePoint) {
  const char = cp(codePoint);
  return [char.toLowerCase(), char];
}
function titleRange(start, end) {
  return range(start, end).map((codePoint) => titleEntry(codePoint));
}
var UnicodePropertiesWithSpecificCase = /* @__PURE__ */ new Set([
  "Lower",
  "Lowercase",
  "Upper",
  "Uppercase",
  "Ll",
  "Lowercase_Letter",
  "Lt",
  "Titlecase_Letter",
  "Lu",
  "Uppercase_Letter"
  // The `Changes_When_*` properties (and their aliases) could be included, but they're very rare.
  // Some other properties include a handful of chars with specific cases only, but these chars are
  // generally extreme edge cases and using such properties case insensitively generally produces
  // undesired behavior anyway
]);

// node_modules/.pnpm/oniguruma-parser@0.12.2/node_modules/oniguruma-parser/dist/traverser/traverse.js
function S(a2, v2, N = null) {
  function b3(e, s2) {
    for (let t = 0; t < e.length; t++) {
      const r4 = n(e[t], s2, t, e);
      t = Math.max(-1, t + r4);
    }
  }
  function n(e, s2 = null, t = null, r4 = null) {
    let i2 = 0, c = false;
    const d2 = { node: e, parent: s2, key: t, container: r4, root: a2, remove() {
      x2(r4).splice(Math.max(0, l2(t) + i2), 1), i2--, c = true;
    }, removeAllNextSiblings() {
      return x2(r4).splice(l2(t) + 1);
    }, removeAllPrevSiblings() {
      const o3 = l2(t) + i2;
      return i2 -= o3, x2(r4).splice(0, Math.max(0, o3));
    }, replaceWith(o3, m3 = {}) {
      const y3 = !!m3.traverse;
      r4 ? r4[Math.max(0, l2(t) + i2)] = o3 : u(s2, "Can't replace root node")[t] = o3, y3 && n(o3, s2, t, r4), c = true;
    }, replaceWithMultiple(o3, m3 = {}) {
      const y3 = !!m3.traverse;
      if (x2(r4).splice(Math.max(0, l2(t) + i2), 1, ...o3), i2 += o3.length - 1, y3) {
        let g = 0;
        for (let p = 0; p < o3.length; p++) g += n(o3[p], s2, l2(t) + p + g, r4);
      }
      c = true;
    }, skip() {
      c = true;
    } }, { type: f2 } = e, u2 = v2["*"], h2 = v2[f2], R3 = typeof u2 == "function" ? u2 : u2?.enter, P3 = typeof h2 == "function" ? h2 : h2?.enter;
    if (R3?.(d2, N), P3?.(d2, N), !c) switch (f2) {
      case "AbsenceFunction":
      case "Alternative":
      case "CapturingGroup":
      case "CharacterClass":
      case "Group":
      case "LookaroundAssertion":
        b3(e.body, e);
        break;
      case "Assertion":
      case "Backreference":
      case "Character":
      case "CharacterSet":
      case "Directive":
      case "Flags":
      case "NamedCallout":
      case "Subroutine":
        break;
      case "CharacterClassRange":
        n(e.min, e, "min"), n(e.max, e, "max");
        break;
      case "Quantifier":
        n(e.body, e, "body");
        break;
      case "Regex":
        b3(e.body, e), n(e.flags, e, "flags");
        break;
      default:
        throw new Error(`Unexpected node type "${f2}"`);
    }
    return h2?.exit?.(d2, N), u2?.exit?.(d2, N), i2;
  }
  return n(a2), a2;
}
function x2(a2) {
  if (!Array.isArray(a2)) throw new Error("Container expected");
  return a2;
}
function l2(a2) {
  if (typeof a2 != "number") throw new Error("Numeric key expected");
  return a2;
}

// src/transform.js
function transform(ast, options) {
  const opts = {
    // A couple edge cases exist where options `accuracy` and `bestEffortTarget` are used:
    // - `CharacterSet` kind `text_segment` (`\X`): An exact representation would require heavy
    //   Unicode data; a best-effort approximation requires knowing the target.
    // - `CharacterSet` kind `posix` with values `graph` and `print`: Their complex Unicode
    //   representations would be hard to change to ASCII versions after the fact in the generator
    //   based on `target`/`accuracy`, so produce the appropriate structure here.
    accuracy: "default",
    asciiWordBoundaries: false,
    avoidSubclass: false,
    bestEffortTarget: "ES2025",
    ...options
  };
  addParentProperties(ast);
  const firstPassState = {
    accuracy: opts.accuracy,
    asciiWordBoundaries: opts.asciiWordBoundaries,
    avoidSubclass: opts.avoidSubclass,
    flagDirectivesByAlt: /* @__PURE__ */ new Map(),
    jsGroupNameMap: /* @__PURE__ */ new Map(),
    minTargetEs2024: isMinTarget(opts.bestEffortTarget, "ES2024"),
    passedLookbehind: false,
    strategy: null,
    // Subroutines can appear before the groups they ref, so collect reffed nodes for a second pass 
    subroutineRefMap: /* @__PURE__ */ new Map(),
    supportedGNodes: /* @__PURE__ */ new Set(),
    digitIsAscii: ast.flags.digitIsAscii,
    spaceIsAscii: ast.flags.spaceIsAscii,
    wordIsAscii: ast.flags.wordIsAscii
  };
  S(ast, FirstPassVisitor, firstPassState);
  const globalFlags = {
    dotAll: ast.flags.dotAll,
    ignoreCase: ast.flags.ignoreCase
  };
  const secondPassState = {
    currentFlags: globalFlags,
    prevFlags: null,
    globalFlags,
    groupOriginByCopy: /* @__PURE__ */ new Map(),
    groupsByName: /* @__PURE__ */ new Map(),
    multiplexCapturesToLeftByRef: /* @__PURE__ */ new Map(),
    openRefs: /* @__PURE__ */ new Map(),
    reffedNodesByReferencer: /* @__PURE__ */ new Map(),
    subroutineRefMap: firstPassState.subroutineRefMap
  };
  S(ast, SecondPassVisitor, secondPassState);
  const thirdPassState = {
    groupsByName: secondPassState.groupsByName,
    highestOrphanBackref: 0,
    numCapturesToLeft: 0,
    reffedNodesByReferencer: secondPassState.reffedNodesByReferencer
  };
  S(ast, ThirdPassVisitor, thirdPassState);
  ast._originMap = secondPassState.groupOriginByCopy;
  ast._strategy = firstPassState.strategy;
  return ast;
}
var FirstPassVisitor = {
  AbsenceFunction({ node, parent, replaceWith }) {
    const { body, kind } = node;
    if (kind === "repeater") {
      const innerGroup = A2();
      innerGroup.body[0].body.push(
        // Insert own alts as `body`
        K2({ negate: true, body }),
        Q2("Any")
      );
      const outerGroup = A2();
      outerGroup.body[0].body.push(
        _2("greedy", 0, Infinity, innerGroup)
      );
      replaceWith(setParentDeep(outerGroup, parent), { traverse: true });
    } else {
      throw new Error(`Unsupported absence function "(?~|"`);
    }
  },
  Alternative: {
    enter({ node, parent, key }, { flagDirectivesByAlt }) {
      const flagDirectives = node.body.filter((el) => el.kind === "flags");
      for (let i2 = key + 1; i2 < parent.body.length; i2++) {
        const forwardSiblingAlt = parent.body[i2];
        getOrInsert(flagDirectivesByAlt, forwardSiblingAlt, []).push(...flagDirectives);
      }
    },
    exit({ node }, { flagDirectivesByAlt }) {
      if (flagDirectivesByAlt.get(node)?.length) {
        const flags = getCombinedFlagModsFromFlagNodes(flagDirectivesByAlt.get(node));
        if (flags) {
          const flagGroup = A2({ flags });
          flagGroup.body[0].body = node.body;
          node.body = [setParentDeep(flagGroup, node)];
        }
      }
    }
  },
  Assertion({ node, parent, key, container, root, remove, replaceWith }, state) {
    const { kind, negate } = node;
    const { asciiWordBoundaries, avoidSubclass, supportedGNodes, wordIsAscii } = state;
    if (kind === "text_segment_boundary") {
      throw new Error(`Unsupported text segment boundary "\\${negate ? "Y" : "y"}"`);
    } else if (kind === "line_end") {
      replaceWith(setParentDeep(K2({ body: [
        b2({ body: [F2("string_end")] }),
        b2({ body: [m2(10)] })
        // `\n`
      ] }), parent));
    } else if (kind === "line_start") {
      replaceWith(setParentDeep(parseFragment(r`(?<=\A|\n(?!\z))`, { skipLookbehindValidation: true }), parent));
    } else if (kind === "search_start") {
      if (supportedGNodes.has(node)) {
        root.flags.sticky = true;
        remove();
      } else {
        const prev = container[key - 1];
        if (prev && isAlwaysNonZeroLength(prev)) {
          replaceWith(setParentDeep(K2({ negate: true }), parent));
        } else if (avoidSubclass) {
          throw new Error(r`Uses "\G" in a way that requires a subclass`);
        } else {
          replaceWith(setParent(F2("string_start"), parent));
          state.strategy = "clip_search";
        }
      }
    } else if (kind === "string_end" || kind === "string_start") {
    } else if (kind === "string_end_newline") {
      replaceWith(setParentDeep(parseFragment(r`(?=\n?\z)`), parent));
    } else if (kind === "word_boundary") {
      if (!wordIsAscii && !asciiWordBoundaries) {
        const b3 = `(?:(?<=${defaultWordChar})(?!${defaultWordChar})|(?<!${defaultWordChar})(?=${defaultWordChar}))`;
        const B3 = `(?:(?<=${defaultWordChar})(?=${defaultWordChar})|(?<!${defaultWordChar})(?!${defaultWordChar}))`;
        replaceWith(setParentDeep(parseFragment(negate ? B3 : b3), parent));
      }
    } else {
      throw new Error(`Unexpected assertion kind "${kind}"`);
    }
  },
  Backreference({ node }, { jsGroupNameMap }) {
    let { ref } = node;
    if (typeof ref === "string" && !isValidJsGroupName(ref)) {
      ref = getAndStoreJsGroupName(ref, jsGroupNameMap);
      node.ref = ref;
    }
  },
  CapturingGroup({ node }, { jsGroupNameMap, subroutineRefMap }) {
    let { name } = node;
    if (name && !isValidJsGroupName(name)) {
      name = getAndStoreJsGroupName(name, jsGroupNameMap);
      node.name = name;
    }
    subroutineRefMap.set(node.number, node);
    if (name) {
      subroutineRefMap.set(name, node);
    }
  },
  CharacterClassRange({ node, parent, replaceWith }) {
    if (parent.kind === "intersection") {
      const cc = C2({ body: [node] });
      replaceWith(setParentDeep(cc, parent), { traverse: true });
    }
  },
  CharacterSet({ node, parent, replaceWith }, { accuracy, minTargetEs2024, digitIsAscii, spaceIsAscii, wordIsAscii }) {
    const { kind, negate, value } = node;
    if (digitIsAscii && (kind === "digit" || value === "digit")) {
      replaceWith(setParent(E2("digit", { negate }), parent));
      return;
    }
    if (spaceIsAscii && (kind === "space" || value === "space")) {
      replaceWith(setParentDeep(setNegate(parseFragment(asciiSpaceChar), negate), parent));
      return;
    }
    if (wordIsAscii && (kind === "word" || value === "word")) {
      replaceWith(setParent(E2("word", { negate }), parent));
      return;
    }
    if (kind === "any") {
      replaceWith(setParent(Q2("Any"), parent));
    } else if (kind === "digit") {
      replaceWith(setParent(Q2("Nd", { negate }), parent));
    } else if (kind === "dot") {
    } else if (kind === "text_segment") {
      if (accuracy === "strict") {
        throw new Error(r`Use of "\X" requires non-strict accuracy`);
      }
      const eBase = "\\p{Emoji}(?:\\p{EMod}|\\uFE0F\\u20E3?|[\\x{E0020}-\\x{E007E}]+\\x{E007F})?";
      const emoji = r`\p{RI}{2}|${eBase}(?:\u200D${eBase})*`;
      replaceWith(setParentDeep(parseFragment(
        // Close approximation of an extended grapheme cluster; see <unicode.org/reports/tr29/>
        r`(?>\r\n|${minTargetEs2024 ? r`\p{RGI_Emoji}` : emoji}|\P{M}\p{M}*)`,
        // Allow JS property `RGI_Emoji` through
        { skipPropertyNameValidation: true }
      ), parent));
    } else if (kind === "hex") {
      replaceWith(setParent(Q2("AHex", { negate }), parent));
    } else if (kind === "newline") {
      replaceWith(setParentDeep(parseFragment(negate ? "[^\n]" : "(?>\r\n?|[\n\v\f\x85\u2028\u2029])"), parent));
    } else if (kind === "posix") {
      if (!minTargetEs2024 && (value === "graph" || value === "print")) {
        if (accuracy === "strict") {
          throw new Error(`POSIX class "${value}" requires min target ES2024 or non-strict accuracy`);
        }
        let ascii = {
          graph: "!-~",
          print: " -~"
        }[value];
        if (negate) {
          ascii = `\0-${cp(ascii.codePointAt(0) - 1)}${cp(ascii.codePointAt(2) + 1)}-\u{10FFFF}`;
        }
        replaceWith(setParentDeep(parseFragment(`[${ascii}]`), parent));
      } else {
        replaceWith(setParentDeep(setNegate(parseFragment(PosixClassMap.get(value)), negate), parent));
      }
    } else if (kind === "property") {
      if (!JsUnicodePropertyMap.has(w2(value))) {
        node.key = "sc";
      }
    } else if (kind === "space") {
      replaceWith(setParent(Q2("space", { negate }), parent));
    } else if (kind === "word") {
      replaceWith(setParentDeep(setNegate(parseFragment(defaultWordChar), negate), parent));
    } else {
      throw new Error(`Unexpected character set kind "${kind}"`);
    }
  },
  Directive({ node, parent, root, remove, replaceWith, removeAllPrevSiblings, removeAllNextSiblings }) {
    const { kind, flags } = node;
    if (kind === "flags") {
      if (!flags.enable && !flags.disable) {
        remove();
      } else {
        const flagGroup = A2({ flags });
        flagGroup.body[0].body = removeAllNextSiblings();
        replaceWith(setParentDeep(flagGroup, parent), { traverse: true });
      }
    } else if (kind === "keep") {
      const firstAlt = root.body[0];
      const hasWrapperGroup = root.body.length === 1 && // Not emulatable if within a `CapturingGroup`
      o2(firstAlt, { type: "Group" }) && firstAlt.body[0].body.length === 1;
      const topLevel = hasWrapperGroup ? firstAlt.body[0] : root;
      if (parent.parent !== topLevel || topLevel.body.length > 1) {
        throw new Error(r`Uses "\K" in a way that's unsupported`);
      }
      const lookbehind = K2({ behind: true });
      lookbehind.body[0].body = removeAllPrevSiblings();
      replaceWith(setParentDeep(lookbehind, parent));
    } else {
      throw new Error(`Unexpected directive kind "${kind}"`);
    }
  },
  Flags({ node, parent }) {
    if (node.posixIsAscii) {
      throw new Error('Unsupported flag "P"');
    }
    if (node.textSegmentMode === "word") {
      throw new Error('Unsupported flag "y{w}"');
    }
    [
      "digitIsAscii",
      // Flag D
      "extended",
      // Flag x
      "posixIsAscii",
      // Flag P
      "spaceIsAscii",
      // Flag S
      "wordIsAscii",
      // Flag W
      "textSegmentMode"
      // Flag y{g} or y{w}
    ].forEach((f2) => delete node[f2]);
    Object.assign(node, {
      // JS flag g; no Onig equiv
      global: false,
      // JS flag d; no Onig equiv
      hasIndices: false,
      // JS flag m; no Onig equiv but its behavior is always on in Onig. Onig's only line break
      // char is line feed, unlike JS, so this flag isn't used since it would produce inaccurate
      // results (also allows `^` and `$` to be used in the generator for string start and end)
      multiline: false,
      // JS flag y; no Onig equiv, but used for `\G` emulation
      sticky: node.sticky ?? false
      // Note: Regex+ doesn't allow explicitly adding flags it handles implicitly, so leave out
      // properties `unicode` (JS flag u) and `unicodeSets` (JS flag v). Keep the existing values
      // for `ignoreCase` (flag i) and `dotAll` (JS flag s, but Onig flag m)
    });
    parent.options = {
      disable: {
        // Onig uses different rules for flag x than Regex+, so disable the implicit flag
        x: true,
        // Onig has no flag to control "named capture only" mode but contextually applies its
        // behavior when named capturing is used, so disable Regex+'s implicit flag for it
        n: true
      },
      force: {
        // Always add flag v because we're generating an AST that relies on it (it enables JS
        // support for Onig features nested classes, intersection, Unicode properties, etc.).
        // However, the generator might disable flag v based on its `target` option
        v: true
      }
    };
  },
  Group({ node }) {
    if (!node.flags) {
      return;
    }
    const { enable, disable } = node.flags;
    enable?.extended && delete enable.extended;
    disable?.extended && delete disable.extended;
    enable?.dotAll && disable?.dotAll && delete enable.dotAll;
    enable?.ignoreCase && disable?.ignoreCase && delete enable.ignoreCase;
    enable && !Object.keys(enable).length && delete node.flags.enable;
    disable && !Object.keys(disable).length && delete node.flags.disable;
    !node.flags.enable && !node.flags.disable && delete node.flags;
  },
  LookaroundAssertion({ node }, state) {
    const { kind } = node;
    if (kind === "lookbehind") {
      state.passedLookbehind = true;
    }
  },
  NamedCallout({ node, parent, replaceWith }) {
    const { kind } = node;
    if (kind === "fail") {
      replaceWith(setParentDeep(K2({ negate: true }), parent));
    } else {
      throw new Error(`Unsupported named callout "(*${kind.toUpperCase()}"`);
    }
  },
  Quantifier({ node }) {
    if (node.body.type === "Quantifier") {
      const group = A2();
      group.body[0].body.push(node.body);
      node.body = setParentDeep(group, node);
    }
  },
  Regex: {
    enter({ node }, { supportedGNodes }) {
      const leadingGs = [];
      let hasAltWithLeadG = false;
      let hasAltWithoutLeadG = false;
      for (const alt of node.body) {
        if (alt.body.length === 1 && alt.body[0].kind === "search_start") {
          alt.body.pop();
        } else {
          const leadingG = getLeadingG(alt.body);
          if (leadingG) {
            hasAltWithLeadG = true;
            Array.isArray(leadingG) ? leadingGs.push(...leadingG) : leadingGs.push(leadingG);
          } else {
            hasAltWithoutLeadG = true;
          }
        }
      }
      if (hasAltWithLeadG && !hasAltWithoutLeadG) {
        leadingGs.forEach((g) => supportedGNodes.add(g));
      }
    },
    exit(_3, { accuracy, passedLookbehind, strategy }) {
      if (accuracy === "strict" && passedLookbehind && strategy) {
        throw new Error(r`Uses "\G" in a way that requires non-strict accuracy`);
      }
    }
  },
  Subroutine({ node }, { jsGroupNameMap }) {
    let { ref } = node;
    if (typeof ref === "string" && !isValidJsGroupName(ref)) {
      ref = getAndStoreJsGroupName(ref, jsGroupNameMap);
      node.ref = ref;
    }
  }
};
var SecondPassVisitor = {
  Backreference({ node }, { multiplexCapturesToLeftByRef, reffedNodesByReferencer }) {
    const { orphan, ref } = node;
    if (!orphan) {
      reffedNodesByReferencer.set(node, [...multiplexCapturesToLeftByRef.get(ref).map(({ node: node2 }) => node2)]);
    }
  },
  CapturingGroup: {
    enter({
      node,
      parent,
      replaceWith,
      skip
    }, {
      groupOriginByCopy,
      groupsByName,
      multiplexCapturesToLeftByRef,
      openRefs,
      reffedNodesByReferencer
    }) {
      const origin = groupOriginByCopy.get(node);
      if (origin && openRefs.has(node.number)) {
        const recursion2 = setParent(createRecursion(node.number), parent);
        reffedNodesByReferencer.set(recursion2, openRefs.get(node.number));
        replaceWith(recursion2);
        return;
      }
      openRefs.set(node.number, node);
      multiplexCapturesToLeftByRef.set(node.number, []);
      if (node.name) {
        getOrInsert(multiplexCapturesToLeftByRef, node.name, []);
      }
      const multiplexNodes = multiplexCapturesToLeftByRef.get(node.name ?? node.number);
      for (let i2 = 0; i2 < multiplexNodes.length; i2++) {
        const multiplex = multiplexNodes[i2];
        if (
          // This group is from subroutine expansion, and there's a multiplex value from either the
          // origin node or a prior subroutine expansion group with the same origin
          origin === multiplex.node || origin && origin === multiplex.origin || // This group is not from subroutine expansion, and it comes after a subroutine expansion
          // group that refers to this group
          node === multiplex.origin
        ) {
          multiplexNodes.splice(i2, 1);
          break;
        }
      }
      multiplexCapturesToLeftByRef.get(node.number).push({ node, origin });
      if (node.name) {
        multiplexCapturesToLeftByRef.get(node.name).push({ node, origin });
      }
      if (node.name) {
        const groupsWithSameName = getOrInsert(groupsByName, node.name, /* @__PURE__ */ new Map());
        let hasDuplicateNameToRemove = false;
        if (origin) {
          hasDuplicateNameToRemove = true;
        } else {
          for (const groupInfo of groupsWithSameName.values()) {
            if (!groupInfo.hasDuplicateNameToRemove) {
              hasDuplicateNameToRemove = true;
              break;
            }
          }
        }
        groupsByName.get(node.name).set(node, { node, hasDuplicateNameToRemove });
      }
    },
    exit({ node }, { openRefs }) {
      if (openRefs.get(node.number) === node) {
        openRefs.delete(node.number);
      }
    }
  },
  Group: {
    enter({ node }, state) {
      state.prevFlags = state.currentFlags;
      if (node.flags) {
        state.currentFlags = getNewCurrentFlags(state.currentFlags, node.flags);
      }
    },
    exit(_3, state) {
      state.currentFlags = state.prevFlags;
    }
  },
  Subroutine({ node, parent, replaceWith }, state) {
    const { isRecursive, ref } = node;
    if (isRecursive) {
      let reffed = parent;
      while (reffed = reffed.parent) {
        if (reffed.type === "CapturingGroup" && (reffed.name === ref || reffed.number === ref)) {
          break;
        }
      }
      state.reffedNodesByReferencer.set(node, reffed);
      return;
    }
    const reffedGroupNode = state.subroutineRefMap.get(ref);
    const isGlobalRecursion = ref === 0;
    const expandedSubroutine = isGlobalRecursion ? createRecursion(0) : (
      // The reffed group might itself contain subroutines, which are expanded during sub-traversal
      cloneCapturingGroup(reffedGroupNode, state.groupOriginByCopy, null)
    );
    let replacement = expandedSubroutine;
    if (!isGlobalRecursion) {
      const reffedGroupFlagMods = getCombinedFlagModsFromFlagNodes(getAllParents(
        reffedGroupNode,
        (p) => p.type === "Group" && !!p.flags
      ));
      const reffedGroupFlags = reffedGroupFlagMods ? getNewCurrentFlags(state.globalFlags, reffedGroupFlagMods) : state.globalFlags;
      if (!areFlagsEqual(reffedGroupFlags, state.currentFlags)) {
        replacement = A2({
          flags: getFlagModsFromFlags(reffedGroupFlags)
        });
        replacement.body[0].body.push(expandedSubroutine);
      }
    }
    replaceWith(setParentDeep(replacement, parent), { traverse: !isGlobalRecursion });
  }
};
var ThirdPassVisitor = {
  Backreference({ node, parent, replaceWith }, state) {
    if (node.orphan) {
      state.highestOrphanBackref = Math.max(state.highestOrphanBackref, node.ref);
      return;
    }
    const reffedNodes = state.reffedNodesByReferencer.get(node);
    const participants = reffedNodes.filter((reffed) => canParticipateWithNode(reffed, node));
    if (!participants.length) {
      replaceWith(setParentDeep(K2({ negate: true }), parent));
    } else if (participants.length > 1) {
      const group = A2({
        atomic: true,
        body: participants.reverse().map((reffed) => b2({
          body: [k2(reffed.number)]
        }))
      });
      replaceWith(setParentDeep(group, parent));
    } else {
      node.ref = participants[0].number;
    }
  },
  CapturingGroup({ node }, state) {
    node.number = ++state.numCapturesToLeft;
    if (node.name) {
      if (state.groupsByName.get(node.name).get(node).hasDuplicateNameToRemove) {
        delete node.name;
      }
    }
  },
  Regex: {
    exit({ node }, state) {
      const numCapsNeeded = Math.max(state.highestOrphanBackref - state.numCapturesToLeft, 0);
      for (let i2 = 0; i2 < numCapsNeeded; i2++) {
        const emptyCapture = P2();
        node.body.at(-1).body.push(emptyCapture);
      }
    }
  },
  Subroutine({ node }, state) {
    if (!node.isRecursive || node.ref === 0) {
      return;
    }
    node.ref = state.reffedNodesByReferencer.get(node).number;
  }
};
function addParentProperties(root) {
  S(root, {
    "*"({ node, parent }) {
      node.parent = parent;
    }
  });
}
function areFlagsEqual(a2, b3) {
  return a2.dotAll === b3.dotAll && a2.ignoreCase === b3.ignoreCase;
}
function canParticipateWithNode(capture, node) {
  let rightmostPoint = node;
  do {
    if (rightmostPoint.type === "Regex") {
      return false;
    }
    if (rightmostPoint.type === "Alternative") {
      continue;
    }
    if (rightmostPoint === capture) {
      return false;
    }
    const kidsOfParent = getKids(rightmostPoint.parent);
    for (const kid of kidsOfParent) {
      if (kid === rightmostPoint) {
        break;
      }
      if (kid === capture || isAncestorOf(kid, capture)) {
        return true;
      }
    }
  } while (rightmostPoint = rightmostPoint.parent);
  throw new Error("Unexpected path");
}
function cloneCapturingGroup(obj, originMap, up, up2) {
  const store = Array.isArray(obj) ? [] : {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === "parent") {
      store.parent = Array.isArray(up) ? up2 : up;
    } else if (value && typeof value === "object") {
      store[key] = cloneCapturingGroup(value, originMap, store, up);
    } else {
      if (key === "type" && value === "CapturingGroup") {
        originMap.set(store, originMap.get(obj) ?? obj);
      }
      store[key] = value;
    }
  }
  return store;
}
function createRecursion(ref) {
  const node = O2(ref);
  node.isRecursive = true;
  return node;
}
function getAllParents(node, filterFn) {
  const results = [];
  while (node = node.parent) {
    if (!filterFn || filterFn(node)) {
      results.push(node);
    }
  }
  return results;
}
function getAndStoreJsGroupName(name, map) {
  if (map.has(name)) {
    return map.get(name);
  }
  const jsName = `$${map.size}_${name.replace(/^[^$_\p{IDS}]|[^$\u200C\u200D\p{IDC}]/ug, "_")}`;
  map.set(name, jsName);
  return jsName;
}
function getCombinedFlagModsFromFlagNodes(flagNodes) {
  const flagProps = ["dotAll", "ignoreCase"];
  const combinedFlags = { enable: {}, disable: {} };
  flagNodes.forEach(({ flags }) => {
    flagProps.forEach((prop) => {
      if (flags.enable?.[prop]) {
        delete combinedFlags.disable[prop];
        combinedFlags.enable[prop] = true;
      }
      if (flags.disable?.[prop]) {
        combinedFlags.disable[prop] = true;
      }
    });
  });
  if (!Object.keys(combinedFlags.enable).length) {
    delete combinedFlags.enable;
  }
  if (!Object.keys(combinedFlags.disable).length) {
    delete combinedFlags.disable;
  }
  if (combinedFlags.enable || combinedFlags.disable) {
    return combinedFlags;
  }
  return null;
}
function getFlagModsFromFlags({ dotAll, ignoreCase }) {
  const mods = {};
  if (dotAll || ignoreCase) {
    mods.enable = {};
    dotAll && (mods.enable.dotAll = true);
    ignoreCase && (mods.enable.ignoreCase = true);
  }
  if (!dotAll || !ignoreCase) {
    mods.disable = {};
    !dotAll && (mods.disable.dotAll = true);
    !ignoreCase && (mods.disable.ignoreCase = true);
  }
  return mods;
}
function getKids(node) {
  if (!node) {
    throw new Error("Node expected");
  }
  const { body } = node;
  return Array.isArray(body) ? body : body ? [body] : null;
}
function getLeadingG(els) {
  const firstToConsider = els.find((el) => el.kind === "search_start" || isLoneGLookaround(el, { negate: false }) || !isAlwaysZeroLength(el));
  if (!firstToConsider) {
    return null;
  }
  if (firstToConsider.kind === "search_start") {
    return firstToConsider;
  }
  if (firstToConsider.type === "LookaroundAssertion") {
    return firstToConsider.body[0].body[0];
  }
  if (firstToConsider.type === "CapturingGroup" || firstToConsider.type === "Group") {
    const gNodesForGroup = [];
    for (const alt of firstToConsider.body) {
      const leadingG = getLeadingG(alt.body);
      if (!leadingG) {
        return null;
      }
      Array.isArray(leadingG) ? gNodesForGroup.push(...leadingG) : gNodesForGroup.push(leadingG);
    }
    return gNodesForGroup;
  }
  return null;
}
function isAncestorOf(node, descendant) {
  const kids = getKids(node) ?? [];
  for (const kid of kids) {
    if (kid === descendant || isAncestorOf(kid, descendant)) {
      return true;
    }
  }
  return false;
}
function isAlwaysZeroLength({ type }) {
  return type === "Assertion" || type === "Directive" || type === "LookaroundAssertion";
}
function isAlwaysNonZeroLength(node) {
  const types = [
    "Character",
    "CharacterClass",
    "CharacterSet"
  ];
  return types.includes(node.type) || node.type === "Quantifier" && node.min && types.includes(node.body.type);
}
function isLoneGLookaround(node, options) {
  const opts = {
    negate: null,
    ...options
  };
  return node.type === "LookaroundAssertion" && (opts.negate === null || node.negate === opts.negate) && node.body.length === 1 && o2(node.body[0], {
    type: "Assertion",
    kind: "search_start"
  });
}
function isValidJsGroupName(name) {
  return /^[$_\p{IDS}][$\u200C\u200D\p{IDC}]*$/u.test(name);
}
function parseFragment(pattern, options) {
  const ast = J2(pattern, {
    ...options,
    // Providing a custom set of Unicode property names avoids converting some JS Unicode
    // properties (ex: `\p{Alpha}`) to Onig POSIX classes
    unicodePropertyMap: JsUnicodePropertyMap
  });
  const alts = ast.body;
  if (alts.length > 1 || alts[0].body.length > 1) {
    return A2({ body: alts });
  }
  return alts[0].body[0];
}
function setNegate(node, negate) {
  node.negate = negate;
  return node;
}
function setParent(node, parent) {
  node.parent = parent;
  return node;
}
function setParentDeep(node, parent) {
  addParentProperties(node);
  node.parent = parent;
  return node;
}

// src/generate.js
function generate(ast, options) {
  const opts = getOptions(options);
  const minTargetEs2024 = isMinTarget(opts.target, "ES2024");
  const minTargetEs2025 = isMinTarget(opts.target, "ES2025");
  const recursionLimit = opts.rules.recursionLimit;
  if (!Number.isInteger(recursionLimit) || recursionLimit < 2 || recursionLimit > 20) {
    throw new Error("Invalid recursionLimit; use 2-20");
  }
  let hasCaseInsensitiveNode = null;
  let hasCaseSensitiveNode = null;
  if (!minTargetEs2025) {
    const iStack = [ast.flags.ignoreCase];
    S(ast, FlagModifierVisitor, {
      getCurrentModI: () => iStack.at(-1),
      popModI() {
        iStack.pop();
      },
      pushModI(isIOn) {
        iStack.push(isIOn);
      },
      setHasCasedChar() {
        if (iStack.at(-1)) {
          hasCaseInsensitiveNode = true;
        } else {
          hasCaseSensitiveNode = true;
        }
      }
    });
  }
  const appliedGlobalFlags = {
    dotAll: ast.flags.dotAll,
    // - Turn global flag i on if a case insensitive node was used and no case sensitive nodes were
    //   used (to avoid unnecessary node expansion).
    // - Turn global flag i off if a case sensitive node was used (since case sensitivity can't be
    //   forced without the use of ES2025 flag groups)
    ignoreCase: !!((ast.flags.ignoreCase || hasCaseInsensitiveNode) && !hasCaseSensitiveNode)
  };
  let lastNode = ast;
  const state = {
    accuracy: opts.accuracy,
    appliedGlobalFlags,
    captureMap: /* @__PURE__ */ new Map(),
    currentFlags: {
      dotAll: ast.flags.dotAll,
      ignoreCase: ast.flags.ignoreCase
    },
    inCharClass: false,
    lastNode,
    originMap: ast._originMap,
    recursionLimit,
    useAppliedIgnoreCase: !!(!minTargetEs2025 && hasCaseInsensitiveNode && hasCaseSensitiveNode),
    useFlagMods: minTargetEs2025,
    useFlagV: minTargetEs2024,
    verbose: opts.verbose
  };
  function gen(node) {
    state.lastNode = lastNode;
    lastNode = node;
    const fn = throwIfNullish(generator[node.type], `Unexpected node type "${node.type}"`);
    return fn(node, state, gen);
  }
  const result = {
    pattern: ast.body.map(gen).join("|"),
    // Could reset `lastNode` at this point via `lastNode = ast`, but it isn't needed by flags
    flags: gen(ast.flags),
    options: { ...ast.options }
  };
  if (!minTargetEs2024) {
    delete result.options.force.v;
    result.options.disable.v = true;
    result.options.unicodeSetsPlugin = null;
  }
  result._captureTransfers = /* @__PURE__ */ new Map();
  result._hiddenCaptures = [];
  state.captureMap.forEach((value, key) => {
    if (value.hidden) {
      result._hiddenCaptures.push(key);
    }
    if (value.transferTo) {
      getOrInsert(result._captureTransfers, value.transferTo, []).push(key);
    }
  });
  return result;
}
var FlagModifierVisitor = {
  "*": {
    enter({ node }, state) {
      if (isAnyGroup(node)) {
        const currentModI = state.getCurrentModI();
        state.pushModI(
          node.flags ? getNewCurrentFlags({ ignoreCase: currentModI }, node.flags).ignoreCase : currentModI
        );
      }
    },
    exit({ node }, state) {
      if (isAnyGroup(node)) {
        state.popModI();
      }
    }
  },
  Backreference(_3, state) {
    state.setHasCasedChar();
  },
  Character({ node }, state) {
    if (charHasCase(cp(node.value))) {
      state.setHasCasedChar();
    }
  },
  CharacterClassRange({ node, skip }, state) {
    skip();
    if (getCasesOutsideCharClassRange(node, { firstOnly: true }).length) {
      state.setHasCasedChar();
    }
  },
  CharacterSet({ node }, state) {
    if (node.kind === "property" && UnicodePropertiesWithSpecificCase.has(node.value)) {
      state.setHasCasedChar();
    }
  }
};
var generator = {
  /**
  @param {AlternativeNode} node
  */
  Alternative({ body }, _3, gen) {
    return body.map(gen).join("");
  },
  /**
  @param {AssertionNode} node
  */
  Assertion({ kind, negate }) {
    if (kind === "string_end") {
      return "$";
    }
    if (kind === "string_start") {
      return "^";
    }
    if (kind === "word_boundary") {
      return negate ? r`\B` : r`\b`;
    }
    throw new Error(`Unexpected assertion kind "${kind}"`);
  },
  /**
  @param {BackreferenceNode} node
  */
  Backreference({ ref }, state) {
    if (typeof ref !== "number") {
      throw new Error("Unexpected named backref in transformed AST");
    }
    if (!state.useFlagMods && state.accuracy === "strict" && state.currentFlags.ignoreCase && !state.captureMap.get(ref).ignoreCase) {
      throw new Error("Use of case-insensitive backref to case-sensitive group requires target ES2025 or non-strict accuracy");
    }
    return "\\" + ref;
  },
  /**
  @param {CapturingGroupNode} node
  */
  CapturingGroup(node, state, gen) {
    const { body, name, number } = node;
    const data = { ignoreCase: state.currentFlags.ignoreCase };
    const origin = state.originMap.get(node);
    if (origin) {
      data.hidden = true;
      if (number > origin.number) {
        data.transferTo = origin.number;
      }
    }
    state.captureMap.set(number, data);
    return `(${name ? `?<${name}>` : ""}${body.map(gen).join("|")})`;
  },
  /**
  @param {CharacterNode} node
  */
  Character({ value }, state) {
    const char = cp(value);
    const escaped = getCharEscape(value, {
      escDigit: state.lastNode.type === "Backreference",
      inCharClass: state.inCharClass,
      useFlagV: state.useFlagV
    });
    if (escaped !== char) {
      return escaped;
    }
    if (state.useAppliedIgnoreCase && state.currentFlags.ignoreCase && charHasCase(char)) {
      const cases = getIgnoreCaseMatchChars(char);
      return state.inCharClass ? cases.join("") : cases.length > 1 ? `[${cases.join("")}]` : cases[0];
    }
    return char;
  },
  /**
  @param {CharacterClassNode} node
  */
  CharacterClass(node, state, gen) {
    const { kind, negate, parent } = node;
    let { body } = node;
    if (kind === "intersection" && !state.useFlagV) {
      throw new Error("Use of character class intersection requires min target ES2024");
    }
    if (envFlags.bugFlagVLiteralHyphenIsRange && state.useFlagV && body.some(isLiteralHyphen)) {
      body = [m2(45), ...body.filter((kid) => !isLiteralHyphen(kid))];
    }
    const genClass = () => `[${negate ? "^" : ""}${body.map(gen).join(kind === "intersection" ? "&&" : "")}]`;
    if (!state.inCharClass) {
      if (
        // Already established `kind !== 'intersection'` if `!state.useFlagV`; don't check again
        (!state.useFlagV || envFlags.bugNestedClassIgnoresNegation) && !negate
      ) {
        const negatedChildClasses = body.filter(
          (kid) => kid.type === "CharacterClass" && kid.kind === "union" && kid.negate
        );
        if (negatedChildClasses.length) {
          const group = A2();
          const groupFirstAlt = group.body[0];
          group.parent = parent;
          groupFirstAlt.parent = group;
          body = body.filter((kid) => !negatedChildClasses.includes(kid));
          node.body = body;
          if (body.length) {
            node.parent = groupFirstAlt;
            groupFirstAlt.body.push(node);
          } else {
            group.body.pop();
          }
          negatedChildClasses.forEach((cc) => {
            const newAlt = b2({ body: [cc] });
            cc.parent = newAlt;
            newAlt.parent = group;
            group.body.push(newAlt);
          });
          return gen(group);
        }
      }
      state.inCharClass = true;
      const result = genClass();
      state.inCharClass = false;
      return result;
    }
    const firstEl = body[0];
    if (
      // Already established that the parent is a char class via `inCharClass`; don't check again
      kind === "union" && !negate && firstEl && // Allows many nested classes to work with `target` ES2018 which doesn't support nesting
      ((!state.useFlagV || !state.verbose) && parent.kind === "union" && !(envFlags.bugFlagVLiteralHyphenIsRange && state.useFlagV) || !state.verbose && parent.kind === "intersection" && // JS doesn't allow intersection with union or ranges
      body.length === 1 && firstEl.type !== "CharacterClassRange")
    ) {
      return body.map(gen).join("");
    }
    if (!state.useFlagV && parent.type === "CharacterClass") {
      throw new Error("Uses nested character class in a way that requires min target ES2024");
    }
    return genClass();
  },
  /**
  @param {CharacterClassRangeNode} node
  */
  CharacterClassRange(node, state) {
    const min = node.min.value;
    const max = node.max.value;
    const escOpts = {
      escDigit: false,
      inCharClass: true,
      useFlagV: state.useFlagV
    };
    const minStr = getCharEscape(min, escOpts);
    const maxStr = getCharEscape(max, escOpts);
    const extraChars = /* @__PURE__ */ new Set();
    if (state.useAppliedIgnoreCase && state.currentFlags.ignoreCase) {
      const charsOutsideRange = getCasesOutsideCharClassRange(node);
      const ranges = getCodePointRangesFromChars(charsOutsideRange);
      ranges.forEach((value) => {
        extraChars.add(
          Array.isArray(value) ? `${getCharEscape(value[0], escOpts)}-${getCharEscape(value[1], escOpts)}` : getCharEscape(value, escOpts)
        );
      });
    }
    return `${minStr}-${maxStr}${[...extraChars].join("")}`;
  },
  /**
  @param {CharacterSetNode} node
  */
  CharacterSet({ kind, negate, value, key }, state) {
    if (kind === "dot") {
      return state.currentFlags.dotAll ? state.appliedGlobalFlags.dotAll || state.useFlagMods ? "." : "[^]" : (
        // Onig's only line break char is line feed, unlike JS
        r`[^\n]`
      );
    }
    if (kind === "digit") {
      return negate ? r`\D` : r`\d`;
    }
    if (kind === "property") {
      if (state.useAppliedIgnoreCase && state.currentFlags.ignoreCase && UnicodePropertiesWithSpecificCase.has(value)) {
        throw new Error(`Unicode property "${value}" can't be case-insensitive when other chars have specific case`);
      }
      return `${negate ? r`\P` : r`\p`}{${key ? `${key}=` : ""}${value}}`;
    }
    if (kind === "word") {
      return negate ? r`\W` : r`\w`;
    }
    throw new Error(`Unexpected character set kind "${kind}"`);
  },
  /**
  @param {FlagsNode} node
  */
  Flags(node, state) {
    return (
      // The transformer should never turn on the properties for flags d, g, m since Onig doesn't
      // have equivs. Flag m is never used since Onig uses different line break chars than JS
      // (node.hasIndices ? 'd' : '') +
      // (node.global ? 'g' : '') +
      // (node.multiline ? 'm' : '') +
      (state.appliedGlobalFlags.ignoreCase ? "i" : "") + (node.dotAll ? "s" : "") + (node.sticky ? "y" : "")
    );
  },
  /**
  @param {GroupNode} node
  */
  Group({ atomic: atomic2, body, flags, parent }, state, gen) {
    const currentFlags = state.currentFlags;
    if (flags) {
      state.currentFlags = getNewCurrentFlags(currentFlags, flags);
    }
    const contents = body.map(gen).join("|");
    const result = !state.verbose && body.length === 1 && // Single alt
    parent.type !== "Quantifier" && !atomic2 && (!state.useFlagMods || !flags) ? contents : `(?${getGroupPrefix(atomic2, flags, state.useFlagMods)}${contents})`;
    state.currentFlags = currentFlags;
    return result;
  },
  /**
  @param {LookaroundAssertionNode} node
  */
  LookaroundAssertion({ body, kind, negate }, _3, gen) {
    const prefix = `${kind === "lookahead" ? "" : "<"}${negate ? "!" : "="}`;
    return `(?${prefix}${body.map(gen).join("|")})`;
  },
  /**
  @param {QuantifierNode} node
  */
  Quantifier(node, _3, gen) {
    return gen(node.body) + getQuantifierStr(node);
  },
  /**
  @param {SubroutineNode & {isRecursive: true}} node
  */
  Subroutine({ isRecursive, ref }, state) {
    if (!isRecursive) {
      throw new Error("Unexpected non-recursive subroutine in transformed AST");
    }
    const limit = state.recursionLimit;
    return ref === 0 ? `(?R=${limit})` : r`\g<${ref}&R=${limit}>`;
  }
};
var BaseEscapeChars = /* @__PURE__ */ new Set([
  "$",
  "(",
  ")",
  "*",
  "+",
  ".",
  "?",
  "[",
  "\\",
  "]",
  "^",
  "{",
  "|",
  "}"
]);
var CharClassEscapeChars = /* @__PURE__ */ new Set([
  "-",
  "\\",
  "]",
  "^",
  // Literal `[` doesn't require escaping with flag u, but this can help work around regex source
  // linters and regex syntax processors that expect unescaped `[` to create a nested class
  "["
]);
var CharClassEscapeCharsFlagV = /* @__PURE__ */ new Set([
  "(",
  ")",
  "-",
  "/",
  "[",
  "\\",
  "]",
  "^",
  "{",
  "|",
  "}",
  // Double punctuators; also includes already-listed `-` and `^`
  "!",
  "#",
  "$",
  "%",
  "&",
  "*",
  "+",
  ",",
  ".",
  ":",
  ";",
  "<",
  "=",
  ">",
  "?",
  "@",
  "`",
  "~"
]);
var CharCodeEscapeMap = /* @__PURE__ */ new Map([
  [9, r`\t`],
  // horizontal tab
  [10, r`\n`],
  // line feed
  [11, r`\v`],
  // vertical tab
  [12, r`\f`],
  // form feed
  [13, r`\r`],
  // carriage return
  [8232, r`\u2028`],
  // line separator
  [8233, r`\u2029`],
  // paragraph separator
  [65279, r`\uFEFF`]
  // ZWNBSP/BOM
]);
var casedRe = /^\p{Cased}$/u;
function charHasCase(char) {
  return casedRe.test(char);
}
function getCasesOutsideCharClassRange(node, options) {
  const firstOnly = !!options?.firstOnly;
  const min = node.min.value;
  const max = node.max.value;
  const found = [];
  if (min < 65 && (max === 65535 || max >= 131071) || min === 65536 && max >= 131071) {
    return found;
  }
  for (let i2 = min; i2 <= max; i2++) {
    const char = cp(i2);
    if (!charHasCase(char)) {
      continue;
    }
    const charsOutsideRange = getIgnoreCaseMatchChars(char).filter((caseOfChar) => {
      const num = caseOfChar.codePointAt(0);
      return num < min || num > max;
    });
    if (charsOutsideRange.length) {
      found.push(...charsOutsideRange);
      if (firstOnly) {
        break;
      }
    }
  }
  return found;
}
function getCharEscape(codePoint, { escDigit, inCharClass, useFlagV }) {
  if (CharCodeEscapeMap.has(codePoint)) {
    return CharCodeEscapeMap.get(codePoint);
  }
  if (
    // Control chars, etc.; condition modeled on the Chrome developer console's display for strings
    codePoint < 32 || codePoint > 126 && codePoint < 160 || // Unicode planes 4-16; unassigned, special purpose, and private use area
    codePoint > 262143 || // Avoid corrupting a preceding backref by immediately following it with a literal digit
    escDigit && isDigitCharCode(codePoint)
  ) {
    return codePoint > 255 ? `\\u{${codePoint.toString(16).toUpperCase()}}` : `\\x${codePoint.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  const escapeChars = inCharClass ? useFlagV ? CharClassEscapeCharsFlagV : CharClassEscapeChars : BaseEscapeChars;
  const char = cp(codePoint);
  return (escapeChars.has(char) ? "\\" : "") + char;
}
function getCodePointRangesFromChars(chars) {
  const codePoints = chars.map((char) => char.codePointAt(0)).sort((a2, b3) => a2 - b3);
  const values = [];
  let start = null;
  for (let i2 = 0; i2 < codePoints.length; i2++) {
    if (codePoints[i2 + 1] === codePoints[i2] + 1) {
      start ??= codePoints[i2];
    } else if (start === null) {
      values.push(codePoints[i2]);
    } else {
      values.push([start, codePoints[i2]]);
      start = null;
    }
  }
  return values;
}
function getGroupPrefix(atomic2, flagMods, useFlagMods) {
  if (atomic2) {
    return ">";
  }
  let mods = "";
  if (flagMods && useFlagMods) {
    const { enable, disable } = flagMods;
    mods = (enable?.ignoreCase ? "i" : "") + (enable?.dotAll ? "s" : "") + (disable ? "-" : "") + (disable?.ignoreCase ? "i" : "") + (disable?.dotAll ? "s" : "");
  }
  return `${mods}:`;
}
function getQuantifierStr({ kind, max, min }) {
  let base;
  if (!min && max === 1) {
    base = "?";
  } else if (!min && max === Infinity) {
    base = "*";
  } else if (min === 1 && max === Infinity) {
    base = "+";
  } else if (min === max) {
    base = `{${min}}`;
  } else {
    base = `{${min},${max === Infinity ? "" : max}}`;
  }
  return base + {
    greedy: "",
    lazy: "?",
    possessive: "+"
  }[kind];
}
function isAnyGroup({ type }) {
  return type === "CapturingGroup" || type === "Group" || type === "LookaroundAssertion";
}
function isDigitCharCode(value) {
  return value > 47 && value < 58;
}
function isLiteralHyphen({ type, value }) {
  return type === "Character" && value === 45;
}

// src/subclass.js
var EmulatedRegExp = class _EmulatedRegExp extends RegExp {
  /**
  @type {Map<number, {
    hidden?: true;
    transferTo?: number;
  }>}
  */
  #captureMap = /* @__PURE__ */ new Map();
  /**
  @type {RegExp | EmulatedRegExp | null}
  */
  #compiled = null;
  /**
  @type {string}
  */
  #pattern;
  /**
  @type {Map<number, string>?}
  */
  #nameMap = null;
  /**
  @type {string?}
  */
  #strategy = null;
  /**
  Can be used to serialize the instance.
  @type {EmulatedRegExpOptions}
  */
  rawOptions = {};
  // Override the getter with one that works with lazy-compiled regexes
  get source() {
    return this.#pattern || "(?:)";
  }
  /**
  @overload
  @param {string} pattern
  @param {string} [flags]
  @param {EmulatedRegExpOptions} [options]
  */
  /**
  @overload
  @param {EmulatedRegExp} pattern
  @param {string} [flags]
  */
  constructor(pattern, flags, options) {
    const lazyCompile = !!options?.lazyCompile;
    if (pattern instanceof RegExp) {
      if (options) {
        throw new Error("Cannot provide options when copying a regexp");
      }
      const re2 = pattern;
      super(re2, flags);
      this.#pattern = re2.source;
      if (re2 instanceof _EmulatedRegExp) {
        this.#captureMap = re2.#captureMap;
        this.#nameMap = re2.#nameMap;
        this.#strategy = re2.#strategy;
        this.rawOptions = re2.rawOptions;
      }
    } else {
      const opts = {
        hiddenCaptures: [],
        strategy: null,
        transfers: [],
        ...options
      };
      super(lazyCompile ? "" : pattern, flags);
      this.#pattern = pattern;
      this.#captureMap = createCaptureMap(opts.hiddenCaptures, opts.transfers);
      this.#strategy = opts.strategy;
      this.rawOptions = options ?? {};
    }
    if (!lazyCompile) {
      this.#compiled = this;
    }
  }
  /**
  Called internally by all String/RegExp methods that use regexes.
  @override
  @param {string} str
  @returns {RegExpExecArray?}
  */
  exec(str) {
    if (!this.#compiled) {
      const { lazyCompile, ...rest } = this.rawOptions;
      this.#compiled = new _EmulatedRegExp(this.#pattern, this.flags, rest);
    }
    const useLastIndex = this.global || this.sticky;
    const pos = this.lastIndex;
    if (this.#strategy === "clip_search" && useLastIndex && pos) {
      this.lastIndex = 0;
      const match = this.#execCore(str.slice(pos));
      if (match) {
        adjustMatchDetailsForOffset(match, pos, str, this.hasIndices);
        this.lastIndex += pos;
      }
      return match;
    }
    return this.#execCore(str);
  }
  /**
  Adds support for hidden and transfer captures.
  @param {string} str
  @returns
  */
  #execCore(str) {
    this.#compiled.lastIndex = this.lastIndex;
    const match = super.exec.call(this.#compiled, str);
    this.lastIndex = this.#compiled.lastIndex;
    if (!match || !this.#captureMap.size) {
      return match;
    }
    const matchCopy = [...match];
    match.length = 1;
    let indicesCopy;
    if (this.hasIndices) {
      indicesCopy = [...match.indices];
      match.indices.length = 1;
    }
    const mappedNums = [0];
    for (let i2 = 1; i2 < matchCopy.length; i2++) {
      const { hidden, transferTo } = this.#captureMap.get(i2) ?? {};
      if (hidden) {
        mappedNums.push(null);
      } else {
        mappedNums.push(match.length);
        match.push(matchCopy[i2]);
        if (this.hasIndices) {
          match.indices.push(indicesCopy[i2]);
        }
      }
      if (transferTo && matchCopy[i2] !== void 0) {
        const to = mappedNums[transferTo];
        if (!to) {
          throw new Error(`Invalid capture transfer to "${to}"`);
        }
        match[to] = matchCopy[i2];
        if (this.hasIndices) {
          match.indices[to] = indicesCopy[i2];
        }
        if (match.groups) {
          if (!this.#nameMap) {
            this.#nameMap = createNameMap(this.source);
          }
          const name = this.#nameMap.get(transferTo);
          if (name) {
            match.groups[name] = matchCopy[i2];
            if (this.hasIndices) {
              match.indices.groups[name] = indicesCopy[i2];
            }
          }
        }
      }
    }
    return match;
  }
};
function adjustMatchDetailsForOffset(match, offset, input, hasIndices) {
  match.index += offset;
  match.input = input;
  if (hasIndices) {
    const indices = match.indices;
    for (let i2 = 0; i2 < indices.length; i2++) {
      const arr = indices[i2];
      if (arr) {
        indices[i2] = [arr[0] + offset, arr[1] + offset];
      }
    }
    const groupIndices = indices.groups;
    if (groupIndices) {
      Object.keys(groupIndices).forEach((key) => {
        const arr = groupIndices[key];
        if (arr) {
          groupIndices[key] = [arr[0] + offset, arr[1] + offset];
        }
      });
    }
  }
}
function createCaptureMap(hiddenCaptures, transfers) {
  const captureMap = /* @__PURE__ */ new Map();
  for (const num of hiddenCaptures) {
    captureMap.set(num, {
      hidden: true
    });
  }
  for (const [to, from] of transfers) {
    for (const num of from) {
      getOrInsert(captureMap, num, {}).transferTo = to;
    }
  }
  return captureMap;
}
function createNameMap(pattern) {
  const re2 = /(?<capture>\((?:\?<(?![=!])(?<name>[^>]+)>|(?!\?)))|\\?./gsu;
  const map = /* @__PURE__ */ new Map();
  let numCharClassesOpen = 0;
  let numCaptures = 0;
  let match;
  while (match = re2.exec(pattern)) {
    const { 0: m3, groups: { capture, name } } = match;
    if (m3 === "[") {
      numCharClassesOpen++;
    } else if (!numCharClassesOpen) {
      if (capture) {
        numCaptures++;
        if (name) {
          map.set(numCaptures, name);
        }
      }
    } else if (m3 === "]") {
      numCharClassesOpen--;
    }
  }
  return map;
}

// node_modules/.pnpm/regex@6.1.0/node_modules/regex/src/utils-internals.js
var noncapturingDelim = String.raw`\(\?(?:[:=!>A-Za-z\-]|<[=!]|\(DEFINE\))`;
function incrementIfAtLeast(arr, threshold) {
  for (let i2 = 0; i2 < arr.length; i2++) {
    if (arr[i2] >= threshold) {
      arr[i2]++;
    }
  }
}
function spliceStr(str, pos, oldValue, newValue) {
  return str.slice(0, pos) + newValue + str.slice(pos + oldValue.length);
}

// node_modules/.pnpm/regex-utilities@2.3.0/node_modules/regex-utilities/src/index.js
var Context = Object.freeze({
  DEFAULT: "DEFAULT",
  CHAR_CLASS: "CHAR_CLASS"
});
function replaceUnescaped(expression, needle, replacement, context) {
  const re2 = new RegExp(String.raw`${needle}|(?<$skip>\[\^?|\\?.)`, "gsu");
  const negated = [false];
  let numCharClassesOpen = 0;
  let result = "";
  for (const match of expression.matchAll(re2)) {
    const { 0: m3, groups: { $skip } } = match;
    if (!$skip && (!context || context === Context.DEFAULT === !numCharClassesOpen)) {
      if (replacement instanceof Function) {
        result += replacement(match, {
          context: numCharClassesOpen ? Context.CHAR_CLASS : Context.DEFAULT,
          negated: negated[negated.length - 1]
        });
      } else {
        result += replacement;
      }
      continue;
    }
    if (m3[0] === "[") {
      numCharClassesOpen++;
      negated.push(m3[1] === "^");
    } else if (m3 === "]" && numCharClassesOpen) {
      numCharClassesOpen--;
      negated.pop();
    }
    result += m3;
  }
  return result;
}
function forEachUnescaped(expression, needle, callback, context) {
  replaceUnescaped(expression, needle, callback, context);
}
function execUnescaped(expression, needle, pos = 0, context) {
  if (!new RegExp(needle, "su").test(expression)) {
    return null;
  }
  const re2 = new RegExp(`${needle}|(?<$skip>\\\\?.)`, "gsu");
  re2.lastIndex = pos;
  let numCharClassesOpen = 0;
  let match;
  while (match = re2.exec(expression)) {
    const { 0: m3, groups: { $skip } } = match;
    if (!$skip && (!context || context === Context.DEFAULT === !numCharClassesOpen)) {
      return match;
    }
    if (m3 === "[") {
      numCharClassesOpen++;
    } else if (m3 === "]" && numCharClassesOpen) {
      numCharClassesOpen--;
    }
    if (re2.lastIndex == match.index) {
      re2.lastIndex++;
    }
  }
  return null;
}
function hasUnescaped(expression, needle, context) {
  return !!execUnescaped(expression, needle, 0, context);
}
function getGroupContents(expression, contentsStartPos) {
  const token2 = /\\?./gsu;
  token2.lastIndex = contentsStartPos;
  let contentsEndPos = expression.length;
  let numCharClassesOpen = 0;
  let numGroupsOpen = 1;
  let match;
  while (match = token2.exec(expression)) {
    const [m3] = match;
    if (m3 === "[") {
      numCharClassesOpen++;
    } else if (!numCharClassesOpen) {
      if (m3 === "(") {
        numGroupsOpen++;
      } else if (m3 === ")") {
        numGroupsOpen--;
        if (!numGroupsOpen) {
          contentsEndPos = match.index;
          break;
        }
      }
    } else if (m3 === "]") {
      numCharClassesOpen--;
    }
  }
  return expression.slice(contentsStartPos, contentsEndPos);
}

// node_modules/.pnpm/regex@6.1.0/node_modules/regex/src/atomic.js
var atomicPluginToken = new RegExp(String.raw`(?<noncapturingStart>${noncapturingDelim})|(?<capturingStart>\((?:\?<[^>]+>)?)|\\?.`, "gsu");
function atomic(expression, data) {
  const hiddenCaptures = data?.hiddenCaptures ?? [];
  let captureTransfers = data?.captureTransfers ?? /* @__PURE__ */ new Map();
  if (!/\(\?>/.test(expression)) {
    return {
      pattern: expression,
      captureTransfers,
      hiddenCaptures
    };
  }
  const aGDelim = "(?>";
  const emulatedAGDelim = "(?:(?=(";
  const captureNumMap = [0];
  const addedHiddenCaptures = [];
  let numCapturesBeforeAG = 0;
  let numAGs = 0;
  let aGPos = NaN;
  let hasProcessedAG;
  do {
    hasProcessedAG = false;
    let numCharClassesOpen = 0;
    let numGroupsOpenInAG = 0;
    let inAG = false;
    let match;
    atomicPluginToken.lastIndex = Number.isNaN(aGPos) ? 0 : aGPos + emulatedAGDelim.length;
    while (match = atomicPluginToken.exec(expression)) {
      const { 0: m3, index, groups: { capturingStart, noncapturingStart } } = match;
      if (m3 === "[") {
        numCharClassesOpen++;
      } else if (!numCharClassesOpen) {
        if (m3 === aGDelim && !inAG) {
          aGPos = index;
          inAG = true;
        } else if (inAG && noncapturingStart) {
          numGroupsOpenInAG++;
        } else if (capturingStart) {
          if (inAG) {
            numGroupsOpenInAG++;
          } else {
            numCapturesBeforeAG++;
            captureNumMap.push(numCapturesBeforeAG + numAGs);
          }
        } else if (m3 === ")" && inAG) {
          if (!numGroupsOpenInAG) {
            numAGs++;
            const addedCaptureNum = numCapturesBeforeAG + numAGs;
            expression = `${expression.slice(0, aGPos)}${emulatedAGDelim}${expression.slice(aGPos + aGDelim.length, index)}))<$$${addedCaptureNum}>)${expression.slice(index + 1)}`;
            hasProcessedAG = true;
            addedHiddenCaptures.push(addedCaptureNum);
            incrementIfAtLeast(hiddenCaptures, addedCaptureNum);
            if (captureTransfers.size) {
              const newCaptureTransfers = /* @__PURE__ */ new Map();
              captureTransfers.forEach((from, to) => {
                newCaptureTransfers.set(
                  to >= addedCaptureNum ? to + 1 : to,
                  from.map((f2) => f2 >= addedCaptureNum ? f2 + 1 : f2)
                );
              });
              captureTransfers = newCaptureTransfers;
            }
            break;
          }
          numGroupsOpenInAG--;
        }
      } else if (m3 === "]") {
        numCharClassesOpen--;
      }
    }
  } while (hasProcessedAG);
  hiddenCaptures.push(...addedHiddenCaptures);
  expression = replaceUnescaped(
    expression,
    String.raw`\\(?<backrefNum>[1-9]\d*)|<\$\$(?<wrappedBackrefNum>\d+)>`,
    ({ 0: m3, groups: { backrefNum, wrappedBackrefNum } }) => {
      if (backrefNum) {
        const bNum = +backrefNum;
        if (bNum > captureNumMap.length - 1) {
          throw new Error(`Backref "${m3}" greater than number of captures`);
        }
        return `\\${captureNumMap[bNum]}`;
      }
      return `\\${wrappedBackrefNum}`;
    },
    Context.DEFAULT
  );
  return {
    pattern: expression,
    captureTransfers,
    hiddenCaptures
  };
}
var baseQuantifier = String.raw`(?:[?*+]|\{\d+(?:,\d*)?\})`;
var possessivePluginToken = new RegExp(String.raw`
\\(?: \d+
  | c[A-Za-z]
  | [gk]<[^>]+>
  | [pPu]\{[^\}]+\}
  | u[A-Fa-f\d]{4}
  | x[A-Fa-f\d]{2}
  )
| \((?: \? (?: [:=!>]
  | <(?:[=!]|[^>]+>)
  | [A-Za-z\-]+:
  | \(DEFINE\)
  ))?
| (?<qBase>${baseQuantifier})(?<qMod>[?+]?)(?<invalidQ>[?*+\{]?)
| \\?.
`.replace(/\s+/g, ""), "gsu");
function possessive(expression) {
  if (!new RegExp(`${baseQuantifier}\\+`).test(expression)) {
    return {
      pattern: expression
    };
  }
  const openGroupIndices = [];
  let lastGroupIndex = null;
  let lastCharClassIndex = null;
  let lastToken = "";
  let numCharClassesOpen = 0;
  let match;
  possessivePluginToken.lastIndex = 0;
  while (match = possessivePluginToken.exec(expression)) {
    const { 0: m3, index, groups: { qBase, qMod, invalidQ } } = match;
    if (m3 === "[") {
      if (!numCharClassesOpen) {
        lastCharClassIndex = index;
      }
      numCharClassesOpen++;
    } else if (m3 === "]") {
      if (numCharClassesOpen) {
        numCharClassesOpen--;
      } else {
        lastCharClassIndex = null;
      }
    } else if (!numCharClassesOpen) {
      if (qMod === "+" && lastToken && !lastToken.startsWith("(")) {
        if (invalidQ) {
          throw new Error(`Invalid quantifier "${m3}"`);
        }
        let charsAdded = -1;
        if (/^\{\d+\}$/.test(qBase)) {
          expression = spliceStr(expression, index + qBase.length, qMod, "");
        } else {
          if (lastToken === ")" || lastToken === "]") {
            const nodeIndex = lastToken === ")" ? lastGroupIndex : lastCharClassIndex;
            if (nodeIndex === null) {
              throw new Error(`Invalid unmatched "${lastToken}"`);
            }
            expression = `${expression.slice(0, nodeIndex)}(?>${expression.slice(nodeIndex, index)}${qBase})${expression.slice(index + m3.length)}`;
          } else {
            expression = `${expression.slice(0, index - lastToken.length)}(?>${lastToken}${qBase})${expression.slice(index + m3.length)}`;
          }
          charsAdded += 4;
        }
        possessivePluginToken.lastIndex += charsAdded;
      } else if (m3[0] === "(") {
        openGroupIndices.push(index);
      } else if (m3 === ")") {
        lastGroupIndex = openGroupIndices.length ? openGroupIndices.pop() : null;
      }
    }
    lastToken = m3;
  }
  return {
    pattern: expression
  };
}

// node_modules/.pnpm/regex-recursion@6.0.2/node_modules/regex-recursion/src/index.js
var r3 = String.raw;
var gRToken = r3`\\g<(?<gRNameOrNum>[^>&]+)&R=(?<gRDepth>[^>]+)>`;
var recursiveToken = r3`\(\?R=(?<rDepth>[^\)]+)\)|${gRToken}`;
var namedCaptureDelim = r3`\(\?<(?![=!])(?<captureName>[^>]+)>`;
var captureDelim = r3`${namedCaptureDelim}|(?<unnamed>\()(?!\?)`;
var token = new RegExp(r3`${namedCaptureDelim}|${recursiveToken}|\(\?|\\?.`, "gsu");
var overlappingRecursionMsg = "Cannot use multiple overlapping recursions";
function recursion(pattern, data) {
  const { hiddenCaptures, mode } = {
    hiddenCaptures: [],
    mode: "plugin",
    ...data
  };
  let captureTransfers = data?.captureTransfers ?? /* @__PURE__ */ new Map();
  if (!new RegExp(recursiveToken, "su").test(pattern)) {
    return {
      pattern,
      captureTransfers,
      hiddenCaptures
    };
  }
  if (mode === "plugin" && hasUnescaped(pattern, r3`\(\?\(DEFINE\)`, Context.DEFAULT)) {
    throw new Error("DEFINE groups cannot be used with recursion");
  }
  const addedHiddenCaptures = [];
  const hasNumberedBackref = hasUnescaped(pattern, r3`\\[1-9]`, Context.DEFAULT);
  const groupContentsStartPos = /* @__PURE__ */ new Map();
  const openGroups = [];
  let hasRecursed = false;
  let numCharClassesOpen = 0;
  let numCapturesPassed = 0;
  let match;
  token.lastIndex = 0;
  while (match = token.exec(pattern)) {
    const { 0: m3, groups: { captureName, rDepth, gRNameOrNum, gRDepth } } = match;
    if (m3 === "[") {
      numCharClassesOpen++;
    } else if (!numCharClassesOpen) {
      if (rDepth) {
        assertMaxInBounds(rDepth);
        if (hasRecursed) {
          throw new Error(overlappingRecursionMsg);
        }
        if (hasNumberedBackref) {
          throw new Error(
            // When used in `external` mode by transpilers other than Regex+, backrefs might have
            // gone through conversion from named to numbered, so avoid a misleading error
            `${mode === "external" ? "Backrefs" : "Numbered backrefs"} cannot be used with global recursion`
          );
        }
        const left = pattern.slice(0, match.index);
        const right = pattern.slice(token.lastIndex);
        if (hasUnescaped(right, recursiveToken, Context.DEFAULT)) {
          throw new Error(overlappingRecursionMsg);
        }
        const reps = +rDepth - 1;
        pattern = makeRecursive(
          left,
          right,
          reps,
          false,
          hiddenCaptures,
          addedHiddenCaptures,
          numCapturesPassed
        );
        captureTransfers = mapCaptureTransfers(
          captureTransfers,
          left,
          reps,
          addedHiddenCaptures.length,
          0,
          numCapturesPassed
        );
        break;
      } else if (gRNameOrNum) {
        assertMaxInBounds(gRDepth);
        let isWithinReffedGroup = false;
        for (const g of openGroups) {
          if (g.name === gRNameOrNum || g.num === +gRNameOrNum) {
            isWithinReffedGroup = true;
            if (g.hasRecursedWithin) {
              throw new Error(overlappingRecursionMsg);
            }
            break;
          }
        }
        if (!isWithinReffedGroup) {
          throw new Error(r3`Recursive \g cannot be used outside the referenced group "${mode === "external" ? gRNameOrNum : r3`\g<${gRNameOrNum}&R=${gRDepth}>`}"`);
        }
        const startPos = groupContentsStartPos.get(gRNameOrNum);
        const groupContents = getGroupContents(pattern, startPos);
        if (hasNumberedBackref && hasUnescaped(groupContents, r3`${namedCaptureDelim}|\((?!\?)`, Context.DEFAULT)) {
          throw new Error(
            // When used in `external` mode by transpilers other than Regex+, backrefs might have
            // gone through conversion from named to numbered, so avoid a misleading error
            `${mode === "external" ? "Backrefs" : "Numbered backrefs"} cannot be used with recursion of capturing groups`
          );
        }
        const groupContentsLeft = pattern.slice(startPos, match.index);
        const groupContentsRight = groupContents.slice(groupContentsLeft.length + m3.length);
        const numAddedHiddenCapturesPreExpansion = addedHiddenCaptures.length;
        const reps = +gRDepth - 1;
        const expansion = makeRecursive(
          groupContentsLeft,
          groupContentsRight,
          reps,
          true,
          hiddenCaptures,
          addedHiddenCaptures,
          numCapturesPassed
        );
        captureTransfers = mapCaptureTransfers(
          captureTransfers,
          groupContentsLeft,
          reps,
          addedHiddenCaptures.length - numAddedHiddenCapturesPreExpansion,
          numAddedHiddenCapturesPreExpansion,
          numCapturesPassed
        );
        const pre = pattern.slice(0, startPos);
        const post = pattern.slice(startPos + groupContents.length);
        pattern = `${pre}${expansion}${post}`;
        token.lastIndex += expansion.length - m3.length - groupContentsLeft.length - groupContentsRight.length;
        openGroups.forEach((g) => g.hasRecursedWithin = true);
        hasRecursed = true;
      } else if (captureName) {
        numCapturesPassed++;
        groupContentsStartPos.set(String(numCapturesPassed), token.lastIndex);
        groupContentsStartPos.set(captureName, token.lastIndex);
        openGroups.push({
          num: numCapturesPassed,
          name: captureName
        });
      } else if (m3[0] === "(") {
        const isUnnamedCapture = m3 === "(";
        if (isUnnamedCapture) {
          numCapturesPassed++;
          groupContentsStartPos.set(String(numCapturesPassed), token.lastIndex);
        }
        openGroups.push(isUnnamedCapture ? { num: numCapturesPassed } : {});
      } else if (m3 === ")") {
        openGroups.pop();
      }
    } else if (m3 === "]") {
      numCharClassesOpen--;
    }
  }
  hiddenCaptures.push(...addedHiddenCaptures);
  return {
    pattern,
    captureTransfers,
    hiddenCaptures
  };
}
function assertMaxInBounds(max) {
  const errMsg = `Max depth must be integer between 2 and 100; used ${max}`;
  if (!/^[1-9]\d*$/.test(max)) {
    throw new Error(errMsg);
  }
  max = +max;
  if (max < 2 || max > 100) {
    throw new Error(errMsg);
  }
}
function makeRecursive(left, right, reps, isSubpattern, hiddenCaptures, addedHiddenCaptures, numCapturesPassed) {
  const namesInRecursed = /* @__PURE__ */ new Set();
  if (isSubpattern) {
    forEachUnescaped(left + right, namedCaptureDelim, ({ groups: { captureName } }) => {
      namesInRecursed.add(captureName);
    }, Context.DEFAULT);
  }
  const rest = [
    reps,
    isSubpattern ? namesInRecursed : null,
    hiddenCaptures,
    addedHiddenCaptures,
    numCapturesPassed
  ];
  return `${left}${repeatWithDepth(`(?:${left}`, "forward", ...rest)}(?:)${repeatWithDepth(`${right})`, "backward", ...rest)}${right}`;
}
function repeatWithDepth(pattern, direction, reps, namesInRecursed, hiddenCaptures, addedHiddenCaptures, numCapturesPassed) {
  const startNum = 2;
  const getDepthNum = (i2) => direction === "forward" ? i2 + startNum : reps - i2 + startNum - 1;
  let result = "";
  for (let i2 = 0; i2 < reps; i2++) {
    const depthNum = getDepthNum(i2);
    result += replaceUnescaped(
      pattern,
      r3`${captureDelim}|\\k<(?<backref>[^>]+)>`,
      ({ 0: m3, groups: { captureName, unnamed, backref } }) => {
        if (backref && namesInRecursed && !namesInRecursed.has(backref)) {
          return m3;
        }
        const suffix = `_$${depthNum}`;
        if (unnamed || captureName) {
          const addedCaptureNum = numCapturesPassed + addedHiddenCaptures.length + 1;
          addedHiddenCaptures.push(addedCaptureNum);
          incrementIfAtLeast2(hiddenCaptures, addedCaptureNum);
          return unnamed ? m3 : `(?<${captureName}${suffix}>`;
        }
        return r3`\k<${backref}${suffix}>`;
      },
      Context.DEFAULT
    );
  }
  return result;
}
function incrementIfAtLeast2(arr, threshold) {
  for (let i2 = 0; i2 < arr.length; i2++) {
    if (arr[i2] >= threshold) {
      arr[i2]++;
    }
  }
}
function mapCaptureTransfers(captureTransfers, left, reps, numCapturesAddedInExpansion, numAddedHiddenCapturesPreExpansion, numCapturesPassed) {
  if (captureTransfers.size && numCapturesAddedInExpansion) {
    let numCapturesInLeft = 0;
    forEachUnescaped(left, captureDelim, () => numCapturesInLeft++, Context.DEFAULT);
    const recursionDelimCaptureNum = numCapturesPassed - numCapturesInLeft + numAddedHiddenCapturesPreExpansion;
    const newCaptureTransfers = /* @__PURE__ */ new Map();
    captureTransfers.forEach((from, to) => {
      const numCapturesInRight = (numCapturesAddedInExpansion - numCapturesInLeft * reps) / reps;
      const numCapturesAddedInLeft = numCapturesInLeft * reps;
      const newTo = to > recursionDelimCaptureNum + numCapturesInLeft ? to + numCapturesAddedInExpansion : to;
      const newFrom = [];
      for (const f2 of from) {
        if (f2 <= recursionDelimCaptureNum) {
          newFrom.push(f2);
        } else if (f2 > recursionDelimCaptureNum + numCapturesInLeft + numCapturesInRight) {
          newFrom.push(f2 + numCapturesAddedInExpansion);
        } else if (f2 <= recursionDelimCaptureNum + numCapturesInLeft) {
          for (let i2 = 0; i2 <= reps; i2++) {
            newFrom.push(f2 + numCapturesInLeft * i2);
          }
        } else {
          for (let i2 = 0; i2 <= reps; i2++) {
            newFrom.push(f2 + numCapturesAddedInLeft + numCapturesInRight * i2);
          }
        }
      }
      newCaptureTransfers.set(newTo, newFrom);
    });
    return newCaptureTransfers;
  }
  return captureTransfers;
}

// src/index.js
function toRegExp(pattern, options) {
  const d2 = toRegExpDetails(pattern, options);
  if (d2.options) {
    return new EmulatedRegExp(d2.pattern, d2.flags, d2.options);
  }
  return new RegExp(d2.pattern, d2.flags);
}
function toRegExpDetails(pattern, options) {
  const opts = getOptions(options);
  const onigurumaAst = J2(pattern, {
    flags: opts.flags,
    normalizeUnknownPropertyNames: true,
    rules: {
      captureGroup: opts.rules.captureGroup,
      singleline: opts.rules.singleline
    },
    skipBackrefValidation: opts.rules.allowOrphanBackrefs,
    unicodePropertyMap: JsUnicodePropertyMap
  });
  const regexPlusAst = transform(onigurumaAst, {
    accuracy: opts.accuracy,
    asciiWordBoundaries: opts.rules.asciiWordBoundaries,
    avoidSubclass: opts.avoidSubclass,
    bestEffortTarget: opts.target
  });
  const generated = generate(regexPlusAst, opts);
  const recursionResult = recursion(generated.pattern, {
    captureTransfers: generated._captureTransfers,
    hiddenCaptures: generated._hiddenCaptures,
    mode: "external"
  });
  const possessiveResult = possessive(recursionResult.pattern);
  const atomicResult = atomic(possessiveResult.pattern, {
    captureTransfers: recursionResult.captureTransfers,
    hiddenCaptures: recursionResult.hiddenCaptures
  });
  const details = {
    pattern: atomicResult.pattern,
    flags: `${opts.hasIndices ? "d" : ""}${opts.global ? "g" : ""}${generated.flags}${generated.options.disable.v ? "u" : "v"}`
  };
  if (opts.avoidSubclass) {
    if (opts.lazyCompileLength !== Infinity) {
      throw new Error("Lazy compilation requires subclass");
    }
  } else {
    const hiddenCaptures = atomicResult.hiddenCaptures.sort((a2, b3) => a2 - b3);
    const transfers = Array.from(atomicResult.captureTransfers);
    const strategy = regexPlusAst._strategy;
    const lazyCompile = details.pattern.length >= opts.lazyCompileLength;
    if (hiddenCaptures.length || transfers.length || strategy || lazyCompile) {
      details.options = {
        ...hiddenCaptures.length && { hiddenCaptures },
        ...transfers.length && { transfers },
        ...strategy && { strategy },
        ...lazyCompile && { lazyCompile }
      };
    }
  }
  return details;
}
//# sourceMappingURL=index.js.map
