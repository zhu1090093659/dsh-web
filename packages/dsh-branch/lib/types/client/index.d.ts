/**
 * Browser half: does NOT replace the official Trajectory tab. It injects a
 * per-row rollback/restore action column into the official trajectory ledger
 * at the DOM level (self-healing MutationObserver), plus a floating
 * master/main tree switcher. Rollback creates numbered master trees
 * (master1, master2, ...); restore returns to the main tree.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import { type BranchKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        'branch': BranchKey;
    }
}
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map