import type { AlternativeElementNode, AlternativeNode, CharacterClassElementNode, Node, ParentNode, RegexNode } from '../parser/parse.js';
type ContainerElementNode = AlternativeNode | AlternativeElementNode | CharacterClassElementNode;
type Path<N = Node, Root = RegexNode> = {
    node: N;
    parent: N extends RegexNode ? null : ParentNode;
    key: N extends RegexNode ? null : number | string;
    container: N extends RegexNode ? null : Array<ContainerElementNode> | null;
    root: Root;
    remove: () => void;
    removeAllNextSiblings: () => Array<Node>;
    removeAllPrevSiblings: () => Array<Node>;
    replaceWith: (newNode: Node, options?: {
        traverse?: boolean;
    }) => void;
    replaceWithMultiple: (newNodes: Array<Node>, options?: {
        traverse?: boolean;
    }) => void;
    skip: () => void;
};
type Visitor<State extends object | null = null, Root extends Node = RegexNode> = {
    [N in Node as N['type']]?: VisitorNodeFn<Path<N, Root>, State> | {
        enter?: VisitorNodeFn<Path<N, Root>, State>;
        exit?: VisitorNodeFn<Path<N, Root>, State>;
    };
} & {
    '*'?: VisitorNodeFn<Path<Node, Root>, State> | {
        enter?: VisitorNodeFn<Path<Node, Root>, State>;
        exit?: VisitorNodeFn<Path<Node, Root>, State>;
    };
};
type VisitorNodeFn<P, State> = (path: P, state: State) => void;
/**
Traverses an AST and calls the provided `visitor`'s node function for each node. Returns the same
object, possibly modified.

Visitor node functions can modify the AST in place and use methods on the `path` (provided as their
first argument) to help modify the AST. Provided `state` is passed through to all visitor node
functions as their second argument.

Visitor node functions are called in the following order:
1. `enter` function of the `'*'` node type (if any)
2. `enter` function of the given node's type (if any)
3. [The node's kids (if any) are traversed recursively, unless `skip` is called]
4. `exit` function of the given node's type (if any)
5. `exit` function of the `'*'` node type (if any)
*/
declare function traverse<State extends object | null = null, Root extends Node = RegexNode>(root: Root, visitor: Visitor<State, Root>, state?: State | null): Root;
export { type Path, type Visitor, traverse, };
//# sourceMappingURL=traverse.d.ts.map