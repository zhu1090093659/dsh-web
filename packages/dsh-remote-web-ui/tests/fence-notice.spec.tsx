/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractPairToken, FenceNotice, type FenceNoticeProps } from '../src/client/FenceNotice.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: FenceNoticeProps['t'] = key => zh[key]

describe('extractPairToken', () => {
  it('handles plain token strings', () => {
    expect(extractPairToken('token-abc-123')).toBe('token-abc-123')
    expect(extractPairToken('  token-with-spaces  ')).toBe('token-with-spaces')
    expect(extractPairToken('')).toBeUndefined()
    expect(extractPairToken('   ')).toBeUndefined()
  })

  it('extracts token from desktop or mobile pair URLs', () => {
    expect(extractPairToken('http://192.168.1.50:3080/?pair=tok123')).toBe('tok123')
    expect(extractPairToken('https://dsh.test/m/?pair=tok456&workspace=ws-1')).toBe('tok456')
    expect(extractPairToken('http://localhost:3080/?other=1')).toBe('http://localhost:3080/?other=1')
  })
})

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

  it('submits manual pair token and calls onRetry upon success (#1213)', async () => {
    const onRetry = vi.fn()
    const onAccept = vi.fn().mockResolvedValue({ ok: true })

    render(<FenceNotice t={t} onRetry={onRetry} onAccept={onAccept} />)

    const input = screen.getByPlaceholderText('或在此直接粘贴配对链接 / Token')
    const submitBtn = screen.getByRole('button', { name: '立即配对' }) as HTMLButtonElement

    expect(submitBtn.disabled).toBe(true)

    fireEvent.change(input, { target: { value: 'https://dsh.test/?pair=manual-tok-123' } })
    expect(submitBtn.disabled).toBe(false)

    fireEvent.click(submitBtn)

    await vi.waitFor(() => {
      expect(onAccept).toHaveBeenCalledWith('manual-tok-123')
      expect(onRetry).toHaveBeenCalledOnce()
    })
  })

  it('displays invalid error when token is invalid or expired (#1213)', async () => {
    const onRetry = vi.fn()
    const onAccept = vi.fn().mockResolvedValue({ ok: false, code: 'invalid' })

    render(<FenceNotice t={t} onRetry={onRetry} onAccept={onAccept} />)

    const input = screen.getByPlaceholderText('或在此直接粘贴配对链接 / Token')
    const submitBtn = screen.getByRole('button', { name: '立即配对' })

    fireEvent.change(input, { target: { value: 'invalid-token' } })
    fireEvent.click(submitBtn)

    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('配对链接或 Token 无效已过期')
      expect(onRetry).not.toHaveBeenCalled()
    })
  })

  it('operator sees the generic refusal copy for a fenced-off accept', async () => {
    // Given a fence whose accept is refused by the origin fence (the only other
    // refusal a bearer token can produce is "invalid").
    const onRetry = vi.fn()
    const onAccept = vi.fn().mockResolvedValue({ ok: false, code: 'forbidden' })

    render(<FenceNotice t={t} onRetry={onRetry} onAccept={onAccept} />)

    // When the operator submits a link.
    const input = screen.getByPlaceholderText('或在此直接粘贴配对链接 / Token')
    const submitBtn = screen.getByRole('button', { name: '立即配对' })

    fireEvent.change(input, { target: { value: 'refused-token' } })
    fireEvent.click(submitBtn)

    // Then the generic refusal copy shows and no retry fires.
    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('配对失败，请检查网络或重新获取链接')
      expect(onRetry).not.toHaveBeenCalled()
    })
  })
})
