/**
 * Browser half: does NOT replace the official Trajectory tab. It injects a
 * per-row rollback/restore action column into the official trajectory ledger
 * at the DOM level (self-healing MutationObserver), plus a floating
 * master/main tree switcher. Rollback creates numbered master trees
 * (master1, master2, ...); restore returns to the main tree.
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { BranchApi } from './api.ts'
import { startBranchInjection, type Translator } from './inject.ts'
import { en, zh, type BranchKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'branch': BranchKey
  }
}

const NS = 'branch'

export const inject = ['sessions', 'locale']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-branch: dictionaries')
  const t = ctx.locale.bind(NS) as unknown as Translator
  const api = new BranchApi()
  ctx.effect(() => startBranchInjection(
    ctx,
    api,
    t,
    () => ctx.sessions.list.getSnapshot().current,
    (id: SessionId) => ctx.sessions.list.getSnapshot().byId[id]?.cwd,
  ), 'dsh-branch: trajectory row injection')
}
