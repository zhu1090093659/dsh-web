import { PET_MODEL_SCHEMA_VERSION, type PetModelDescriptor } from '../contracts/model.ts'

export const BUILTIN_SPRITE_MODEL_FORMATS = Object.freeze([
  'petdex-v1', 'petdex-v2', 'dsh-pet-model-v1',
] as const)

const builtinWhaleModel: PetModelDescriptor = {
  schemaVersion: PET_MODEL_SCHEMA_VERSION,
  id: 'builtin:whale',
  displayName: '鲸鱼娘',
  description: 'DSH Pet 内置像素模型',
  rendererId: 'builtin:sprite2d',
  format: 'petdex-v1',
  entry: 'spritesheet.webp',
  source: { kind: 'builtin' },
  capabilities: {
    motions: [
      'idle', 'waiting', 'thinking', 'working', 'reviewing',
      'request-input', 'celebrate', 'failure', 'pet', 'feed',
    ],
    expressions: [],
    lookAt: false,
    lipSync: false,
    hitAreas: ['body'],
  },
  bindings: {
    motions: {
      idle: 'idle', waiting: 'waiting', thinking: 'running', working: 'running-right',
      reviewing: 'review', 'request-input': 'waving', celebrate: 'jumping',
      failure: 'failed', pet: 'waving', feed: 'jumping',
    },
    expressions: {},
  },
  fallback: { motion: 'idle', expression: 'neutral' },
}

export const BUILTIN_WHALE_MODEL: PetModelDescriptor = Object.freeze(builtinWhaleModel)
