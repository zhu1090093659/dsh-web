/**
 * Client side of the fetch carrier. AbstractApiClient holds every protocol invariant: rpcId minting,
 * four-quadrant envelope wrap/unwrap, zod parsing, in-process SSE frame decoding, and the payload-direct
 * IApiClient domain methods (business code never mints). Platform differences ride two aspects:
 * abstract doFetch (transport) + overridable onEnvelope (tap). ApiProxy (the impl face) is untouched.
 */
import { RpcId } from "../api/rpc.js";
import { rpcReceiptSchema, serverRequestSchema, serverResponseSchema } from "../api/rpc.schema.js";
import { hostFrameSchema, muxFrameSchema } from "../api/events.schema.js";
import { hostCreateDirectoryValueSchema, hostDescribeValueSchema, hostListDirectoryValueSchema, hostOpenPathValueSchema, hostPickDirectoryValueSchema, } from "../api/host.schema.js";
import { sessionCancelValueSchema, sessionAttachmentValueSchema, sessionCreateValueSchema, sessionForkValueSchema, sessionHistoryValueSchema, sessionListValueSchema, sessionModelsValueSchema, sessionPromptValueSchema, sessionRenameValueSchema, sessionSearchValueSchema, sessionSelectModelValueSchema, sessionUpdateQueueValueSchema, } from "../api/sessions.schema.js";
import { workspaceArchiveSessionValueSchema, workspaceCreateValueSchema, workspaceDeleteValueSchema, workspaceInsertBeforeValueSchema, workspaceInsertSessionBeforeValueSchema, workspaceListValueSchema, workspaceRenameValueSchema, } from "../api/workspace.schema.js";
import { skillListValueSchema } from "../api/skills.schema.js";
import { agentPresetCopyValueSchema, agentPresetListValueSchema, agentPresetOpenDocumentValueSchema, agentPresetReadValueSchema, agentPresetRemoveValueSchema, agentPresetSelectValueSchema, } from "../api/agent-presets.schema.js";
import { goalCreateValueSchema, goalEditValueSchema, goalPauseValueSchema, goalResumeValueSchema, goalCompleteValueSchema, goalClearValueSchema, } from "../api/goals.schema.js";
import { settingsDescribeValueSchema, settingsMutateValueSchema, settingsOpenDocumentValueSchema, settingsReplaceValueSchema, settingsUpdateValueSchema, } from "../api/settings.schema.js";
import { credentialsDescribeValueSchema, credentialsSetValueSchema, credentialsUnsetValueSchema, } from "../api/credentials.schema.js";
import { llmDiscoverModelsValueSchema, llmModelsValueSchema, llmProvidersValueSchema } from "../api/llm.schema.js";
import { subagentHistoryValueSchema, subagentInterruptValueSchema, subagentListValueSchema, subagentPromptValueSchema, } from "../api/subagents.schema.js";
/**
 * S→C second-level parse table: value schema by method (the response-path
 * mirror of the handler's request table; key coverage compiler-enforced against RpcMethodMap).
 */
