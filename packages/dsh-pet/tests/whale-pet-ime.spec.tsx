import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'
import { WhalePet } from '../src/client/WhalePet.tsx'

describe('WhalePet IME rename behavior', () => {
  beforeEach(() => {
    cleanup()
  })

  it('does not close or confirm rename when Enter is pressed during IME composition', () => {
    const onRename = vi.fn()
    const t = (key: string) => key

    const { getByRole, getByPlaceholderText, queryByPlaceholderText } = render(
      <WhalePet
        display={{ right: 20, bottom: 20, size: 160 }}
        snapshot={{
          visible: true,
          name: '鲸鱼娘',
          affinity: { points: 10, rank: 'Lv1' },
          treats: { stocked: 5 },
        }}
        t={t as never}
        onPet={() => {}}
        onFeed={() => {}}
        onRename={onRename}
        onHide={() => {}}
        onDragEnd={() => {}}
        onFeedbackDone={() => {}}
      />
    )

    // Hover to reveal panel
    const sprite = getByRole('button', { name: 'whale girl' })
    fireEvent.pointerEnter(sprite)

    // Click rename button
    const renameBtn = getByRole('button', { name: 'pet.rename' })
    fireEvent.click(renameBtn)

    // Verify input is open
    const input = getByPlaceholderText('pet.namePlaceholder') as HTMLInputElement
    expect(input).not.toBeNull()

    // Simulate IME composition start
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: 'gai' } })

    // Press Enter while composing IME (nativeEvent.isComposing = true)
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })

    // Verify rename was NOT triggered and input is still open
    expect(onRename).not.toHaveBeenCalled()
    expect(getByPlaceholderText('pet.namePlaceholder')).not.toBeNull()

    // Simulate IME composition end and confirm final text
    fireEvent.compositionEnd(input)
    fireEvent.change(input, { target: { value: '小鲸娘' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: false })

    // Verify rename was called with trimmed new name and input closed
    expect(onRename).toHaveBeenCalledWith('小鲸娘')
    expect(queryByPlaceholderText('pet.namePlaceholder')).toBeNull()
  })

  it('keeps panel visible when pointer leaves while renaming is active', () => {
    const t = (key: string) => key

    const { getByRole, getByPlaceholderText } = render(
      <WhalePet
        display={{ right: 20, bottom: 20, size: 160 }}
        snapshot={null}
        t={t as never}
        onPet={() => {}}
        onFeed={() => {}}
        onRename={() => {}}
        onHide={() => {}}
        onDragEnd={() => {}}
        onFeedbackDone={() => {}}
      />
    )

    // Pointer enter and click rename
    const sprite = getByRole('button', { name: 'whale girl' })
    fireEvent.pointerEnter(sprite)

    const renameBtn = getByRole('button', { name: 'pet.rename' })
    fireEvent.click(renameBtn)

    // Pointer leaves sprite container while renaming
    fireEvent.pointerLeave(sprite)

    // Rename input should still remain open
    expect(getByPlaceholderText('pet.namePlaceholder')).not.toBeNull()
  })
})
