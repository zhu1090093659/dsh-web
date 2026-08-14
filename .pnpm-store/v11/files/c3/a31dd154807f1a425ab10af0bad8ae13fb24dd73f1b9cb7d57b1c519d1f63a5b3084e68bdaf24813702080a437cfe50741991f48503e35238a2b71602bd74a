/**
@import {ToRegExpOptions} from './index.js';
@import {RegexPlusAst} from './transform.js';
@import {AlternativeNode, AssertionNode, BackreferenceNode, CapturingGroupNode, CharacterClassNode, CharacterClassRangeNode, CharacterNode, CharacterSetNode, FlagsNode, GroupNode, LookaroundAssertionNode, Node, QuantifierNode, SubroutineNode} from 'oniguruma-parser/parser';
@import {Visitor} from 'oniguruma-parser/traverser';
*/
/**
Generates a Regex+ compatible `pattern`, `flags`, and `options` from a Regex+ AST.
@param {RegexPlusAst} ast
@param {ToRegExpOptions} [options]
@returns {{
  pattern: string;
  flags: string;
  options: Object;
  _captureTransfers: Map<number, Array<number>>;
  _hiddenCaptures: Array<number>;
}}
*/
export function generate(ast: RegexPlusAst, options?: ToRegExpOptions): {
    pattern: string;
    flags: string;
    options: Object;
    _captureTransfers: Map<number, Array<number>>;
    _hiddenCaptures: Array<number>;
};
import type { RegexPlusAst } from './transform.js';
import type { ToRegExpOptions } from './index.js';
