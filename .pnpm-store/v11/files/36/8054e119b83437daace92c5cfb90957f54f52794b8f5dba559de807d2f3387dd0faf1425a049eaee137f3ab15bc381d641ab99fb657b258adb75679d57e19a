import type { ConversationEventInput, ConversationNodeDefinition, ConversationPublication, ConversationViewDefinition, ConversationViewSnapshotMap, ConversationViewSnapshotStore } from '../contract/conversation.ts';
/** Event Registry subset consumed by a Session-owned Assembler. */
export interface ConversationEventDefinitions {
    /** @returns ordinary Definitions in registration order. */
    entries(): readonly ConversationNodeDefinition[];
    /** @returns unmatched-event fallback, when registered. */
    fallbackEntry(): ConversationNodeDefinition | undefined;
}
/** View Registry subset consumed by a Session-owned Assembler. */
export interface ConversationViewDefinitions {
    /** @returns view builder factories in registration order. */
    entries(): readonly ConversationViewDefinition[];
}
/**
 * Session-owned incremental engine that assembles business Contexts from a
 * contiguous Event window and materializes registered view snapshots.
 */
export declare class ConversationNodeAssembler implements ConversationViewSnapshotStore {
    private readonly eventDefinitions;
    private readonly viewDefinitions;
    private readonly contexts;
    private readonly contextsByKind;
    private readonly contextsBySeq;
    private readonly inputs;
    private readonly locationIndex;
    private readonly dirty;
    private readonly revised;
    private readonly dependents;
    private readonly views;
    private hasMore;
    private replacePending;
    private timelineDirty;
    /**
     * @param eventDefinitions - live Event Definition registry.
     * @param viewDefinitions - live view builder registry.
     */
    constructor(eventDefinitions: ConversationEventDefinitions, viewDefinitions: ConversationViewDefinitions);
    /**
     * Replace the complete loaded window after open, resync, or gap repair.
     * @param entries - complete contiguous window.
     * @param hasMore - whether older history remains outside the window.
     * @returns immediate publication request.
     */
    replaceWindow(entries: readonly ConversationEventInput[], hasMore: boolean): ConversationPublication;
    /**
     * Add one contiguous live tail event without scanning existing Contexts.
     * @param input - appended Event and optional wire view.
     * @returns highest requested publication cadence.
     */
    append(input: ConversationEventInput): ConversationPublication;
    /**
     * Add an older page while preserving existing Context and view identities.
     * @param entries - newly loaded older Events.
     * @param hasMore - whether history still precedes the expanded window.
     * @returns highest requested publication cadence.
     */
    prepend(entries: readonly ConversationEventInput[], hasMore: boolean): ConversationPublication;
    /**
     * Rebuild against the current Registry set after a low-frequency plugin change.
     * @returns immediate publication request.
     */
    rebuildRegistry(): ConversationPublication;
    /**
     * Materialize dirty Contexts and advance every registered view builder.
     * @returns whether any view snapshot was rebuilt or incrementally applied.
     */
    flush(): boolean;
    /**
     * Read the latest snapshot of a registered target.
     * @param target - registered view target.
     * @returns target snapshot, or undefined when no builder is registered.
     */
    snapshot(target: string): unknown;
    get<Target extends Extract<keyof ConversationViewSnapshotMap, string>>(target: Target): ConversationViewSnapshotMap[Target] | undefined;
    private sortedInputs;
    private matchInput;
    private collectInput;
    private dispatchInput;
    private acceptMatch;
    private applyPendingMatches;
    private replayContexts;
    private replayContext;
    private replaceDependencies;
    private replayRevisedDependents;
    private readerFor;
    private previousContext;
    /** Insert one newly discovered start into its Definition's ordered predecessor index. */
    private indexStartedContext;
    private indexStartedContexts;
    private replayDependencies;
    private refreshMatchLocations;
    private buildNode;
    private buildLocationData;
    private replaceLocationData;
    private applyDirtyLocationData;
    private resetViewBuilders;
}
/** Structural registry pair accepted by Session and SessionManager. */
export interface ConversationRuntime {
    readonly events: ConversationEventDefinitions & {
        subscribe(listener: () => void): () => void;
    };
    readonly views: ConversationViewDefinitions & {
        subscribe(listener: () => void): () => void;
    };
}
//# sourceMappingURL=conversation-assembler.d.ts.map