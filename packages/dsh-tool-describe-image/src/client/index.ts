/**
 * Browser half: no-op. The "Image understanding" settings card is rendered by
 * the web GUI's built-in plugin config page from the host-side
 * `describe-image` settings section, so this half has nothing to mount. The
 * entry exists to satisfy the shared client-bundle preset, which always emits
 * a client bundle; package.json declares no `dsh.client`, so the shell never
 * loads this artifact.
 */
export function apply(): void {}
