/**
 * Shared import target for the per-family shell subpaths
 * (`@linxin666/dsh-web-all/<family>`, one package.json exports key per family
 * row, all pointing here): the loader imports this module for every family
 * patch row, and the row config keeps naming the real plugin package
 * (`config.plugin`), exactly like the main face — the subpath exists purely
 * so the official plugin inventory can render a distinct
 * "web-all/<family>" title per row (the same multi-entry convention as the
 * host's own `web-app/startup` row) instead of a wall of identical
 * "web-all" cards.
 *
 * This file MUST live under shells/: the client module scanner resolves a
 * row's module URL and walks up to the nearest package.json, and the marker
 * manifest beside this file (src/shells/package.json, copied to lib/shells/)
 * stops that walk before it reaches the package root — whose dsh.client face
 * belongs to the compat row alone. A second scanner source for the same
 * package is a hard reconcile error ("resolves from multiple active Loader
 * sources").
 */
export { apply, inject } from '../shell.ts'
