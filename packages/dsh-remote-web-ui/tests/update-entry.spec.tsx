// @vitest-environment jsdom
/** The update entry: trigger, check flow, the confirmed update (#507), and outcome copy. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { UpdateStatus } from '../src/update.ts'
import { UpdateEntry } from '../src/client/UpdateEntry.tsx'
import { en, type RemoteKey } from '../src/client/locales.ts'

// The npm SDK's client half is a closure-factory bundle (not importable
// under vitest); the ui-primitives icons used by the panel resolve through
// the platform module table, so stub the value import minimally.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconCloseOutline16: () => null,
  IconRefreshOutline16: () => null,
  IconDownloadOutline16: () => null,
}))

// English dictionary translate stub with {param} interpolation.
const t = (key: RemoteKey, params?: Record<string, string | number>): string => {
  let text = (en as Record<string, string>)[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}

/** The standard npm-mode up-to-date status. */
function upToDateStatus(): UpdateStatus {
  return {
    mode: "npm",
    profileName: "web",
    anchor: "@linxin666/dsh-web-all",
    packages: [{ name: "@linxin666/dsh-web-all", current: "0.1.10", latest: "0.1.10", outdated: false }],
    outdated: false,
  }
}

/** A status with a newer npm release. */
function outdatedStatus(): UpdateStatus {
  return {
    mode: "npm",
    profileName: "web",
    anchor: "@linxin666/dsh-web-all",
    packages: [{ name: "@linxin666/dsh-web-all", current: "0.1.10", latest: "0.1.11", outdated: true }],
    outdated: true,
  }
}

/** fetch stub answering the update endpoints. */
function mockFetch(status: UpdateStatus, runResult?: { ok: boolean; exitCode?: number | null; output?: string; errorCode?: string }) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === "/api/update/status") {
      return new Response(JSON.stringify(status), { status: 200, headers: { "content-type": "application/json" } })
    }
    if (url === "/api/update/run") {
      return new Response(JSON.stringify(runResult ?? { ok: true, exitCode: 0, output: "" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    return new Response("not found", { status: 404 })
  })
}

function deferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined
  return {
    promise: new Promise<T>((resolve) => { resolvePromise = resolve }),
    resolve(value: T): void { resolvePromise?.(value) },
  }
}

