import { Binary, Dict } from 'cosmokit';
import type { StandardSchemaV1 } from '@standard-schema/spec';
declare const kSchema: unique symbol;
declare global {
    namespace Schemastery {
        type From<X> = X extends string | number | boolean ? Schema<X> : X extends Schema ? X : X extends typeof String ? Schema<string> : X extends typeof Number ? Schema<number> : X extends typeof Boolean ? Schema<boolean> : X extends typeof Function ? Schema<Function, (...args: any[]) => any> : X extends Constructor<infer S> ? Schema<S> : never;
        type TypeS1<X> = X extends Schema<infer S, unknown> ? S : never;
        type Inverse<X> = X extends Schema<any, infer Y> ? (arg: Y) => void : never;
        type TypeS<X> = TypeS1<From<X>>;
        type TypeT<X> = ReturnType<From<X>>;
        type Resolve = (data: any, schema: Schema, options: Options, strict?: boolean) => [any, any?];
        type IntersectS<X> = From<X> extends Schema<infer S, unknown> ? S : never;
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
        interface Static {
            <T = any>(options: Partial<Schema<T>>): Schema<T>;
            new <T = any>(options: Partial<Schema<T>>): Schema<T>;
            prototype: Schema;
            resolve: Resolve;
            from<X = any>(source?: X): From<X>;
            extend(type: string, resolve: Resolve): void;
            any<T = any>(): Schema<T>;
            never(): Schema<never>;
            const<const T>(value: T): Schema<T>;
            string(): Schema<string>;
            number(): Schema<number>;
            natural(): Schema<number>;
            percent(): Schema<number>;
            boolean(): Schema<boolean>;
            date(): Schema<string | Date, Date>;
            regExp(flag?: string): Schema<string | RegExp, RegExp>;
            arrayBuffer(): Schema<Binary.Source, ArrayBufferLike>;
            arrayBuffer(encoding: 'hex' | 'base64'): Schema<Binary.Source | string, ArrayBufferLike>;
            bitset<K extends string>(bits: Partial<Record<K, number>>): Schema<number | readonly K[], number>;
            function(): Schema<Function, (...args: any[]) => any>;
            is(constructor: string): Schema;
            is<T>(constructor: Constructor<T>): Schema<T>;
            array<X>(inner: X): Schema<TypeS<X>[], TypeT<X>[]>;
            dict<X, Y extends Schema<any, string> = Schema<string>>(inner: X, sKey?: Y): Schema<Dict<TypeS<X>, TypeS<Y>>, Dict<TypeT<X>, TypeT<Y>>>;
            tuple<const X extends readonly any[]>(list: X): Schema<TupleS<X>, TupleT<X>>;
            object<X extends Dict>(dict: X): Schema<ObjectS<X>, ObjectT<X>>;
            union<const X>(list: readonly X[]): Schema<TypeS<X>, TypeT<X>>;
            intersect<const X>(list: readonly X[]): Schema<IntersectS<X>, IntersectT<X>>;
            transform<X, T>(inner: X, callback: (value: TypeS<X>, options: Schemastery.Options) => T, preserve?: boolean): Schema<TypeS<X>, T>;
            lazy<X extends Schema>(callback: () => X): X;
            ValidationError: typeof ValidationError;
        }
        interface Options {
            autofix?: boolean;
            ignore?(data: any, schema: Schema): boolean;
            path?: (keyof any)[];
        }
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
        toString(inline?: boolean): string;
        toJSON(): Schema<S, T>;
        required(value?: boolean): Schema<S, T>;
        hidden(value?: boolean): Schema<S, T>;
        loose(value?: boolean): Schema<S, T>;
        role(text: string, extra?: any): Schema<S, T>;
        link(link: string): Schema<S, T>;
        default(value: T): Schema<S, T>;
        comment(text: string): Schema<S, T>;
        description(text: string): Schema<S, T>;
        disabled(value?: boolean): Schema<S, T>;
        collapse(value?: boolean): Schema<S, T>;
        deprecated(): Schema<S, T>;
        experimental(): Schema<S, T>;
        pattern(regexp: RegExp): Schema<S, T>;
        max(value: number): Schema<S, T>;
        min(value: number): Schema<S, T>;
        step(value: number): Schema<S, T>;
        set(key: string, value: Schema): Schema<S, T>;
        push(value: Schema): Schema<S, T>;
        simplify(value?: any): any;
        i18n(messages: Dict): Schema<S, T>;
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
export = Schema;
