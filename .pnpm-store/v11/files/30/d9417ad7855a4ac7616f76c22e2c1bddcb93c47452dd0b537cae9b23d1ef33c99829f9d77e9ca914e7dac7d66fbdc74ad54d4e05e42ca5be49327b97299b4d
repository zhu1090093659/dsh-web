/** Platform-neutral assembly of generated Host Remote contributions. */
import type { Context } from '@deepseek-ai/cordis';
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol';
export type { TypertClientRemote as ClientRemote } from '@deepseek-ai/dsh-typert-protocol';
export type { PluginInventorySnapshot } from '@deepseek-ai/dsh-host-plugin-inventory/types';
export type {} from '@deepseek-ai/dsh-commands/remote';
export type {} from '@deepseek-ai/dsh-goal/remote';
export type {} from '@deepseek-ai/dsh-host-plugin-inventory/remote';
export type {} from '@deepseek-ai/dsh-message-feedback/remote';
export type { ApiRemoteForwardedEvent } from '../types.ts';
export type {} from '@deepseek-ai/dsh-commands/types';
export type {} from '@deepseek-ai/dsh-cordis-host-runner/types';
export type {} from '@deepseek-ai/dsh-credentials/types';
export type {} from '@deepseek-ai/dsh-llm/types';
export type {} from '@deepseek-ai/dsh-agent-presets/types';
export type {} from '@deepseek-ai/dsh-settings/types';
/**
 * The carrier's Client-facing types, re-exported so a business package names one
 * assembly package instead of both this facade and the Connection plugin. Type-only:
 * the carrier's runtime values stay behind their own module edge.
 */
export type { ClientResponse, ConfigurableProviderView, ConnectionHandle, ConnectionSinks, ContentBlock, CredentialView, DirectoryListing, DiscoveredModelView, HistoryEntry, HostFrame, IApiClient, MessageId, ModelCatalogFailure, ModelProviderGroup, ModelReasoningEffort, ModelSelection, MuxFrame, PromptContentPart, QuestionResponsePayload, QueueAction, RpcError, RpcId, RpcReceipt, RpcRequest, RpcResponse, RpcResult, SessionId, SessionModels, SessionSearchItem, SessionSummary, SettingsNamespaceView, SettingsPathOpView, SkillEntry, StreamChunk, SubagentAddress, SubagentCatalog, JobView, ToolCallView, ToolEventView, ToolResultView, WorkspaceId, WorkspaceView, } from '@deepseek-ai/dsh-client-connection/client';
export type {} from '@deepseek-ai/dsh-api-gateway/client';
export type {} from '@deepseek-ai/dsh-cordis-host-runner/remote';
export type { ApprovalRequestId, CordisHalfState, CordisDynamicPackageId, CordisDynamicPluginId, CordisDynamicPluginRunId, CordisDynamicRunMode, CordisInspectMethodManifest, CordisInspectPlatform, CordisInspectProviderManifest, CordisInspectProviderView, CordisInspectQueryRequest, CordisInspectQueryResolution, CordisInspectQueryResolved, CordisInspectRequestId, CordisInspectResolveAck, CordisRunDiagnostic, CordisRunStatus, DynamicCordisClientSource, DynamicCordisHostHalfResult, DynamicCordisInventoryRow, DynamicCordisInvokeResult, DynamicCordisPackage, DynamicCordisRequestResolved, DynamicCordisResolveAck, DynamicCordisRetracted, DynamicCordisRunRequest, DynamicCordisRunResolution, DynamicCordisRunAttempt, DynamicCordisRunResponse, DynamicCordisStopResponse, DynamicCordisUndefineReceipt, RequestRunOutcome, } from '@deepseek-ai/dsh-cordis-host-runner/types';
export type { JsonValue } from '@deepseek-ai/dsh-session/types';
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** Generated Remote namespaces selected by this Client assembly. */
        remote: TypertClientRemote;
    }
}
/** Required service: the typed Client Remote contribution mount. */
export declare const inject: string[];
/**
 * Mount the Host capabilities explicitly selected for this Client assembly.
 * @param ctx - Client Cordis root carrying the typed API service.
 * @returns disposer after every selected Remote namespace is ready.
 */
export declare function apply(ctx: Context): Promise<() => Promise<void>>;
//# sourceMappingURL=index.d.ts.map