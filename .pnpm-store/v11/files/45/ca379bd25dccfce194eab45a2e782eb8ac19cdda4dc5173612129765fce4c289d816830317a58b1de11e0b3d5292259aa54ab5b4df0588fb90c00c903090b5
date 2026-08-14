/**
 * Server side of the fetch carrier: maps an ApiProxy onto a pure
 * WHATWG Request->Response function. Two-level parse: full form (type/rpcId/method +
 * path==method) -> payload dispatched per method. HTTP status expresses only the carrier
 * (404 unknown path / 415 non-JSON media type / 400 non-JSON body / 500 handler crash);
 * business errors are always 200 + ServerResponse.
 */
import { randomUUID } from 'node:crypto';
import { sessionLogQuerySchema } from "../api/downloads.schema.js";
import { RpcId } from "../api/rpc.js";
import { clientRequestSchema, clientResponseSchema } from "../api/rpc.schema.js";
import { sessionCancelRequestSchema, sessionAttachmentRequestSchema, sessionCreateRequestSchema, sessionForkRequestSchema, sessionHistoryRequestSchema, sessionListRequestSchema, sessionModelsRequestSchema, sessionPromptRequestSchema, sessionRenameRequestSchema, sessionSearchRequestSchema, sessionSelectModelRequestSchema, sessionUpdateQueueRequestSchema, } from "../api/sessions.schema.js";
import { hostCreateDirectoryRequestSchema, hostDescribeRequestSchema, hostListDirectoryRequestSchema, hostOpenPathRequestSchema, hostPickDirectoryRequestSchema, } from "../api/host.schema.js";
import { workspaceArchiveSessionRequestSchema, workspaceCreateRequestSchema, workspaceDeleteRequestSchema, workspaceInsertBeforeRequestSchema, workspaceInsertSessionBeforeRequestSchema, workspaceListRequestSchema, workspaceRenameRequestSchema, } from "../api/workspace.schema.js";
import { skillListRequestSchema } from "../api/skills.schema.js";
import { agentPresetCopyRequestSchema, agentPresetListRequestSchema, agentPresetOpenDocumentRequestSchema, agentPresetReadRequestSchema, agentPresetRemoveRequestSchema, agentPresetSelectRequestSchema, } from "../api/agent-presets.schema.js";
import { goalCreateRequestSchema, goalEditRequestSchema, goalPauseRequestSchema, goalResumeRequestSchema, goalCompleteRequestSchema, goalClearRequestSchema, } from "../api/goals.schema.js";
import { settingsDescribeRequestSchema, settingsMutateRequestSchema, settingsOpenDocumentRequestSchema, settingsReplaceRequestSchema, settingsUpdateRequestSchema, } from "../api/settings.schema.js";
import { credentialsDescribeRequestSchema, credentialsSetRequestSchema, credentialsUnsetRequestSchema, } from "../api/credentials.schema.js";
import { llmDiscoverModelsRequestSchema, llmModelsRequestSchema, llmProvidersRequestSchema } from "../api/llm.schema.js";
import { subagentHistoryRequestSchema, subagentInterruptRequestSchema, subagentListRequestSchema, subagentPromptRequestSchema, } from "../api/subagents.schema.js";
const UNARY_ROUTES = {
    'session.list': { schema: sessionListRequestSchema, invoke: (api, r) => api.sessions.list(r) },
    'session.search': { schema: sessionSearchRequestSchema, invoke: (api, r, signal) => api.sessions.search(r, signal) },
    'session.create': { schema: sessionCreateRequestSchema, invoke: (api, r) => api.sessions.create(r) },
    'session.history': { schema: sessionHistoryRequestSchema, invoke: (api, r) => api.sessions.history(r) },
    'session.models': { schema: sessionModelsRequestSchema, invoke: (api, r) => api.sessions.models(r) },
    'session.selectModel': { schema: sessionSelectModelRequestSchema, invoke: (api, r) => api.sessions.selectModel(r) },
    'session.rename': { schema: sessionRenameRequestSchema, invoke: (api, r) => api.sessions.rename(r) },
    'session.fork': { schema: sessionForkRequestSchema, invoke: (api, r) => api.sessions.fork(r) },
    'session.prompt': { schema: sessionPromptRequestSchema, invoke: (api, r) => api.sessions.prompt(r) },
    'session.attachment': { schema: sessionAttachmentRequestSchema, invoke: (api, r) => api.sessions.attachment(r) },
    'session.updateQueue': { schema: sessionUpdateQueueRequestSchema, invoke: (api, r) => api.sessions.updateQueue(r) },
    'session.cancel': { schema: sessionCancelRequestSchema, invoke: (api, r) => api.sessions.cancel(r) },
    'subagent.list': { schema: subagentListRequestSchema, invoke: (api, r, signal) => api.subagents.list(r, signal) },
    'subagent.history': { schema: subagentHistoryRequestSchema, invoke: (api, r, signal) => api.subagents.history(r, signal) },
    'subagent.prompt': { schema: subagentPromptRequestSchema, invoke: (api, r, signal) => api.subagents.prompt(r, signal) },
    'subagent.interrupt': { schema: subagentInterruptRequestSchema, invoke: (api, r) => api.subagents.interrupt(r) },
    'host.describe': { schema: hostDescribeRequestSchema, invoke: (api, r) => api.host.describe(r) },
    'host.pickDirectory': { schema: hostPickDirectoryRequestSchema, invoke: (api, r, signal) => api.host.pickDirectory(r, signal) },
    'host.listDirectory': { schema: hostListDirectoryRequestSchema, invoke: (api, r, signal) => api.host.listDirectory(r, signal) },
    'host.createDirectory': { schema: hostCreateDirectoryRequestSchema, invoke: (api, r) => api.host.createDirectory(r) },
    'host.openPath': { schema: hostOpenPathRequestSchema, invoke: (api, r, signal) => api.host.openPath(r, signal) },
    'workspace.list': { schema: workspaceListRequestSchema, invoke: (api, r) => api.workspace.list(r) },
    'workspace.create': { schema: workspaceCreateRequestSchema, invoke: (api, r) => api.workspace.create(r) },
    'workspace.rename': { schema: workspaceRenameRequestSchema, invoke: (api, r) => api.workspace.rename(r) },
    'workspace.delete': { schema: workspaceDeleteRequestSchema, invoke: (api, r) => api.workspace.delete(r) },
    'workspace.insertBefore': { schema: workspaceInsertBeforeRequestSchema, invoke: (api, r) => api.workspace.insertBefore(r) },
    'workspace.insertSessionBefore': { schema: workspaceInsertSessionBeforeRequestSchema, invoke: (api, r) => api.workspace.insertSessionBefore(r) },
    'workspace.archiveSession': { schema: workspaceArchiveSessionRequestSchema, invoke: (api, r) => api.workspace.archiveSession(r) },
    'skill.list': { schema: skillListRequestSchema, invoke: (api, r) => api.skills.list(r) },
    'agentPreset.list': { schema: agentPresetListRequestSchema, invoke: (api, r) => api.agentPresets.list(r) },
    'agentPreset.select': { schema: agentPresetSelectRequestSchema, invoke: (api, r) => api.agentPresets.select(r) },
    'agentPreset.read': { schema: agentPresetReadRequestSchema, invoke: (api, r) => api.agentPresets.read(r) },
    'agentPreset.copy': { schema: agentPresetCopyRequestSchema, invoke: (api, r) => api.agentPresets.copy(r) },
    'agentPreset.openDocument': { schema: agentPresetOpenDocumentRequestSchema, invoke: (api, r, signal) => api.agentPresets.openDocument(r, signal) },
    'agentPreset.remove': { schema: agentPresetRemoveRequestSchema, invoke: (api, r) => api.agentPresets.remove(r) },
    'goal.create': { schema: goalCreateRequestSchema, invoke: (api, r) => api.goals.create(r) },
    'goal.edit': { schema: goalEditRequestSchema, invoke: (api, r) => api.goals.edit(r) },
    'goal.pause': { schema: goalPauseRequestSchema, invoke: (api, r) => api.goals.pause(r) },
    'goal.resume': { schema: goalResumeRequestSchema, invoke: (api, r) => api.goals.resume(r) },
    'goal.complete': { schema: goalCompleteRequestSchema, invoke: (api, r) => api.goals.complete(r) },
    'goal.clear': { schema: goalClearRequestSchema, invoke: (api, r) => api.goals.clear(r) },
    'settings.describe': { schema: settingsDescribeRequestSchema, invoke: (api, r) => api.settings.describe(r) },
    'settings.openDocument': { schema: settingsOpenDocumentRequestSchema, invoke: (api, r, signal) => api.settings.openDocument(r, signal) },
    'settings.update': { schema: settingsUpdateRequestSchema, invoke: (api, r) => api.settings.update(r) },
    'settings.replace': { schema: settingsReplaceRequestSchema, invoke: (api, r) => api.settings.replace(r) },
    'settings.mutate': { schema: settingsMutateRequestSchema, invoke: (api, r) => api.settings.mutate(r) },
    'credentials.describe': { schema: credentialsDescribeRequestSchema, invoke: (api, r) => api.credentials.describe(r) },
    'credentials.set': { schema: credentialsSetRequestSchema, invoke: (api, r) => api.credentials.set(r) },
    'credentials.unset': { schema: credentialsUnsetRequestSchema, invoke: (api, r) => api.credentials.unset(r) },
    'llm.providers': { schema: llmProvidersRequestSchema, invoke: (api, r) => api.llm.providers(r) },
    'llm.models': { schema: llmModelsRequestSchema, invoke: (api, r) => api.llm.models(r) },
    'llm.discoverModels': { schema: llmDiscoverModelsRequestSchema, invoke: (api, r, signal) => api.llm.discoverModels(r, signal) },
};
/** Route lookup that narrows an arbitrary path segment to a map key (single cast point for the string→key refinement). */
function methodFor(path) {
    return Object.hasOwn(UNARY_ROUTES, path) ? path : undefined;
}
/**
 * Sentinel rpcId for error responses to envelopes whose own rpcId is unreadable: the response
 * must still be a valid ServerResponse (a self-violating shape would turn the server's explicit
 * bad-request report into a client-side parse failure). Fixed value, documented here as wire contract.
 */
