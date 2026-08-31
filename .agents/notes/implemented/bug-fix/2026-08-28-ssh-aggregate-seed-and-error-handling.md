# Agent Note: Restore dsh-ssh default enablement in dsh-web-all and enhance 404 error handling

Status: implemented

## Problem

After upgrading @linxin666/dsh-web-all to 0.3.6, existing users with configured SSH hosts encountered HTTP 404: invalid JSON response when operating the SSH panel (Issue #1250):
1. 0.3.6 aggregate bundle seeded web-ui-ssh: enabled: false in ggregate.yml. Existing users who configured hosts in 0.3.5 never needed to touch the settings switch, so their settings.yaml had no override for the seed, causing the host routes to skip registration after upgrading.
2. When the host route returned 404 plain text, client eadJson failed JSON parsing and threw the misleading invalid JSON response error.

## Decision

- **Remove aggregate disabled seed**: Removed patches: - {id: web-ui-ssh, config: {enabled: false}} from packages/dsh-web-all/aggregate.yml, restoring the standard default-enabled behavior, and regenerated cordis.patch.yml via scripts/aggregate.mjs.
- **Protect legacy users with existing hosts**: In packages/dsh-ssh/src/index.ts, when the resolved initial config is enabled: false without bound explicit user settings but local ~/.dsh/dsh-ssh.json already contains active host records, keep the plugin enabled.
- **Graceful client-side 404 error handling**: In packages/dsh-ssh/src/client/api.ts eadJson, translate HTTP 404 into localized friendly guidance (The SSH plugin is disabled on the host. Please enable it in Settings → Web Plugins → SSH.), eliminating the confusing raw JSON parse failure.

## Alternatives considered

- **Client-only error hint**: Rejected — forcing existing users to manually navigate to settings and toggle the switch creates friction.

## Consequences

Upgrading users retain full SSH functionality with zero manual actions required. If a user explicitly disables SSH in settings, the client panel presents clear instructions on how to re-enable it.
