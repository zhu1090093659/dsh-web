import type { Context } from '@deepseek-ai/cordis';
import z from 'schemastery';
export declare const name = "web-auth-gateway";
export declare const inject: string[];
export declare const WEB_AUTH_GATEWAY_SETTINGS_NAMESPACE: import("@deepseek-ai/dsh-settings").SettingsNamespace;
export interface Config {
    enabled?: boolean;
    port?: number;
    sessionTtlHours?: number;
}
export declare const Config: z<Config>;
export declare function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=index.d.ts.map