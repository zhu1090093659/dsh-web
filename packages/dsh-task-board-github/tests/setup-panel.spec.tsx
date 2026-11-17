// @vitest-environment jsdom
/**
 * The integration block of the settings card, as the operator drives it: the
 * credential line, the token paste, the repository list, and the connection
 * test. Every case renders the real component against a setup API double and
 * asserts what the Host would have been asked to store.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GitHubProxyStatus as GitHubProxySummary, GitHubSetupSummary } from '../src/core/setup.ts'
import type { GitHubRepoConfig } from '../src/core/types.ts'
import { GitHubSetupPanel } from '../src/client/SetupPanel.tsx'
import type { GitHubSetupApi } from '../src/client/setup-api.ts'
import { t, zh } from '../src/client/locales.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

beforeEach(() => { document.documentElement.lang = 'zh' })

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => { root.unmount() })
  }
  document.body.replaceChildren()
})

/**
 * The proxy the host would report for one stored pair.
 *
 * It models the documented precedence: `direct` resolves to nothing, `custom`
 * to the URL it was given, and `auto` to the local system proxy this machine
 * happens to have (a fixed value, so the case is about the rendering rather
 * than about whatever proxy the test runner has).
 */
function resolveProxy(mode: GitHubProxySummary['mode'], url: string): GitHubProxySummary {
  if (mode === 'direct') return { mode, url }
  if (mode === 'custom' && url !== '') {
    const dialed = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : 'http://' + url
    return { mode, url, effective: dialed, source: 'custom' }
  }
  return { mode, url, effective: 'http://127.0.0.1:7890', source: 'system' }
}

/** The setup API double: an in-memory configuration recording every call. */
function apiDouble(initial: GitHubRepoConfig[] = []) {
  const calls: string[] = []
  let repositories = [...initial]
  let credential: GitHubSetupSummary['credential'] = { configured: false, writable: true, envName: 'GITHUB_TOKEN' }
  let proxy: GitHubSetupSummary['proxy'] = { mode: 'auto', url: '' }
  const api: GitHubSetupApi = {
    status: async () => { calls.push('status'); return { credential, repositories: [...repositories], running: true, settingsWritable: true, proxy } },
    test: async () => {
      calls.push('test')
      return {
        ok: true,
        login: 'octocat',
        credential,
        checks: [{ owner: 'deepseek-ai', repository: 'dsh-web', ok: true, message: '3 open issues carry the "dsh" label' }],
      }
    },
    setCredential: async (token) => {
      calls.push('setCredential ' + token)
      credential = { configured: true, writable: true, envName: 'GITHUB_TOKEN', source: 'store' }
      return { credential, repositories: [...repositories], running: true, settingsWritable: true, proxy }
    },
    clearCredential: async () => {
      calls.push('clearCredential')
      credential = { configured: false, writable: true, envName: 'GITHUB_TOKEN' }
      return { credential, repositories: [...repositories], running: true, settingsWritable: true, proxy }
    },
    listRepositories: async () => [...repositories],
    writeRepositories: async (value) => {
      calls.push('writeRepositories')
      repositories = [...value]
      return repositories
    },
    setProxy: async (value) => {
      calls.push('setProxy ' + value.mode + ' ' + value.url)
      proxy = resolveProxy(value.mode, value.url)
      return { credential, repositories: [...repositories], running: true, settingsWritable: true, proxy }
    },
  }
  return { api, calls, list: () => repositories, proxy: () => proxy, setProxyState: (next: GitHubSetupSummary['proxy']) => { proxy = next } }
}

/** Render the panel and let its first status read settle. */
async function renderPanel(api: GitHubSetupApi): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => { root.render(<GitHubSetupPanel t={t} api={api} />) })
  return container
}

/** Type into one input the way a browser does (React reads the native setter). */
function type(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** Find one button by its visible copy. */
function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find(candidate => candidate.textContent === text)
  if (found === undefined) throw new Error('button not found: ' + text)
  return found
}

