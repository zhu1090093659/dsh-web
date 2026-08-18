// @vitest-environment jsdom
/**
 * Conversation image preview enhancer: reference matching, in-place
 * thumbnail upgrade, live-toggle restore, unreachable-route fallback,
 * transcript scoping, and overlay focus management. jsdom never loads
 * images, so load failure is simulated by dispatching the `error` event.
 * Keyboard activation needs no synthetic test: the trigger is a native
 * <button type="button">, so Enter/Space activation is browser behavior.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { findImageReferences, installConversationImagePreview, type ConversationImagePreview } from '../src/client/preview.ts'

/** The reference the send hook splices into a plain-text prompt. */
const REF = '![图片](/describe-image/raw/sha256:abc)'
/** The raw-route path inside {@link REF}. */
const PATH = '/describe-image/raw/sha256:abc'
/** The official slot wrapper the enhancer scopes itself to. */
const SLOT = 'data-slot="conversation.session"'

/** Flush the observer's microtask-batched work. */
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

describe('findImageReferences', () => {
  it('locates a single reference with its alt text and span', () => {
    expect(findImageReferences(`看 ${REF} 一下`)).toEqual([{ alt: '图片', path: PATH, start: 2, end: 2 + REF.length }])
  })

  it('preserves durable reference metadata in the preview path', () => {
    const durable = `![图片](${PATH}?ref=%7B%22attachmentId%22%3A%22sha256%3Aabc%22%7D)`
    expect(findImageReferences(durable)).toEqual([{
      alt: '图片',
      path: `${PATH}?ref=%7B%22attachmentId%22%3A%22sha256%3Aabc%22%7D`,
      start: 0,
      end: durable.length,
    }])
  })

  it('locates repeated references in one chunk', () => {
    const matches = findImageReferences(`${REF} 和 ${REF}`)
    expect(matches).toHaveLength(2)
    expect(matches[1]?.start).toBe(REF.length + 3)
  })

  it('ignores plain links and absolute-URL forms', () => {
    expect(findImageReferences('[图片](/describe-image/raw/sha256:abc)')).toEqual([])
    expect(findImageReferences('![图片](http://127.0.0.1:3080/describe-image/raw/sha256:abc)')).toEqual([])
  })
})

