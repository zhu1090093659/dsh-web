import React from 'react'
import ReactDOM from 'react-dom/client'

import type { PetNativeSurfaceApi } from '../../../src/contracts/desktop-host.ts'
import type { DesktopApi } from '../shared/desktop-api.ts'
import { App } from './App.tsx'
import { createEmbeddedDesktopApi } from './embedded-desktop-api.ts'
import './styles.css'

const runtimeWindow = window as unknown as {
  petDesktop?: DesktopApi
  petSurface?: PetNativeSurfaceApi
}
if (runtimeWindow.petDesktop === undefined) {
  if (runtimeWindow.petSurface === undefined) throw new Error('native pet surface preload is unavailable')
  runtimeWindow.petDesktop = createEmbeddedDesktopApi(runtimeWindow.petSurface)
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