/** The repository disclosure, in whichever state it currently reads. */
function repositoriesToggle(container: HTMLElement): HTMLButtonElement {
  const found = container.querySelector('[data-dsh-part="github-repositories"] button[aria-expanded]')
  if (found === null) throw new Error('the repository disclosure did not render')
  return found as HTMLButtonElement
}

/** The region the disclosure controls, or null while it is collapsed. */
function repositoriesRegion(container: HTMLElement): HTMLElement | null {
  const id = repositoriesToggle(container).getAttribute('aria-controls')
  if (id === null) throw new Error('the toggle names no controlled region')
  return document.getElementById(id)
}

/** Open the repository list the way the operator does. */
async function expandRepositories(container: HTMLElement): Promise<void> {
  await act(async () => { repositoriesToggle(container).click() })
}

/** The token input the panel renders. */
function tokenInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('[data-dsh-part="github-token"]')
  if (input === null) throw new Error('the token input did not render')
  return input as HTMLInputElement
}

/** The proxy mode select the panel renders. */
function proxyModeSelect(container: HTMLElement): HTMLSelectElement {
  const select = container.querySelector('[data-dsh-part="github-proxy-mode"]')
  if (select === null) throw new Error('the proxy mode select did not render')
  return select as HTMLSelectElement
}

/** The custom proxy URL input, or null while the mode does not read one. */
function proxyUrlInput(container: HTMLElement): HTMLInputElement | null {
  const input = container.querySelector('[data-dsh-part="github-proxy-url"]')
  return input === null ? null : input as HTMLInputElement
}

/** The line reporting what the Host would actually dial. */
function proxyEffectiveLine(container: HTMLElement): HTMLElement {
  const line = container.querySelector('[data-dsh-part="github-proxy-effective"]')
  if (line === null) throw new Error('the effective-proxy line did not render')
  return line as HTMLElement
}

