/**
 * Centralize the non-secret product identity every provider request sends as `User-Agent`, keeping
 * adapters from drifting. See
 * `.agents/notes/implemented/architecture/2026-06-21-mandatory-app-attribution-headers.md`.
 *
 * App-attribution vocabulary for provider requests.
 * @module @deepseek-ai/dsh-llm/attribution
 */
/**
 * Static public application identity sent to LLM providers.
 *
 * Every field is a public product fact, safe on every request: no secrets,
 * local paths, session ids, prompt text, or per-user identifiers belong here,
 * and nothing per-request may influence the values.
 */
export interface AppIdentity {
    /** `User-Agent` product token (lowercase, hyphenated). */
    product: string;
    /** Product version; sourced from package metadata, never hand-copied. */
    version: string;
    /** Repository home URL of the app, used as the `User-Agent` comment. */
    url: string;
}
/**
 * The harness's own identity: the default every adapter sends. Deployments
 * that need a white-label identity pass their own {@link AppIdentity} to
 * {@link attributionHeaders} — omission falls back to this default; nothing
 * can suppress attribution entirely.
 */
export declare const APP_IDENTITY: AppIdentity;
/**
 * The standard `User-Agent` value: `product/version (+url)`. The
 * parenthesized `+url` comment is the conventional self-identification form
 * (RFC 9110 §10.1.5 product + comment syntax).
 * @param identity - the identity to render; defaults to {@link APP_IDENTITY}.
 * @returns the ready-to-send header value.
 */
export declare function userAgent(identity?: AppIdentity): string;
/**
 * Build the attribution headers an adapter must send on every provider
 * request. Header names are lowercase (HTTP field names are case-insensitive
 * on the wire).
 * @param identity - the identity to send; defaults to {@link APP_IDENTITY} — omission cannot suppress attribution.
 * @returns headers to merge into the provider request (currently just `user-agent`).
 */
export declare function attributionHeaders(identity?: AppIdentity): Record<string, string>;
//# sourceMappingURL=attribution.d.ts.map