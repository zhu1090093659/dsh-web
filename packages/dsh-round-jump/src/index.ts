/**
 * dsh-round-jump host half — a no-op placeholder. The entire feature lives
 * in the browser half (lib/client.js): reading the conversation snapshot
 * for user rounds and rendering the right-edge hover popup. The host row
 * exists only so the package resolves as a profile bundle and its
 * dsh.client declaration gets scanned into the web plugin roster.
 * @module @linxin666/dsh-round-jump
 */

export const name = '@linxin666/dsh-round-jump'
export const inject = []

export function apply() {
  // Intentionally empty: this plugin has no host-side behavior.
}
