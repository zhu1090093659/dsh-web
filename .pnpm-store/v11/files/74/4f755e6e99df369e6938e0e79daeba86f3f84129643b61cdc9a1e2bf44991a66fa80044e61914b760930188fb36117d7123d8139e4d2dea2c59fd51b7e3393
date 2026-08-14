/** Canonical tool-definition fixtures for repository tests. @module dsh-tools/testing */
import { defineTool } from "./schema.js";
const CONTENT_VALUE_SCHEMA = { type: 'array', items: { type: 'json' } };
/**
 * Define a test fixture that deliberately uses its content blocks as the
 * canonical JSON value. Product tools must declare domain-owned DTOs instead.
 * @param options - ordinary fixture fields plus a content-producing body.
 * @returns a registry-ready tool with an explicit JSON-array output contract.
 * @internal
 */
export function defineContentToolFixture(options) {
    // oxlint-disable-next-line typescript/unbound-method
    const execute = options.execute;
    return defineTool({
        ...options,
        output: {
            schema: CONTENT_VALUE_SCHEMA,
            render: (_args, value) => value,
        },
        async execute(args, exec) {
            return await execute(args, exec);
        },
    });
}
//# sourceMappingURL=testing.js.map