/**
 * Host half of the dsh-web-ui compat shim: no host behavior. The browser half
 * (./client) stamps the legacy DOM hooks the family plugins expect.
 */
import type { Context } from '@deepseek-ai/cordis'

/** Required services: none. */
export const inject = [] as const

/** Host plugin body: nothing to do. */
export function apply(_ctx: Context): void {}
