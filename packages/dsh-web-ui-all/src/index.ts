/**
 * Host half of the dsh-web-ui family aggregate: no host behavior of its own.
 * The browser half (./client) carries the compat shim that stamps the legacy
 * DOM hooks (data-pane / data-dsh-frame) the family plugins and skins expect
 * onto current dsh web shells — folded into the aggregate so npm installs
 * need no separate compat package (npm charges per new package name).
 */
import type { Context } from '@deepseek-ai/cordis'

/** Required services: none. */
export const inject = [] as const

/** Host plugin body: nothing to do. */
export function apply(_ctx: Context): void {}
