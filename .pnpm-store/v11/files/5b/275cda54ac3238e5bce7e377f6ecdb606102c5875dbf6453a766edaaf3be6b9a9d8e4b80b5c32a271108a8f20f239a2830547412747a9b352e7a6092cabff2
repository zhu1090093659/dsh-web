/**
 * sessions domain zod schemas (names derived from map keys: sessionListRequestSchema /
 * sessionListValueSchema). SessionEvent passthrough = strict envelope (type/seq/time) + wide
 * data: the merge-extensible event API keeps an unknown-type branch at the union level,
 * with no field-level passthrough. SessionId brand cast point: sessionIdSchema, and only there.
 */
import { z } from 'zod';
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types';
import type { MessageId } from '@deepseek-ai/dsh-llm/brand';
import type { RequestPayload, ResponseValue } from './rpc-map.ts';
import type { Wire } from './rpc.schema.ts';
import type { HistoryEntry, SessionListMetadata, SessionProjectionsBlock, SessionSummary } from './sessions.ts';
import type { ToolEventView } from './events.ts';
import type { AttachmentIdType, ImageAttachmentLimits, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { WorkspaceId } from './workspace.ts';
/** SessionId: one brand cast after schema validation (the only cast point in this domain). */
export declare const sessionIdSchema: z.ZodType<SessionId>;
/** MessageId: one brand cast after non-empty string validation. */
export declare const messageIdSchema: z.ZodType<MessageId>;
/**
 * WorkspaceId: the workspace domain's one brand cast. Hosted here rather
 * than in workspace.schema because session.create references it while
 * workspace.schema references sessionIdSchema — schema modules must stay a
 * DAG (both casts used at module top level; a cycle is a load-time TDZ).
 */
export declare const workspaceIdSchema: z.ZodType<WorkspaceId>;
/** SessionEvent passthrough: strict envelope, wide data (the client fold handles unknown types via its documented default). */
export declare const sessionEventSchema: z.ZodType<SessionEvent>;
/** SessionSummary row of session.list (`projections` reuses the history block's shape and schema). */
export declare const sessionSummarySchema: z.ZodType<Wire<SessionSummary>>;
/** session.list request payload (cursor is a reserved seat, unimplemented in v1). */
export declare const sessionListRequestSchema: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** session.list response value. */
export declare const sessionListValueSchema: z.ZodType<Wire<ResponseValue<'session.list'>>>;
/** session.search request payload. */
export declare const sessionSearchRequestSchema: z.ZodObject<{
    query: z.ZodString;
}, z.core.$strip>;
/** One session.search result. */
export declare const sessionSearchItemSchema: z.ZodObject<{
    sessionId: z.ZodType<SessionId, unknown, z.core.$ZodTypeInternals<SessionId, unknown>>;
    snippet: z.ZodString;
}, z.core.$strip>;
/** session.search response value. */
export declare const sessionSearchValueSchema: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        sessionId: z.ZodType<SessionId, unknown, z.core.$ZodTypeInternals<SessionId, unknown>>;
        snippet: z.ZodString;
    }, z.core.$strip>>;
    hasMore: z.ZodBoolean;
}, z.core.$strip>;
/** session.create request payload (at most one of workspaceId / cwd). */
export declare const sessionCreateRequestSchema: z.ZodObject<{
    workspaceId: z.ZodOptional<z.ZodType<WorkspaceId, unknown, z.core.$ZodTypeInternals<WorkspaceId, unknown>>>;
    cwd: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodType<SessionId, unknown, z.core.$ZodTypeInternals<SessionId, unknown>>>;
    agentPreset: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** session.create response value. */
export declare const sessionCreateValueSchema: z.ZodObject<{
    sessionId: z.ZodType<SessionId, unknown, z.core.$ZodTypeInternals<SessionId, unknown>>;
    agentPreset: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** session.rename request payload (raw title; host-side normalization decides acceptance). */
export declare const sessionRenameRequestSchema: z.ZodObject<{
    sessionId: z.ZodType<SessionId, unknown, z.core.$ZodTypeInternals<SessionId, unknown>>;
    title: z.ZodString;
}, z.core.$strip>;
/** session.rename response value (the normalized accepted title and its event seq). */
export declare const sessionRenameValueSchema: z.ZodObject<{
    title: z.ZodString;
    seq: z.ZodNumber;
}, z.core.$strip>;
/** session.fork request payload (atSeq anchors the completed-turn cut). */
export declare const sessionForkRequestSchema: z.ZodObject<{
    sessionId: z.ZodType<SessionId, unknown, z.core.$ZodTypeInternals<SessionId, unknown>>;
    atSeq: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
/** session.fork response value (the child session id). */
export declare const sessionForkValueSchema: z.ZodObject<{
    sessionId: z.ZodType<SessionId, unknown, z.core.$ZodTypeInternals<SessionId, unknown>>;
}, z.core.$strip>;
/** session.history request payload (beforeSeq/maxMessages page backwards from the window tail). */
export declare const sessionHistoryRequestSchema: z.ZodObject<{
    sessionId: z.ZodType<SessionId, unknown, z.core.$ZodTypeInternals<SessionId, unknown>>;
    beforeSeq: z.ZodOptional<z.ZodNumber>;
    maxMessages: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
/** Complete provider/model selection. */
export declare const modelSelectionSchema: z.ZodObject<{
    provider: z.ZodString;
    model: z.ZodString;
    reasoningEffort: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** One adapter-owned reasoning effort. */
export declare const modelReasoningEffortSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** Exact-model reasoning metadata. */
export declare const modelReasoningSchema: z.ZodObject<{
    efforts: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    defaultEffort: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** One advisory model entry inside a provider group. */
export declare const modelCatalogModelSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    reasoning: z.ZodOptional<z.ZodObject<{
        efforts: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        defaultEffort: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** One successfully loaded provider group. */
export declare const modelProviderGroupSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    models: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        reasoning: z.ZodOptional<z.ZodObject<{
            efforts: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                name: z.ZodString;
                description: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            defaultEffort: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** One provider-local catalog failure. */
export declare const modelCatalogFailureSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    message: z.ZodString;
}, z.core.$strip>;
/**
 * ToolEventView passthrough: lock only the `for` discriminant and the presence
 * of a card-tagged `view` object. The view interior is a host-computed product
 * the client reads without echoing back; deep-validating it would hand-copy
 * the dsh-tools vocabulary into this schema and drift with it.
 */
export declare const toolEventViewSchema: z.ZodType<ToolEventView>;
/** One session.history item: the session event plus its optional host-computed tool view. */
export declare const historyEntrySchema: z.ZodType<Wire<HistoryEntry>>;
/**
 * Projection baseline passthrough: `values` stays a wide record — each value
 * was already parsed by its provider's own schema on the host side, and
 * deep-validating here would import every domain's schema into the carrier.
 */
export declare const sessionProjectionsBlockSchema: z.ZodType<Wire<SessionProjectionsBlock>>;
/** Host-side validation for the persisted Session-list projection. */
export declare const sessionListMetadataProjectionSchema: z.ZodType<SessionListMetadata>;
/**
 * imageLimits projection unit schema (host-side view validation). zod widens
 * `readonly ImageMediaType[]` to `string[]`; on the JSON wire the two
 * serialize identically, so the cast records exactly that widening.
 */
export declare const imageLimitsProjectionSchema: z.ZodType<ImageAttachmentLimits>;
/** session.history response value (projections rides the tail page only). */
export declare const sessionHistoryValueSchema: z.ZodType<Wire<ResponseValue<'session.history'>>>;
/** session.models request payload. */
export declare const sessionModelsRequestSchema: z.ZodObject<{
    sessionId: z.ZodType<SessionId, unknown, z.core.$ZodTypeInternals<SessionId, unknown>>;
}, z.core.$strip>;
/** session.models response value. */
export declare const sessionModelsValueSchema: z.ZodObject<{
    current: z.ZodObject<{
        provider: z.ZodString;
        model: z.ZodString;
        reasoningEffort: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    routable: z.ZodBoolean;
    groups: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        models: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
            reasoning: z.ZodOptional<z.ZodObject<{
                efforts: z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    name: z.ZodString;
                    description: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>;
                defaultEffort: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    failures: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        message: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** session.selectModel request payload. */
export declare const sessionSelectModelRequestSchema: z.ZodObject<{
    sessionId: z.ZodType<SessionId, unknown, z.core.$ZodTypeInternals<SessionId, unknown>>;
    provider: z.ZodString;
    model: z.ZodString;
    reasoningEffort: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** session.selectModel response value. */
export declare const sessionSelectModelValueSchema: z.ZodObject<{
    selected: z.ZodObject<{
        provider: z.ZodString;
        model: z.ZodString;
        reasoningEffort: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>;
/** ContentBlock passthrough: core is merge-extensible — the type discriminant envelope is strict, the rest stays wide. */
export declare const contentBlockSchema: z.ZodObject<{
    type: z.ZodString;
}, z.core.$loose>;
/** Raster image media types accepted by the version-one browser wire. */
export declare const imageMediaTypeSchema: z.ZodUnion<readonly [z.ZodLiteral<"image/png">, z.ZodLiteral<"image/jpeg">, z.ZodLiteral<"image/webp">, z.ZodLiteral<"image/gif">]>;
/** Prompt wire content is intentionally narrower than merge-extensible durable core content. */
export declare const promptContentPartSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"text">;
    text: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"image">;
    mediaType: z.ZodUnion<readonly [z.ZodLiteral<"image/png">, z.ZodLiteral<"image/jpeg">, z.ZodLiteral<"image/webp">, z.ZodLiteral<"image/gif">]>;
    data: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
}, z.core.$strip>], "type">;
/** session.prompt request payload, including optional browser-local request provenance. */
export declare const sessionPromptRequestSchema: z.ZodType<RequestPayload<"session.prompt">>;
/** session.prompt response value (the command slot appears only when the prompt dispatched a slash command). */
export declare const sessionPromptValueSchema: z.ZodObject<{
    accepted: z.ZodLiteral<true>;
    command: z.ZodOptional<z.ZodObject<{
        kind: z.ZodLiteral<"success">;
        text: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** Opaque attachment id after string-shape validation. */
export declare const attachmentIdSchema: z.ZodType<AttachmentIdType>;
/** Durable image reference returned from the authenticated session lookup. */
export declare const imageAttachmentRefSchema: z.ZodType<ImageAttachmentRef>;
/** session.attachment request payload. */
export declare const sessionAttachmentRequestSchema: z.ZodObject<{
    sessionId: z.ZodType<SessionId, unknown, z.core.$ZodTypeInternals<SessionId, unknown>>;
    attachmentId: z.ZodType<AttachmentIdType, unknown, z.core.$ZodTypeInternals<AttachmentIdType, unknown>>;
}, z.core.$strip>;
/** session.attachment response value. */
export declare const sessionAttachmentValueSchema: z.ZodObject<{
    attachment: z.ZodType<ImageAttachmentRef, unknown, z.core.$ZodTypeInternals<ImageAttachmentRef, unknown>>;
    data: z.ZodString;
}, z.core.$strip>;
/** session.updateQueue request payload. */
export declare const sessionUpdateQueueRequestSchema: z.ZodType<RequestPayload<"session.updateQueue">>;
/** session.updateQueue response value. */
export declare const sessionUpdateQueueValueSchema: z.ZodObject<{
    accepted: z.ZodLiteral<true>;
}, z.core.$strip>;
/** session.cancel request payload. */
export declare const sessionCancelRequestSchema: z.ZodObject<{
    sessionId: z.ZodType<SessionId, unknown, z.core.$ZodTypeInternals<SessionId, unknown>>;
}, z.core.$strip>;
/** session.cancel response value. */
export declare const sessionCancelValueSchema: z.ZodObject<{
    accepted: z.ZodLiteral<true>;
}, z.core.$strip>;
//# sourceMappingURL=sessions.schema.d.ts.map