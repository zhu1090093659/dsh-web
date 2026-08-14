import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { BusyEnterBehavior } from '../contract/composer-submission.ts';
/** Registration-side preference face. */
export interface EnterBehaviorRowInjected {
    hooks: {
        /** Persisted busy-state preference bound as useBusyEnter. */
        busyEnter: SnapshotStore<BusyEnterBehavior>;
    };
    /** Change the busy-state plain-Enter behavior. */
    setBusyEnter: (behavior: BusyEnterBehavior) => void;
}
/** Full Settings-row props. */
export type EnterBehaviorRowProps = PropsRuntime<'settings.general.item'> & PropsLocale<'conversation'> & InjectFace<EnterBehaviorRowInjected>;
/**
 * Render the busy-state Enter behavior selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export declare function EnterBehaviorRow({ useBusyEnter, setBusyEnter, t }: EnterBehaviorRowProps): import("react").JSX.Element;
//# sourceMappingURL=EnterBehaviorRow.d.ts.map