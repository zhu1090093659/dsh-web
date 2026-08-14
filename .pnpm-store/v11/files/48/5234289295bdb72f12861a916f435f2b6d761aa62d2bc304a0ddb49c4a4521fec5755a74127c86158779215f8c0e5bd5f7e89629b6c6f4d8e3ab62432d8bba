import { n as createPromiseWithResolvers } from "../utils-KbwazfVD.mjs";
import { n as DEFAULT_SESSION_HEADER, o as createSSEParser, r as DEFAULT_SSE_PATH, t as DEFAULT_RPC_PATH } from "../shared-CFafo5hh.mjs";
//#region src/sse/client.ts
/**
* Create a birpc channel that talks to a server over SSE + POST.
*
* @param baseUrl - Base URL of the server, e.g. `http://localhost:3737`.
*/
function createSseClientChannel(baseUrl, options = {}) {
	const { ssePath = DEFAULT_SSE_PATH, rpcPath = DEFAULT_RPC_PATH, sessionHeader = DEFAULT_SESSION_HEADER, fetch = globalThis.fetch, headers = {} } = options;
	let sessionId;
	let emit;
	const { promise: ready, resolve: resolveReady } = createPromiseWithResolvers();
	async function startSSE() {
		const reader = (await fetch(`${baseUrl}${ssePath}`, { headers: {
			accept: "text/event-stream",
			...headers
		} })).body.getReader();
		const decoder = new TextDecoder();
		const feed = createSSEParser((event, data) => {
			if (event === "session") {
				sessionId = data;
				resolveReady();
				return;
			}
			emit?.(data);
		});
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			feed(decoder.decode(value, { stream: true }));
		}
	}
	return {
		post: async (data) => {
			await ready;
			const msg = JSON.parse(data);
			const expectsResponse = msg.t === "q" && msg.i != null;
			const text = await (await fetch(`${baseUrl}${rpcPath}`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					[sessionHeader]: sessionId,
					...headers
				},
				body: data
			})).text();
			if (expectsResponse && text) emit?.(text);
		},
		on: (fn) => {
			emit = fn;
			startSSE();
			return ready;
		}
	};
}
//#endregion
export { createSseClientChannel };
