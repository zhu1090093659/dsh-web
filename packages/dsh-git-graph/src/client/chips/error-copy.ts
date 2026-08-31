/**
 * Stable git error code → readable copy mapping (ZCode branchSwitcher
 * vocabulary). The host classifies failures onto the codes; this mapper owns
 * the user-facing sentences.
 * @module dsh-git-graph/client/chips/error-copy
 */

import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { GitError } from '../../core/types.ts'
import type { GitGraphKey } from '../locales.ts'

/** The blocked-file sentence tail: quoted paths plus the overflow count. */
function pathsText(error: GitError, t: Translate<GitGraphKey>): string {
  const listed = (error.paths ?? []).map(path => `"${path}"`).join(t('error.pathsSeparator'))
  const more = error.moreFiles !== undefined && error.moreFiles > 0
    ? ` ${t('error.moreFiles', { count: error.moreFiles })}`
    : ''
  return `${listed}${more}`
}

/**
 * One readable message for a git operation rejection.
 * @param error - the classified git error.
 * @param t - the git-graph namespace translate seat.
 * @returns the sentence for the error's code.
 */
export function errorMessage(error: GitError, t: Translate<GitGraphKey>): string {
  switch (error.code) {
    case 'conflicts-present':
      return t('error.conflictsPresent')
    case 'operation-in-progress':
      return t('error.operationInProgress')
    case 'branch-in-other-worktree':
      return t('error.branchInOtherWorktree')
    case 'tracked-changes-would-be-overwritten':
      return t('error.trackedOverwrite', { paths: pathsText(error, t) })
    case 'untracked-changes-would-be-overwritten':
      return t('error.untrackedOverwrite', { paths: pathsText(error, t) })
    case 'target-branch-not-found':
      return t('error.targetBranchNotFound')
    case 'invalid-branch-name':
      return t('error.invalidBranchName')
    case 'branch-already-exists':
      return t('error.branchAlreadyExists')
    case 'workspace-unknown':
      return t('error.workspaceUnknown')
    case 'invalid-worktree-name':
      return t('error.invalidWorktreeName')
    case 'worktree-already-exists':
      return t('error.worktreeAlreadyExists')
    case 'worktree-dirty':
      return t('error.worktreeDirty')
    case 'worktree-not-found':
      return t('error.worktreeNotFound')
    case 'worktree-is-main':
      return t('error.worktreeIsMain')
    case 'base-ref-not-found':
      return t('error.baseRefNotFound')
    case 'internal':
      return t('error.requestFailed', { error: error.message })
  }
}
