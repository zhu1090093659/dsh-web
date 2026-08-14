//#region src/sse/shared.ts
/**
* Shared bits for the SSE + POST birpc transport.
*
* birpc assumes one full-duplex channel, but SSE is server -> client only, so
* these adapters pair it with HTTP POST for the client -> server direction.
* See `./client` and `./server` for the two ends.
*/
/** Default HTTP header used to correlate a client's POSTs with its SSE stream. */
const DEFAULT_SESSION_HEADER = "x-birpc-session";
/** Default path the client opens the SSE stream on. */
const DEFAULT_SSE_PATH = "/sse";
/** Default path the client POSTs messages to. */
const DEFAULT_RPC_PATH = "/rpc";
/** The SSE event name carrying the session id as the first frame. */
const SESSION_EVENT = "session";
/** The SSE event name carrying birpc messages. */
const MESSAGE_EVENT = "message";
/** Parse a stream of raw SSE text into `{ event, data }` frames. */
function createSSEParser(onFrame) {
	let buf = "";
	return (chunk) => {
		buf += chunk;
		let idx;
		while ((idx = buf.indexOf("\n\n")) !== -1) {
			const raw = buf.slice(0, idx);
			buf = buf.slice(idx + 2);
			let event = MESSAGE_EVENT;
			const data = [];
			for (const line of raw.split("\n")) if (line.startsWith("event:")) event = line.slice(6).trim();
			else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
			onFrame(event, data.join("\n"));
		}
	};
}
//#endregion
export { SESSION_EVENT as a, MESSAGE_EVENT as i, DEFAULT_SESSION_HEADER as n, createSSEParser as o, DEFAULT_SSE_PATH as r, DEFAULT_RPC_PATH as t };
