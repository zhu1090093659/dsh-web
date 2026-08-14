/**
 * Agent-scoped dispatch and prompt assembly helpers. The fused dispatcher
 * {@link agentEvents} couples the agent subject to its scope carrier, so the
 * scope key and the payload's `agent` cannot diverge; repeat dispatchers (the
 * loop driver) build it once in the agent's constructor and reuse it.
 * @module @deepseek-ai/dsh-agent/dispatch
 */
import { scopeTarget } from '@deepseek-ai/dsh-scope';
/**
 * Build the fused scope carrier for one agent subject.
 *
 * The carrier is a stateless routing object. {@link agentEvents} accepts an
 * existing carrier, so callers that dispatch repeatedly for the same agent
 * (the loop driver) build it once in the agent's constructor and reuse it,
 * keeping hot-path dispatches allocation-free.
 * @param agent - the subject agent and scope key.
 * @returns the carrier passed as the event dispatcher `this` value.
 */
export function agentCarrier(agent) {
    return scopeTarget(agent, agent);
}
/**
 * Build a dispatcher that couples the agent subject to its scope carrier.
 * @param ctx - the context to dispatch through (any context of the app).
 * @param agent - the subject agent; also the scope-carrier key.
 * @param carrier - the scope carrier to dispatch through; defaults to
 * {@link agentCarrier} for the agent. Pass a constructor-built carrier to
 * avoid rebuilding it for every dispatch.
 * @returns the fused dispatcher.
 */
export function agentEvents(ctx, agent, carrier = agentCarrier(agent)) {
    // The ordinary dispatch methods forward through Cordis' variadic mixins. The
    // fused (carrier, name, payload, ...rest) tuple is provably a valid argument
    // list for the matching thisArg overload, but TypeScript cannot relate the
    // generic Tail<K> spread back to that overload's conditional parameter
    // tuple — hence one contained, shape-preserving cast per method.
    const fused = (payload) => 
    // The dispatcher owns the subject injection; callers pass PayloadRest, so
    // the fused record is exactly the declared payload. The spread comes
    // first, so a structurally acceptable payload that happens to carry an
    // `agent` field can never override the injected subject.
    ({ ...payload, agent });
    return {
        emit(name, payload) {
            // Cordis emit invokes callbacks through Array.map: one synchronous throw
            // starves later listeners, and returned promises are discarded. Agent
            // notifications are non-vetoing, so resolve the same filtered callback
            // set ourselves and contain both failure modes independently.
            const args = [carrier, name, fused(payload)];
            const callbacks = ctx.events.dispatch('emit', args);
            for (const callback of callbacks) {
                try {
                    const returned = callback(...args);
                    void Promise.resolve(returned).catch((error) => {
                        ctx.logger.warn(`agent event "${name}" listener rejected: ${String(error)}`);
                    });
                }
                catch (error) {
                    ctx.logger.warn(`agent event "${name}" listener threw: ${String(error)}`);
                }
            }
        },
        async serial(name, payload) {
            // oxlint-disable-next-line typescript/unbound-method -- the events mixin accessor returns a pre-bound function
            const serial = ctx.serial;
            return await serial(carrier, name, fused(payload));
        },
        waterfall(name, payload, ...rest) {
            // oxlint-disable-next-line typescript/unbound-method -- the events mixin accessor returns a pre-bound function
            const waterfall = ctx.waterfall;
            return waterfall(carrier, name, fused(payload), ...rest);
        },
    };
}
/**
 * Emit one contained agent notification without allocating a retained dispatcher.
 * @param ctx - the context to dispatch through.
 * @param agent - the subject agent and scope key.
 * @param name - the agent-subject event to emit.
 * @param payload - the event's payload fields; `agent` is injected.
 */
export function emitAgentEvent(ctx, agent, name, payload) {
    agentEvents(ctx, agent).emit(name, payload);
}
/**
 * Build the prompt assembly context with agent and scope set together, so
 * agent-scoped prompt and tool contributions cannot be silently omitted.
 * @param agent - the agent the assembly is for.
 * @param signal - the current turn's explicit control signal, when assembly belongs to a turn.
 * @returns the context to pass to `assemble()`.
 */
export function assembleContextFor(agent, signal) {
    return { agent, scope: agent, ...signal === undefined ? {} : { signal } };
}
//# sourceMappingURL=dispatch.js.map