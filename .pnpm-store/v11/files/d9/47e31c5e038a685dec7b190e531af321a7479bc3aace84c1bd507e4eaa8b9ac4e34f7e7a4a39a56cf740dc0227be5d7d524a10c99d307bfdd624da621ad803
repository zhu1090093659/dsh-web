import { a as SESSION_EVENT, i as MESSAGE_EVENT, n as DEFAULT_SESSION_HEADER } from "../shared-CFafo5hh.mjs";
import { randomUUID } from "node:crypto";
//#region src/sse/server.ts
function writeSSE(res, event, data) {
	const lines = data.split("\n").map((l) => `data: ${l}`).join("\n");
	res.write(`event: ${event}\n${lines}\n\n`);
}
/**
* Create a manager that owns the per-connection SSE sessions and routes POSTs
* to the right one.
*/
function createSseSessionManager(options = {}) {
	const { sessionHeader = DEFAULT_SESSION_HEADER, generateId = randomUUID } = options;
	const sessions = /* @__PURE__ */ new Map();
	function open(req, res) {
		const id = generateId();
		res.writeHead(200, {
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
			"connection": "keep-alive",
			"access-control-allow-origin": "*",
			"x-accel-buffering": "no"
		});
		const session = {
			id,
			res,
			pending: /* @__PURE__ */ new Map()
		};
		sessions.set(id, session);
		writeSSE(res, SESSION_EVENT, id);
		req.on("close", () => {
			sessions.delete(id);
			session.onClose?.();
		});
		return {
			id,
			channel: {
				post: async (data) => {
					const msg = JSON.parse(data);
					if (msg.t === "s" && msg.i != null && session.pending.has(msg.i)) {
						const pendingRes = session.pending.get(msg.i);
						session.pending.delete(msg.i);
						pendingRes.writeHead(200, {
							"content-type": "application/json",
							"access-control-allow-origin": "*"
						});
						pendingRes.end(data);
						return;
					}
					writeSSE(res, MESSAGE_EVENT, data);
				},
				on: (fn) => {
					session.emit = fn;
				}
			},
			onClose: (fn) => {
				session.onClose = fn;
			}
		};
	}
	async function handlePost(req, res) {
		const id = req.headers[sessionHeader];
		const session = id ? sessions.get(id) : void 0;
		if (!session) {
			res.writeHead(400, { "access-control-allow-origin": "*" });
			res.end("unknown session");
			return;
		}
		let body = "";
		for await (const chunk of req) body += chunk;
		const msg = JSON.parse(body);
		if (msg.t === "q" && msg.i != null) {
			session.pending.set(msg.i, res);
			session.emit?.(body);
		} else {
			session.emit?.(body);
			res.writeHead(202, { "access-control-allow-origin": "*" });
			res.end();
		}
	}
	return {
		open,
		handlePost
	};
}
//#endregion
export { createSseSessionManager };
