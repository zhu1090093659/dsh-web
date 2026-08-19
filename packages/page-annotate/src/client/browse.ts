/** Browser-mode sandbox policy helpers. */

const BASE_SANDBOX = 'allow-scripts allow-forms allow-popups allow-downloads allow-modals allow-popups-to-escape-sandbox'

/**
 * Keep cookies/storage for remote pages, but never combine script and
 * same-origin privileges when embedding the DSH shell's own origin.
 */
export function iframeSandboxForUrl(url: string, shellOrigin: string): string {
  try {
    return new URL(url).origin === shellOrigin ? BASE_SANDBOX : `allow-same-origin ${BASE_SANDBOX}`
  } catch {
    return BASE_SANDBOX
  }
}