const INVALID_REQUEST_RPC_ID = RpcId('invalid-request');
/** Wrap a business error as a ServerResponse full form (rpcId backfilled; an unreadable rpcId uses the invalid-request sentinel). */
function errorResponse(rpcId, error) {
    const body = { type: 'server-response', rpcId, result: { ok: false, error } };
    return Response.json(body);
}
/** Complete the impl's narrow form into a ServerResponse full form. */
function fullResponse(narrow) {
    const body = { type: 'server-response', rpcId: narrow.rpcId, result: narrow.result };
    return Response.json(body);
}
/**
 * Parse the payload and invoke one unary route. Generic over the map key so
 * the row's schema/invoke pairing typechecks; the only cast collapses the
 * Wire<> widening back to the exact payload (undefined-valued properties and
 * absent ones are indistinguishable after JSON transport).
 */
// K appears once in the signature but ties the UNARY_ROUTES[K] row lookup to its own
// schema/invoke pairing; a union parameter degrades the row to an uninvokable intersection.
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
async function handleUnary(api, method, message, signal) {
    const route = UNARY_ROUTES[method];
    const payload = route.schema.safeParse(message.payload);
    if (!payload.success) {
        return errorResponse(message.rpcId, { code: 'bad-request', message: `invalid payload for ${method}`, details: { issues: payload.error.issues } });
    }
    try {
        return fullResponse(await route.invoke(api, { rpcId: message.rpcId, payload: payload.data }, signal));
    }
    catch (error) {
        // The impl never throws business errors; reaching here means the implementation itself crashed — 500, carrier layer.
        return new Response(`handler failure: ${String(error)}`, { status: 500 });
    }
}
/** SSE frame: complete the narrow RpcRequest<frame> into a ServerRequest full form (method = frame type). */
function fullFrame(narrow) {
    return { type: 'server-request', rpcId: narrow.rpcId, method: narrow.payload.type, payload: narrow.payload };
}
/**
 * Wrap a frame stream as an SSE Response; stops when req.signal aborts. An
 * impl throw mid-stream emits one stream/error frame and then closes.
 */
