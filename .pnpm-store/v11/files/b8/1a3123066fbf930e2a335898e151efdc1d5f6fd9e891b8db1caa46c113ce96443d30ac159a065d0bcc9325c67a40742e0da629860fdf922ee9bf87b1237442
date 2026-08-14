import type { AssertionNode, CharacterNode, Node } from '../../parser/parse.js';
import type { Visitor } from '../../traverser/traverse.js';
/**
Extract nodes at the start of every alternative into a prefix.
Ex: `^aa|^abb|^ac` -> `^a(?:a|bb|c)`.
Also works within groups.
*/
declare const extractPrefix: Visitor;
declare function isAllowedSimpleNode(node: Node): node is AssertionNode | CharacterNode | {
    type: "CharacterSet";
    kind: "posix" | "property";
    value: string;
    negate: boolean;
    variableLength?: never;
} | {
    type: "CharacterSet";
    kind: Exclude<import("../../parser/parse.js").NodeCharacterSetKind, "posix" | "property">;
    value?: never;
    negate?: boolean;
    variableLength?: boolean;
};
declare function isNodeEqual(a: Node, b: Node): boolean;
export { extractPrefix, isAllowedSimpleNode, isNodeEqual, };
//# sourceMappingURL=extract-prefix.d.ts.map