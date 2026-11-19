/**
 * Host half of the task-board SSH provider extension.
 *
 * This slice ships the frozen core and nothing else: the extension row mounts,
 * and every seam the host engine will drive (the board's launch interception,
 * `dshSsh`, the launcher, the adapters, the workspace strategies and the action
 * protocol) already exists under `src/core/`. The engine that registers the
 * extension, publishes the three model-visible tools and polls the remote runs
 * lands in the next slice, against these interfaces.
 */
import type { Context } from '@deepseek-ai/cordis'

/**
 * npm identity of this package. The host single-instance guard keys on it, so an
 * aggregate install and a standalone install do not double-register.
 */
export const PACKAGE_NAME = '@linxin666/dsh-client-ui-task-board-ssh'

/** Extension id this provider registers under, and the key of its ledger payload. */
export const EXTENSION_ID = 'ssh'

/**
 * Apply the host half.
 * @param _ctx - host context; unused until the run engine is mounted.
 */
export function apply(_ctx: Context): void {
  // The run engine is the next slice; mounting this row today is a no-op that
  // keeps the profile roster and the browser half resolvable.
}