const UNARY_VALUE_SCHEMAS = {
    'session.list': sessionListValueSchema,
    'session.search': sessionSearchValueSchema,
    'session.create': sessionCreateValueSchema,
    'session.history': sessionHistoryValueSchema,
    'session.models': sessionModelsValueSchema,
    'session.selectModel': sessionSelectModelValueSchema,
    'session.rename': sessionRenameValueSchema,
    'session.fork': sessionForkValueSchema,
    'session.prompt': sessionPromptValueSchema,
    'session.attachment': sessionAttachmentValueSchema,
    'session.updateQueue': sessionUpdateQueueValueSchema,
    'session.cancel': sessionCancelValueSchema,
    'subagent.list': subagentListValueSchema,
    'subagent.history': subagentHistoryValueSchema,
    'subagent.prompt': subagentPromptValueSchema,
    'subagent.interrupt': subagentInterruptValueSchema,
    'host.describe': hostDescribeValueSchema,
    'host.pickDirectory': hostPickDirectoryValueSchema,
    'host.listDirectory': hostListDirectoryValueSchema,
    'host.createDirectory': hostCreateDirectoryValueSchema,
    'host.openPath': hostOpenPathValueSchema,
    'workspace.list': workspaceListValueSchema,
    'workspace.create': workspaceCreateValueSchema,
    'workspace.rename': workspaceRenameValueSchema,
    'workspace.delete': workspaceDeleteValueSchema,
    'workspace.insertBefore': workspaceInsertBeforeValueSchema,
    'workspace.insertSessionBefore': workspaceInsertSessionBeforeValueSchema,
    'workspace.archiveSession': workspaceArchiveSessionValueSchema,
    'skill.list': skillListValueSchema,
    'agentPreset.list': agentPresetListValueSchema,
    'agentPreset.select': agentPresetSelectValueSchema,
    'agentPreset.read': agentPresetReadValueSchema,
    'agentPreset.copy': agentPresetCopyValueSchema,
    'agentPreset.openDocument': agentPresetOpenDocumentValueSchema,
    'agentPreset.remove': agentPresetRemoveValueSchema,
    'goal.create': goalCreateValueSchema,
    'goal.edit': goalEditValueSchema,
    'goal.pause': goalPauseValueSchema,
    'goal.resume': goalResumeValueSchema,
    'goal.complete': goalCompleteValueSchema,
    'goal.clear': goalClearValueSchema,
    'settings.describe': settingsDescribeValueSchema,
    'settings.openDocument': settingsOpenDocumentValueSchema,
    'settings.update': settingsUpdateValueSchema,
    'settings.replace': settingsReplaceValueSchema,
    'settings.mutate': settingsMutateValueSchema,
    'credentials.describe': credentialsDescribeValueSchema,
    'credentials.set': credentialsSetValueSchema,
    'credentials.unset': credentialsUnsetValueSchema,
    'llm.providers': llmProvidersValueSchema,
    'llm.models': llmModelsValueSchema,
    'llm.discoverModels': llmDiscoverModelsValueSchema,
};
/** Default timeout for bounded unary calls (rpc-compare 2026-07-19: a hung host must not leave callers pending forever). */
const DEFAULT_TIMEOUT_MS = 30_000;
/** URL base for in-process handler injection (fake authority, opencode precedent). */
const INTERNAL_BASE = 'http://dsh.internal';
/**
 * Abstract fetch-carrier client. Subclasses supply the transport (doFetch) and may refine the
 * per-message tap (onEnvelope) — platform aspects stay in subclasses, protocol invariants stay
 * here. Envelope observation is a first-class aspect of this data middle layer: the instance
 * owns a microtask-batched buffer (frame storms must not cost one consumer update per frame),
 * and observers subscribe via subscribeEnvelopes. The isomorphic point survives: an in-process
 * subclass whose doFetch is toFetchHandler(api).fetch never touches the network.
 */
