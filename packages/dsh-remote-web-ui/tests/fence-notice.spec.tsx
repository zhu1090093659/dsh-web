/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FenceNotice, type FenceNoticeProps } from '../src/client/FenceNotice.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: FenceNoticeProps['t'] = key => zh[key]

describe('FenceNotice', () => {
  it('blocks the shell with pairing instructions and retries on request', () => {
    const onRetry = vi.fn()
    render(<FenceNotice t={t} onRetry={onRetry} />)

    const page = screen.getByRole('dialog', { name: '此设备未配对，无法访问工作区数据' })
    expect(page.getAttribute('aria-modal')).toBe('true')
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByText(/电脑配对链接/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '重新检测' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
