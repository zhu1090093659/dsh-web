import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client';
import { type CardActions, type CardShell, type FieldState } from './settings-form.ts';
export interface GatewaySettings {
    enabled?: boolean;
    port?: number;
    sessionTtlHours?: number;
}
interface State extends CardShell {
    enabled: FieldState;
    port: FieldState;
    sessionTtlHours: FieldState;
}
interface Face extends CardActions {
    hooks: {
        gatewaySettingsCard: SnapshotStore<State>;
    };
}
export declare class GatewaySettingsCardController {
    private readonly form;
    private readonly store;
    constructor(scope: SettingsScope<GatewaySettings>);
    inject(): Face;
}
type Props = PropsRuntime<'web-ui.plugin.item'> & PropsLocale<'web-auth-gateway'> & InjectFace<Face>;
export declare function GatewaySettingsCard(props: Props): import("react").JSX.Element;
export {};
//# sourceMappingURL=GatewaySettingsCard.d.ts.map