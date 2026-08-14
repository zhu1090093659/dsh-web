type Token = AlternatorToken | AssertionToken | BackreferenceToken | CharacterToken | CharacterClassCloseToken | CharacterClassHyphenToken | CharacterClassIntersectorToken | CharacterClassOpenToken | CharacterSetToken | DirectiveToken | GroupCloseToken | GroupOpenToken | NamedCalloutToken | QuantifierToken | SubroutineToken;
type TokenCharacterSetKind = 'any' | 'digit' | 'dot' | 'hex' | 'newline' | 'posix' | 'property' | 'space' | 'text_segment' | 'word';
type TokenDirectiveKind = 'flags' | 'keep';
type TokenGroupOpenKind = 'absence_repeater' | 'atomic' | 'capturing' | 'group' | 'lookahead' | 'lookbehind';
type TokenQuantifierKind = 'greedy' | 'lazy' | 'possessive';
type TokenNamedCalloutKind = 'count' | 'cmp' | 'error' | 'fail' | 'max' | 'mismatch' | 'skip' | 'total_count' | 'custom';
type TokenizeOptions = {
    flags?: string;
    rules?: {
        captureGroup?: boolean;
        singleline?: boolean;
    };
};
declare function tokenize(pattern: string, options?: TokenizeOptions): {
    tokens: Array<Token>;
    flags: FlagProperties;
};
type AlternatorToken = {
    type: 'Alternator';
    raw: '|';
};
type AssertionToken = {
    type: 'Assertion';
    kind: string;
    raw: string;
};
type BackreferenceToken = {
    type: 'Backreference';
    raw: string;
};
type CharacterToken = {
    type: 'Character';
    value: number;
    raw: string;
};
type CharacterClassCloseToken = {
    type: 'CharacterClassClose';
    raw: ']';
};
type CharacterClassHyphenToken = {
    type: 'CharacterClassHyphen';
    raw: '-';
};
type CharacterClassIntersectorToken = {
    type: 'CharacterClassIntersector';
    raw: '&&';
};
type CharacterClassOpenToken = {
    type: 'CharacterClassOpen';
    negate: boolean;
    raw: CharacterClassOpener;
};
type CharacterClassOpener = '[' | '[^';
type CharacterSetToken = {
    type: 'CharacterSet';
    kind: TokenCharacterSetKind;
    value?: string;
    negate?: boolean;
    raw: string;
};
type DirectiveToken = {
    type: 'Directive';
    raw: string;
} & ({
    kind: 'keep';
    flags?: never;
} | {
    kind: 'flags';
    flags: FlagGroupModifiers;
});
type GroupCloseToken = {
    type: 'GroupClose';
    raw: ')';
};
type GroupOpenToken = {
    type: 'GroupOpen';
    kind: TokenGroupOpenKind;
    flags?: FlagGroupModifiers;
    name?: string;
    number?: number;
    negate?: boolean;
    raw: string;
};
type NamedCalloutToken = {
    type: 'NamedCallout';
    kind: TokenNamedCalloutKind;
    tag: string | null;
    arguments: Array<string | number> | null;
    raw: string;
};
type QuantifierToken = {
    type: 'Quantifier';
    kind: TokenQuantifierKind;
    min: number;
    max: number;
    raw: string;
};
type SubroutineToken = {
    type: 'Subroutine';
    raw: string;
};
type FlagProperties = {
    ignoreCase: boolean;
    dotAll: boolean;
    extended: boolean;
    digitIsAscii: boolean;
    posixIsAscii: boolean;
    spaceIsAscii: boolean;
    wordIsAscii: boolean;
    textSegmentMode: 'grapheme' | 'word' | null;
};
type FlagGroupModifiers = {
    enable?: FlagGroupSwitches;
    disable?: FlagGroupSwitches;
};
type FlagGroupSwitches = {
    ignoreCase?: true;
    dotAll?: true;
    extended?: true;
};
export { type AlternatorToken, type AssertionToken, type BackreferenceToken, type CharacterToken, type CharacterClassCloseToken, type CharacterClassHyphenToken, type CharacterClassIntersectorToken, type CharacterClassOpenToken, type CharacterSetToken, type DirectiveToken, type FlagGroupModifiers, type FlagProperties, type GroupCloseToken, type GroupOpenToken, type NamedCalloutToken, type QuantifierToken, type SubroutineToken, type Token, type TokenCharacterSetKind, type TokenDirectiveKind, type TokenNamedCalloutKind, type TokenQuantifierKind, tokenize, };
//# sourceMappingURL=tokenize.d.ts.map