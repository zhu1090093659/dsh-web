import { L as VERSION, r as defineConfig, t as ConfigExport } from "./shared/define-config-BhJ90aEv.mjs";

//#region src/utils/load-config.d.ts
type ConfigLoader = "bundle" | "native";
interface LoadConfigOptions {
  /**
  * How to load the config file.
  * - `'bundle'` (default): bundle the config with Rolldown, then import it.
  * - `'native'`: import the config directly, delegating TypeScript/loader
  *   handling to the runtime. Faster, but requires runtime support.
  *
  * @default 'bundle'
  */
  configLoader?: ConfigLoader;
}
/**
* Load config from a file in a way that Rolldown does.
*
* @param configPath The path to the config file. If empty, it will look for `rolldown.config` with supported extensions in the current working directory.
* @param options Loading options. `configLoader` selects `'bundle'` (default) or `'native'`.
* @returns The loaded config export
*
* @category Config
*/
declare function loadConfig(configPath: string, options?: LoadConfigOptions): Promise<ConfigExport>;
//#endregion
export { VERSION, defineConfig, loadConfig };