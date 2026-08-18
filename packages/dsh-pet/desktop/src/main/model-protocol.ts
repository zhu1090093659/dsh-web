import { net, protocol, type Session } from 'electron'
import { extname } from 'node:path'
import { pathToFileURL } from 'node:url'

import { BUILTIN_SPRITE_MODEL_FORMATS } from '../../../src/models/builtin-whale.ts'
import type { PetModelCatalog } from '../../../src/models/catalog.ts'
import type { PetModelSummary } from '../shared/desktop-api.ts'

export const PET_MODEL_SCHEME = 'dsh-pet-model'
const PET_MODEL_HOST = 'asset'

function modelUrl(modelId: string, entry: string): string {
  return `${PET_MODEL_SCHEME}://${PET_MODEL_HOST}/${encodeURIComponent(modelId)}/${encodeURIComponent(entry)}`
}

/** Electron-only URL adapter over the Host-neutral model catalog. */
export class PetModelProtocol {
  private installed = false

  constructor(readonly catalog: PetModelCatalog) {}

  async list(): Promise<PetModelSummary[]> {
    return (await this.catalog.list()).map(model => ({
      ...model,
      ...(model.source.kind === 'builtin' ? {} : { assetUrl: modelUrl(model.id, model.entry) }),
    }))
  }

  async importDirectory(directory: string): Promise<PetModelSummary> {
    const model = await this.catalog.importDirectory(directory)
    return { ...model, assetUrl: modelUrl(model.id, model.entry) }
  }

  supports(rendererId: string, modelId: string): Promise<boolean> {
    const formats = rendererId === 'builtin:sprite2d' ? BUILTIN_SPRITE_MODEL_FORMATS : []
    return this.catalog.supports(rendererId, modelId, formats)
  }

  install(session: Session): void {
    if (this.installed) return
    this.installed = true
    session.protocol.handle(PET_MODEL_SCHEME, request => this.handle(request))
  }

  uninstall(session: Session): void {
    if (!this.installed) return
    this.installed = false
    session.protocol.unhandle(PET_MODEL_SCHEME)
  }

  private async handle(request: Request): Promise<Response> {
    if (request.method !== 'GET') return new Response(null, { status: 405 })
    try {
      const url = new URL(request.url)
      if (url.protocol !== `${PET_MODEL_SCHEME}:` || url.hostname !== PET_MODEL_HOST) throw new Error('invalid model URL')
      const parts = url.pathname.replace(/^\/+/, '').split('/')
      if (parts.length !== 2) throw new Error('invalid model asset path')
      const modelId = decodeURIComponent(parts[0] ?? '')
      const entry = decodeURIComponent(parts[1] ?? '')
      if (!/\.(?:webp|png)$/i.test(entry)) throw new Error('invalid model asset type')
      const path = await this.catalog.assetPath(modelId, entry)
      if (path === undefined || extname(path).toLowerCase() !== extname(entry).toLowerCase()) {
        throw new Error('unknown model asset')
      }
      return net.fetch(pathToFileURL(path).toString())
    } catch {
      console.warn('local pet model resource request was rejected')
      return new Response(null, { status: 404 })
    }
  }
}

export function registerPetModelScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: PET_MODEL_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      codeCache: true,
    },
  }])
}