function sseResponse(frames) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            try {
                // Send an SSE comment line on open so clients/proxies see a live channel (the host
                // stream has no baseline frames and would otherwise emit zero bytes while idle;
                // a comment line is not a frame, so client frame parsing skips it naturally).
                controller.enqueue(encoder.encode(': connected\n\n'));
                for await (const narrow of frames) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(fullFrame(narrow))}\n\n`));
                }
            }
            catch (error) {
                // Mid-stream impl failure → one stream/error frame, then close: the client must see
                // the failure instead of a silent end (which reads as a normal disconnect). A fresh
                // rpcId is minted — this is a server-initiated push like any other frame.
                const failure = { type: 'stream/error', error: { code: 'internal', message: String(error), details: {} } };
                try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(fullFrame({ rpcId: RpcId(randomUUID()), payload: failure }))}\n\n`));
                }
                catch {
                    // Consumer already cancelled the stream: enqueue-after-cancel is the
                    // only reachable error, and there is no one left to tell.
                }
            }
            finally {
                try {
                    controller.close();
                }
                catch { /* already cancelled by the consumer: a double close is the only reachable error */ }
            }
        },
    });
    return new Response(stream, {
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
    });
}
/**
 * Wraps an ApiProxy into a pure fetch function (isomorphic point: feed the returned fetch straight to InProcessApiClient).
 * @param api - the host-side ApiProxy implementation.
 * @returns an object holding `fetch(Request)`; paths outside /api/ return 404.
 */