function mount(status: UpdateStatus, runResult?: { ok: boolean; exitCode?: number | null; output?: string; errorCode?: string }) {
  const fetch = mockFetch(status, runResult)
  vi.stubGlobal('fetch', fetch)
  const view = render(<UpdateEntry wide={true} t={t} />)
  return { fetch, view }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("UpdateEntry", () => {
  it("marks the trigger when the background probe finds a newer release", async () => {
    const { fetch } = mount(outdatedStatus())

    await waitFor(() => {
      const trigger = screen.getByRole('button', { name: 'New version available. Check for updates' })
      expect(trigger.getAttribute('data-update-available')).toBe('true')
      expect(trigger.getAttribute('title')).toBe('New version available. Check for updates')
    })
    expect(fetch).toHaveBeenCalledWith('/api/update/status')
    expect(fetch).not.toHaveBeenCalledWith('/api/update/run', expect.anything())
  })

  it("keeps the trigger unmarked when the background probe finds no update", async () => {
    const { fetch } = mount(upToDateStatus())

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/update/status'))
    const trigger = screen.getByRole('button', { name: /Check for updates$/ })
    expect(trigger.getAttribute('data-update-available')).toBeNull()
  })

  it("opens the panel and reports up to date", async () => {
    const { fetch } = mount(upToDateStatus())
    const trigger = screen.getByRole('button', { name: /Check for updates$/ })
    fireEvent.click(trigger)
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/update/status"))
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    await waitFor(() => expect(screen.getByText('Everything is up to date')).toBeTruthy())
    expect(screen.getByText('@linxin666/dsh-web-all')).toBeTruthy()
    // No update run for an up-to-date install.
    expect(fetch).not.toHaveBeenCalledWith("/api/update/run", expect.anything())
  })

  it("shows release-note sections and keeps component versions collapsible", async () => {
    const status: UpdateStatus = {
      ...outdatedStatus(),
      notes: {
        version: "0.1.11",
        features: ["Add a new catalog page"],
        fixes: ["Fix policy sync"],
        other: ["Update documentation"],
      },
    }
    mount(status)
    fireEvent.click(screen.getByRole('button', { name: /Check for updates$/ }))
    await waitFor(() => expect(screen.getByText('v0.1.11 release notes')).toBeTruthy())
    expect(screen.getByText('New Features')).toBeTruthy()
    expect(screen.getByText('Bug Fixes')).toBeTruthy()
    expect(screen.getByText('Other Changes')).toBeTruthy()
    expect(screen.getByText('Add a new catalog page')).toBeTruthy()
    expect(screen.getByText('Fix policy sync')).toBeTruthy()
    expect(screen.getByText('Update documentation')).toBeTruthy()
    expect(screen.getByText('View component versions')).toBeTruthy()
  })

  it("never starts the update from the check alone and runs it on confirmation (#507)", async () => {
    const { fetch } = mount(outdatedStatus(), { ok: true, exitCode: 0, output: "Done" })
    fireEvent.click(screen.getByRole('button', { name: /Check for updates$/ }))
    // The result view shows the new version and waits; no run is triggered.
    await waitFor(() => expect(screen.getByText('A new version is available')).toBeTruthy())
    expect(fetch).not.toHaveBeenCalledWith('/api/update/run', expect.anything())
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/update/run', expect.objectContaining({ method: 'POST' })))
    await waitFor(() => expect(screen.getByText('Update complete')).toBeTruthy())
    expect(screen.getByText(/Restart dsh web/)).toBeTruthy()
  })

  it("clears the indicator when a closed panel's update succeeds", async () => {
    const update = deferred<Response>()
    const fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/update/status') {
        return Promise.resolve(new Response(JSON.stringify(outdatedStatus()), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      if (url === '/api/update/run') return update.promise
      return Promise.resolve(new Response('not found', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetch)
    render(<UpdateEntry wide={true} t={t} />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'New version available. Check for updates' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Check for updates$/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Update now' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/update/run', expect.objectContaining({ method: 'POST' })))
    fireEvent.click(screen.getByRole('button', { name: 'Close update panel' }))
    update.resolve(new Response(JSON.stringify({ ok: true, exitCode: 0, output: '' }), { status: 200, headers: { 'content-type': 'application/json' } }))

    await waitFor(() => {
      const trigger = screen.getByRole('button', { name: 'Check for updates' })
      expect(trigger.getAttribute('data-update-available')).toBeNull()
    })
  })

  it("shows the failure output when pnpm fails", async () => {
    const { fetch } = mount(outdatedStatus(), { ok: false, exitCode: 1, output: "ERR! failed", errorCode: "pnpm-failed" })
    fireEvent.click(screen.getByRole('button', { name: /Check for updates$/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Update now' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/update/run', expect.anything()))
    await waitFor(() => expect(screen.getByText(/exited with code 1/)).toBeTruthy())
    expect(screen.getByText('ERR! failed')).toBeTruthy()
  })

  it("shows the dev-mode banner for link installs", async () => {
    const status: UpdateStatus = {
      mode: "link",
      anchor: "@linxin666/dsh-web-all",
      packages: [{ name: "@linxin666/dsh-web-all", current: "0.1.10", latest: "0.1.11", outdated: true }],
      outdated: true,
    }
    const { fetch } = mount(status)
    fireEvent.click(screen.getByRole('button', { name: /Check for updates$/ }))
    await waitFor(() => expect(screen.getByText('Local development mode')).toBeTruthy())
    expect(fetch).not.toHaveBeenCalledWith("/api/update/run", expect.anything())
  })

  it("shows an error when the status probe fails", async () => {
    const fetch = vi.fn(async () => { throw new Error("network down") })
    vi.stubGlobal('fetch', fetch)
    render(<UpdateEntry wide={true} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /Check for updates$/ }))
    await waitFor(() => expect(screen.getByText('Cannot reach the update source')).toBeTruthy())
  })

  it("explains the stale-host case when the update route is missing", async () => {
    // 404 = the host process runs an older plugin build without the update
    // routes; the panel must not blame the network.
    const fetch = vi.fn(async () => new Response("not found", { status: 404 }))
    vi.stubGlobal('fetch', fetch)
    render(<UpdateEntry wide={true} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /Check for updates$/ }))
    await waitFor(() => expect(screen.getByText('The update service is not loaded')).toBeTruthy())
    expect(screen.getByText(/restart dsh web/)).toBeTruthy()
    expect(screen.queryByText('Cannot reach the update source')).toBeNull()
  })
})
