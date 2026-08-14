/**
 * Composer submission policy. It owns the live busy-Enter
 * preference and resolves keyboard gestures into queue/steer delivery modes;
 * Host and Agent keep the actual delivery-window authority.
 */
import { type SettingsScope, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client';
import type { BusyEnterBehavior, ComposerSubmitGesture, InputSubmitMode } from '../contract/composer-submission.ts';
import type { ConversationSettings } from '../../submission-settings.ts';
export { DEFAULT_BUSY_ENTER_BEHAVIOR } from '../../submission-settings.ts';
/**
 * Busy-Enter policy used by both the composer inject face and its Settings row.
 * Direct `steer` is intentionally best-effort: AgentLoop turns a closed-window
 * submission into the next waking Queue item.
 */
export declare class ComposerSubmissionPolicy {
    /** Reactive preference source for the Settings row. */
    readonly busyEnter: SnapshotStore<BusyEnterBehavior>;
    private readonly host;
    /**
     * @param host - durable preference scope owned by the providing plugin;
     * absent compositions stay process-local. The adoption subscription shares
     * the scope's plugin lifetime — a disposed scope never publishes again, so
     * the policy needs no release hook.
     */
    constructor(host?: SettingsScope<ConversationSettings>);
    /**
     * Resolve one keyboard gesture without changing state.
     * @param running - whether the addressed agent currently reports busy.
     * @param gesture - plain Enter or the Cmd/Ctrl-accelerated chord.
     * @param steeringAvailable - whether this session transport supports steering.
     * @returns Queue outside steer-capable busy state; otherwise the preferred mode or its opposite.
     */
    resolve(running: boolean, gesture: ComposerSubmitGesture, steeringAvailable: boolean): InputSubmitMode;
    /**
     * Change the plain-Enter behavior used during busy state; the live value
     * publishes before the durable write starts.
     * @param behavior - Queue or Steer.
     */
    setBusyEnter(behavior: BusyEnterBehavior): void;
    /**
     * Adopt the scope's accepted durable behavior without writing it back.
     * @param host - the constructor-narrowed scope driving this adoption.
     */
    private adopt;
}
//# sourceMappingURL=submission-policy.d.ts.map