describe('installConversationImagePreview (fixed root)', () => {
  let handle: ConversationImagePreview | undefined

  afterEach(() => {
    handle?.dispose()
    handle = undefined
    document.body.innerHTML = ''
  })

  /** Mount one container under the shell body and return it. */
  const makeRoot = (html: string): HTMLElement => {
    const root = document.createElement('div')
    root.innerHTML = html
    document.body.append(root)
    return root
  }

  it('upgrades a reference in place into a thumbnail button, keeping the surrounding text', () => {
    const root = makeRoot(`<div class="bubble">看 ${REF} 一下</div>`)
    handle = installConversationImagePreview(() => true, root)
    const button = root.querySelector('button')
    expect(button?.type).toBe('button')
    expect(button?.getAttribute('aria-label')).toBe('点击查看大图')
    const image = root.querySelector('img')
    expect(image?.src).toBe(`${window.location.origin}${PATH}`)
    expect(image?.alt).toBe('图片')
    expect(root.querySelector('[data-dsh-di-preview]')?.getAttribute('data-dsh-di-preview')).toBe(REF)
    expect(root.textContent).toBe('看  一下')
  })

  it('upgrades references that arrive after install (observer pass)', async () => {
    const root = makeRoot('<div class="bubble"></div>')
    handle = installConversationImagePreview(() => true, root)
    expect(root.querySelector('img')).toBeNull()
    root.firstElementChild!.textContent = REF
    await flush()
    expect(root.querySelector('img')?.src).toBe(`${window.location.origin}${PATH}`)
  })

  it('upgrades a reference edited into an existing text node (characterData)', async () => {
    const root = makeRoot('<div class="bubble">占位</div>')
    handle = installConversationImagePreview(() => true, root)
    root.firstElementChild!.firstChild!.nodeValue = REF
    await flush()
    expect(root.querySelector('img')).not.toBeNull()
  })

  it('restores the original text when the toggle turns off', () => {
    let enabled = true
    const root = makeRoot(`<div class="bubble">看 ${REF} 一下</div>`)
    handle = installConversationImagePreview(() => enabled, root)
    expect(root.querySelector('img')).not.toBeNull()
    enabled = false
    handle.refresh()
    expect(root.querySelector('img')).toBeNull()
    expect(root.textContent).toBe(`看 ${REF} 一下`)
    enabled = true
    handle.refresh()
    expect(root.querySelector('img')).not.toBeNull()
  })

  it('never enhances while the toggle is off', async () => {
    const root = makeRoot(`<div class="bubble">${REF}</div>`)
    handle = installConversationImagePreview(() => false, root)
    await flush()
    expect(root.querySelector('img')).toBeNull()
    expect(root.textContent).toBe(REF)
  })

  it('restores the text and remembers the path when the thumbnail fails to load', async () => {
    const root = makeRoot(`<div class="bubble">${REF}</div>`)
    handle = installConversationImagePreview(() => true, root)
    const image = root.querySelector('img')
    expect(image).not.toBeNull()
    image!.dispatchEvent(new Event('error'))
    expect(root.querySelector('img')).toBeNull()
    expect(root.textContent).toBe(REF)
    // The failed path is remembered for the session: re-arriving text stays plain.
    root.innerHTML = `<div class="bubble">${REF}</div>`
    await flush()
    expect(root.querySelector('img')).toBeNull()
    expect(root.textContent).toBe(REF)
  })

  it('leaves editable surfaces and raw-text islands alone', () => {
    const root = makeRoot(`<div contenteditable="true">${REF}</div><textarea>${REF}</textarea>`)
    handle = installConversationImagePreview(() => true, root)
    expect(root.querySelector('img')).toBeNull()
  })

  it('opens the full-size overlay on click and closes it on overlay click', () => {
    const root = makeRoot(`<div class="bubble">${REF}</div>`)
    handle = installConversationImagePreview(() => true, root)
    root.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const overlay = document.body.querySelector('[data-dsh-di-lightbox]')
    expect(overlay?.querySelector('img')?.src).toBe(`${window.location.origin}${PATH}`)
    overlay!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(document.body.querySelector('[data-dsh-di-lightbox]')).toBeNull()
  })

  it('moves focus into the overlay and returns it to the trigger on close', () => {
    const root = makeRoot(`<div class="bubble">${REF}</div>`)
    handle = installConversationImagePreview(() => true, root)
    const button = root.querySelector('button')!
    button.focus()
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const overlay = document.body.querySelector('[data-dsh-di-lightbox]') as HTMLElement
    expect(overlay).not.toBeNull()
    expect(document.activeElement).toBe(overlay)
    overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(document.body.querySelector('[data-dsh-di-lightbox]')).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('restores focus without scrolling the trigger back into view (issue #317)', () => {
    const root = makeRoot(`<div class="bubble">${REF}</div>`)
    handle = installConversationImagePreview(() => true, root)
    const button = root.querySelector('button')!
    const focus = vi.spyOn(button, 'focus')
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const overlay = document.body.querySelector('[data-dsh-di-lightbox]') as HTMLElement
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('open/close cycles are idempotent: one overlay at a time, none after, transcript untouched', () => {
    const root = makeRoot(`<div class="bubble">看 ${REF} 一下</div>`)
    handle = installConversationImagePreview(() => true, root)
    const button = root.querySelector('button')!
    const snapshot = root.innerHTML
    for (let cycle = 0; cycle < 3; cycle += 1) {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      const overlays = document.body.querySelectorAll('[data-dsh-di-lightbox]')
      expect(overlays).toHaveLength(1)
      const overlay = overlays[0] as HTMLElement
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(document.body.querySelectorAll('[data-dsh-di-lightbox]')).toHaveLength(0)
      expect(root.querySelectorAll('img')).toHaveLength(1)
      expect(root.querySelector('img')?.src).toBe(`${window.location.origin}${PATH}`)
    }
    expect(root.innerHTML).toBe(snapshot)
  })

  it('dispose restores every preview and stops observing', async () => {
    const root = makeRoot(`<div class="bubble">${REF}</div>`)
    handle = installConversationImagePreview(() => true, root)
    expect(root.querySelector('img')).not.toBeNull()
    handle.dispose()
    handle = undefined
    expect(root.textContent).toBe(REF)
    root.innerHTML = `<div class="bubble">${REF}</div>`
    await flush()
    expect(root.querySelector('img')).toBeNull()
  })
})

describe('installConversationImagePreview (default transcript scoping)', () => {
  let handle: ConversationImagePreview | undefined

  afterEach(() => {
    handle?.dispose()
    handle = undefined
    document.body.innerHTML = ''
  })

  it('enhances only inside the conversation.session slot wrapper', () => {
    document.body.innerHTML = `<div ${SLOT}><div class="bubble">${REF}</div></div><aside class="sidebar">${REF}</aside>`
    handle = installConversationImagePreview(() => true)
    const transcript = document.querySelector(`[${SLOT}]`)!
    expect(transcript.querySelector('img')).not.toBeNull()
    const sidebar = document.querySelector('.sidebar')!
    expect(sidebar.querySelector('img')).toBeNull()
    expect(sidebar.textContent).toBe(REF)
  })

  it('processes later arrivals inside the transcript, ignoring outside churn', async () => {
    document.body.innerHTML = `<div ${SLOT}></div><aside class="sidebar"></aside>`
    handle = installConversationImagePreview(() => true)
    const bubble = document.createElement('div')
    bubble.textContent = REF
    document.querySelector(`[${SLOT}]`)!.append(bubble)
    const outside = document.createElement('div')
    outside.textContent = REF
    document.querySelector('.sidebar')!.append(outside)
    await flush()
    expect(bubble.querySelector('img')).not.toBeNull()
    expect(outside.querySelector('img')).toBeNull()
  })

  it('reattaches when the shell remounts the transcript container', async () => {
    document.body.innerHTML = `<div ${SLOT}><div>${REF}</div></div>`
    handle = installConversationImagePreview(() => true)
    expect(document.querySelector(`[${SLOT}] img`)).not.toBeNull()
    // Session switch: the container is torn down and rebuilt.
    document.body.innerHTML = ''
    await flush()
    document.body.innerHTML = `<div ${SLOT}><div>${REF}</div></div>`
    await flush()
    expect(document.querySelector(`[${SLOT}] img`)).not.toBeNull()
  })
})
