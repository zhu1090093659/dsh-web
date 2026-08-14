import type { FlagGroupModifiers, FlagProperties, TokenCharacterSetKind, TokenDirectiveKind, TokenNamedCalloutKind, TokenQuantifierKind } from '../tokenizer/tokenize.js';
import { hasOnlyChild, isAlternativeContainer, isQuantifiable } from './node-utils.js';
type Node = AbsenceFunctionNode | AlternativeNode | AssertionNode | BackreferenceNode | CapturingGroupNode | CharacterNode | CharacterClassNode | CharacterClassRangeNode | CharacterSetNode | DirectiveNode | FlagsNode | GroupNode | LookaroundAssertionNode | NamedCalloutNode | QuantifierNode | RegexNode | SubroutineNode;
type OnigurumaAst = RegexNode;
type ParentNode = AlternativeContainerNode | AlternativeNode | CharacterClassNode | CharacterClassRangeNode | QuantifierNode;
type AlternativeContainerNode = AbsenceFunctionNode | // Some sub-kinds aren't alternative containers
CapturingGroupNode | GroupNode | LookaroundAssertionNode | RegexNode;
type AlternativeElementNode = AbsenceFunctionNode | AssertionNode | BackreferenceNode | CapturingGroupNode | CharacterNode | CharacterClassNode | CharacterSetNode | DirectiveNode | GroupNode | LookaroundAssertionNode | NamedCalloutNode | QuantifierNode | SubroutineNode;
type CharacterClassElementNode = CharacterNode | CharacterClassNode | CharacterClassRangeNode | CharacterSetNode;
type QuantifiableNode = AbsenceFunctionNode | BackreferenceNode | CapturingGroupNode | CharacterNode | CharacterClassNode | CharacterSetNode | GroupNode | QuantifierNode | SubroutineNode;
type NodeAbsenceFunctionKind = 'repeater';
type NodeAssertionKind = 'line_end' | 'line_start' | 'search_start' | 'string_end' | 'string_end_newline' | 'string_start' | 'text_segment_boundary' | 'word_boundary';
type NodeCharacterClassKind = 'union' | 'intersection';
type NodeCharacterSetKind = TokenCharacterSetKind;
type NodeDirectiveKind = TokenDirectiveKind;
type NodeLookaroundAssertionKind = 'lookahead' | 'lookbehind';
type NodeNamedCalloutKind = TokenNamedCalloutKind;
type NodeQuantifierKind = TokenQuantifierKind;
type UnicodePropertyMap = Map<string, string>;
type ParseOptions = {
    flags?: string;
    normalizeUnknownPropertyNames?: boolean;
    rules?: {
        captureGroup?: boolean;
        singleline?: boolean;
    };
    skipBackrefValidation?: boolean;
    skipLookbehindValidation?: boolean;
    skipPropertyNameValidation?: boolean;
    unicodePropertyMap?: UnicodePropertyMap | null;
};
declare function parse(pattern: string, options?: ParseOptions): OnigurumaAst;
type AbsenceFunctionNode = {
    type: 'AbsenceFunction';
    kind: NodeAbsenceFunctionKind;
    body: Array<AlternativeNode>;
};
declare function createAbsenceFunction(kind: NodeAbsenceFunctionKind, options?: {
    body?: Array<AlternativeNode>;
}): AbsenceFunctionNode;
type AlternativeNode = {
    type: 'Alternative';
    body: Array<AlternativeElementNode>;
};
declare function createAlternative(options?: {
    body?: Array<AlternativeElementNode>;
}): AlternativeNode;
type AssertionNode = {
    type: 'Assertion';
    kind: NodeAssertionKind;
    negate?: boolean;
};
declare function createAssertion(kind: NodeAssertionKind, options?: {
    negate?: boolean;
}): AssertionNode;
type BackreferenceNode = {
    type: 'Backreference';
    ref: string | number;
    orphan?: boolean;
};
declare function createBackreference(ref: string | number, options?: {
    orphan?: boolean;
}): BackreferenceNode;
type CapturingGroupNode = {
    type: 'CapturingGroup';
    kind?: never;
    number: number;
    name?: string;
    isSubroutined?: boolean;
    body: Array<AlternativeNode>;
};
declare function createCapturingGroup(number: number, options?: {
    name?: string;
    isSubroutined?: boolean;
    body?: Array<AlternativeNode>;
}): CapturingGroupNode;
type CharacterNode = {
    type: 'Character';
    value: number;
};
declare function createCharacter(charCode: number, options?: {
    useLastValid?: boolean;
}): CharacterNode;
type CharacterClassNode = {
    type: 'CharacterClass';
    kind: NodeCharacterClassKind;
    negate: boolean;
    body: Array<CharacterClassElementNode>;
};
declare function createCharacterClass(options?: {
    kind?: NodeCharacterClassKind;
    negate?: boolean;
    body?: Array<CharacterClassElementNode>;
}): CharacterClassNode;
type CharacterClassRangeNode = {
    type: 'CharacterClassRange';
    min: CharacterNode;
    max: CharacterNode;
};
declare function createCharacterClassRange(min: CharacterNode, max: CharacterNode): CharacterClassRangeNode;
type NamedCharacterSetNode = {
    type: 'CharacterSet';
    kind: 'posix' | 'property';
    value: string;
    negate: boolean;
    variableLength?: never;
};
type UnnamedCharacterSetNode = {
    type: 'CharacterSet';
    kind: Exclude<NodeCharacterSetKind, NamedCharacterSetNode['kind']>;
    value?: never;
    negate?: boolean;
    variableLength?: boolean;
};
type CharacterSetNode = NamedCharacterSetNode | UnnamedCharacterSetNode;
/**
Use `createUnicodeProperty` and `createPosixClass` for `kind` values `'property'` and `'posix'`.
*/
declare function createCharacterSet(kind: UnnamedCharacterSetNode['kind'], options?: {
    negate?: boolean;
}): UnnamedCharacterSetNode;
type DirectiveNode = {
    type: 'Directive';
} & ({
    kind: 'keep';
    flags?: never;
} | {
    kind: 'flags';
    flags: FlagGroupModifiers;
});
declare function createDirective(kind: NodeDirectiveKind, options?: {
    flags?: FlagGroupModifiers;
}): DirectiveNode;
type FlagsNode = {
    type: 'Flags';
} & FlagProperties;
declare function createFlags(flags: FlagProperties): FlagsNode;
type GroupNode = {
    type: 'Group';
    kind?: never;
    atomic?: boolean;
    flags?: FlagGroupModifiers;
    body: Array<AlternativeNode>;
};
declare function createGroup(options?: {
    atomic?: boolean;
    flags?: FlagGroupModifiers;
    body?: Array<AlternativeNode>;
}): GroupNode;
type LookaroundAssertionNode = {
    type: 'LookaroundAssertion';
    kind: NodeLookaroundAssertionKind;
    negate: boolean;
    body: Array<AlternativeNode>;
};
declare function createLookaroundAssertion(options?: {
    behind?: boolean;
    negate?: boolean;
    body?: Array<AlternativeNode>;
}): LookaroundAssertionNode;
type NamedCalloutNode = {
    type: 'NamedCallout';
    kind: NodeNamedCalloutKind;
    tag: string | null;
    arguments: Array<string | number> | null;
};
declare function createNamedCallout(kind: NodeNamedCalloutKind, tag: string | null, args: Array<string | number> | null): NamedCalloutNode;
declare function createPosixClass(name: string, options?: {
    negate?: boolean;
}): NamedCharacterSetNode & {
    kind: 'posix';
};
type QuantifierNode = {
    type: 'Quantifier';
    kind: NodeQuantifierKind;
    min: number;
    max: number;
    body: QuantifiableNode;
};
declare function createQuantifier(kind: NodeQuantifierKind, min: number, max: number, body: QuantifiableNode): QuantifierNode;
type RegexNode = {
    type: 'Regex';
    body: Array<AlternativeNode>;
    flags: FlagsNode;
};
declare function createRegex(flags: FlagsNode, options?: {
    body?: Array<AlternativeNode>;
}): RegexNode;
type SubroutineNode = {
    type: 'Subroutine';
    ref: string | number;
};
declare function createSubroutine(ref: string | number): SubroutineNode;
type CreateUnicodePropertyOptions = {
    negate?: boolean;
    normalizeUnknownPropertyNames?: boolean;
    skipPropertyNameValidation?: boolean;
    unicodePropertyMap?: UnicodePropertyMap | null;
};
declare function createUnicodeProperty(name: string, options?: CreateUnicodePropertyOptions): NamedCharacterSetNode & {
    kind: 'property';
};
/**
Generates a Unicode property lookup name: lowercase, without spaces, hyphens, or underscores.
*/
declare function slug(name: string): string;
export { type AbsenceFunctionNode, type AlternativeNode, type AlternativeContainerNode, type AlternativeElementNode, type AssertionNode, type BackreferenceNode, type CapturingGroupNode, type CharacterClassElementNode, type CharacterClassNode, type CharacterClassRangeNode, type CharacterNode, type CharacterSetNode, type DirectiveNode, type FlagsNode, type GroupNode, type LookaroundAssertionNode, type NamedCalloutNode, type Node, type NodeAbsenceFunctionKind, type NodeAssertionKind, type NodeCharacterClassKind, type NodeCharacterSetKind, type NodeDirectiveKind, type NodeLookaroundAssertionKind, type NodeQuantifierKind, type OnigurumaAst, type ParentNode, type ParseOptions, type QuantifiableNode, type QuantifierNode, type RegexNode, type SubroutineNode, type UnicodePropertyMap, createAbsenceFunction, createAlternative, createAssertion, createBackreference, createCapturingGroup, createCharacter, createCharacterClass, createCharacterClassRange, createCharacterSet, createDirective, createFlags, createGroup, createLookaroundAssertion, createNamedCallout, createPosixClass, createQuantifier, createRegex, createSubroutine, createUnicodeProperty, hasOnlyChild, isAlternativeContainer, isQuantifiable, parse, slug, };
//# sourceMappingURL=parse.d.ts.map