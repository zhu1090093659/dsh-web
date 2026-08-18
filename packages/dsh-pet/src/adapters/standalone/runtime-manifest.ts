/**
 * Checksum-pinned Electron artifacts used by the optional Standalone host.
 *
 * Mirrors are transport choices only. These hashes come from Electron's
 * official v43.4.0 SHASUMS256.txt and remain the integrity authority.
 */
export const STANDALONE_ELECTRON_VERSION = '43.4.0'

export const STANDALONE_ELECTRON_CHECKSUMS: Readonly<Record<string, string>> = {
  'electron-v43.4.0-darwin-arm64.zip': '827f9f182566f46846377575b51c547b9926b111637313a373b6f717462aebac',
  'electron-v43.4.0-darwin-x64.zip': '7ab39ec1b0bcf5463f2dc0040142fbc1c30cd7bc3f99086066f588c717b11e24',
  'electron-v43.4.0-linux-arm64.zip': '17021d48739857106a26dd95bf749f95b89ae924955c3c7e7ff5a3f06251ac14',
  'electron-v43.4.0-linux-x64.zip': '7c5f7918bcae74a05a814543940eb28469c055edaa3cfcf41d0ff1787b314c52',
  'electron-v43.4.0-win32-arm64.zip': 'cec4e502e5db33b432adcf1278072fb14b9edeb88403e0952e4b864bdf51b0ef',
  'electron-v43.4.0-win32-x64.zip': 'ef0709cfa719739acce73de6f9b684304baf38c6454376638a70d34a7cecffe0',
}

export type StandaloneElectronPlatform = 'win32' | 'darwin' | 'linux'
export type StandaloneElectronArch = 'x64' | 'arm64'

export interface StandaloneElectronArtifact {
  platform: StandaloneElectronPlatform
  arch: StandaloneElectronArch
  filename: string
  checksum: string
}

/** Return the supported, integrity-pinned artifact for one native target. */
export function standaloneElectronArtifact(
  platform: NodeJS.Platform,
  arch: string,
): StandaloneElectronArtifact | undefined {
  if (platform !== 'win32' && platform !== 'darwin' && platform !== 'linux') return undefined
  if (arch !== 'x64' && arch !== 'arm64') return undefined
  const filename = `electron-v${STANDALONE_ELECTRON_VERSION}-${platform}-${arch}.zip`
  const checksum = STANDALONE_ELECTRON_CHECKSUMS[filename]
  return checksum === undefined ? undefined : { platform, arch, filename, checksum }
}
