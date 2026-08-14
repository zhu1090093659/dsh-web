/**
 * The durable subagent-child descriptor: the versioned, model-hidden
 * `subagent/descriptor` session event that identifies every session-backed
 * subagent and records whether it is one-shot or continuable. Continuable
 * descriptors additionally preserve the declared composition required for
 * cold resume. Providers append it turn-enclosed in the child's initial turn.
 *
 * The descriptor deliberately snapshots explicit fields rather than the
 * merge-extensible `AgentOptions` object: an unrelated extension value cannot
 * make continuation fail merely because it is not JSON, and later composition
 * inputs require a deliberate {@link SUBAGENT_DESCRIPTOR_VERSION} change. It
 * omits `subagentDepth` — cold resume trusts the persisted header's
 * `delegationDepth` as the monotone floor — and `outputSchema`, which belongs
 * to one activation's result contract rather than durable child composition.
 * Per-activation knobs such as `maxTokens` are omitted for the same reason as
 * `outputSchema`: they budget one activation. Cold resume requires the exact
 * live parent for authorization but reconstructs child options only from the
 * durable descriptor, so it neither restores the prior budget nor inherits
 * the parent's current one; the resumed route's defaults apply instead.
 *
 * @module @deepseek-ai/dsh-subagent/descriptor
 */
import { snapshotJsonValue } from '@deepseek-ai/dsh-session';
/**
 * The current descriptor format version, stamped into every appended
 * `subagent/descriptor` event and required verbatim by {@link foldSubagentDescriptor}.
 * Supporting another composition input is a deliberate version change, never
 * an implicit extra field.
 */
