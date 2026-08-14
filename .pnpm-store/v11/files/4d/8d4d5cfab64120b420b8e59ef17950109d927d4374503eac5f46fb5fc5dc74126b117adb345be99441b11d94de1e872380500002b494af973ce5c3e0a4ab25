//#region src/sse/client.d.ts
interface SSEClientChannelOptions {
  /** Path to open the SSE stream on. @default '/sse' */
  ssePath?: string;
  /** Path to POST messages to. @default '/rpc' */
  rpcPath?: string;
  /** Header used to send the session id on each POST. @default 'x-birpc-session' */
  sessionHeader?: string;
  /** Custom `fetch` implementation. @default globalThis.fetch */
  fetch?: typeof globalThis.fetch;
  /** Extra headers to attach to every request. */
  headers?: Record<string, string>;
}
interface SSEChannel {
  post: (data: string) => Promise<void>;
  on: (fn: (data: string) => void) => Promise<void>;
}
/**
 * Create a birpc channel that talks to a server over SSE + POST.
 *
 * @param baseUrl - Base URL of the server, e.g. `http://localhost:3737`.
 */
declare function createSseClientChannel(baseUrl: string, options?: SSEClientChannelOptions): SSEChannel;
//#endregion
export { SSEChannel, SSEClientChannelOptions, createSseClientChannel };