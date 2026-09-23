/**
 * The repository root is a thin alias bundle over the published npm aggregate:
 * its patch is the aggregate's generated manifest, while every module the rows
 * reference resolves from the `@linxin666/dsh-web-all` dependency. That
 * dependency must name one exact released version — the version whose package
 * exports match the patch rows in the same commit. A range admits any version
 * in it, so an install that keeps an older lockfile entry mounts rows whose
 * subpaths the installed aggregate does not export: Node throws
 * ERR_PACKAGE_PATH_NOT_EXPORTED for every row and the plugin tree fails to
 * load (issue #1442).
 */

/** The aggregate dependency the root alias resolves every row's modules from. */
export const ROOT_AGGREGATE_DEPENDENCY = '@linxin666/dsh-web-all'

/**
 * Check the root alias dependency against the release tag.
 * @param {unknown} rootManifest - parsed repository root package.json.
 * @param {string} version - release tag version, without the leading v.
 * @returns {string | undefined} the mismatch message, or undefined when the
 *   root pins exactly the tag version.
 */
export function rootAggregatePinMismatch(rootManifest, version) {
  const record = (value) => value !== null && typeof value === 'object' ? value : undefined
  const dependencies = record(rootManifest)?.dependencies
  const spec = record(dependencies)?.[ROOT_AGGREGATE_DEPENDENCY]
  if (spec === version) return undefined
  return `root dependency ${ROOT_AGGREGATE_DEPENDENCY} ${typeof spec === 'string' ? spec : '(missing)'} does not match tag v${version}`
}
