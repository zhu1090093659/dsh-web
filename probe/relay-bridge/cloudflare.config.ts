import { bindings, defineConfig, exports } from "cf/config";

export default defineConfig({
	worker: {
		name: "dsh-relay-bridge-probe",
		compatibilityDate: "2026-08-18",
		entrypoint: "src/probe.ts",
		observability: {
			enabled: true,
		},
		env: {
			PROBE_INSTANCE: bindings.text("shadow-1"),
			BRIDGE: bindings.durableObject({
				worker: "dsh-relay-bridge-probe",
				exportName: "RelayBridge",
			}),
		},
		// The wrangler "migrations" array is the same Durable Object class ledger,
		// declared here as the class's export lifecycle: RelayBridge keeps its
		// SQLite storage. No data migration is involved in this translation.
		exports: {
			RelayBridge: exports.durableObject({ storage: "sqlite" }),
		},
	},
});
