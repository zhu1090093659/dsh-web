import z from "@deepseek-ai/schemastery";
import { toFetchHandler } from "@deepseek-ai/dsh-host-apiproxy";
import { Service } from "@deepseek-ai/cordis";
import { RpcId, clientRequestSchema } from "@deepseek-ai/dsh-host-apiproxy/api";
import { randomUUID } from "node:crypto";
import WebSocket, { WebSocketServer } from "ws";
//#region lib/types/api-path.js
/**
* The /api URL prefix — single source for both halves of the web transport.
* The node half registers this prefix on the web server; both halves share the
* event paths below for the browser WebSocket downlinks.
*/
/** Route prefix owning every api request (`/api` and `/api/<anything>`). */
const API_PATH = "/api";
/** Browser mux-frame WebSocket pathname. */
const MUX_EVENTS_PATH = `${API_PATH}/events.mux`;
/** Browser host-frame WebSocket pathname. */
const HOST_EVENTS_PATH = `${API_PATH}/events.host`;
//#endregion
//#region lib/types/http-bridge.js
/**
* node:http ↔ WHATWG fetch bridge for the /api transport (host side of the
* web carrier; the fetch-shaped handler itself is transport-agnostic).
*/
/** Default carrier cap for all HTTP RPC bodies: sized for the default
* aggregate image limit (100 MiB) after base64 expansion plus envelope
* headroom (~134.3 MiB required), rounded up for slack. The bridge buffers
* each body in memory, so this cap is also the per-request resident bound. */
const DEFAULT_MAX_REQUEST_BODY_BYTES = 160 * 1024 * 1024;
/**
* Bridge one node:http request to the fetch-shaped handler (client close
* aborts; SSE bodies stream out chunk by chunk).
* @param req - incoming node:http request (fully read before dispatch).
* @param res - node:http response the bridge writes and owns to completion.
* @param apiHandler - fetch-shaped API carrier the request is dispatched to.
* @param maxRequestBodyBytes - maximum body bytes buffered before dispatch.
*/
async function bridge(req, res, apiHandler, maxRequestBodyBytes = DEFAULT_MAX_REQUEST_BODY_BYTES) {
	const abort = new AbortController();
	res.on("close", () => {
		if (!res.writableEnded) abort.abort();
	});
	const declaredLength = req.headers["content-length"];
	if (declaredLength !== void 0 && Number(declaredLength) > maxRequestBodyBytes) {
		res.writeHead(413, { connection: "close" });
		res.end();
		req.destroy();
		return;
	}
	const chunks = [];
	let received = 0;
	for await (const chunk of req) {
		const buffer = chunk;
		received += buffer.byteLength;
		if (received > maxRequestBodyBytes) {
			res.writeHead(413, { connection: "close" });
			res.end();
			req.destroy();
			return;
		}
		chunks.push(buffer);
	}
	/* v8 ignore next 3 -- `??` arms: node:http always sets url/method on server
	requests; the fields are only optional on the client-side IncomingMessage type */
	const request = new Request(new URL(req.url ?? "/", "http://dsh.internal"), {
		method: req.method ?? "GET",
		headers: Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === "string")),
		...chunks.length > 0 ? { body: Buffer.concat(chunks) } : {},
		signal: abort.signal
	});
	const response = await apiHandler.fetch(request);
	res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
	if (response.body === null) {
		res.end();
		return;
	}
	for await (const chunk of response.body) if (!res.write(chunk)) await new Promise((resolve) => {
		const done = () => {
			res.off("drain", done);
			res.off("close", done);
			resolve();
		};
		res.once("drain", done);
		res.once("close", done);
	});
	res.end();
}
//#endregion
//#region lib/types/loopback-hostname.js
/**
* Browser-safe, zero-dependency loopback classification shared by the `/api`
* Host fence and the package's `ctx.connection` state. The predicate stays
* package-internal; client plugins consume the derived state through Cordis.
*/
/**
* Whether a normalized URL hostname names the local loopback authority.
* @param hostname - WHATWG URL hostname (IPv6 literals retain brackets).
* @returns true for localhost, IPv6 loopback, or any IPv4 address in 127/8.
*/
function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	const parts = hostname.split(".");
	return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
