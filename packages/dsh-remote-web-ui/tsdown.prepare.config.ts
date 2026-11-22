/**
 * Consumer-side build for git installs (the `prepare` script): transpile
 * straight from src without tsc project references, which need the sibling
 * harness checkout that only dev machines and CI have. Types are NOT
 * checked here — `pnpm run typecheck` owns that. The client bundle is
 * emitted too: the modules node half serves lib/client.js to browsers, so a
 * git-installed package must ship it. The standalone mobile bundle was removed
 * in 0.4.0. This file re-exports the primary config itself so host externals
 * cannot drift between development and publish artifacts (issue #2082).
 */
export { default } from './tsdown.config.ts'
