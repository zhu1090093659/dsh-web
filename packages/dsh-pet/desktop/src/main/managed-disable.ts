export interface ManagedDesktopConnection {
  origin?: string
  nativeToken?: string
}

export interface ManagedDesktopSettingsWriter {
  setCompanionSettings(patch: { enabled: false }): Promise<{ enabled: boolean }>
  setCompanionSettingsForConnection(
    origin: string,
    nativeToken: string,
    patch: { enabled: false },
  ): Promise<{ enabled: boolean }>
}

/** Disable every authenticated Host generation before the shared process exits. */
export async function disableManagedDesktopPets(
  client: ManagedDesktopSettingsWriter,
  registrations: Iterable<ManagedDesktopConnection>,
): Promise<void> {
  const targets = new Map<string, { origin: string; nativeToken: string }>()
  for (const registration of registrations) {
    if (registration.origin === undefined || registration.nativeToken === undefined) {
      throw new Error('managed desktop registration is missing authentication')
    }
    targets.set(`${registration.origin}\u0000${registration.nativeToken}`, {
      origin: registration.origin,
      nativeToken: registration.nativeToken,
    })
  }

  if (targets.size === 0) {
    const companion = await client.setCompanionSettings({ enabled: false })
    if (companion.enabled) throw new Error('desktop pet remained enabled')
    return
  }

  await Promise.all([...targets.values()].map(async ({ origin, nativeToken }) => {
    const companion = await client.setCompanionSettingsForConnection(
      origin,
      nativeToken,
      { enabled: false },
    )
    if (companion.enabled) throw new Error('desktop pet remained enabled')
  }))
}
