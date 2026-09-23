import { describe, expect, it } from 'vitest'
import { zh, en } from './locales.ts'
import {
  CATEGORY_IDS,
  CATEGORY_LABEL_KEY,
  PRESET_CATEGORY_IDS,
  PRESET_CATEGORY_LABEL_KEY,
  SUBCATEGORY_IDS,
  SUBCATEGORY_LABEL_KEY,
} from './categories.ts'

describe('market category and subcategory label coverage', () => {
  it('has a label key for every canonical category id in both locales', () => {
    for (const id of CATEGORY_IDS) {
      const key = CATEGORY_LABEL_KEY[id]
      expect(key, 'label key for category ' + id).toBeDefined()
      expect(Object.keys(en), 'en locale key ' + String(key)).toContain(key)
      expect(Object.keys(zh), 'zh locale key ' + String(key)).toContain(key)
    }
  })

  it('has a label key for every canonical preset category id in both locales', () => {
    for (const id of PRESET_CATEGORY_IDS) {
      const key = PRESET_CATEGORY_LABEL_KEY[id]
      expect(key, 'label key for preset category ' + id).toBeDefined()
      expect(Object.keys(en), 'en locale key ' + String(key)).toContain(key)
      expect(Object.keys(zh), 'zh locale key ' + String(key)).toContain(key)
    }
    // A preset entry may omit category; the manifest then says 'other'.
    expect(Object.keys(en), 'en locale key for the preset other bucket').toContain(PRESET_CATEGORY_LABEL_KEY.other)
    expect(Object.keys(zh), 'zh locale key for the preset other bucket').toContain(PRESET_CATEGORY_LABEL_KEY.other)
  })

  it('has a label key for every canonical subcategory id in both locales', () => {
    for (const [cat, subs] of Object.entries(SUBCATEGORY_IDS)) {
      for (const sub of subs) {
        const key = SUBCATEGORY_LABEL_KEY[sub]
        expect(key, 'label key for subcategory ' + cat + '/' + sub).toBeDefined()
        expect(Object.keys(en), 'en locale key ' + String(key)).toContain(key)
        expect(Object.keys(zh), 'zh locale key ' + String(key)).toContain(key)
      }
    }
  })
})