export function toFetchHandler(api) {
    return {
        // Signature matches global fetch: the isomorphic point hands this function to InProcessApiClient as its transport aspect,
        // Clients call in (url, init) form — normalize to Request before handling.
        async fetch(input, init) {
            const req = input instanceof Request ? input : new Request(input, init);
            const url = new URL(req.url);
            const path = url.pathname;
            // No-envelope read channels (SSE GET streams + host-only download):
            // physical routes that answer directly, without a wire envelope.
            if (path === '/api/events.mux' && req.method === 'GET') {
                return sseResponse(api.events.mux({ rpcId: RpcId(randomUUID()), payload: {} }, req.signal));
            }
            if (path === '/api/events.host' && req.method === 'GET') {
                return sseResponse(api.events.host({ rpcId: RpcId(randomUUID()), payload: {} }, req.signal));
            }
            if (path === '/api/session.export' && (req.method === 'GET' || req.method === 'HEAD')) {
                // Query params are a different boundary from the POST envelope, but
                // the request still casts its brands only through the domain schema.
                const parsed = sessionLogQuerySchema.safeParse(Object.fromEntries(url.searchParams));
                if (!parsed.success) {
                    return new Response('missing or invalid sessionId query parameter', { status: 400 });
                }
                const response = await api.downloads.sessionLog(parsed.data, req.signal);
                if (req.method === 'GET')
                    return response;
                await response.body?.cancel();
                return new Response(null, { status: response.status, headers: response.headers });
            }
            if (req.method !== 'POST' || !path.startsWith('/api/')) {
                return new Response('not found', { status: 404 });
            }
            // Cross-site write fence: browsers send "simple" POSTs (text/plain,
            // form encodings) without a CORS preflight, so a malicious page could
            // otherwise execute side-effectful RPCs blind — the response stays
            // unreadable cross-origin, but session.prompt would still run. Only the
            // JSON media type is accepted; anything else is forced into a preflight
            // this server never answers. 415 = carrier layer, like the 400 below.
            const mediaType = req.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
            if (mediaType !== 'application/json') {
                return new Response('content type must be application/json', { status: 415 });
            }
            let body;
            try {
                body = await req.json();
            }
            catch {
                // 400 = carrier layer (body is not even JSON); valid JSON with a bad shape goes 200 + bad-request.
                return new Response('body is not JSON', { status: 400 });
            }
            if (path === '/api/respond') {
                const parsed = clientResponseSchema.safeParse(body);
                if (!parsed.success)
                    return Response.json({ accepted: false, reason: 'bad-response' });
                return Response.json(await api.respond(parsed.data));
            }
            const method = methodFor(path.slice('/api/'.length));
            if (method === undefined)
                return new Response('not found', { status: 404 });
            const envelope = clientRequestSchema.safeParse(body);
            if (!envelope.success) {
                // Best effort at correlation: salvage a string rpcId from the raw body;
                // otherwise the fixed sentinel keeps the response a valid ServerResponse.
                const rawId = body?.rpcId;
                const rpcId = typeof rawId === 'string' ? RpcId(rawId) : INVALID_REQUEST_RPC_ID;
                return errorResponse(rpcId, { code: 'bad-request', message: 'invalid client-request message', details: { issues: envelope.error.issues } });
            }
            const message = envelope.data;
            if (message.method !== method) {
                return errorResponse(message.rpcId, { code: 'bad-request', message: `method "${message.method}" does not match path "${method}"`, details: { issues: [] } });
            }
            return handleUnary(api, method, message, req.signal);
        },
    };
}
//# sourceMappingURL=handler.js.map