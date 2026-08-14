/** Host BFF entry and Loader shell for the Remote contribution assembly. */
import { API_REMOTE_FORWARDED_EVENTS } from "./remote-events.js";
export { ApiRemoteSessionNotFound, ApiRemoteSubagentSessionOwnership, apiRemoteSubagentOwnershipError, createApiRemoteAgentResolver, hasApiRemoteSubagentOwner, inspectApiRemoteSession, } from "./agent-lookup.js";
export { API_REMOTE_FORWARDED_EVENTS } from "./remote-events.js";
// Shape gate over the allowlist, kept in the Host face because the Host's event
// vocabulary is the authoritative one. It pins three things at compile time:
// every entry NAMES a declared event (the predicate is keyed on `keyof
// Events`), no entry BINDS a Scope (a scoped event's `ThisParameterType` is not
// `unknown`, which is how "must not depend on AgentScope" is stated statically),
// and every entry is ONE-WAY (a waterfall or bail shape returns something other
// than void and is excluded). Widening the array to an event that fails any of
// these fails here, not on the wire.
API_REMOTE_FORWARDED_EVENTS;
/** Host plugin body; the selected contributions mount only in Client environments. */
export function apply() { }
//# sourceMappingURL=index.js.map