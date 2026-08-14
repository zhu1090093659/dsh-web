export type RegexPlusAst = OnigurumaAst & {
    options: {
        disable: {
            [key: string]: boolean;
        };
        force: {
            [key: string]: boolean;
        };
    };
    _originMap: Map<CapturingGroupNode, CapturingGroupNode>;
    _strategy: string | null;
};
/**
@import {CapturingGroupNode, OnigurumaAst, Node} from 'oniguruma-parser/parser';
@import {Visitor} from 'oniguruma-parser/traverser';
*/
/**
@typedef {
  OnigurumaAst & {
    options: {
      disable: {[key: string]: boolean};
      force: {[key: string]: boolean};
    };
    _originMap: Map<CapturingGroupNode, CapturingGroupNode>;
    _strategy: string | null;
  }
} RegexPlusAst
*/
/**
Transforms an Oniguruma AST in-place to a [Regex+](https://github.com/slevithan/regex) AST.
Assumes target ES2025, expecting the generator to down-convert to the desired JS target version.

Regex+'s syntax and behavior is a strict superset of native JavaScript, so the AST is very close
to representing native ES2025 `RegExp` but with some added features (atomic groups, possessive
quantifiers, recursion). The AST doesn't use some of Regex+'s extended features like flag x or
subroutines because they follow PCRE behavior and work somewhat differently than in Oniguruma. The
AST represents what's needed to precisely reproduce Oniguruma behavior using Regex+.
@param {OnigurumaAst} ast
@param {{
  accuracy?: keyof Accuracy;
  asciiWordBoundaries?: boolean;
  avoidSubclass?: boolean;
  bestEffortTarget?: keyof Target;
}} [options]
@returns {RegexPlusAst}
*/
export function transform(ast: OnigurumaAst, options?: {
    accuracy?: "default" | "strict";
    asciiWordBoundaries?: boolean;
    avoidSubclass?: boolean;
    bestEffortTarget?: "auto" | "ES2025" | "ES2024" | "ES2018";
}): RegexPlusAst;
import type { OnigurumaAst } from 'oniguruma-parser/parser';
import type { CapturingGroupNode } from 'oniguruma-parser/parser';
