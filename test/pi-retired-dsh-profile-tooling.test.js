import test from 'node:test'
import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import * as integrity from '../scripts/deployment-integrity.mjs'

test('retired DSH profile tooling is absent from the native distribution', async () => {
  for (const file of [
    'bootstrap-workflow-maintenance.mjs', 'configure-agent-query-resources.mjs',
    'configure-project-local-acceptance.mjs', 'configure-release-targets.mjs',
    'configure-uat-schema-target.mjs', 'reconcile-data-change-approval.mjs',
    'repair-release-target-policy.mjs', 'check-cutover.ps1',
  ]) {
    await assert.rejects(access(new URL(`../scripts/${file}`, import.meta.url)), { code: 'ENOENT' })
  }
  assert.equal('verifyPlannedEngineeringConfig' in integrity, false)
})

test('generic deployment integrity helpers remain available without DSH profile tooling', () => {
  for (const name of [
    'verifyArtifactClosure', 'checkDeploymentTaskDirectory', 'copyDeploymentTaskDirectory',
    'checkpointDeploymentDatabase', 'verifyDeploymentBackup', 'verifyRequiredDependencyBackup',
    'reverifyDeploymentBackup', 'verifyDeploymentWeb', 'verifyEngineeringRepositoryDigests',
  ]) assert.equal(typeof integrity[name], 'function', name)
})