/** Choose one option of a select the way a browser does (React reads the native setter). */
function choose(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
  setter?.call(select, value)
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('GitHub setup panel', () => {
  it('operator opening an unconfigured integration is told the credential is missing and gets the paste box', async () => {
    // Given a deployment with no credential and no repository
    const { api } = apiDouble()

    // When the panel renders
    const container = await renderPanel(api)

    // Then the credential line explains what is missing, the paste box and the
    // integration heading are on screen, and the empty repository list is stated
    const text = container.textContent ?? ''
    expect(text).toContain(zh['summary.title'])
    expect(text).toContain(zh['setup.credentialMissing'].replace('{name}', 'GITHUB_TOKEN'))
    expect(text).toContain(zh['setup.repositoriesEmpty'])
    expect(tokenInput(container).type).toBe('password')
    expect(tokenInput(container).placeholder).toBe(zh['setup.tokenPlaceholder'])
  })

  it('operator sees the repository list collapsed until the disclosure opens it, and can collapse it again', async () => {
    // Given a deployment already syncing two repositories, one of them with
    // both channel chips
    const { api } = apiDouble([
      { owner: 'deepseek-ai', repository: 'dsh-web', inclusionLabel: 'dsh', assignee: '@me' },
      { owner: 'other', repository: 'thing', includeUnassigned: true },
    ])

    // When the panel renders
    const container = await renderPanel(api)

    // Then the disclosure is collapsed, counts what is behind it, and neither a
    // repository row nor the add form is in the document
    const toggle = repositoriesToggle(container)
    const heading = zh['setup.repositoriesCount'].replace('{count}', '2')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.textContent).toBe(heading)
    // The accessible name repeats the visible heading instead of replacing it,
    // so a screen reader still hears how many repositories are behind the fold
    expect(toggle.getAttribute('aria-label')).toBe(zh['setup.repositoriesExpand'] + ': ' + heading)
    expect(container.querySelector('[data-dsh-part="github-repository"]')).toBeNull()
    expect(container.querySelector('[data-dsh-part="github-repository-input"]')).toBeNull()

    // When the operator opens it
    await expandRepositories(container)

    // Then the toggle reads expanded, points at the region that now exists, and
    // that region carries the rows, every chip and the add form
    const open = repositoriesToggle(container)
    expect(open.getAttribute('aria-expanded')).toBe('true')
    expect(open.textContent).toBe(heading)
    expect(open.getAttribute('aria-label')).toBe(zh['setup.repositoriesCollapse'] + ': ' + heading)
    if (repositoriesRegion(container) === null) throw new Error('the disclosed region did not render')
    const regionText = repositoriesRegion(container)?.textContent ?? ''
    expect(regionText).toContain('deepseek-ai/dsh-web')
    expect(regionText).toContain('dsh')
    expect(regionText).toContain(zh['setup.assigneeChip'].replace('{login}', '@me'))
    expect(regionText).toContain(zh['setup.unassignedChip'])
    expect(container.querySelectorAll('[data-dsh-part="github-repository"]')).toHaveLength(2)
    expect(container.querySelector('[data-dsh-part="github-repository-input"]')).toBeInstanceOf(HTMLInputElement)

    // When the operator collapses it again
    await expandRepositories(container)

    // Then the rows and the add form leave the document, and the toggle is back
    // to naming the collapsed state with its heading
    const collapsed = repositoriesToggle(container)
    expect(collapsed.getAttribute('aria-expanded')).toBe('false')
    expect(collapsed.getAttribute('aria-label')).toBe(zh['setup.repositoriesExpand'] + ': ' + heading)
    expect(repositoriesRegion(container)).toBeNull()
    expect(container.querySelector('[data-dsh-part="github-repository"]')).toBeNull()
    expect(container.querySelector('[data-dsh-part="github-repository-input"]')).toBeNull()
  })

  it('operator pasting a token stores it through the same-origin API and sees the credential configured', async () => {
    // Given a rendered panel with no credential
    const { api, calls } = apiDouble()
    const container = await renderPanel(api)

    // When the operator pastes a token and saves it
    type(tokenInput(container), 'ghp_pasted_token')
    await act(async () => { button(container, zh['setup.tokenSave']).click() })

    // Then the token reached the setup API once and the status now reads configured
    expect(calls).toContain('setCredential ghp_pasted_token')
    expect(container.textContent).toContain(zh['setup.credentialConfigured'].replace('{name}', 'GITHUB_TOKEN').replace('{source}', 'store'))
    // And the paste box was cleared so the secret is not left on screen
    expect(tokenInput(container).value).toBe('')
  })

  it('operator adding a repository writes the list and clears the input', async () => {
    // Given a rendered panel with no repository
    const { api, calls, list } = apiDouble()
    const container = await renderPanel(api)

    // When the operator opens the list, types a repository and adds it
    await expandRepositories(container)
    const input = container.querySelector('[data-dsh-part="github-repository-input"]') as HTMLInputElement
    type(input, 'https://github.com/deepseek-ai/dsh-web')
    await act(async () => { button(container, zh['setup.repositoryAdd']).click() })

    // Then the Host stored exactly that repository and the row is on screen
    expect(calls).toContain('writeRepositories')
    expect(list()).toEqual([{ owner: 'deepseek-ai', repository: 'dsh-web' }])
    expect(container.textContent).toContain('deepseek-ai/dsh-web')
    expect(input.value).toBe('')
  })

  it('operator can hand a new repository the assignee channel from the same row', async () => {
    // Given a rendered panel with no repository
    const { api, list } = apiDouble()
    const container = await renderPanel(api)

    // When the operator opens the list, then types a repository plus an assignee
    await expandRepositories(container)
    const input = container.querySelector('[data-dsh-part="github-repository-input"]') as HTMLInputElement
    const assignee = container.querySelector('[data-dsh-part="github-repository-assignee-input"]') as HTMLInputElement
    type(input, 'deepseek-ai/dsh-web')
    type(assignee, '@me')
    await act(async () => { button(container, zh['setup.repositoryAdd']).click() })

    // Then the stored entry carries the channel and the row shows it
    expect(list()).toEqual([{ owner: 'deepseek-ai', repository: 'dsh-web', assignee: '@me' }])
    expect(container.querySelector('[data-dsh-part="github-repository-assignee"]')?.textContent)
      .toBe(zh['setup.assigneeChip'].replace('{login}', '@me'))
  })

  it('operator reads a bare assignee login as a handle and removes a row by its icon action', async () => {
    // Given a repository whose assignee is stored without the @ prefix
    const { api } = apiDouble([{ owner: 'deepseek-ai', repository: 'dsh-web', assignee: 'octocat' }])
    const container = await renderPanel(api)

    // When the operator opens the list
    await expandRepositories(container)

    // Then the assignee chip reads as a handle, and the remove action is an
    // icon button whose accessible name carries the verb instead of visible text
    expect(container.querySelector('[data-dsh-part="github-repository-assignee"]')?.textContent).toBe('@octocat')
    const remove = container.querySelector('[data-dsh-part="github-repository-remove"]') as HTMLButtonElement
    expect(remove.getAttribute('aria-label')).toBe(zh['setup.repositoryRemove'])
    expect(remove.textContent).toBe('')
  })

  it('operator adding the same repository twice is told instead of silently getting one row', async () => {
    // Given a configuration that already carries the repository
    const { api, calls } = apiDouble([{ owner: 'deepseek-ai', repository: 'dsh-web' }])
    const container = await renderPanel(api)

    // When the same repository is typed again
    await expandRepositories(container)
    const input = container.querySelector('[data-dsh-part="github-repository-input"]') as HTMLInputElement
    type(input, 'deepseek-ai/dsh-web')
    await act(async () => { button(container, zh['setup.repositoryAdd']).click() })

    // Then the refusal is shown and nothing was written
    expect(container.textContent).toContain('already configured')
    expect(calls.filter(call => call === 'writeRepositories')).toHaveLength(0)
  })

  it('operator removing a repository writes the remaining list', async () => {
    // Given two configured repositories
    const { api, calls, list } = apiDouble([{ owner: 'deepseek-ai', repository: 'dsh-web' }, { owner: 'other', repository: 'thing' }])
    const container = await renderPanel(api)

    // When the operator opens the list and removes one of them
    await expandRepositories(container)
    const rows = Array.from(container.querySelectorAll('[data-dsh-part="github-repository"]'))
    expect(rows).toHaveLength(2)
    const remove = rows[1]!.querySelector('[data-dsh-part="github-repository-remove"]') as HTMLButtonElement
    await act(async () => { remove.click() })

    // Then only the other repository is stored
    expect(calls).toContain('writeRepositories')
    expect(list()).toEqual([{ owner: 'deepseek-ai', repository: 'dsh-web' }])
  })

  it('operator collecting an unassigned backlog flips the channel on the row it clicked', async () => {
    // Given one configured repository that does not yet take unassigned issues
    const { api, list } = apiDouble([{ owner: 'deepseek-ai', repository: 'dsh-web' }])
    const container = await renderPanel(api)

    // When the operator opens the list and presses that row's take-unassigned button
    await expandRepositories(container)
    const toggle = container.querySelector('[data-dsh-part="github-repository-unassigned-toggle"]') as HTMLButtonElement
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    await act(async () => { toggle.click() })

    // Then the stored repository carries the flag and the row says so
    expect(list()).toEqual([{ owner: 'deepseek-ai', repository: 'dsh-web', includeUnassigned: true }])
    const after = container.querySelector('[data-dsh-part="github-repository-unassigned-toggle"]') as HTMLButtonElement
    expect(after.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('[data-dsh-part="github-repository-unassigned"]')?.textContent).toBe(zh['setup.unassignedChip'])
  })

  it('operator testing the connection sees the authenticated account and each repository check', async () => {
    // Given a configured repository
    const { api } = apiDouble([{ owner: 'deepseek-ai', repository: 'dsh-web' }])
    const container = await renderPanel(api)

    // When the operator runs the test
    await act(async () => { button(container, zh['setup.test']).click() })

    // Then the account and the per-repository outcome are on screen
    const text = container.textContent ?? ''
    expect(text).toContain(zh['setup.testLogin'].replace('{login}', 'octocat'))
    expect(text).toContain('deepseek-ai/dsh-web')
    expect(text).toContain('3 open issues')
  })

  it('operator on a page that cannot reach the host API is told so instead of seeing an empty form', async () => {
    // Given an API whose status read fails
    const failing: GitHubSetupApi = {
      ...apiDouble().api,
      status: async () => { throw new Error('Failed to fetch') },
    }

    // When the panel renders
    const container = await renderPanel(failing)

    // Then the failure is reported with its reason
    expect(container.textContent).toContain('Failed to fetch')
    expect(container.textContent).toContain(zh['summary.title'])
  })
})


