/**
 * Host-side session-log download: streams one ZIP archive whose files are the
 * sessions' stored artifact text verbatim plus every referenced media object.
 * The root artifact sits under its original base name (`session.jsonl`); each
 * subagent descendant under `subagents/<id>/<filename>`; each image referenced
 * by any included log under `media/<attachmentId>.<ext>` (content-addressed,
 * so one archive never duplicates a shared image). No manifest is written —
 * every file is byte-identical to the backend's durable artifact or attachment
 * store and self-describing through its own header line or media type. Before
 * each live session's artifact read, the SessionStore flush barrier makes the
 * current in-memory log durable; cold sessions need no barrier. Request abort
 * and response-consumer cancellation share one producer signal and terminate
 * the active compressor.
 * Compression runs on the host with fflate's streaming Zip API, so the archive
 * bytes are produced incrementally and the host never holds the whole archive
 * in one buffer; production waits for consumer pull whenever the response queue
 * reaches its byte high-water mark, so a slow consumer bounds accumulation to
 * the fixed 64 KiB response queue plus one synchronous fflate push.
 * @module
 */
import type { Context } from '@deepseek-ai/cordis';
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment';
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query';
import type { SessionId, SessionStore } from '@deepseek-ai/dsh-session';
import type { SessionPersistence, SessionRawArtifact } from '@deepseek-ai/dsh-session-persistence';
/** Valid fflate DEFLATE levels accepted by session-log export. */
export type SessionLogCompressionLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
/** Balanced default used when a direct createApiProxy caller omits deployment config. */
export declare const DEFAULT_SESSION_LOG_COMPRESSION_LEVEL: SessionLogCompressionLevel;
/** The services a session-log export needs (the live-session store is optional). */
export interface SessionLogExportDeps {
    readonly sessionQuery: SessionQueryEngine | undefined;
    readonly sessionPersistence: SessionPersistence | undefined;
    readonly attachments: AttachmentStore | undefined;
    readonly sessions: SessionStore | undefined;
}
/** The export services narrowed to the mounted ones streaming actually reads. */
export interface SessionLogExportReady {
    readonly sessionQuery: SessionQueryEngine;
    readonly sessionPersistence: SessionPersistence;
    readonly attachments: AttachmentStore;
    readonly sessions: SessionStore | undefined;
}
/**
 * Resolve the persistence, session-query, and attachment services a log export needs.
 * @param ctx - the composed host context.
 * @returns the export services (absent when the deployment does not mount them).
 */
export declare function sessionLogExportDeps(ctx: Context): SessionLogExportDeps;
/**
 * Flush one currently live session through the store's authoritative durability
 * barrier immediately before its raw artifact is read. A cold or absent id has
 * no in-memory work to flush.
 * @param deps - export services, including the optional live-session store.
 * @param id - the session whose artifact is about to be read.
 * @param signal - optional cancellation observed around the flush barrier.
 */
export declare function flushLiveSessionLog(deps: Pick<SessionLogExportDeps, 'sessions'>, id: SessionId, signal?: AbortSignal): Promise<void>;
/** One exported file: a stored artifact text or one referenced media object. */
export type SessionLogZipEntry = {
    readonly path: string;
    readonly content: string;
} | {
    readonly path: string;
    readonly data: Uint8Array;
};
/**
 * The export archive filename for one root session.
 * @param sessionId - the root session id (sanitized to one safe path segment).
 * @returns the attachment filename for the session's export archive.
 */
export declare function sessionLogZipFilename(sessionId: string): string;
/**
 * Yield the export entries in zip order: the preloaded root artifact first,
 * then every subagent descendant in lineage order (each flushed when live,
 * read from the persistence backend right before it is yielded, and dropped
 * after the consumer moves on), then every distinct media object referenced by any of
 * the included logs (read and verified from the attachment store, one archive
 * entry per attachment id). The host holds at most one descendant's artifact
 * text and one media object at a time beyond the root.
 * @param deps - the mounted export services (the caller answered 500 before this runs).
 * @param root - the already-read root artifact (read by the caller so the
 * missing-session path can answer cleanly before streaming starts).
 * @param sessionId - the root session id.
 * @param includeDescendants - whether to include every subagent descendant.
 * @param signal - optional cancellation forwarded to lineage, persistence, and attachment reads.
 * @returns the export entries in zip order.
 */
export declare function sessionLogZipEntries(deps: SessionLogExportReady, root: SessionRawArtifact, sessionId: SessionId, includeDescendants: boolean, signal?: AbortSignal): AsyncGenerator<SessionLogZipEntry>;
/**
 * Stream one session-log ZIP as a WHATWG ReadableStream. The root artifact is
 * read and validated by the caller before this is called (missing root or
 * missing services answer cleanly before any byte is produced); each entry is
 * then encoded and deflated in bounded chunks as it is produced, so the
 * archive bytes arrive incrementally. A descendant that fails to read errors
 * the stream (fail-loud, never silent under-export).
 * @param deps - the mounted export services (the caller answered 500 before this runs).
 * @param root - the already-read root artifact (first zip entry).
 * @param sessionId - the root session id.
 * @param includeDescendants - whether to include every subagent descendant.
 * @param compressionLevel - validated fflate DEFLATE level for every ZIP entry.
 * @param signal - request cancellation combined with response-consumer cancellation.
 * @returns the zip byte stream.
 */
export declare function streamSessionLogZip(deps: SessionLogExportReady, root: SessionRawArtifact, sessionId: SessionId, includeDescendants: boolean, compressionLevel: SessionLogCompressionLevel, signal: AbortSignal): ReadableStream<Uint8Array>;
//# sourceMappingURL=session-export.d.ts.map