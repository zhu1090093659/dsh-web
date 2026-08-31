/**
 * Shared browser platform modules. Seeding, bundling externals, and Vite
 * aliases consume this list so their module identities cannot drift.
 * Mirrors the shell's frozen module table (dsh-client-web staticModules,
 * verified against the 0.1.2-alpha.2 cohort: react, react/jsx-runtime,
 * react-dom, react-dom/client, cordis, dsh-client-store,
 * dsh-client-ui-slots, dsh-client-ui-primitives; the client-runtime row of
 * the rc.2 table is gone because upstream removed the package, and
 * dsh-client-store is the replacement static module).
 * @module dsh-web/shared/web-platform
 */

/** The module specifiers the shell shares into the frozen module table. */
export const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
] as const
