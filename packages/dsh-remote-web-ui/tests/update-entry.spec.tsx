// @vitest-environment jsdom
/** The update entry: trigger, check flow, auto-update, and outcome copy. */
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
    anchor: "@linxin666/dsh-web-ui-all",
    packages: [{ name: "@linxin666/dsh-web-ui-all", current: "0.1.10", latest: "0.1.10", outdated: false }],
    outdated: false,
  }
}

/** A status with a newer npm release. */
function outdatedStatus(): UpdateStatus {
  return {
    mode: "npm",
    profileName: "web",
    anchor: "@linxin666/dsh-web-ui-all",
    packages: [{ name: "@linxin666/dsh-web-ui-all", current: "0.1.10", latest: "0.1.11", outdated: true }],
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
  it("opens the panel and reports up to date", async () => {
    const { fetch } = mount(upToDateStatus())
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/update/status"))
    await waitFor(() => expect(screen.getByText('Everything is up to date')).toBeTruthy())
    expect(screen.getByText('@linxin666/dsh-web-ui-all')).toBeTruthy()
    // No update run for an up-to-date install.
    expect(fetch).not.toHaveBeenCalledWith("/api/update/run", expect.anything())
  })

  it("auto-runs the update when a newer release exists and reports done", async () => {
    const { fetch } = mount(outdatedStatus(), { ok: true, exitCode: 0, output: "Done" })
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/update/run', expect.objectContaining({ method: 'POST' })))
    await waitFor(() => expect(screen.getByText('Update complete')).toBeTruthy())
    expect(screen.getByText(/Restart dsh web/)).toBeTruthy()
  })

  it("shows the failure output when pnpm fails", async () => {
    const { fetch } = mount(outdatedStatus(), { ok: false, exitCode: 1, output: "ERR! failed", errorCode: "pnpm-failed" })
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/update/run', expect.anything()))
    await waitFor(() => expect(screen.getByText(/exited with code 1/)).toBeTruthy())
    expect(screen.getByText('ERR! failed')).toBeTruthy()
  })

  it("shows the dev-mode banner for link installs", async () => {
    const status: UpdateStatus = {
      mode: "link",
      anchor: "@linxin666/dsh-web-ui-all",
      packages: [{ name: "@linxin666/dsh-web-ui-all", current: "0.1.10", latest: "0.1.11", outdated: true }],
      outdated: true,
    }
    const { fetch } = mount(status)
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    await waitFor(() => expect(screen.getByText('Local development mode')).toBeTruthy())
    expect(fetch).not.toHaveBeenCalledWith("/api/update/run", expect.anything())
  })

  it("shows an error when the status probe fails", async () => {
    const fetch = vi.fn(async () => { throw new Error("network down") })
    vi.stubGlobal('fetch', fetch)
    render(<UpdateEntry wide={true} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    await waitFor(() => expect(screen.getByText('Cannot reach the update source')).toBeTruthy())
  })
})
