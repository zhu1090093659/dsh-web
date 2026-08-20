/**
 * Shared browser platform modules. Seeding, bundling externals, and Vite
 * aliases consume this list so their module identities cannot drift.
 * Mirrors the shell's frozen module table (dsh-web-frontend staticModules,
 * verified against the 0.1.0-rc.8 dist: react, react/jsx-runtime, react-dom,
 * react-dom/client, cordis, dsh-client-ui-slots, dsh-client-ui-primitives).
 * @module dsh-web-ui/shared/web-platform
 */

/** The module specifiers the shell shares into the frozen module table. */
export const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
] as const
