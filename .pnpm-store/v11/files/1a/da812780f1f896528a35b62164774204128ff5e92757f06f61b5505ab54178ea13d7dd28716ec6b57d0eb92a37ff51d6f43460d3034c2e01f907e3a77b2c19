/** Host-side WebSocket carrier for the two server-to-browser event streams. */
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy/api';
/**
 * Owns WebSocket negotiation and frame pumping for the connection plugin's
 * two downlinks. Client messages are a protocol violation: upstream traffic
 * remains on HTTP.
 */
export declare class WebSocketDownlinks {
    private readonly api;
    private readonly server;
    private readonly pumps;
    /** @param api - host API supplying the typed event streams. */
    constructor(api: ApiProxy);
    /**
     * Upgrade one socket and pump the mux stream until either side closes.
     * @param req - HTTP upgrade request.
     * @param socket - Raw socket transferred by the HTTP server.
     * @param head - Bytes already read after the upgrade headers.
     */
    handleMux(req: IncomingMessage, socket: Duplex, head: Buffer): void;
    /**
     * Upgrade one socket and pump the host stream until either side closes.
     * @param req - HTTP upgrade request.
     * @param socket - Raw socket transferred by the HTTP server.
     * @param head - Bytes already read after the upgrade headers.
     */
    handleHost(req: IncomingMessage, socket: Duplex, head: Buffer): void;
    /**
     * Terminate owned sockets and await the no-server acceptor plus frame pumps.
     * @returns A promise resolving after every socket and source iterator stops.
     */
    close(): Promise<void>;
    private upgrade;
    private pump;
}
/**
 * Reject an untrusted upgrade before protocol negotiation.
 * @param socket - Raw HTTP socket that remains owned by the caller.
 */
export declare function rejectWebSocketUpgrade(socket: Duplex): void;
//# sourceMappingURL=websocket-downlink.d.ts.map