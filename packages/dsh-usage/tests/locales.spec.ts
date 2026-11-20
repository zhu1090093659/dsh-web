import { afterEach, describe, expect, it } from 'vitest'
import { dictionary, en, providerDisplayName, t, zh } from '../src/client/locales.ts'

afterEach(() => {
  document.documentElement.lang = ''
})

describe('usage locale fallback', () => {
  it.each(['ru', 'de', 'fr-CA'])('user with %s locale receives English rather than Chinese', (lang) => {
    // Given an interface language this package does not directly ship
    document.documentElement.lang = lang
    // When the package uses its last-resort dictionary
    // Then it chooses English copy
    expect(dictionary()).toBe(en)
    expect(t('usage.title')).toBe('Usage Statistics')
  })

  it('user with no document language keeps the original Chinese default', () => {
    // Given a DOM that has not declared a language
    document.documentElement.lang = ''
    // When the fallback dictionary is resolved
    // Then the pre-fix default remains unchanged
    expect(dictionary()).toBe(zh)
  })

  it('user with Chinese locale keeps the Chinese dictionary', () => {
    // Given a Chinese interface language
    document.documentElement.lang = 'zh-CN'
    // When the package resolves its dictionary
    // Then Chinese remains the selected copy
    expect(dictionary()).toBe(zh)
    expect(t('usage.title')).toBe('使用统计')
  })

  it('user sees the host display name for a provider without a dictionary key', () => {
    // Given a provider with no localized override
    document.documentElement.lang = 'ru'
    // When its display name is resolved
    // Then the host-provided label remains unchanged
    expect(providerDisplayName('deepseek', 'DeepSeek')).toBe('DeepSeek')
  })
})