export class AbstractApiClient {
    timeoutMs;
    /** Instance-owned observation buffer (module-level state would leak across instances/tests). */
    envelopeBatch = [];
    flushScheduled = false;
    envelopeListeners = new Set();
    /** @param timeoutMs - timeout for bounded unary calls; user-paced calls and streams do not use it. */
    constructor(timeoutMs = DEFAULT_TIMEOUT_MS) {
        this.timeoutMs = timeoutMs;
    }
    /**
     * Subscribe to batched envelope observation (diagnostics/logging consumers).
     * Batches follow microtask boundaries; a listener throw is isolated (observation
     * must never break the carrier).
     * @param listener - receives each flushed batch in arrival order.
     * @returns unsubscribe function.
     */
    subscribeEnvelopes(listener) {
        this.envelopeListeners.add(listener);
        return () => {
            this.envelopeListeners.delete(listener);
        };
    }
    /** Per-message tap: feeds the instance buffer. Subclasses may override to observe unbatched (call super to keep batching). */
    onEnvelope(message) {
        if (this.envelopeListeners.size === 0)
            return;
        this.envelopeBatch.push(message);
        if (this.flushScheduled)
            return;
        this.flushScheduled = true;
        queueMicrotask(() => {
            this.flushScheduled = false;
            // Never empty here: a flush is only ever scheduled by the push above,
            // and this callback is the sole drain point.
            const batch = this.envelopeBatch;
            this.envelopeBatch = [];
            for (const notify of this.envelopeListeners) {
                try {
                    notify(batch);
                }
                catch (error) {
                    console.error('[apiproxy] envelope listener threw:', error);
                }
            }
        });
    }
    /** Browser = same-origin (a fake authority would fail DNS on real requests); no-location env (Node) = fake authority. */
    resolveBase() {
        const loc = globalThis.location;
        return loc?.origin !== undefined && loc.origin !== 'null' ? loc.origin : INTERNAL_BASE;
    }
    mintRpcId() {
        // crypto.randomUUID is a Web API (browser + Node ≥19): keeps this base platform-neutral.
        return RpcId(crypto.randomUUID());
    }
    /**
     * Shared POST leg of both C→S carriers (callUnary/respond): JSON body,
     * optional default timeout merged with the caller's external signal, non-2xx → transport throw.
     */
    async postJson(path, body, signal, timeoutPolicy = 'default') {
        const requestSignal = timeoutPolicy === 'default'
            ? signal === undefined
                ? AbortSignal.timeout(this.timeoutMs)
                : AbortSignal.any([AbortSignal.timeout(this.timeoutMs), signal])
            : signal;
        const response = await this.doFetch(new URL(path, this.resolveBase()), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            ...requestSignal === undefined ? {} : { signal: requestSignal },
        });
        if (!response.ok)
            throw new Error(`transport failure for ${path}: HTTP ${response.status}`);
        return response;
    }
    /**
     * Unary protocol path: mint → tap → POST full form → envelope parse → verify
     * echo → value parse → tap → narrow. Virtual so a fake carrier (fixture) can
     * override transport at this layer.
     */
    async callUnary(method, payload, signal, timeoutPolicy = 'default') {
        const message = { type: 'client-request', rpcId: this.mintRpcId(), method, payload };
        this.onEnvelope(message);
        const response = await this.postJson(`/api/${method}`, message, signal, timeoutPolicy);
        const full = serverResponseSchema.parse(await response.json());
        this.onEnvelope(full);
        if (full.rpcId !== message.rpcId)
            throw new Error(`rpcId mismatch for ${method}: sent ${message.rpcId}, got ${full.rpcId}`);
        if (!full.result.ok)
            return { rpcId: full.rpcId, result: full.result };
        // Second-level S→C parse: the ok value must match the method's Value schema (mirror of the
        // handler's request-payload parse). The cast collapses the Wire<> widening, same as the handler side.
        const value = UNARY_VALUE_SCHEMAS[method].parse(full.result.value);
        return { rpcId: full.rpcId, result: { ok: true, value } };
    }
    /** Mux stream opener; virtual for the same override reason as callUnary. */
    openMux(_payload, signal, onOpen) {
        return this.readSse('/api/events.mux', signal, muxFrameSchema, onOpen);
    }
    /** Host stream opener; virtual. */
    openHost(_payload, signal, onOpen) {
        return this.readSse('/api/events.host', signal, hostFrameSchema, onOpen);
    }
    /**
     * SSE protocol path: streaming fetch (not EventSource), '\n\n' framing, ServerRequest envelope +
     * frame-schema parse, tap, narrow yield. onOpen fires once the response headers are in and the
     * body is readable — the stream-established signal, before any frame arrives. A frame that fails
     * either parse level is reported and skipped (one corrupt frame must not kill the stream; the
     * client's gap detection covers whatever the frame carried).
     */
    async *readSse(path, signal, frameSchema, onOpen) {
        const response = await this.doFetch(new URL(path, this.resolveBase()), { signal });
        if (!response.ok || response.body === null)
            throw new Error(`transport failure for ${path}: HTTP ${response.status}`);
        onOpen?.();
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    return;
                buffer += decoder.decode(value, { stream: true });
                let boundary;
                while ((boundary = buffer.indexOf('\n\n')) !== -1) {
                    const chunk = buffer.slice(0, boundary);
                    buffer = buffer.slice(boundary + 2);
                    const data = chunk.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('');
                    if (data === '')
                        continue;
                    let full;
                    let frame;
                    try {
                        full = serverRequestSchema.parse(JSON.parse(data));
                        frame = frameSchema.parse(full.payload);
                    }
                    catch (error) {
                        console.error(`[apiproxy] dropping malformed SSE frame on ${path}:`, error);
                        continue;
                    }
                    this.onEnvelope(full);
                    yield { rpcId: full.rpcId, payload: frame };
                }
            }
        }
        finally {
            await reader.cancel().catch(() => undefined);
        }
    }
    // ---- IApiClient API (arrow properties so destructured/passed references stay bound) ----
    sessions = {
        list: (payload, signal) => this.callUnary('session.list', payload, signal),
        search: (payload, signal) => this.callUnary('session.search', payload, signal),
        create: (payload, signal) => this.callUnary('session.create', payload, signal),
        history: (payload, signal) => this.callUnary('session.history', payload, signal),
        models: (payload, signal) => this.callUnary('session.models', payload, signal),
        selectModel: (payload, signal) => this.callUnary('session.selectModel', payload, signal),
        rename: (payload, signal) => this.callUnary('session.rename', payload, signal),
        fork: (payload, signal) => this.callUnary('session.fork', payload, signal),
        prompt: (payload, signal) => this.callUnary('session.prompt', payload, signal),
        attachment: (payload, signal) => this.callUnary('session.attachment', payload, signal),
        updateQueue: (payload, signal) => this.callUnary('session.updateQueue', payload, signal),
        cancel: (payload, signal) => this.callUnary('session.cancel', payload, signal),
    };
    subagents = {
        list: (payload, signal) => this.callUnary('subagent.list', payload, signal),
        history: (payload, signal) => this.callUnary('subagent.history', payload, signal),
        prompt: (payload, signal) => this.callUnary('subagent.prompt', payload, signal),
        interrupt: (payload, signal) => this.callUnary('subagent.interrupt', payload, signal),
    };
    host = {
        describe: (payload, signal) => this.callUnary('host.describe', payload, signal),
        // A native system dialog is user-paced and may legitimately stay open
        // longer than the normal unary deadline. Caller/connection aborts remain.
        pickDirectory: (payload, signal) => this.callUnary('host.pickDirectory', payload, signal, 'caller-signal-only'),
        listDirectory: (payload, signal) => this.callUnary('host.listDirectory', payload, signal),
        createDirectory: (payload, signal) => this.callUnary('host.createDirectory', payload, signal),
        openPath: (payload, signal) => this.callUnary('host.openPath', payload, signal),
    };
    workspace = {
        list: (payload, signal) => this.callUnary('workspace.list', payload, signal),
        create: (payload, signal) => this.callUnary('workspace.create', payload, signal),
        rename: (payload, signal) => this.callUnary('workspace.rename', payload, signal),
        delete: (payload, signal) => this.callUnary('workspace.delete', payload, signal),
        insertBefore: (payload, signal) => this.callUnary('workspace.insertBefore', payload, signal),
        insertSessionBefore: (payload, signal) => this.callUnary('workspace.insertSessionBefore', payload, signal),
        archiveSession: (payload, signal) => this.callUnary('workspace.archiveSession', payload, signal),
    };
    skills = {
        list: (payload, signal) => this.callUnary('skill.list', payload, signal),
    };
    // Annotated like every sibling, and load-bearing rather than cosmetic:
    // inferring this member inlines `AgentPresetEntry` into the emitted
    // declaration by the specifier TS picks — the host `index.ts` — which drags
    // the whole gateway, and with it the host `Context` merges, into every
    // Client program that imports this carrier.
    agentPresets = {
        list: (payload, signal) => this.callUnary('agentPreset.list', payload, signal),
        select: (payload, signal) => this.callUnary('agentPreset.select', payload, signal),
        read: (payload, signal) => this.callUnary('agentPreset.read', payload, signal),
        copy: (payload, signal) => this.callUnary('agentPreset.copy', payload, signal),
        openDocument: (payload, signal) => this.callUnary('agentPreset.openDocument', payload, signal),
        remove: (payload, signal) => this.callUnary('agentPreset.remove', payload, signal),
    };
    goals = {
        create: (payload, signal) => this.callUnary('goal.create', payload, signal),
        edit: (payload, signal) => this.callUnary('goal.edit', payload, signal),
        pause: (payload, signal) => this.callUnary('goal.pause', payload, signal),
        resume: (payload, signal) => this.callUnary('goal.resume', payload, signal),
        complete: (payload, signal) => this.callUnary('goal.complete', payload, signal),
        clear: (payload, signal) => this.callUnary('goal.clear', payload, signal),
    };
    settings = {
        describe: (payload, signal) => this.callUnary('settings.describe', payload, signal),
        openDocument: (payload, signal) => this.callUnary('settings.openDocument', payload, signal),
        update: (payload, signal) => this.callUnary('settings.update', payload, signal),
        replace: (payload, signal) => this.callUnary('settings.replace', payload, signal),
        mutate: (payload, signal) => this.callUnary('settings.mutate', payload, signal),
    };
    credentials = {
        describe: (payload, signal) => this.callUnary('credentials.describe', payload, signal),
        set: (payload, signal) => this.callUnary('credentials.set', payload, signal),
        unset: (payload, signal) => this.callUnary('credentials.unset', payload, signal),
    };
    llm = {
        providers: (payload, signal) => this.callUnary('llm.providers', payload, signal),
        models: (payload, signal) => this.callUnary('llm.models', payload, signal),
        discoverModels: (payload, signal) => this.callUnary('llm.discoverModels', payload, signal),
    };
    events = {
        mux: (payload, signal, onOpen) => this.openMux(payload, signal, onOpen),
        host: (payload, signal, onOpen) => this.openHost(payload, signal, onOpen),
    };
    async respond(message, signal) {
        this.onEnvelope(message);
        const response = await this.postJson('/api/respond', message, signal);
        return rpcReceiptSchema.parse(await response.json());
    }
}
/**
 * In-process client over an injected fetch-shaped handler (the isomorphic point:
 * `new InProcessApiClient(toFetchHandler(api))` never touches the network). Lives here because
 * in-process injection is this package's own capability (handler and client are both local).
 */
export class InProcessApiClient extends AbstractApiClient {
    handler;
    constructor(handler, timeoutMs) {
        super(timeoutMs);
        this.handler = handler;
    }
    /**
     * Faithful to real fetch: reject on signal abort even when the in-process
     * handler ignores the signal (a hung impl must not defeat timeout/cancel).
     */
    doFetch(input, init) {
        const signal = init?.signal ?? undefined;
        if (signal === undefined)
            return this.handler.fetch(input, init);
        if (signal.aborted)
            return Promise.reject(abortError(signal));
        return new Promise((resolve, reject) => {
            const onAbort = () => { reject(abortError(signal)); };
            signal.addEventListener('abort', onAbort, { once: true });
            this.handler.fetch(input, init)
                .then(resolve, reject)
                .finally(() => { signal.removeEventListener('abort', onAbort); });
        });
    }
}
/** Mirror fetch's abort rejection: the signal's reason when present, else a DOMException-style AbortError. */
function abortError(signal) {
    const reason = signal.reason;
    if (reason instanceof Error)
        return reason;
    if (typeof reason === 'string')
        return new Error(reason);
    return new Error('This operation was aborted');
}
//# sourceMappingURL=client.js.map