/**
 * Vision payload extraction tests: the chat-completions reasoning-content
 * fallback (issue #637) alongside the other extraction shapes.
 */

import { describe, expect, it } from 'vitest'
import { extractChatCompletionsContent } from '../src/vision-client.ts'

describe('extractChatCompletionsContent', () => {
  it('reads the message content', () => {
    expect(extractChatCompletionsContent({ choices: [{ message: { role: 'assistant', content: 'Cyan' } }] })).toBe('Cyan')
  })

  it('falls back to a string reasoning_content when content is empty (issue #637)', () => {
    const payload = {
      choices: [{
        finish_reason: 'length',
        message: { role: 'assistant', content: '', reasoning_content: 'the sky reads cyan' },
      }],
    }
    expect(extractChatCompletionsContent(payload)).toBe('the sky reads cyan')
  })

  it('falls back to an array reasoning_content, joining non-empty strings', () => {
    const payload = { choices: [{ message: { content: '', reasoning_content: ['part one', '', 'part two'] } }] }
      expect(extractChatCompletionsContent(payload)).toBe('part one\npart two')
  })

  it('reports no text content with an actionable hint when both are empty', () => {
    expect(() => extractChatCompletionsContent({ choices: [{ message: { content: '', reasoning_content: '' } }] }))
      .toThrow(/no text content.*reasoning/i)
  })

  it('still rejects payloads without a choices array', () => {
    expect(() => extractChatCompletionsContent({ models: [] })).toThrow('unexpected response shape')
  })
})
