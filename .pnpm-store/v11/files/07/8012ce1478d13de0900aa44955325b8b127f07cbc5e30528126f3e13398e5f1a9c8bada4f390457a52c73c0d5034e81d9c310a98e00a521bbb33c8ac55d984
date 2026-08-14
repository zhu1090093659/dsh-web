/**
 * llm domain zod schemas (names derived from map keys: llmProvidersRequestSchema /
 * llmProvidersValueSchema / llmModelsRequestSchema / llmModelsValueSchema).
 */
import { z } from 'zod';
/** ConfigurableProviderView row of llm.providers. */
export declare const configurableProviderViewSchema: z.ZodObject<{
    provider: z.ZodString;
    displayName: z.ZodString;
    settingsNs: z.ZodString;
    settingsPath: z.ZodArray<z.ZodString>;
    active: z.ZodBoolean;
    declared: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
/** llm.providers request payload. */
export declare const llmProvidersRequestSchema: z.ZodObject<{}, z.core.$strip>;
/** llm.providers response value. */
export declare const llmProvidersValueSchema: z.ZodObject<{
    providers: z.ZodArray<z.ZodObject<{
        provider: z.ZodString;
        displayName: z.ZodString;
        settingsNs: z.ZodString;
        settingsPath: z.ZodArray<z.ZodString>;
        active: z.ZodBoolean;
        declared: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** llm.models request payload. */
export declare const llmModelsRequestSchema: z.ZodObject<{}, z.core.$strip>;
/** llm.models response value. */
export declare const llmModelsValueSchema: z.ZodObject<{
    groups: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        models: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
            reasoning: z.ZodOptional<z.ZodObject<{
                efforts: z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    name: z.ZodString;
                    description: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>;
                defaultEffort: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    failures: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        message: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** DiscoveredModelView row of llm.discoverModels. */
export declare const discoveredModelViewSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
    contextWindow: z.ZodOptional<z.ZodNumber>;
    maxTokens: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
/** llm.discoverModels request payload. */
export declare const llmDiscoverModelsRequestSchema: z.ZodObject<{
    settingsNs: z.ZodString;
    provider: z.ZodOptional<z.ZodString>;
    baseURL: z.ZodOptional<z.ZodString>;
    api: z.ZodOptional<z.ZodString>;
    apiKey: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** llm.discoverModels response value. */
export declare const llmDiscoverModelsValueSchema: z.ZodObject<{
    models: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        contextWindow: z.ZodOptional<z.ZodNumber>;
        maxTokens: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
//# sourceMappingURL=llm.schema.d.ts.map