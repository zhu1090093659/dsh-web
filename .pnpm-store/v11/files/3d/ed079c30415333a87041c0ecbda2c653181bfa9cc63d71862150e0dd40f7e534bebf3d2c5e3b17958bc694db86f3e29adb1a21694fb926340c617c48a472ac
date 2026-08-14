import type { Context } from '@deepseek-ai/cordis';
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo/client';
export interface TodoPanelProps {
    /** The session's current plan (empty renders nothing) — selected by the dock adapter. */
    todos: readonly TodoItem[];
    /** The dock entry's locale seat, passed down as a plain prop. */
    t: TodoDockProps['t'];
}
export declare function TodoPanel({ todos, t }: TodoPanelProps): import("react").JSX.Element | null;
/** Full props of a dock entry: InputZone owner share + session standard kit + global seat + the locale seat. */
export type TodoDockProps = PropsRuntime<'conversation.input.dock'> & PropsLocale<'conversation'>;
/** Dock adapter: reads the host-computed 'todos' projection (whole list; absent or null renders nothing). */
export declare function TodoDock({ useProjection, t }: TodoDockProps): import("react").JSX.Element;
/**
 * The plan strip as a plain registrant plugin (QueueDock posture), following
 * the input-dock declaration across independent activation and reload.
 */
export declare const todoDockEntry: {
    name: string;
    inject: string[];
    /**
     * Register the plan strip before the goal and queue entries (order 0).
     * @param ctx - registrant context (disposal rides ctx.effect inside slots.register).
     */
    apply(ctx: Context): void;
};
//# sourceMappingURL=TodoPanel.d.ts.map