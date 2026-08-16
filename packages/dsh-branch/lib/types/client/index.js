import { BranchApi } from "./api.js";
import { startBranchInjection } from "./inject.js";
import { en, zh } from "./locales.js";
const NS = 'branch';
export const inject = ['sessions', 'locale'];
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-branch: dictionaries');
    const t = ctx.locale.bind(NS);
    const api = new BranchApi();
    ctx.effect(() => startBranchInjection(ctx, api, t, () => ctx.sessions.list.getSnapshot().current, (id) => ctx.sessions.list.getSnapshot().byId[id]?.cwd), 'dsh-branch: trajectory row injection');
}
