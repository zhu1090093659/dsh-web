/** PWA registration for the standalone /m mobile surface. */
export const MOBILE_PWA_SCOPE = '/m/'
export const MOBILE_SERVICE_WORKER_URL = '/m/service-worker.js'

/** Register the mobile shell worker when the current browser supports it. */
export async function registerMobilePwa(
  serviceWorker: Pick<ServiceWorkerContainer, 'register'> | undefined = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker,
): Promise<void> {
  if (serviceWorker === undefined) return

  try {
    await serviceWorker.register(MOBILE_SERVICE_WORKER_URL, {
      scope: MOBILE_PWA_SCOPE,
      updateViaCache: 'none',
    })
  } catch {
    // HTTP LAN origins cannot register workers; the online mobile UI still works.
  }
}
