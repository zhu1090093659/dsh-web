import { bindings, defineConfig, exports, triggers } from "cf/config";

export default defineConfig({
	worker: {
		name: "dsh-market",
		compatibilityDate: "2026-08-01",
		entrypoint: "src/index.js",
		observability: {
			enabled: true,
		},
		assets: {
			// Static site assets (../dist, built and committed by scripts/market-build;
			// the directory lives in wrangler.config.ts because it is a Wrangler-only
			// key). runWorkerFirst keeps the API, the discovery document, the document
			// root and /app.js on the Worker instead of serving them from the asset
			// server.
			runWorkerFirst: [
				"/api/*",
				"/.well-known/*",
				"/",
				"/index.html",
				"/app.js",
			],
		},
		triggers: [
			// The wildcard ZONE ROUTE must carry the "/*" path part: a pattern without
			// a path component matches ONLY the root path, so every non-root request on
			// relay hosts fell through to the DNS origin (2026-09-02 phone 522 incident;
			// misread for hours as temporal edge flapping). Custom domains stay
			// dashboard-managed: any deploy declaring even one custom_domain route
			// PUT-replaces the worker's whole domain list, silently detaching
			// dashboard-created domains, so this config declares none (wrangler as of
			// 4.128 could not declare wildcard custom domains either). Current domains:
			// dsh-market.com + *.dsh-market.com (both custom domains).
			triggers.fetch({
				pattern: "*.dsh-market.com/*",
				zone: "dsh-market.com",
			}),
			// The scheduled handler (src/index.js) refreshes the badge cache, the daily
			// rollups and the summary cache on this tick, so the badge and the telemetry
			// panels never compute a full-table scan on the request path.
			triggers.scheduled({
				schedule: "*/30 * * * *",
			}),
		],
		// Relay bridge (src/relay-bridge.js): one Durable Object per relay instance,
		// named by idFromName(id), holding that instance's connector socket and piping
		// its HTTP/WS bytes. Additive -- no request reaches it until an instance's
		// lease row is flipped to mode 'bridge', and the quick path stays the default.
		// This "exports" key is Cloudflare's Durable Object class ledger (the wrangler
		// "migrations" array before the cf migration), unrelated to the D1 migrations
		// under migrations/. Moving the ledger here needs no data migration: the
		// already-provisioned RelayBridge namespace is kept in place.
		exports: {
			RelayBridge: exports.durableObject({ storage: "sqlite" }),
		},
		env: {
			// Relay control plane (src/relay-control.js) reads three secrets that are
			// never declared here: CF_API_TOKEN (Account: Cloudflare Tunnel, Edit; Zone:
			// DNS, Edit, on dsh-market.com only), CF_ACCOUNT_ID and CF_ZONE_ID. Without
			// all three the claim endpoint answers 503 cf-api-unconfigured and creates
			// nothing.
			//
			// RELAY_MODE is an optional plain variable and the deployment-wide switch.
			// Absent means "bridge": the hostname is served by the instance's own
			// Durable Object, which owns no object in the Cloudflare account, so a
			// claim costs zero account calls. That is the default because the tunnel
			// transports converge a tunnel, an ingress and a CNAME (four calls), and
			// the account allows 1200 calls per 300 seconds for every caller on it at
			// once. "quick" is the deployment-wide rollback to the Worker's
			// quick-tunnel proxy and "named" selects the named-tunnel transport; a
			// per-instance value recorded on the lease row (relay_leases.mode)
			// overrides either, so one instance flips with a single UPDATE.
			DB: bindings.d1({
				name: "dsh-market",
				id: "95f4e8ae-444a-46d0-98be-c367a9dbe6e8",
			}),
			// tv.dsh-market.com rides the wildcard routes above too, so the fetch entry
			// forwards that whole hostname to the telemetry-view dashboard worker via
			// the service binding here (/app.js is in runWorkerFirst for the same
			// reason: the dashboard's same-origin script must reach its worker).
			TELEMETRY_VIEW: bindings.worker({
				worker: "dsh-market-telemetry-view",
			}),
			RELAY_BRIDGE: bindings.durableObject({
				worker: "dsh-market",
				exportName: "RelayBridge",
			}),
			ASSETS: bindings.assets(),
		},
	},
});
