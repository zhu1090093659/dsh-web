import { defineWranglerConfig } from "wrangler/experimental-config";

// Keys Wrangler owns that cloudflare.config.ts has no equivalent for. cf
// delegates the build to Wrangler (bundler=wrangler), so the static asset
// directory lives here; the rest of the Worker is declared next door.
export default defineWranglerConfig({
	assetsDirectory: "../dist",
});
