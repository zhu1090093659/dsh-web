import type { AlternativeContainerNode, Node, ParentNode, QuantifiableNode } from './parse.js';
type KeysOfUnion<T> = T extends T ? keyof T : never;
type Props = {
    [key in KeysOfUnion<Node>]?: any;
} & {
    type?: Node['type'];
};
declare function hasOnlyChild(node: ParentNode & {
    body: Array<Node>;
}, props?: Props): boolean;
declare function isAlternativeContainer(node: Node): node is AlternativeContainerNode;
declare function isQuantifiable(node: Node): node is QuantifiableNode;
export { hasOnlyChild, isAlternativeContainer, isQuantifiable, };
//# sourceMappingURL=node-utils.d.ts.map