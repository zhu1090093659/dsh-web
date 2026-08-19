/**
 * Minimal `electron` module declaration for typecheck only. The module is
 * never installed in this package: it exists inside the DSH Desktop shell's
 * main process at runtime. The capture backend casts the dynamic import to
 * its own structural faces, so the shim only needs to make `import('electron')`
 * resolve.
 * @module electron
 */
declare module 'electron' {
  export const app: unknown
  export const BrowserWindow: unknown
}
