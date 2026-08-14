import type { Node } from '../../parser/parse.js';
import type { Visitor } from '../../traverser/traverse.js';
/**
Use shorthands (`\d`, `\h`, `\s`, etc.) when possible.
- `\d` from `\p{Decimal_Number}`, `\p{Nd}`, `\p{digit}`, `[[:digit:]]`
- `\h` from `\p{ASCII_Hex_Digit}`, `\p{AHex}`, `\p{xdigit}`, `[[:xdigit:]]`, `[0-9A-Fa-f]`
- `\s` from `\p{White_Space}`, `\p{WSpace}`, `\p{space}`, `[[:space:]]`
- `\w` from `[\p{L}\p{M}\p{N}\p{Pc}]` - Not the same as POSIX `\p{word}`, `[[:word:]]`!
- `\O` from `\p{Any}` if not in class
See also `useUnicodeProps`.
*/
declare const useShorthands: Visitor;
declare function isRange(node: Node, min: number, max: number): boolean;
export { isRange, useShorthands, };
//# sourceMappingURL=use-shorthands.d.ts.map