//#endregion
//#region lib/types/api-request-trust.js
/**
* Browser-trust fence for every /api request. Defends the two confused-deputy
* paths a browser opens against a local HTTP API — DNS rebinding (Host names
* the attacker's domain while the socket reaches this server) and cross-site
* requests fired from a malicious page. The Host fence binds every request,
* browser-looking or not: over plain HTTP a browser attaches neither Origin
* nor Fetch-Metadata to reads (images and navigations — those
* headers go only to trustworthy destinations), so an unmarked request may
* still be a rebound browser read and Host is the one header rebinding cannot
* forge. Non-browser and remote clients pass the same fence via loopback,
* deployment-derived LAN IP literals, or a declared `trustedHosts` authority.
* Network reachability and authentication stay out of scope: binding policy
* belongs to the webserver config, and this fence is not an auth layer.
*/
function header(headers, name) {
	if (headers instanceof Headers) return headers.get(name) ?? void 0;
	const value = headers[name];
	return typeof value === "string" ? value : void 0;
}
/** Normalized URL of a Host-header authority (hostname lowercased, default port stripped, IPv6 bracketed), or undefined when unparsable. */
function parseAuthority(authority) {
	try {
		return new URL(`http://${authority}`);
	} catch {
		return;
	}
}
/**
* Assert one configured `trustedHosts` entry is a bare authority (`host` or
* `host:port`) in canonical form: it must survive WHATWG parsing unchanged
* (case aside). Anything parsing would silently rewrite is refused as a typo
* that must fail the load loudly instead of being ignored until requests 403
* or quietly changing the grant: URL parts beyond the authority
* (`harness.internal/path`, `user@harness.internal` — which would authorize
* the embedded hostname), stripped whitespace, a dangling colon or
* zero-padded port (which would broaden an intended exact-port grant to every
* port), and non-canonical host spellings (`0x7f.0.0.1`, percent-encoding,
* unbracketed IPv6; IDN hosts are declared in punycode, the form the wire
* carries).
* @param entry - the configured value, verbatim.
*/
function assertTrustedAuthority(entry) {
	const entryUrl = parseAuthority(entry);
	if (entryUrl !== void 0 && canonicalAuthority(entry, entryUrl) === entry.toLowerCase()) return;
	throw new Error(`client-connection: trustedHosts entry ${JSON.stringify(entry)} is not a bare host[:port] authority`);
}
/**
* Canonical form of a parsed authority: `hostname` when no port was written,
* else `hostname:port`. The port is judged from URL parses under both special
* schemes (their default ports differ, so `:80` and `:443` still count as
* explicit), never from the raw string, where WHATWG trimming would misread
* shapes like `host:port ` as port-less.
*/
function canonicalAuthority(entry, entryUrl) {
	const port = entryUrl.port !== "" ? entryUrl.port : new URL(`https://${entry}`).port;
	return port === "" ? entryUrl.hostname : `${entryUrl.hostname}:${port}`;
}
/**
* Whether the request authority matches a `trustedHosts` entry. An entry with
* an explicit port matches that exact authority; a port-less entry matches the
* hostname on any port (the shape the CLI derives for IP-literal LAN serving,
* where the bound port may be OS-assigned). Both sides compare through WHATWG
* normalization, so case and a redundant `:80` never decide trust.
*/
function isTrustedAuthority(hostUrl, trustedHosts) {
	return trustedHosts.some((entry) => {
		const entryUrl = parseAuthority(entry);
		if (entryUrl === void 0) return false;
		return canonicalAuthority(entry, entryUrl) === entryUrl.hostname ? entryUrl.hostname === hostUrl.hostname : entryUrl.host === hostUrl.host;
	});
}
/**
* Decide whether one /api request may reach the RPC bridge.
* @param request - Node HTTP or Fetch request facts (headers).
* @param trustedHosts - non-loopback authorities this deployment serves: exact `host:port`, or port-less `host` matching any port.
* @returns true when the Host is ours (loopback or trusted) and any attached browser markers are same-origin.
*/
function isTrustedApiRequest(request, trustedHosts) {
	const host = header(request.headers, "host");
	if (host === void 0) return false;
	const hostUrl = parseAuthority(host);
	if (hostUrl === void 0) return false;
	if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false;
	if (header(request.headers, "sec-fetch-site") === "cross-site") return false;
	const origin = header(request.headers, "origin");
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
//#endregion
//#region lib/types/rpc-host.js
/** Host registry and HTTP adapter for generic Connection RPC channels. */
const INVALID_REQUEST_RPC_ID = RpcId("invalid-request");
const CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/;
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/;
/** Host Connection service whose channel registrations belong to the caller fiber. */
var HostConnectionService = class extends Service {
	trustedHosts;
	interceptors = /* @__PURE__ */ new Map();
	/**
	* Provide the Host half over the active HTTP server.
	* @param ctx - owning Connection plugin context.
	* @param trustedHosts - deployment authorities accepted by trusted-host channels.
	*/
	constructor(ctx, trustedHosts) {
		super(ctx, "connection");
		this.trustedHosts = trustedHosts;
	}
	/** Generic channel registry scoped to the Context reading this service. */
	get rpc() {
		const owner = this.ctx;
		return {
			handle: (channel, handler, options) => this.register(owner, channel, handler, options),
			intercept: (channel, matches, handler, options) => this.registerInterceptor(owner, channel, matches, handler, options)
		};
	}
	/**
	* Compose one shared-channel Fetch handler from its interceptor and fallback.
	* @param channel - shared channel mounted by Connection.
	* @param fallback - handler for endpoints not claimed by the interceptor.
	* @returns Fetch handler that selects exactly one target for each request.
	*/
	createSharedFetchHandler(channel, fallback) {
		return { fetch: (request) => {
			const endpoint = endpointFromPath(channel, new URL(request.url).pathname);
			const interceptor = this.interceptors.get(channel);
			if (endpoint === void 0 || interceptor === void 0 || !interceptor.matches(endpoint)) return fallback.fetch(request);
			if (interceptor.options.authority === "loopback" && !isTrustedApiRequest(request, [])) return Promise.resolve(new Response("forbidden", { status: 403 }));
			return interceptor.fetchHandler.fetch(request);
		} };
	}
	register(owner, channel, handler, options) {
		assertChannel(channel);
		const trustedHosts = options.authority === "loopback" ? [] : this.trustedHosts;
		const fetchHandler = rpcFetchHandler(channel, handler);
		const route = {
			kind: "prefix",
			path: channel,
			handler: async (req, res) => {
				if (!isTrustedApiRequest(req, trustedHosts)) {
					res.writeHead(403);
					res.end("forbidden");
					return;
				}
				await bridge(req, res, fetchHandler);
			}
		};
		return owner.effect(() => owner.webServer.register(route), `client-connection: ${channel} rpc channel`);
	}
	registerInterceptor(owner, channel, matches, handler, options) {
		if (channel !== "/api") throw new Error(`connection: invalid shared RPC channel ${JSON.stringify(channel)}`);
		const interceptor = {
			matches,
			fetchHandler: rpcFetchHandler(channel, handler),
			options
		};
		return owner.effect(() => {
			if (this.interceptors.has(channel)) throw new Error(`connection: shared RPC channel ${JSON.stringify(channel)} already has an interceptor`);
			this.interceptors.set(channel, interceptor);
			return () => {
				this.interceptors.delete(channel);
			};
		}, `client-connection: ${channel} rpc interceptor`);
	}
};
function rpcFetchHandler(channel, handler) {
	return { async fetch(request) {
		const endpoint = endpointFromPath(channel, new URL(request.url).pathname);
		if (request.method !== "POST" || endpoint === void 0) return new Response("not found", { status: 404 });
		if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return new Response("content type must be application/json", { status: 415 });
		let body;
		try {
			body = await request.json();
		} catch {
			return new Response("body is not JSON", { status: 400 });
		}
		const envelope = clientRequestSchema.safeParse(body);
		if (!envelope.success) return invalidEnvelopeResponse(body, envelope.error.issues);
		const message = envelope.data;
		if (message.method !== endpoint) return errorResponse(message.rpcId, {
			code: "bad-request",
			message: `method ${JSON.stringify(message.method)} does not match endpoint ${JSON.stringify(endpoint)}`,
			details: { issues: [] }
		});
		try {
			const result = await handler(endpoint, message.payload, request.signal);
			return fullResponse(message.rpcId, result);
		} catch (error) {
			return new Response(`handler failure: ${String(error)}`, { status: 500 });
		}
	} };
}
function invalidEnvelopeResponse(body, issues) {
	const rawId = body?.rpcId;
	return errorResponse(typeof rawId === "string" ? RpcId(rawId) : INVALID_REQUEST_RPC_ID, {
		code: "bad-request",
		message: "invalid client-request message",
		details: { issues }
	});
}
function endpointFromPath(channel, pathname) {
	if (!pathname.startsWith(`${channel}/`)) return void 0;
	const endpoint = pathname.slice(channel.length + 1);
	if (endpoint.split("/").some((segment) => segment === "" || segment === "." || segment === ".." || !ENDPOINT_SEGMENT_PATTERN.test(segment))) return;
	return endpoint;
}
function errorResponse(rpcId, error) {
	return fullResponse(rpcId, {
		ok: false,
		error
	});
}
function fullResponse(rpcId, result) {
	const body = {
		type: "server-response",
		rpcId,
		result
	};
	return Response.json(body);
}
function assertChannel(channel) {
	if (!CHANNEL_PATTERN.test(channel) || channel === "/api") throw new Error(`connection: invalid or reserved RPC channel ${JSON.stringify(channel)}`);
}
//#endregion
//#region lib/types/websocket-downlink.js
/** Host-side WebSocket carrier for the two server-to-browser event streams. */
function serverRequest(frame) {
	return {
		type: "server-request",
		rpcId: frame.rpcId,
		method: frame.payload.type,
		payload: frame.payload
	};
}
function send(socket, frame) {
	return new Promise((resolve, reject) => {
		if (socket.readyState !== WebSocket.OPEN) {
			reject(/* @__PURE__ */ new Error("websocket downlink closed before frame delivery"));
			return;
		}
		socket.send(JSON.stringify(serverRequest(frame)), (error) => {
			if (error) reject(error);
			else resolve();
		});
	});
}
function failureFrame(error) {
	return {
		rpcId: RpcId(randomUUID()),
		payload: {
			type: "stream/error",
			error: {
				code: "internal",
				message: String(error),
				details: {}
			}
		}
	};
}
/**
* Owns WebSocket negotiation and frame pumping for the connection plugin's
* two downlinks. Client messages are a protocol violation: upstream traffic
* remains on HTTP.
*/
var WebSocketDownlinks = class {
	api;
	server = new WebSocketServer({ noServer: true });
	pumps = /* @__PURE__ */ new Set();
	/** @param api - host API supplying the typed event streams. */
	constructor(api) {
		this.api = api;
	}
	/**
	* Upgrade one socket and pump the mux stream until either side closes.
	* @param req - HTTP upgrade request.
	* @param socket - Raw socket transferred by the HTTP server.
	* @param head - Bytes already read after the upgrade headers.
	*/
	handleMux(req, socket, head) {
		this.upgrade(req, socket, head, (signal) => this.api.events.mux({
			rpcId: RpcId(randomUUID()),
			payload: {}
		}, signal));
	}
	/**
	* Upgrade one socket and pump the host stream until either side closes.
	* @param req - HTTP upgrade request.
	* @param socket - Raw socket transferred by the HTTP server.
	* @param head - Bytes already read after the upgrade headers.
	*/
	handleHost(req, socket, head) {
		this.upgrade(req, socket, head, (signal) => this.api.events.host({
			rpcId: RpcId(randomUUID()),
			payload: {}
		}, signal));
	}
	/**
	* Terminate owned sockets and await the no-server acceptor plus frame pumps.
	* @returns A promise resolving after every socket and source iterator stops.
	*/
	async close() {
		for (const socket of this.server.clients) socket.terminate();
		await new Promise((resolve, reject) => {
			this.server.close((error) => {
				if (error === void 0) resolve();
				else reject(error);
			});
		});
		await Promise.all(this.pumps);
	}
	upgrade(req, socket, head, open) {
		this.server.handleUpgrade(req, socket, head, (websocket) => {
			const abort = new AbortController();
			websocket.once("close", () => {
				abort.abort();
			});
			websocket.once("error", () => {
				abort.abort();
			});
			websocket.once("message", () => {
				websocket.close(1008, "downlink only");
			});
			const pump = this.pump(websocket, open(abort.signal), abort);
			this.pumps.add(pump);
			pump.then(() => {
				this.pumps.delete(pump);
			});
		});
	}
	async pump(socket, frames, abort) {
		try {
			for await (const frame of frames) await send(socket, frame);
		} catch (error) {
			if (!abort.signal.aborted) try {
				await send(socket, failureFrame(error));
			} catch {}
		} finally {
			abort.abort();
			if (socket.readyState === WebSocket.OPEN) socket.close();
		}
	}
};
/**
* Reject an untrusted upgrade before protocol negotiation.
* @param socket - Raw HTTP socket that remains owned by the caller.
*/
function rejectWebSocketUpgrade(socket) {
	socket.end([
		"HTTP/1.1 403 Forbidden",
		"Connection: close",
		"Content-Type: text/plain; charset=utf-8",
		"Content-Length: 9",
		"",
		"forbidden"
	].join("\r\n"));
}
//#endregion
//#region lib/types/index.js
/** Stable Cordis plugin name. */
const name = "client-connection";
/** Headroom for RPC JSON fields around aggregate base64 image payloads. */
const REQUEST_ENVELOPE_HEADROOM_BYTES = 1024 * 1024;
function assertImageBodyCapacity(ctx, maxRequestBodyBytes) {
	const attachments = ctx.get("attachments");
	if (attachments === void 0) return;
	const requiredImageBodyBytes = Math.ceil(attachments.imageLimits.maxMessageImageBytes * 4 / 3) + REQUEST_ENVELOPE_HEADROOM_BYTES;
	if (maxRequestBodyBytes < requiredImageBodyBytes) throw new Error(`client-connection maxRequestBodyBytes (${String(maxRequestBodyBytes)}) must be at least ${String(requiredImageBodyBytes)} for the configured aggregate image limit`);
}
/** Services required before providing Connection; API Proxy is an optional `/api` fallback. */
const inject = ["webServer"];
const Config = z.object({
	trustedHosts: z.array(String).default([]),
	maxRequestBodyBytes: z.natural().min(1).default(DEFAULT_MAX_REQUEST_BODY_BYTES)
});
/**
* Methods gated to loopback even on a trusted-host deployment. Native dialogs
* act on the host machine; the settings and credential domains mutate the
* user's configuration and secret store, and READING them is equally
* privileged — `settings.describe` returns every exposed namespace's
* configuration and `credentials.describe` reports whether an arbitrary
* environment-variable name is configured and where from, which is
* reconnaissance no anonymous caller should have. `trustedHosts` is a
* DNS-rebinding fence, explicitly not authentication, so the whole
* configuration plane stays loopback-same-origin until a real authentication
* layer exists. `llm.discoverModels` belongs to that plane on both counts: it
* carries a draft credential, and it makes the HOST issue a GET to a URL the
* caller chose and reports back the status or the parsed body — an anonymous
* LAN caller would have a probe for whatever the host can reach and the
* browser cannot.
*
* The model catalog (`llm.providers`, `llm.models`) is deliberately NOT here:
* it carries provider ids, display names, and model lists — no endpoints,
* keys, or key state — and a LAN client's model picker legitimately needs it.
*/
const PRIVILEGED_METHODS = new Set([
	"agentPreset.read",
	"agentPreset.copy",
	"agentPreset.openDocument",
	"agentPreset.remove",
	"host.pickDirectory",
	"host.openPath",
	"settings.describe",
	"settings.openDocument",
	"settings.update",
	"settings.replace",
	"settings.mutate",
	"credentials.describe",
	"credentials.set",
	"credentials.unset",
	"llm.discoverModels"
]);
/**
* Mounts the API gateway under the browser transport prefix. Every request on
* the prefix passes the browser-trust fence first (DNS-rebinding and
* cross-site defense — [api-request-trust](./api-request-trust.ts));
* privileged methods additionally pass it with an empty trust list, which
* pins them to loopback.
* @param ctx - Host plugin context.
* @param config - resolved plugin config (schema defaults applied).
*/
function apply(ctx, config) {
	const trustedHosts = config?.trustedHosts ?? [];
	const maxRequestBodyBytes = config?.maxRequestBodyBytes ?? 167772160;
	for (const entry of trustedHosts) assertTrustedAuthority(entry);
	if (ctx.get("apiProxy") !== void 0) assertImageBodyCapacity(ctx, maxRequestBodyBytes);
	const fetchHandler = new HostConnectionService(ctx, trustedHosts).createSharedFetchHandler(API_PATH, { async fetch(request) {
		const pathname = new URL(request.url).pathname;
		const method = pathname.startsWith(`/api/`) ? pathname.slice(5) : void 0;
		if (method !== void 0 && PRIVILEGED_METHODS.has(method) && !isTrustedApiRequest(request, [])) return new Response("forbidden", { status: 403 });
		if (request.method === "GET" && (pathname === MUX_EVENTS_PATH || pathname === HOST_EVENTS_PATH)) return new Response("upgrade required", {
			status: 426,
			headers: {
				connection: "Upgrade",
				upgrade: "websocket"
			}
		});
		const apiProxy = ctx.get("apiProxy");
		if (apiProxy === void 0) return new Response("not found", { status: 404 });
		return toFetchHandler(apiProxy).fetch(request);
	} });
	const route = {
		kind: "prefix",
		path: API_PATH,
		handler: async (req, res) => {
			if (!isTrustedApiRequest(req, trustedHosts)) {
				res.writeHead(403);
				res.end("forbidden");
				return;
			}
			await bridge(req, res, fetchHandler, maxRequestBodyBytes);
		}
	};
	ctx.effect(() => ctx.webServer.register(route), "client-connection: /api route");
	ctx.inject(["apiProxy"], (apiCtx) => {
		assertImageBodyCapacity(apiCtx, maxRequestBodyBytes);
		const downlinks = new WebSocketDownlinks(apiCtx.apiProxy);
		const registerDownlink = (path, handle) => {
			apiCtx.effect(() => apiCtx.webServer.registerUpgrade({
				path,
				handler: (req, socket, head) => {
					if (!isTrustedApiRequest(req, trustedHosts)) {
						rejectWebSocketUpgrade(socket);
						return;
					}
					return handle(req, socket, head);
				}
			}), `client-connection: ${path} WebSocket`);
		};
		apiCtx.effect(() => () => downlinks.close(), "client-connection: WebSocket downlinks");
		registerDownlink(MUX_EVENTS_PATH, (req, socket, head) => {
			downlinks.handleMux(req, socket, head);
		});
		registerDownlink(HOST_EVENTS_PATH, (req, socket, head) => {
			downlinks.handleHost(req, socket, head);
		});
	});
}
//#endregion
export { API_PATH, Config, HOST_EVENTS_PATH, HostConnectionService, MUX_EVENTS_PATH, apply, inject, name };