describe('GitHub setup panel network proxy', () => {
  it('operator on auto is told which proxy the Host detected', async () => {
    // Given a deployment whose auto mode resolved the machine system proxy
    const double = apiDouble()
    double.setProxyState({ mode: 'auto', url: '', effective: 'http://127.0.0.1:7890', source: 'system' })

    // When the panel renders
    const container = await renderPanel(double.api)

    // Then the detected line names the proxy and where it came from, and the
    // mode select reads auto with no URL box
    const line = proxyEffectiveLine(container).textContent ?? ''
    expect(line).toContain('http://127.0.0.1:7890')
    expect(line).toContain(zh['setup.proxySourceSystem'])
    expect(proxyModeSelect(container).value).toBe('auto')
    expect(proxyUrlInput(container)).toBeNull()
  })

  it('operator on auto with nothing detected is told the requests go direct', async () => {
    // Given a deployment where nothing resolved a proxy
    const { api } = apiDouble()

    // When the panel renders
    const container = await renderPanel(api)

    // Then the line says so instead of staying blank
    expect(proxyEffectiveLine(container).textContent).toBe(zh['setup.proxyDirect'])
  })

  it('operator switching the mode to custom gets the URL box and has the choice stored', async () => {
    // Given a panel on the default auto mode
    const double = apiDouble()
    const container = await renderPanel(double.api)
    expect(proxyUrlInput(container)).toBeNull()

    // When the operator chooses the custom mode
    await act(async () => { choose(proxyModeSelect(container), 'custom') })

    // Then the choice was written through the setup API, and the URL box the
    // custom mode needs is now on screen
    expect(double.calls).toContain('setProxy custom ')
    expect(proxyModeSelect(container).value).toBe('custom')
    const input = proxyUrlInput(container)
    if (input === null) throw new Error('the custom URL input did not render')
    expect(input.placeholder).toBe(zh['setup.proxyUrlPlaceholder'])
  })

  it('operator typing a custom URL has it stored on Enter, without waiting for a blur', async () => {
    // Given a panel already in the custom mode
    const double = apiDouble()
    double.setProxyState({ mode: 'custom', url: '' })
    const container = await renderPanel(double.api)

    // When the operator types an address and presses Enter
    const input = proxyUrlInput(container)
    if (input === null) throw new Error('the custom URL input did not render')
    type(input, '127.0.0.1:7890')
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    // Then the Host stored it and the detected line reports the URL it resolves
    expect(double.calls).toContain('setProxy custom 127.0.0.1:7890')
    expect(proxyEffectiveLine(container).textContent ?? '').toContain('http://127.0.0.1:7890')
  })

  it('operator switching to direct is told no proxy is used at all', async () => {
    // Given a panel resolving a detected proxy
    const double = apiDouble()
    double.setProxyState({ mode: 'auto', url: '', effective: 'http://127.0.0.1:7890', source: 'system' })
    const container = await renderPanel(double.api)

    // When the operator chooses the direct mode
    await act(async () => { choose(proxyModeSelect(container), 'direct') })

    // Then the detected line switches to the direct wording and the URL box
    // stays away
    expect(proxyEffectiveLine(container).textContent).toBe(zh['setup.proxyDirectMode'])
    expect(proxyUrlInput(container)).toBeNull()
  })
})

