/**
 * Centralize the non-secret product identity every provider request sends as `User-Agent`, keeping
 * adapters from drifting. See
 * `.agents/notes/implemented/architecture/2026-06-21-mandatory-app-attribution-headers.md`.
 *
 * App-attribution vocabulary for provider requests.
 * @module @deepseek-ai/dsh-llm/attribution
 */
import { createRequire } from 'node:module';
// The package's own manifest is the single source of the version so the
// User-Agent cannot drift from what is published (`./package.json` is an
// export of this package; the relative path resolves from both `src/` and
// the bundled `lib/`).
const { version } = createRequire(import.meta.url)('../package.json');
/**
 * The harness's own identity: the default every adapter sends. Deployments
 * that need a white-label identity pass their own {@link AppIdentity} to
 * {@link attributionHeaders} — omission falls back to this default; nothing
 * can suppress attribution entirely.
 */
export const APP_IDENTITY = {
    product: 'deepseek-harness',
    version,
    url: 'https://github.com/deepseek-ai/deepseek-harness',
};
/**
 * The standard `User-Agent` value: `product/version (+url)`. The
 * parenthesized `+url` comment is the conventional self-identification form
 * (RFC 9110 §10.1.5 product + comment syntax).
 * @param identity - the identity to render; defaults to {@link APP_IDENTITY}.
 * @returns the ready-to-send header value.
 */
export function userAgent(identity = APP_IDENTITY) {
    return `${identity.product}/${identity.version} (+${identity.url})`;
}
/**
 * Build the attribution headers an adapter must send on every provider
 * request. Header names are lowercase (HTTP field names are case-insensitive
 * on the wire).
 * @param identity - the identity to send; defaults to {@link APP_IDENTITY} — omission cannot suppress attribution.
 * @returns headers to merge into the provider request (currently just `user-agent`).
 */
export function attributionHeaders(identity = APP_IDENTITY) {
    return { 'user-agent': userAgent(identity) };
}
//# sourceMappingURL=attribution.js.map