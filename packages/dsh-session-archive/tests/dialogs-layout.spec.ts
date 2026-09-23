// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { Modal } from '../src/client/dialogs.tsx'

describe('dsh-session-archive modal layout and keyboard isolation (Issue #1412)', () => {
  const css = readFileSync(
    resolve(__dirname, '../src/client/archive.module.css'),
    'utf-8',
  )

  it('modal has border-box, bounded max-height, and hidden overflow', () => {
    expect(css).toMatch(
      /\.modal\s*\{[\s\S]*?box-sizing:\s*border-box;/,
    )
    expect(css).toMatch(
      /\.modal\s*\{[\s\S]*?max-height:\s*min\(82vh,\s*calc\(100%\s*-\s*32px\)\);/,
    )
    expect(css).toMatch(
      /\.modal\s*\{[\s\S]*?overflow:\s*hidden;/,
    )
    expect(css).toMatch(
      /\.modalActions\s*\{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?margin-top:\s*auto;/,
    )
  })

  it('modal body containers are independently scrollable', () => {
    for (const bodyClass of ['confirmBody', 'batchBody', 'previewBody']) {
      const regex = new RegExp(`\\.${bodyClass}\\s*\\{[\\s\\S]*?flex:\\s*1 1 auto;[\\s\\S]*?min-height:\\s*0;[\\s\\S]*?overflow-y:\\s*auto;`)
      expect(css).toMatch(regex)
    }
  })

  it('intercepts Escape in capture phase and stops propagation to prevent closing parent panels', () => {
    const onClose = vi.fn()
    const { unmount } = render(
      createElement(Modal, {
        title: 'Test Modal',
        onClose,
        children: 'Modal Content',
      }),
    )

    const outerKeyDownListener = vi.fn()
    document.addEventListener('keydown', outerKeyDownListener)

    const escEvent = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })

    const stopPropagationSpy = vi.spyOn(escEvent, 'stopPropagation')
    const stopImmediatePropagationSpy = vi.spyOn(escEvent, 'stopImmediatePropagation')

    document.dispatchEvent(escEvent)

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(stopPropagationSpy).toHaveBeenCalled()
    expect(stopImmediatePropagationSpy).toHaveBeenCalled()

    document.removeEventListener('keydown', outerKeyDownListener)
    unmount()
  })
})
