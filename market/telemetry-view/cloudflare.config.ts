import { bindings, defineConfig } from "cf/config";

export default defineConfig({
	worker: {
		name: "dsh-market-telemetry-view",
		compatibilityDate: "2026-08-01",
		entrypoint: "src/index.js",
		observability: {
			enabled: true,
		},
		domains: [
			"tv.dsh-market.com",
		],
		env: {
			// Summary fetches must ride this binding: this worker runs inside the
			// market worker's invocation chain (forwarded for tv.dsh-market.com), and
			// a public fetch back to dsh-market.com would re-enter the same worker in
			// that chain, trip Cloudflare's loop protection, and fail as a 522 from
			// the custom-domain placeholder origin.
			MARKET: bindings.worker({
				worker: "dsh-market",
			}),
		},
	},
});
