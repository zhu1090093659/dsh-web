import { IncomingMessage, ServerResponse } from "node:http";
//#region src/sse/server.d.ts
interface SSEServerChannel {
  post: (data: string) => Promise<void>;
  on: (fn: (data: string) => void) => void;
}
interface SSESession {
  /** The session id, also sent to the client as the first SSE frame. */
  id: string;
  /** The `{ post, on }` channel to hand to `createBirpc`. */
  channel: SSEServerChannel;
  /** Register a callback fired when the SSE stream closes. */
  onClose: (fn: () => void) => void;
}
interface SSESessionManagerOptions {
  /** Header the client echoes its session id on. @default 'x-birpc-session' */
  sessionHeader?: string;
  /** Custom session id generator. @default crypto.randomUUID */
  generateId?: () => string;
}
interface SSESessionManager {
  /** Handle `GET /sse`: open the stream, mint a session, return its channel. */
  open: (req: IncomingMessage, res: ServerResponse) => SSESession;
  /** Handle `POST /rpc`: route the body into the matching session's birpc. */
  handlePost: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
}
/**
 * Create a manager that owns the per-connection SSE sessions and routes POSTs
 * to the right one.
 */
declare function createSseSessionManager(options?: SSESessionManagerOptions): SSESessionManager;
//#endregion
export { SSEServerChannel, SSESession, SSESessionManager, SSESessionManagerOptions, createSseSessionManager };