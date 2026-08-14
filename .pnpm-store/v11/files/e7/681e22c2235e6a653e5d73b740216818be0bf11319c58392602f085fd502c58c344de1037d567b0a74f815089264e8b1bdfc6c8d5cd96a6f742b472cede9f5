/**
 * Remote decorators and explicit Gateway bindings backed only by private
 * module state. Strict reflection remains a Typert compiler responsibility.
 * @module @deepseek-ai/dsh-typert-protocol
 */
import { Service, type Context } from '@deepseek-ai/cordis';
import type { TypertContextMap } from './types.ts';
/**
 * Test one generated Remote name against the Connection endpoint grammar.
 * @param value - namespace, method, lookup, or Context segment.
 * @returns whether the value can cross the shared RPC carrier unchanged.
 */
export declare function isTypertRemoteSegment(value: string): boolean;
/**
 * A lookup policy rejection whose typed payload belongs to the active boundary adapter.
 * Gateway adapters preserve this payload instead of collapsing it into an infrastructure failure.
 */
export declare class TypertLookupFailure<Failure = unknown> extends Error {
    /** Adapter-owned failure returned to the caller. */
    readonly failure: Failure;
    /**
     * Wrap one adapter failure without exposing the rejected identity.
     * @param failure - typed failure owned by the active boundary adapter.
     */
    constructor(failure: Failure);
}
export type { InvocationDescriptor, InvocationParameterDescriptor, InvocationSourceLocation, RemoteFailure, RemoteResult, TypertClientRemote, TypertClientContextBinder, TypertCodec, TypertContext, TypertContextMap, TypertContextRegistry, TypertContextWire, TypertDisposer, TypertForwardableEvent, TypertHostContextProvider, TypertHostContextResolver, TypertLocalRegistry, TypertLookup, TypertLookupDefinition, TypertLookupHost, TypertLookupMap, TypertLookupProvider, TypertLookupResolver, TypertLookupRegistry, TypertLookupWire, TypertRemoteScopeApi, TypertRemoteScopeMap, TypertRemoteScopeNamespace, TypertRemoteContribution, TypertRemoteEvent, TypertRemoteEventSelection, TypertRemoteMap, TypertRemoteNamespace, TypertRemoteNamespaceMap, TypertRemoteRegistry, TypertRegistryChange, TypertRegistryListener, TypertSchema, TypertRegistryContract, } from './types.ts';
/** Options for an explicit Service-to-Gateway binding. */
export interface TypertGatewayBindingOptions {
    /** Wire namespace; defaults to the Cordis service key. */
    readonly namespace?: string;
}
/** Visible declaration that one Service participates in Typert Gateway export. */
export interface TypertGatewayBinding<Service extends object = object> {
    readonly service: Service;
    readonly serviceKey: string;
    readonly namespace: string;
}
/** Invocation mode recorded by a Remote method decorator. */
export type RemoteInvocationMarker = {
    readonly kind: 'direct';
} | {
    readonly kind: 'context';
    readonly context: string;
};
/** One decorator marker discovered for a live Service instance. */
export interface RemoteMethodMarker {
    /** Public instance method carrying the implementation. */
    readonly method: string;
    /** Endpoint method when it differs from the implementation member. */
    readonly exportName?: string;
    readonly invocation: RemoteInvocationMarker;
}
type RemoteMethodDecorator = <This extends object, Args extends unknown[], Result>(method: (this: This, ...args: Args) => Result, context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>) => void;
/**
 * Bind one visible Service field to a Cordis key and Remote namespace.
 * @param service - owning Service instance, normally `this`.
 * @param serviceKey - exact Cordis service key.
 * @param options - optional distinct wire namespace.
 * @returns a frozen, inspectable binding with no compiler-injected metadata.
 */
export declare function bindTypertRemote<Service extends object>(service: Service, serviceKey: string, options?: TypertGatewayBindingOptions): TypertGatewayBinding<Service>;
/** Cordis Service base that exposes its registered name through Typert Gateway. */
export declare abstract class TypertRemoteService<out T = never> extends Service<T> {
    /** Visible binding consumed by the Gateway's source-mode discovery. */
    readonly typertRemote: TypertGatewayBinding<this>;
    /**
     * Register the Service and bind the same key to Typert Gateway.
     * @param ctx - owning Cordis Context.
     * @param serviceKey - exact Cordis service key and default wire namespace.
     * @param options - optional distinct wire namespace.
     */
    protected constructor(ctx: Context, serviceKey: string, options?: TypertGatewayBindingOptions);
}
/**
 * Mark one public instance method as a direct Remote invocation.
 * @param _method - decorated method; retained only by the class itself.
 * @param context - standard decorator context used to schedule private marking.
 */
export declare function Remote<This extends object, Args extends unknown[], Result>(_method: (this: This, ...args: Args) => Result, context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>): void;
/**
 * Mark one public instance method under a distinct exported method name.
 * @param exportName - Remote endpoint method, without a namespace or slash.
 * @returns a standard method decorator.
 */
export declare function Remote(exportName: string): RemoteMethodDecorator;
/**
 * Create a decorator for a method resolved from one Remote Scope.
 * @param key - scope key declared through the Context map.
 * @param exportName - optional Remote export name; defaults to the method name.
 * @returns a standard method decorator that records only private module state.
 */
export declare function RemoteScope(key: Extract<keyof TypertContextMap, string>, exportName?: string): RemoteMethodDecorator;
/**
 * Read Remote markers attached to a live Service by decorator initializers.
 * The returned snapshot cannot mutate the private marker table.
 * @param service - live Service instance.
 * @returns markers in class declaration order.
 */
export declare function remoteMethods(service: object): readonly RemoteMethodMarker[];
//# sourceMappingURL=index.d.ts.map