/**
 * llm domain zod schemas (names derived from map keys: llmProvidersRequestSchema /
 * llmProvidersValueSchema / llmModelsRequestSchema / llmModelsValueSchema).
 */
import { z } from 'zod';
import { modelCatalogFailureSchema, modelProviderGroupSchema } from "./sessions.schema.js";
/** ConfigurableProviderView row of llm.providers. */
export const configurableProviderViewSchema = z.object({
    provider: z.string().min(1),
    displayName: z.string().min(1),
    settingsNs: z.string(),
    settingsPath: z.array(z.string()),
    active: z.boolean(),
    declared: z.boolean().optional(),
});
/** llm.providers request payload. */
export const llmProvidersRequestSchema = z.object({});
/** llm.providers response value. */
export const llmProvidersValueSchema = z.object({
    providers: z.array(configurableProviderViewSchema),
});
/** llm.models request payload. */
export const llmModelsRequestSchema = z.object({});
/** llm.models response value. */
export const llmModelsValueSchema = z.object({
    groups: z.array(modelProviderGroupSchema),
    failures: z.array(modelCatalogFailureSchema),
});
/** DiscoveredModelView row of llm.discoverModels. */
export const discoveredModelViewSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1).optional(),
    contextWindow: z.number().int().positive().optional(),
    maxTokens: z.number().int().positive().optional(),
});
/** llm.discoverModels request payload. */
export const llmDiscoverModelsRequestSchema = z.object({
    settingsNs: z.string().min(1),
    provider: z.string().min(1).optional(),
    baseURL: z.string().min(1).optional(),
    api: z.string().min(1).optional(),
    // Write-only at the host: used for this one interrogation, never stored and
    // never returned. It does ride the client's outgoing envelope like every
    // other secret-bearing payload (`credentials.set`, `settings.update`), which
    // `subscribeEnvelopes()` observers can see — redacting that tap is a
    // configuration-plane-wide change, not this method's to make alone.
    apiKey: z.string().min(1).optional(),
});
/** llm.discoverModels response value. */
export const llmDiscoverModelsValueSchema = z.object({
    models: z.array(discoveredModelViewSchema),
});
//# sourceMappingURL=llm.schema.js.map