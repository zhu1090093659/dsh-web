/**
 * Structural secret redaction for settings values. `role('secret')` fields are
 * removed from a value before it crosses a wire boundary; a sidecar records
 * each schema-declared secret position and whether it currently holds a value,
 * so a configuration surface can render a write-only input without ever
 * receiving the secret itself.
 * @module @deepseek-ai/dsh-settings/redact
 */
/** Whether a value is a plain data object the walker may recurse into. */
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function walk(node, value, path, secrets) {
    if (node === undefined)
        return value;
    if (node.meta?.role === 'secret') {
        secrets.push({ path, set: value !== undefined });
        return undefined;
    }
    switch (node.type) {
        case 'object': {
            const properties = node.dict ?? {};
            const source = isRecord(value) ? value : undefined;
            const rebuilt = {};
            if (source !== undefined) {
                for (const [key, entry] of Object.entries(source)) {
                    if (key in properties)
                        continue;
                    rebuilt[key] = entry;
                }
            }
            for (const [key, child] of Object.entries(properties)) {
                const stripped = walk(child, source?.[key], [...path, key], secrets);
                if (stripped !== undefined)
                    rebuilt[key] = stripped;
            }
            return source === undefined && Object.keys(rebuilt).length === 0 ? value : rebuilt;
        }
        case 'dict': {
            if (!isRecord(value))
                return value;
            const rebuilt = {};
            for (const [key, entry] of Object.entries(value)) {
                const stripped = walk(node.inner, entry, [...path, key], secrets);
                if (stripped !== undefined)
                    rebuilt[key] = stripped;
            }
            return rebuilt;
        }
        case 'array': {
            if (!Array.isArray(value))
                return value;
            return value.map((entry, index) => walk(node.inner, entry, [...path, String(index)], secrets));
        }
        default:
            // TODO(settings-wire-redaction): Fail closed instead — a secret reachable
            // only through a union, intersection, or transform is returned verbatim
            // here, with nothing recording that it was missed.
            return value;
    }
}
/**
 * Remove every `role('secret')` field a schema declares from a value. The
 * walker follows `object`, `dict`, and `array` containers; a secret must be
 * declared directly on a field reachable through those containers (a secret
 * buried inside a union branch or transform is not reachable and must not be
 * modeled that way). The input is never mutated.
 * @param schema - live schemastery schema describing the value.
 * @param value - the value to strip; `undefined` yields an empty record with
 *   object-property secret slots still enumerated.
 * @returns the stripped detached value and the ordered secret positions.
 */
export function redactSecrets(schema, value) {
    const secrets = [];
    const stripped = walk(schema, value, [], secrets);
    return { value: stripped, secrets };
}
//# sourceMappingURL=redact.js.map