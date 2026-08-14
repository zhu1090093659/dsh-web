import type { Context } from '@deepseek-ai/cordis';
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { QueueAction, QueueItemId } from '../contract/queue.ts';
/** Queue operations injected by the session-scoped registration. */
export interface QueueDockInjected {
    updateQueue: (itemId: QueueItemId, action: QueueAction) => Promise<void>;
    notify: (level: 'info' | 'error', text: string) => void;
}
/** Full props of a dock entry: InputZone owner share + session standard kit + global seat + the locale seat. */
export type QueueDockProps = PropsRuntime<'conversation.input.dock'> & QueueDockInjected & PropsLocale<'conversation'>;
/**
 * Queue strip: one item renders directly; multiple items default to a
 * collapsible count header; an empty queue renders nothing.
 */
export declare function QueueDock({ useSession, updateQueue, notify, t }: QueueDockProps): import("react").JSX.Element | null;
/**
 * The dock entry as a plain registrant plugin. The conversation service is
 * the action contract; the slot declaration has an independent lifecycle boundary.
 */
export declare const queueDockEntry: {
    name: string;
    inject: string[];
    /**
     * Register the queue strip as the terminal input-dock entry (order 20).
     * @param ctx - registrant context (disposal rides ctx.effect inside slots.register).
     */
    apply(ctx: Context): void;
};
//# sourceMappingURL=QueueDock.d.ts.map