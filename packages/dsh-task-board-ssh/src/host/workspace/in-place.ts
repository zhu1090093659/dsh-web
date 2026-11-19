/**
 * Runs in a remote directory the user already has.
 *
 * The pinned directory is the whole strategy: nothing is created, copied or
 * versioned, so the agent's changes land where the user pointed and `collect`
 * has nothing to bring back. An absent directory fails the run instead of being
 * created, because a typo in a path must not turn into a silently new, empty
 * place to work in.
 *
 * @module dsh-task-board-ssh/host/workspace/in-place
 */
import type { SshWorkspaceCollection, SshWorkspaceRun } from '../../core/workspace.ts'
import { SshWorkspaceError } from './errors.ts'
import { directoryProbeCommand } from './remote-git.ts'
import { probeRemote } from './remote.ts'
import type { SshWorkspacePreparationNote, SshWorkspaceStrategyWithNote } from './types.ts'

/** The pinned remote directory, checked but never created. */
export class InPlaceWorkspaceStrategy implements SshWorkspaceStrategyWithNote {
  readonly kind = 'in-place' as const

  /** The directory the card pinned. */
  private readonly path: string

  /**
   * @param path - absolute remote directory the run works in.
   * @throws SshWorkspaceError when the path is not absolute.
   */
  constructor(path: string) {
    if (!path.startsWith('/')) {
      throw new SshWorkspaceError(`the pinned remote directory must be an absolute path: ${path}`)
    }
    this.path = path
  }

  /**
   * Check that the pinned directory exists and hand it back.
   * @param run - the run being prepared.
   * @returns the pinned directory as the working directory.
   * @throws SshWorkspaceError when it is missing or the host is unreachable.
   */
  async prepare(run: SshWorkspaceRun): Promise<SshWorkspacePreparationNote> {
    if (!(await probeRemote(run, directoryProbeCommand(this.path)))) {
      throw new SshWorkspaceError(
        `the pinned remote directory does not exist and an in-place workspace never creates it: ${this.path}`,
      )
    }
    return { cwd: this.path }
  }

  /**
   * Collect nothing: in-place work stays where it was made.
   * @returns an empty collection, because files in place are already the result.
   */
  async collect(): Promise<SshWorkspaceCollection> {
    return {}
  }
}