export const SUBAGENT_DESCRIPTOR_VERSION = 2;
const DESCRIPTOR_BASE_KEYS = [
    'version',
    'mode',
    'provider',
    'label',
];
const ONE_SHOT_DESCRIPTOR_KEYS = new Set(DESCRIPTOR_BASE_KEYS);
const CONTINUABLE_DESCRIPTOR_KEYS = new Set([
    ...DESCRIPTOR_BASE_KEYS,
    'agentProvider',
    'agentModel',
    'persona',
    'toolFilter',
]);
const TOOL_FILTER_KEYS = new Set(['allow', 'deny']);
/** Whether a persisted JSON value is an object record. */
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Reject fields outside one versioned record's declared schema. */
function assertKnownKeys(value, keys, path) {
    const unknown = Object.keys(value).find(key => !keys.has(key));
    if (unknown !== undefined) {
        throw new Error(`persisted subagent descriptor ${path} has unknown field "${unknown}"`);
    }
}
/** Read one optional string field from a persisted descriptor record. */
function optionalString(value, key) {
    if (!Object.hasOwn(value, key))
        return undefined;
    const field = value[key];
    if (typeof field !== 'string') {
        throw new Error(`persisted subagent descriptor ${key} must be a string`);
    }
    return field;
}
/** Read one optional string-array field from a persisted tool restriction. */
function optionalStringArray(value, key) {
    if (!Object.hasOwn(value, key))
        return undefined;
    const field = value[key];
    if (!Array.isArray(field)) {
        throw new Error(`persisted subagent descriptor toolFilter.${key} must be an array of strings`);
    }
    const items = field;
    if (items.some(item => typeof item !== 'string')) {
        throw new Error(`persisted subagent descriptor toolFilter.${key} must be an array of strings`);
    }
    return items;
}
/** Validate and reconstruct a persisted tool restriction. */
function parseToolFilter(value) {
    if (!isRecord(value)) {
        throw new Error('persisted subagent descriptor toolFilter must be an object');
    }
    assertKnownKeys(value, TOOL_FILTER_KEYS, 'toolFilter');
    const allow = optionalStringArray(value, 'allow');
    const deny = optionalStringArray(value, 'deny');
    if (allow === undefined && deny === undefined) {
        throw new Error('persisted subagent descriptor toolFilter must declare allow and/or deny');
    }
    return {
        ...allow !== undefined ? { allow } : {},
        ...deny !== undefined ? { deny } : {},
    };
}
/** Validate one persisted descriptor payload for the current runtime. */
function parseSubagentDescriptor(value) {
    if (!isRecord(value)) {
        throw new Error('persisted subagent descriptor payload must be an object');
    }
    const version = value['version'];
    if (typeof version !== 'number') {
        throw new Error('persisted subagent descriptor version must be a number');
    }
    if (version !== SUBAGENT_DESCRIPTOR_VERSION)
        return undefined;
    const mode = value['mode'];
    if (mode !== 'one-shot' && mode !== 'continuable') {
        throw new Error('persisted subagent descriptor mode must be "one-shot" or "continuable"');
    }
    assertKnownKeys(value, mode === 'one-shot' ? ONE_SHOT_DESCRIPTOR_KEYS : CONTINUABLE_DESCRIPTOR_KEYS, 'payload');
    const provider = value['provider'];
    if (typeof provider !== 'string') {
        throw new Error('persisted subagent descriptor provider must be a string');
    }
    if (mode === 'one-shot') {
        const label = optionalString(value, 'label');
        return {
            version: SUBAGENT_DESCRIPTOR_VERSION,
            mode,
            provider,
            ...label !== undefined ? { label } : {},
        };
    }
    const label = value['label'];
    if (typeof label !== 'string') {
        throw new Error('persisted subagent descriptor label must be a string');
    }
    const agentProvider = optionalString(value, 'agentProvider');
    const agentModel = optionalString(value, 'agentModel');
    const persona = optionalString(value, 'persona');
    const toolFilter = Object.hasOwn(value, 'toolFilter')
        ? parseToolFilter(value['toolFilter'])
        : undefined;
    return {
        version: SUBAGENT_DESCRIPTOR_VERSION,
        mode,
        provider,
        label,
        ...agentProvider !== undefined ? { agentProvider } : {},
        ...agentModel !== undefined ? { agentModel } : {},
        ...persona !== undefined ? { persona } : {},
        ...toolFilter !== undefined ? { toolFilter } : {},
    };
}
export function snapshotSubagentDescriptor(input) {
    const candidate = input.mode === 'one-shot'
        ? {
            version: SUBAGENT_DESCRIPTOR_VERSION,
            mode: input.mode,
            provider: input.provider,
            ...input.label !== undefined ? { label: input.label } : {},
        }
        : {
            version: SUBAGENT_DESCRIPTOR_VERSION,
            mode: input.mode,
            provider: input.provider,
            label: input.label,
            ...input.agentProvider !== undefined ? { agentProvider: input.agentProvider } : {},
            ...input.agentModel !== undefined ? { agentModel: input.agentModel } : {},
            ...input.persona !== undefined ? { persona: input.persona } : {},
            ...input.toolFilter !== undefined ? { toolFilter: input.toolFilter } : {},
        };
    const snapshot = snapshotJsonValue(candidate);
    if (snapshot === undefined) {
        throw new Error('subagent descriptor is not losslessly JSON-serializable');
    }
    return snapshot;
}
/**
 * Fold a persisted child log to its supported descriptor. The first
 * `subagent/descriptor` event is authoritative — the establishing provider
 * appends exactly one, so a later same-type event cannot rewrite the declared
 * composition.
 * @param events - the loaded child session events.
 * @returns the descriptor, or `undefined` when the log has none or its
 *   version is not {@link SUBAGENT_DESCRIPTOR_VERSION} (the child cannot be
 *   classified by this runtime).
 * @throws when a current-version persisted payload does not match its complete
 *   declared schema.
 */
export function foldSubagentDescriptor(events) {
    const event = events.find((candidate) => candidate.type === 'subagent/descriptor');
    if (event === undefined)
        return undefined;
    return parseSubagentDescriptor(event.data);
}
//# sourceMappingURL=descriptor.js.map