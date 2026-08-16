/**
 * DOM injector: adds a per-row rollback/restore action cell to the OFFICIAL
 * trajectory ledger plus a floating tree switcher — purely additive, the
 * official UI is never replaced or restyled. Row identity comes from the
 * official `tr[data-record-index]` attribute, mapped through the read-only
 * official-row projection (core/official-rows.ts). A self-healing
 * MutationObserver re-syncs virtualized rows as they enter/leave the DOM.
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client';
import type { ApplySet } from '../core/trajectory.ts';
import type { WriteTarget } from '../core/types.ts';
import { BranchApi, type ApiResult } from './api.ts';
export type Translator = (key: string, params?: Record<string, string | number>) => string;
/** Start the injector; returns the disposer (registered via ctx.effect). */
export declare function startBranchInjection(ctx: ClientContext, api: BranchApi, t: Translator, sessionIdOf: () => SessionId | undefined, cwdOf: (id: SessionId) => string | undefined): () => void;
export type { ApplySet, WriteTarget, ApiResult };
//# sourceMappingURL=inject.d.ts.map