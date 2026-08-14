/** Browser runtime services for slots, sessions, workspaces, and connection-stream delivery. */
import type { Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client';
import type { TypertContext } from '@deepseek-ai/dsh-typert-protocol';
import type { MaybeSnapshotSelectorHook, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots';
import type { SessionListState } from './sessions/service.ts';
import type { ConversationSnapshot } from './sessions/conversation.ts';
import type { UseProjection } from './sessions/projection-store.ts';
export { isAppendSurfaceEvent, isReplacementSurfaceEvent } from '@deepseek-ai/dsh-session/surface';
export { SlotRegistry } from './slots.ts';
export { ConversationEventRegistry } from './conversation/event-registry.ts';
export { ConversationViewRegistry } from './conversation/view-registry.ts';
export { ConversationNodeAssembler } from './sessions/conversation-assembler.ts';
export { ConversationLocationIndex } from './sessions/conversation-location-index.ts';
export { conversationContextKey } from './contract/conversation.ts';
export type { ChatConversationViewNode, ConversationContextReader, ConversationEventInput, ConversationLocationData, ConversationLocationDataScope, ConversationLocationDataStore, ConversationStepDataMap, ConversationLocation, ConversationMatch, ConversationMatchResult, ConversationNodeContext, ConversationNodeDefinition, ConversationPreviousContext, ConversationPublication, ConversationTimelineSnapshot, ConversationTurnDataMap, ConversationViewBuilder, ConversationViewDefinition, ConversationViewNode, ConversationViewSnapshotMap, ConversationViewSnapshotStore, StepLocation, TurnLocation, } from './contract/conversation.ts';
export type { ConversationRuntime } from './sessions/conversation-assembler.ts';
export type { RootOwnerProps } from './slots.ts';
export { SessionCreateError, SessionRuntime, scopeOf, workspaceTitleOf } from './sessions/service.ts';
export { indexSubagentDescendants } from './sessions/subagent-lineage.ts';
export type { SubagentDescendantSummary } from './sessions/subagent-lineage.ts';
export { SessionProvideChannel } from './sessions/provide.ts';
export type { SessionProvideChannelHost } from './sessions/provide.ts';
export { createScope } from './agents/scope.ts';
export type { AgentScopeHandle } from './agents/scope.ts';
export { DirectoryBrowseError, WorkspaceCreateError, WorkspaceRuntime } from './workspaces/service.ts';
export { resolveWorkspacePath } from './workspaces/path.ts';
export type { SettingsScope, SettingsScopeSnapshot, SettingsScopeSpec, } from './contract/settings-scope.ts';
export type { Session } from './sessions/session.ts';
export type { ISession, ProjectionsFace, SessionFace } from './contract/session.ts';
export type { AgentContext, ISessions } from './contract/sessions.ts';
export type { IWorkspaces } from './contract/workspaces.ts';
export type { SessionBinding, SessionListState, SessionProvideContribution, SessionProvideDescriptor, SessionSummary, } from './sessions/service.ts';
export type { SessionListPhase, SessionSearchResultItem, SubagentCatalogSnapshot } from './sessions/manager.ts';
export type { SubagentAddress, JobView } from '@deepseek-ai/dsh-client-connection/client';
export type { WorkspaceListPhase } from './workspaces/manager.ts';
export type { WorkspaceListState } from './workspaces/service.ts';
export type { DirectoryEntry, DirectoryListing, WorkspaceId, WorkspaceView, } from '@deepseek-ai/dsh-client-connection/client';
export { createSnapshotStore, defineStore, shallowEqual } from './contract/store.ts';
export type { EngineStoreHandle, EngineStoreInstance, ObservableSnapshot, SnapshotStore, } from './contract/store.ts';
export type { AssistantBlock, AssistantMessageNode, AssistantProvenanceView, AssistantRequestConfig, AssistantTiming, ChatLocationNodeIndex, ChatNodeStore, ChatSnapshot, CommandNode, CompactionSummaryNode, ComposerPhase, ContextMessageNode, ConversationNode, ConversationSnapshot, ModelRetryNode, QueuedMessage, LegacyConversationSlice, PartialAssistant, RunningToolCall, SteeringMessageNode, TodoItem, ToolCallBlock, ToolResultNode, TurnErrorNode, TurnMaxTokensNode, UnknownSurfaceNode, UserMessageNode, } from './sessions/conversation.ts';
export { EMPTY_CHAT_SNAPSHOT, EMPTY_CONVERSATION_VIEWS, toAssistantBlock, toAssistantBlocks, } from './sessions/conversation.ts';
export { emptyAssistantBlock } from './sessions/partial.ts';
export { isTokenDelta } from './sessions/assistant-timing.ts';
export { contextForm, contextProvenance } from './sessions/context-provenance.ts';
export { displayFailureMessage } from './sessions/failure-display.ts';
export type { ConversationContext, ConversationContextOriginKind, } from './sessions/conversation-context.ts';
export type { ContextProvenanceView, ContextRole, KnownContextForm, } from './sessions/context-provenance.ts';
export type { ConversationPromptSnapshot, RequestInspectionSnapshot, RequestPromptChange, RequestView, } from './sessions/request-inspection.ts';
export { PendingWait } from './sessions/pending.ts';
export type { PendingInteraction, PendingInteractionStatus, PendingKind, PendingPayloads, } from './sessions/pending.ts';
export type { ProjectionsBaseline, ProjectionValueStore, SessionProjectionMap, UseProjection, } from './sessions/projection-store.ts';
export type { SessionId } from '@deepseek-ai/dsh-client-connection/client';
/** Client-side Cordis context after declaration merging. */
export type ClientContext = Context;
declare module '@deepseek-ai/dsh-typert-protocol' {
    interface TypertContextMap {
        /** Client Agent scope identity; the agent and session share one wire id. */
        agent: TypertContext<SessionId>;
    }
}
/** The conversation-snapshot selector hook supplied to session-scoped UI entries. */
export type UseConversationSession = SnapshotSelectorHook<ConversationSnapshot>;
declare module '@deepseek-ai/dsh-client-ui-slots' {
    /**
     * Session standard kit, real members (ui-slots declares the empty seat;
     * the runtime — where the subjects live — merges the concrete types):
     * every session-scope slot component receives these from the framework.
     */
    interface SessionStandardProps {
        useSession: SnapshotSelectorHook<ConversationSnapshot>;
        /** The framework-resolved session id (owners never pass it). */
        sessionId: SessionId;
        /** The fifth framework hook seat: key-addressed projection reader (undefined = capability absent). */
        useProjection: UseProjection;
    }
    /** Standard kit for slots that remain mounted while current session changes. */
    interface SessionMaybeStandardProps {
        useSession: MaybeSnapshotSelectorHook<ConversationSnapshot>;
        /** Current session id; absent in the no-session state. */
        sessionId: SessionId | undefined;
        /** Key-addressed projection reader; every key reads absent while no session is current. */
        useProjection: UseProjection;
    }
    /** Props injected into every global slot component. */
    interface GlobalStandardProps {
        useSessions: SnapshotSelectorHook<SessionListState>;
        /** Selector hook over real Workspaces and their independent baseline lifecycle. */
        useWorkspaces: SnapshotSelectorHook<import('./workspaces/service.ts').WorkspaceListState>;
    }
}
declare module '@deepseek-ai/cordis' {
    interface Events {
        /**
         * A slot's definition or registration set changed.
         * @mode emit
         * @param key - the mutated SlotMap key.
         */
        'slots/changed'(key: string): void;
        /**
         * A connection generation was (re-)established. Wire-derived caches must
         * treat their state as stale and repull (commands directory; the queue
         * mirrors reset themselves through the session resync path).
         * @mode emit
         */
        'connection/reset'(): void;
    }
    interface Context {
        slots: import('./slots.ts').SlotRegistry;
        /** Event-to-business-Context Definition registry. */
        conversationEvents: import('./conversation/event-registry.ts').ConversationEventRegistry;
        /** Per-target Conversation snapshot builder registry. */
        conversationViews: import('./conversation/view-registry.ts').ConversationViewRegistry;
        /** The outward face only; the concrete service stays inside the runtime. */
        sessions: import('./contract/sessions.ts').ISessions;
        /** The outward face only; the concrete service stays inside the runtime. */
        workspaces: import('./contract/workspaces.ts').IWorkspaces;
    }
}
/** Required services: the wire handle and Client Typert registry. */
export declare const inject: string[];
/** Mounts the browser runtime services and connection stream.
 * @param ctx - Client Cordis context.
 */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=index.d.ts.map