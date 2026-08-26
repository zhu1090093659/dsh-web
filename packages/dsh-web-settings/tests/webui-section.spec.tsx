/** @vitest-environment jsdom */

/**
 * The Web UI section contract: it renders a static heading plus a description
 * and immediately renders every family plugin card through the child slot
 * (no disclosure fold: the nav entry already selects the section).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { WebUIPluginsSection } from '../src/client/WebUIPluginsCard.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

/**
 * English translate stub (same shape the sibling settings-card tests use).
 * Reads from the published dictionary and falls back to the key.
 */
const t = (key: string): string => (en as Record<string, string>)[key] ?? key

describe('WebUIPluginsSection', () => {
  it('renders the static heading, description and family plugin cards immediately', () => {
    const renderSlot = vi.fn(() => null)
    const props = { t, renderSlot } as ComponentProps<typeof WebUIPluginsSection>
    render(<WebUIPluginsSection {...props} />)

    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading.textContent).toBe('Web Plugins')

    expect(screen.getByText('Enable and configure the dsh-web family plugins from one place.')).toBeTruthy()

    expect(renderSlot).toHaveBeenCalledTimes(1)
    expect(renderSlot).toHaveBeenCalledWith('web-ui.plugin.item', {})
  })
})
