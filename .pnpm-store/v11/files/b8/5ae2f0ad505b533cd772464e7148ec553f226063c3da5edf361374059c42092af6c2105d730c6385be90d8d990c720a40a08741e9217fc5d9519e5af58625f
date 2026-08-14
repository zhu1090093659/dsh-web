/** Uppercase the first character of a string. */
export declare function capitalize(source: string): string;
/** Lowercase the first character of a string. */
export declare function uncapitalize(source: string): string;
/** Convert dash or underscore delimited text to camelCase. */
export declare function camelCase(source: string): string;
/** Convert text to dash-delimited parameter case. */
export declare function paramCase(source: string): string;
/** Convert text to underscore-delimited snake case. */
export declare function snakeCase(source: string): string;
/** Runtime alias for `camelCase`. */
export declare const camelize: typeof camelCase;
/** Runtime alias for `paramCase`. */
export declare const hyphenate: typeof paramCase;
declare namespace Letter {
    interface LowerToUpper {
        a: 'A';
        b: 'B';
        c: 'C';
        d: 'D';
        e: 'E';
        f: 'F';
        g: 'G';
        h: 'H';
        i: 'I';
        j: 'J';
        k: 'K';
        l: 'L';
        m: 'M';
        n: 'N';
        o: 'O';
        p: 'P';
        q: 'Q';
        r: 'R';
        s: 'S';
        t: 'T';
        u: 'U';
        v: 'V';
        w: 'W';
        x: 'X';
        y: 'Y';
        z: 'Z';
    }
    interface UpperToLower {
        A: 'a';
        B: 'b';
        C: 'c';
        D: 'd';
        E: 'e';
        F: 'f';
        G: 'g';
        H: 'h';
        I: 'i';
        J: 'j';
        K: 'k';
        L: 'l';
        M: 'm';
        N: 'n';
        O: 'o';
        P: 'p';
        Q: 'q';
        R: 'r';
        S: 's';
        T: 't';
        U: 'u';
        V: 'v';
        W: 'w';
        X: 'x';
        Y: 'y';
        Z: 'z';
    }
    export type Upper = keyof UpperToLower;
    export type Lower = keyof LowerToUpper;
    export type ToUpper<S extends string> = S extends Lower ? LowerToUpper[S] : S;
    export type ToLower<S extends string, P extends string = ''> = S extends Upper ? `${P}${UpperToLower[S]}` : S;
    export {};
}
/** Type-level conversion from dash-delimited text to camelCase. */
export type camelize<S extends string> = S extends `${infer L}-${infer M}${infer R}` ? `${L}${Letter.ToUpper<M>}${camelize<R>}` : S;
/** Type-level conversion from camelCase text to dash-delimited text. */
export type hyphenate<S extends string> = S extends `${infer L}${infer R}` ? `${Letter.ToLower<L, '-'>}${hyphenate<R>}` : S;
/** Format a property key as a JavaScript member access suffix. */
export declare function formatProperty(key: keyof any): string;
/** Remove one trailing slash from a path string. */
export declare function trimSlash(source: string): string;
/** Ensure a path starts with `/` and has no trailing slash. */
export declare function sanitize(source: string): string;
export {};
//# sourceMappingURL=string.d.ts.map