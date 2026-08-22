import { readFile } from 'node:fs/promises'
import { DOCTOR_PROTOCOL_VERSION } from './core/protocol.ts'
import { managedLaunch, findRealDsh } from './agent/launch.ts'
import { DoctorSupervisor, runSupervisor } from './agent/supervisor.ts'
import { doctorPaths } from './agent/paths.ts'
import { callSupervisor } from './agent/ipc.ts'
import { servicePlan, ensureServiceInstalled, removeService, runCommand } from './agent/service.ts'
import { currentPackageVersion } from './agent/version.ts'
import { provisionCapsule } from './agent/capsule.ts'
import { resolveDshHome } from './core/profile.ts'
import { diagnoseAndPlan, discoverRollbackProfile, repairProfile, rollbackTransaction, snapshotProfile } from './core/recover.ts'
import type { RecoveryRequest } from './core/recover.ts'

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const paths = doctorPaths(); const command = argv[0] ?? 'help'
  if (command === 'supervisor') { await runSupervisor(); return 0 }
  if (command === 'launch') { const token = (await readFile(paths.token, 'utf8')).trim(); return managedLaunch({ argv: argv.slice(1), endpoint: paths.socket, token }) }
  if (command === 'status') { const token = (await readFile(paths.token, 'utf8')).trim(); console.log(JSON.stringify(await callSupervisor(paths.socket, token, { protocol: DOCTOR_PROTOCOL_VERSION, type: 'status' }), null, 2)); return 0 }
  if (command === 'provision') { const dsh = process.env.DSH_DOCTOR_REAL_DSH || 'dsh'; const version = currentPackageVersion(); const profileName = argv[1] ?? 'web'; const mirrorCredentials = !argv.includes('--no-credentials') && process.env.DSH_DOCTOR_CREDENTIALS !== 'off'; const manifest = await provisionCapsule({ paths, dshExecutable: dsh, doctorSpec: process.env.DSH_DOCTOR_PACKAGE || '@linxin666/dsh-doctor@' + version, doctorPackageDir: process.env.DSH_DOCTOR_PACKAGE_DIR, doctorVersion: version, sourceHome: resolveDshHome(), sourceProfile: profileName, mirrorCredentials }); console.log(JSON.stringify(manifest, null, 2)); return 0 }
  if (command === 'diagnose' || command === 'repair' || command === 'snapshot' || command === 'rollback') {
    const home = resolveDshHome()
    if (command === 'rollback') {
      const txnId = argv[1]
      if (txnId === undefined) { console.error('usage: dsh-doctor rollback <txnId>'); return 2 }
      let profile: string
      try {
        profile = await discoverRollbackProfile(home, txnId)
      } catch (error) {
        console.log(JSON.stringify({
          ok: false,
          phase: 'failed',
          diagnostics: [],
          actions: [],
          manualActions: [],
          txnId,
          message: error instanceof Error ? error.message : String(error),
        }, null, 2))
        return 2
      }
      // Rollback only restores an existing transaction and never launches
      // DSH, so recovery must still work when the executable itself is broken.
      const outcome = await rollbackTransaction({ home, profile }, txnId)
      console.log(JSON.stringify(outcome, null, 2))
      return outcome.ok ? 0 : 2
    }
    const dshPath = process.env.DSH_DOCTOR_REAL_DSH || findRealDsh()
    const profile = argv[1] ?? 'web'
    const base: RecoveryRequest = {
      home,
      profile,
      dshPath,
      allowLive: command !== 'repair' || argv.includes('--allow-live'),
    }
    const outcome = command === 'snapshot' ? await snapshotProfile(base) : command === 'diagnose' ? await diagnoseAndPlan(base) : await repairProfile(base)
    console.log(JSON.stringify(outcome, null, 2))
    return outcome.ok ? 0 : 2
  }
  if (command === 'service-plan' || command === 'service-install' || command === 'service-uninstall') { const plan = servicePlan({ platform: process.platform, label: 'com.dsh.doctor', executable: process.execPath, args: [process.argv[1]!, 'supervisor'], doctorHome: paths.root }); if (command === 'service-plan') console.log(JSON.stringify(plan, null, 2)); else if (command === 'service-install') { await ensureServiceInstalled(plan) } else { await removeService(plan) } return 0 }
  console.log('Usage: dsh-doctor <supervisor|launch|status|provision [profile] [--no-credentials]|diagnose|repair|snapshot|rollback|service-plan|service-install|service-uninstall> [args...]')
  return command === 'help' || command === '--help' || command === '-h' ? 0 : 2
}

if (import.meta.url === new URL(process.argv[1] ?? '', 'file:').href) main().then(code => { process.exitCode = code }, error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })

export { DoctorSupervisor }
