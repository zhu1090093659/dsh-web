// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PairRequiredView } from './PairRequiredView.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('PairRequiredView', () => {
  it('accepts a pasted link in the installed app context', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const onPaired = vi.fn()
    render(<PairRequiredView onPaired={onPaired} />)

    fireEvent.change(screen.getByLabelText('配对链接'), { target: { value: 'https://phone.example/m/?pair=tok-1&workspace=ws-7' } })
    fireEvent.click(screen.getByRole('button', { name: '配对' }))

    await waitFor(() => expect(onPaired).toHaveBeenCalledWith('/m/?workspace=ws-7'))
  })

  it('shows an initial QR failure without starting the mobile data channel', () => {
    render(<PairRequiredView initialError="配对链接已被使用。" onPaired={vi.fn()} />)
    expect(screen.getByRole('alert').textContent).toContain('配对链接已被使用。')
  })
})
