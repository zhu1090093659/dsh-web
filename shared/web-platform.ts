/**
 * Shared browser platform modules. Seeding, bundling externals, and Vite
 * aliases consume this list so their module identities cannot drift.
 * Mirrors the shell's frozen module table (dsh-web-frontend staticModules,
 * verified against the 0.2.2-rc.1 cohort dist bundle: react,
 * react/jsx-runtime, react-dom, react-dom/client, cordis, zod,
 * @tanstack/react-virtual, dsh-client-store, dsh-client-ui-slots,
 * dsh-client-ui-primitives, dsh-client-ui-dockkit).
 * @module dsh-web/shared/web-platform
 */

/** The module specifiers the shell shares into the frozen module table. */
export const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
] as const
