/** @vitest-environment jsdom */

/**
 * The Web UI section contract: it renders a static heading plus a description,
 * immediately renders every family plugin card through the child slot
 * (no disclosure fold: the nav entry already selects the section), and appends
 * the built-in version-notes card for the latest release.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { WebUIPluginsSection } from '../src/client/WebUIPluginsCard.tsx'
import { en } from '../src/client/locales.ts'
import { CURRENT_VERSION } from '../src/client/release-notes.ts'

afterEach(cleanup)

/**
 * English translate stub (same shape the sibling settings-card tests use).
 * Reads from the published dictionary and falls back to the key.
 */
const t = (key: string): string => (en as Record<string, string>)[key] ?? key

describe('WebUIPluginsSection', () => {
  it('renders the static heading, description, family plugin cards and the version-notes card immediately', () => {
    const renderSlot = vi.fn(() => null)
    const props = { t, renderSlot } as ComponentProps<typeof WebUIPluginsSection>
    render(<WebUIPluginsSection {...props} />)

    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading.textContent).toBe('Web UI Plugins')

    expect(screen.getByText('Enable and configure the dsh-web family plugins from one place.')).toBeTruthy()

    expect(renderSlot).toHaveBeenCalledTimes(1)
    expect(renderSlot).toHaveBeenCalledWith('web-ui.plugin.item', {})

    // The built-in version-notes card ships collapsed inside the same list.
    // The entry row and the (still closed) modal chrome bar both contain the
    // title and version text, so scope to the entry button before opening.
    const entryBtn = screen.getByRole('button', { name: /Version Notes/ })
    expect(entryBtn).toBeTruthy()
    expect(within(entryBtn).getByText(`v${CURRENT_VERSION}`)).toBeTruthy()
  })
})
