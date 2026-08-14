import { Binary, type Dict } from '@deepseek-ai/cosmokit';
import type { StandardSchemaV1 } from '@standard-schema/spec';
declare const kSchema: unique symbol;
declare global {
    namespace Schemastery {
        /** Convert primitive constructors, constants, and existing schemas into a schema type. */
        type From<X> = X extends string | number | boolean ? Schema<X> : X extends Schema ? X : X extends typeof String ? Schema<string> : X extends typeof Number ? Schema<number> : X extends typeof Boolean ? Schema<boolean> : X extends typeof Function ? Schema<Function, (...args: any[]) => any> : X extends Constructor<infer S> ? Schema<S> : never;
        type TypeS1<X> = X extends Schema<infer S, unknown> ? S : never;
        type Inverse<X> = X extends Schema<any, infer Y> ? (arg: Y) => void : never;
        /** Input type accepted by a schema-like value. */
        type TypeS<X> = TypeS1<From<X>>;
        /** Output type returned by a schema-like value after validation. */
        type TypeT<X> = ReturnType<From<X>>;
        /** Resolver callback used by custom schema types registered with `Schema.extend()`. */
        type Resolve = (data: any, schema: Schema, options: Options, strict?: boolean) => [any, any?];
        /** Input type accepted by one schema in an intersection. */
        type IntersectS<X> = From<X> extends Schema<infer S, unknown> ? S : never;
        /** Output type returned by one schema in an intersection. */
        type IntersectT<X> = Inverse<From<X>> extends ((arg: infer T) => void) ? T : never;
        type TupleS<X extends readonly any[]> = X extends readonly [infer L, ...infer R] ? [TypeS<L>?, ...TupleS<R>] : any[];
        type TupleT<X extends readonly any[]> = X extends readonly [infer L, ...infer R] ? [TypeT<L>?, ...TupleT<R>] : any[];
        type ObjectS<X extends Dict> = {
            [K in keyof X]?: TypeS<X[K]> | null;
        } & Dict;
        type ObjectT<X extends Dict> = {
            [K in keyof X]: TypeT<X[K]>;
        } & Dict;
        type Constructor<T = any> = new (...args: any[]) => T;
        /** Static constructor and factory methods exposed by the default `Schema` export. */
        interface Static {
            <T = any>(options: Partial<Schema<T>>): Schema<T>;
            new <T = any>(options: Partial<Schema<T>>): Schema<T>;
            prototype: Schema;
            /** Validate a value against a schema node and return `[output, adaptedInput?]`. */
            resolve: Resolve;
            /** Infer a schema from a primitive value, constructor, or existing schema. */
            from<X = any>(source?: X): From<X>;
            /** Register a resolver for a custom schema `type`. */
            extend(type: string, resolve: Resolve): void;
            /** Accept any value without validation. */
            any<T = any>(): Schema<T>;
            /** Accept only nullable input. */
            never(): Schema<never>;
            /** Accept exactly one constant value. */
            const<const T>(value: T): Schema<T>;
            /** Accept strings, with optional metadata constraints added by instance methods. */
            string(): Schema<string>;
            /** Accept numbers, with optional range and step constraints. */
            number(): Schema<number>;
            /** Accept non-negative integer numbers. */
            natural(): Schema<number>;
            /** Accept a number between 0 and 1 and mark it as a slider. */
            percent(): Schema<number>;
            /** Accept booleans. */
            boolean(): Schema<boolean>;
            /** Accept `Date` instances or parse datetime strings into `Date` objects. */
            date(): Schema<string | Date, Date>;
            /** Accept `RegExp` instances or parse strings into regular expressions. */
            regExp(flag?: string): Schema<string | RegExp, RegExp>;
            /** Accept binary sources and normalize them to `ArrayBufferLike`. */
            arrayBuffer(): Schema<Binary.Source, ArrayBufferLike>;
            arrayBuffer(encoding: 'hex' | 'base64'): Schema<Binary.Source | string, ArrayBufferLike>;
            /** Accept a numeric bitset or string keys and normalize to a number. */
            bitset<K extends string>(bits: Partial<Record<K, number>>): Schema<number | readonly K[], number>;
            /** Accept functions. */
            function(): Schema<Function, (...args: any[]) => any>;
            /** Accept instances of a constructor or objects whose constructor name matches. */
            is(constructor: string): Schema;
            is<T>(constructor: Constructor<T>): Schema<T>;
            /** Accept arrays whose elements match `inner`. */
            array<X>(inner: X): Schema<TypeS<X>[], TypeT<X>[]>;
            /** Accept plain objects with values matching `inner` and optional key schema. */
            dict<X, Y extends Schema<any, string> = Schema<string>>(inner: X, sKey?: Y): Schema<Dict<TypeS<X>, TypeS<Y>>, Dict<TypeT<X>, TypeT<Y>>>;
            /** Accept tuple arrays where each index matches the corresponding schema. */
            tuple<const X extends readonly any[]>(list: X): Schema<TupleS<X>, TupleT<X>>;
            /** Accept plain objects whose declared properties match the schema dictionary. */
            object<X extends Dict>(dict: X): Schema<ObjectS<X>, ObjectT<X>>;
            /** Accept values matching at least one schema in `list`. */
            union<const X>(list: readonly X[]): Schema<TypeS<X>, TypeT<X>>;
            /** Accept values matching every schema in `list`, merging object outputs. */
            intersect<const X>(list: readonly X[]): Schema<IntersectS<X>, IntersectT<X>>;
            /** Validate with `inner`, then convert the result with `callback`. */
            transform<X, T>(inner: X, callback: (value: TypeS<X>, options: Schemastery.Options) => T, preserve?: boolean): Schema<TypeS<X>, T>;
            /** Defer construction of a recursive schema until validation or serialization. */
            lazy<X extends Schema>(callback: () => X): X;
            ValidationError: typeof ValidationError;
        }
        /** Runtime validation options shared by all schema calls. */
        interface Options {
            /** Remove invalid object properties instead of throwing when possible. */
            autofix?: boolean;
            /** Skip validation for selected values and schema nodes. */
            ignore?(data: any, schema: Schema): boolean;
            /** Path used to format nested validation errors. */
            path?: (keyof any)[];
        }
        /** UI and validation metadata attached by schema builder methods. */
        interface Meta<T = any> {
            default?: T extends {} ? Partial<T> : T;
            required?: boolean;
            disabled?: boolean;
            collapse?: boolean;
            badges?: {
                text: string;
                type: string;
            }[];
            hidden?: boolean;
            loose?: boolean;
            role?: string;
            extra?: any;
            link?: string;
            description?: string | Dict<string>;
            comment?: string;
            pattern?: {
                source: string;
                flags?: string;
            };
            max?: number;
            min?: number;
            step?: number;
        }
    }
    /** Callable schema instance that validates input and returns normalized output. */
    interface Schemastery<S = any, T = S> {
        (data?: S | null, options?: Schemastery.Options): T;
        new (data?: S | null, options?: Schemastery.Options): T;
        [kSchema]: true;
        uid: number;
        meta: Schemastery.Meta<T>;
        type: string;
        sKey?: Schema;
        inner?: Schema;
        list?: Schema[];
        dict?: Dict<Schema>;
        bits?: Dict<number>;
        callback?: Function;
        constructor?: string | Function;
        builder?: Function;
        value?: T;
        refs?: Dict<Schema>;
        preserve?: boolean;
        '~standard': StandardSchemaV1.Props;
        /** Format this schema as a compact TypeScript-like type string. */
        toString(inline?: boolean): string;
        /** Serialize this schema, preserving shared and recursive references. */
        toJSON(): Schema<S, T>;
        /** Mark nullable input as invalid unless a default supplies a fallback. */
        required(value?: boolean): Schema<S, T>;
        /** Hide this schema node from UI renderers. */
        hidden(value?: boolean): Schema<S, T>;
        /** Return the default value instead of throwing when validation fails. */
        loose(value?: boolean): Schema<S, T>;
        /** Attach a renderer role and optional role-specific metadata. */
        role(text: string, extra?: any): Schema<S, T>;
        /** Attach an external documentation link. */
        link(link: string): Schema<S, T>;
        /** Set the fallback value used for nullable input. */
        default(value: T): Schema<S, T>;
        /** Attach an auxiliary comment for documentation or form UIs. */
        comment(text: string): Schema<S, T>;
        /** Attach a localized or plain description for documentation or form UIs. */
        description(text: string): Schema<S, T>;
        /** Mark this schema node as disabled for form UIs. */
        disabled(value?: boolean): Schema<S, T>;
        /** Request collapsed rendering for nested form UIs. */
        collapse(value?: boolean): Schema<S, T>;
        /** Add a deprecated badge to this schema node. */
        deprecated(): Schema<S, T>;
        /** Add an experimental badge to this schema node. */
        experimental(): Schema<S, T>;
        /** Require strings to match a regular expression. */
        pattern(regexp: RegExp): Schema<S, T>;
        /** Set an inclusive maximum for numbers or collection lengths. */
        max(value: number): Schema<S, T>;
        /** Set an inclusive minimum for numbers or collection lengths. */
        min(value: number): Schema<S, T>;
        /** Set the numeric increment constraint. */
        step(value: number): Schema<S, T>;
        /** Add or replace an object property schema. */
        set(key: string, value: Schema): Schema<S, T>;
        /** Append a tuple, union, or intersection member schema. */
        push(value: Schema): Schema<S, T>;
        /** Remove values equal to schema defaults from normalized output. */
        simplify(value?: any): any;
        /** Return a schema clone with descriptions merged from locale messages. */
        i18n(messages: Dict): Schema<S, T>;
        /** Attach arbitrary metadata consumed by form renderers and downstream tools. */
        extra<K extends keyof Schemastery.Meta>(key: K, value: Schemastery.Meta[K]): Schema<S, T>;
    }
}
declare class ValidationError extends TypeError {
    options: Schemastery.Options;
    name: string;
    constructor(message: string, options: Schemastery.Options);
    static is(error: any): error is ValidationError;
}
type Schema<S = any, T = S> = Schemastery<S, T>;
declare const Schema: Schemastery.Static;
export default Schema;
//# sourceMappingURL=index.d.ts.map