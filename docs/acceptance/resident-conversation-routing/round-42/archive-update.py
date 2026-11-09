from pathlib import Path
import argparse, csv, hashlib, io, json, re, subprocess, sys

sys.stdout.reconfigure(encoding='utf-8')
p = argparse.ArgumentParser()
g = p.add_mutually_exclusive_group(required=True)
g.add_argument('--check', action='store_true')
g.add_argument('--run', action='store_true')
a = p.parse_args()
r = Path.cwd().resolve()
b = r / 'docs/acceptance/resident-conversation-routing'
d = b / 'round-42'
assert Path(__file__).resolve() == d / 'archive-update.py'
sha = lambda data: hashlib.sha256(data).hexdigest()
encode = lambda value: (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()
pre = 'docs/tmp/sg11-profile-suspended-scope-'
expected = {
    'probe.mjs': (73253, '906c9c80524cb07dfbbdceee4dad226b95b6c2b97844cb77cf50a1d76ac3e557'),
    'checklist.md': (27397, 'd1930cf1baf07bbe4730a2b5a20093d0260bebdee1ea0cd674fa5ac0c7b54f9e'),
    'check.json': (32129, 'a4689468c04ee0155c2b54915ba3f4c632c2c535960556e03fd9da5cb8e47ffa'),
    'check-execution.json': (58612, '436bd4638c489fe89692e51787b499519ab88808a537f47bb86fa3c0ab2359da'),
    'execute.py': (9636, '822aae4950573e71956da493a1f8a011ad732f4ff61e2b217a0178257aed6d63'),
    'run-check.json': (32129, 'a4689468c04ee0155c2b54915ba3f4c632c2c535960556e03fd9da5cb8e47ffa'),
    'run-console.log': (195, '067745453b886b0f306bbd9c5c007d56c1f356fd05cca231cbb86267d77815e0'),
    'run-stderr.log': (0, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'),
    'run.json': (225111, 'c9338c5ef3eae6b010e782df5a1aab55c1f69e1a54f81f4680bf52dcb280ae6a'),
    'execution.json': (57404, '36ee3f49099d862ccaa4c6a279d4a748d7cb8aae3ff1133dc3133d6e8829b705'),
}
def private_input(name, wanted):
    path = r / name
    info = path.lstat()
    assert path.is_file() and not path.is_symlink() and not getattr(info, 'st_file_attributes', 0) & 0x400
    data = path.read_bytes()
    assert {'bytes': len(data), 'sha256': sha(data)} == wanted, name
    assert subprocess.run(['git', 'check-ignore', '-q', '--', name]).returncode == 0
    assert subprocess.check_output(['git', 'ls-files', '--', name]) == b''
    assert subprocess.check_output(['git', 'diff', '--cached', '--name-only', '--', name]) == b''
    return data
private = {pre + suffix: {'bytes': size, 'sha256': digest} for suffix, (size, digest) in expected.items()}
raw = {suffix: private_input(pre + suffix, private[pre + suffix]) for suffix in expected}
old_index = json.loads((b / 'round-41/evidence-index.json').read_bytes())
previous_private = old_index['previousRoundPrivateInputsUnchanged'] | old_index['privateInputsRetainedUnchanged']
assert len(previous_private) == 30
for name, wanted in previous_private.items():
    private_input(name, wanted)
x = json.loads(raw['run.json'])
e = json.loads(raw['execution.json'])
c = json.loads(raw['check.json'])
source = x['sourceBefore']
assert source == x['sourceAfter'] == c['sourceBefore']
assert source['head'] == '6d79b0a0279d3f94f2d72d21f51ab1d654b0f509'
assert source['branch'] == 'worktree-resident-conversation-routing'
assert source['files'] == e['sourceBefore'] == e['sourceAfter'] and len(source['files']) == source['fileCount'] == 251
assert sha(json.dumps(source['files'], separators=(',', ':')).encode()) == source['aggregateSha256'] == '87eaab60b98532c133894ddac12ab927f6582377e8e52c4e11771a1ff0b91b23'
assert source['files']['src/process/windows-profile.js'] == '8f65c6ec916bf7da309e8bff9f5175ae7ad8d9a2f672212fd943f7d17496fff4'
assert x['sourceChanged'] == e['sourceChanged'] == [] and e['imageBefore'] == e['imageAfter'] and e['imageChanged'] is False
assert e['exitCode'] == 1 and e['naturalWaitReturned'] is True and e['forcedTermination'] is False and e['intervention'] is None
assert e['nativeRunCommandStarted'] is True and e['collectorSha256'] == expected['execute.py'][1]
assert 'collectorError' not in e and 'sourceReadbackError' not in e
assert x['componentPass'] is e['componentPass'] is False and e['componentWasProduced'] is True
assert e['freshCheck']['exitCode'] == 0 and e['freshCheck']['stderr'] == '' and raw['run-check.json'] == raw['check.json'] and raw['run-stderr.log'] == b''
assert x['installationRetained'] is True and (r / c['installation']).is_dir()
assert all(x[k] is True for k in ['hostInstantiated', 'nativeLoaderEntered', 'nativeFactoryEntered', 'frameCreationAttempted', 'scopePreparationAttempted', 'terminationAttempted', 'cleanupAttempted', 'scopeReleaseAttempted'])
assert x['originalFilePolicy']['mode'] == 'workspace-write' and len(x['policy']['readRoots']) == 4 and len(x['policy']['writeRoots']) == 2 and len(x['scopeRoots']) == 4
assert len(x['errors']) == 2 and x['errors'][0]['code'] == 'WINDOWS_PROFILE_OWNERSHIP_UNVERIFIED'
assert x['errors'][0]['message'] == 'Exact scope Host maintenance access was lost'
assert x['errors'][1]['code'] == 'ERR_ASSERTION' and 'out.settled&&out.releasedEntryId' in x['errors'][1]['message']
missing = ['scopePreparationResult', 'scopePreparationCommitted', 'scopePreparationAfter', 'scopeStageEvidence', 'settled', 'liveJobAudit', 'releasedLiveProofs', 'coldViaOriginalRecorder', 'cold']
assert all(key not in x for key in missing)
assert x['unknownOwnership'] == [] and x['nulRetained'] == 0 and len(x['nul']) == 3
for z in x['nul']:
    assert z['device'] == 'NUL' and z['namespacePath'] == chr(92) * 2 + '.' + chr(92) + 'NUL' and z['fd'] > 2
    assert all(z[key] is True for key in ['opened', 'validationAttempted', 'closeAttempted', 'closed'])
    assert z['flagsBefore'] == z['flagsAfter'] == 0
assert [z['stage'] for z in x['frameSnapshots']] == ['original-frame-bound', 'original-seal-complete', 'native-drained', 'native-handles-closed']
for z in x['frameSnapshots']:
    assert z['pid'] == 103728 and z['childCreated'] is z['assigned'] is z['preparationReleased'] is True
    assert z['payloadResumed'] is z['resumeAttempted'] is z['pendingPreparation'] is False
assert all(x['frameSnapshots'][-1][key] is True for key in ['initialThreadCloseAttempted', 'processCloseAttempted', 'jobCloseAttempted'])
assert all(x['frameSnapshots'][-1][key] is False for key in ['threadPresent', 'processPresent', 'jobPresent'])
assert x['nativeDrain'] == {'pid': 103728, 'childCreated': True, 'processSettled': True, 'jobEmpty': True, 'exitCode': 1}
assert all(x['sealResult'][key] is True for key in ['profileOwned', 'profileSealed', 'nativeTokenQualified', 'observationHandlesClosed'])
assert len(x['sealTargets']) == len(x['sealedReceipt']['sealEffects']) == 8
assert sorted(z['kind'] for z in x['sealTargets']) == [1, 1, 1, 1, 1, 1, 4, 4]
assert all(z['attempted'] is True and z['status'] == 0 and z['immediateVerified'] is True for z in x['sealedReceipt']['sealEffects'])
assert x['scopeReleaseResult'] == {'scopeReleased': True}
assert x['scopeReleaseBefore']['scopeEffects'] == x['scopeReleaseAfter']['scopeEffects'] == 0
assert x['scopeReleaseBefore']['scopeReleased'] is False and x['scopeReleaseAfter']['scopeReleased'] is True
assert [z['ownership']['scopeEffects'] for z in x['scopeSnapshots']] == [0, 0, 0, 0]
final = x['finalReceipt']
assert final == x['deletedReceipt'] and final['state'] == 'registration-and-folder-absent' and final['sealState'] == 'unknown-retained'
assert final['retainedHandles'] == final['retainedAllocations'] == 0
trail = x['failureCommittedEntries']
registered = next(z for z in trail if z['receipt']['kind'] == 'registered')['receipt']['payload']
resources = [z for z in trail if z['receipt']['kind'] == 'resource-ownership']
assert len(trail) == 6 and [z['receipt']['payload']['seq'] for z in resources] == [1, 2, 3, 4, 5]
assert [z['receipt']['payload']['resource']['status'] for z in resources] == ['planned', 'unknown-retained', 'unknown-retained', 'unknown-retained', 'released']
for z in trail:
    q = z['receipt']['payload']
    assert all(q[key] == registered[key] for key in ['jobId', 'owner', 'kind', 'label', 'startedAt', 'toolCall'])
assert registered['jobId'] == x['jobId'] and registered['owner'] == x['ownerId'] == x['executionIdentity']['owner']
for akey, bkey in [('callId', 'callId'), ('rootCallId', 'rootCallId'), ('toolName', 'name')]:
    assert registered['toolCall'][akey] == x['executionIdentity'][bkey]
assert resources[-1]['entryId'] == x['releasedEntryId'] == '3a2aeab8' and resources[-1]['receipt']['payload']['resource'] == x['released']
assert x['released']['retainedHandles'] == x['released']['retainedAllocations'] == x['released']['scopeEffects'] == 0
assert all(x['released'][key] is True for key in ['threadRestored', 'childSettled', 'jobEmpty', 'nativeHandlesClosed', 'scopeReleased', 'profileAbsent'])
assert x['released']['preparationPending'] is False
assert [z['receipt']['payload']['privateProof']['phase'] for z in x['proofEntries']] == ['profile-owned', 'profile-seal-frozen']
assert all(z in trail for z in x['proofEntries'])
assert x['jobTerminal']['status'] == 'failed' and x['task']['status'] == 'active' and x['task']['drained'] is True
assert x['task']['lastDecision']['action'] == 'blocked' and x['task']['lastDecision']['limitations'] == ['TASK_EFFECT_UNCERTAIN_NO_REPLAY']
init = x['birthInitialization']
assert init == x['workspaceInitialization'] and init['state'] == 'ready' and init['creationCommandId'] and init['sessionId'] == x['ownerId']
observation = init['observation']
assert observation['nativeResources'] == {'handles': {'acquired': 16, 'closed': 16, 'retained': 0}, 'local': {'acquired': 36, 'closed': 36, 'retained': 0}}
for name in ['work', 'tmp']:
    z = observation['directories'][name]
    assert z['createdControl'] == 0x9814 and z['control'] == 0x9c14 and z['initializationNeeded'] is True
v = x['launchEnvironmentVerification']
assert v['ownedProofEntryId'] == x['proofEntries'][0]['entryId'] and v['trustedLocalAppData'] == v['actualLocalAppData']
assert v['conflictsOverridden'] is v['otherEnvironmentUnchanged'] is True and len(v['otherKeys']) == 10
assert all(x[key] is False for key in ['readOnlyAdmission', 'runnerIpcAckQualified', 'productionScopeReady'])
inventory = b / 'test-case-inventory.csv'
ib = inventory.read_bytes()
assert len(ib) == 3335797 and sha(ib) == '4cb87a89885f8359d2b813580994d40dcd2d74bbc76ac4aac9138498e0891f2f'
assert len(list(csv.DictReader(io.StringIO(ib.decode())))) == 5485
matrix = b / 'matrix.csv'
mb = matrix.read_bytes()
assert len(mb) == 237308 and sha(mb) == '207e609b14008e2b8858793944ef8125c59149c3d2eceac9fa7a4ec5854e112c'
reader = csv.DictReader(io.StringIO(mb.decode()))
rows, fields = list(reader), reader.fieldnames
assert len(rows) == 315 and fields[-1] == 'round_41'
def render(rows, fields):
    out = io.StringIO(newline='')
    writer = csv.DictWriter(out, fieldnames=fields, lineterminator='\n')
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue().encode()
assert render(rows, fields) == mb
for row in rows:
    row['round_42'] = 'NOT_RERUN_ROUND_42'
updates = {
    'all-required-regressions': 'PARTIAL_BUSINESS_SCOPE_COMPONENT_FAIL_HOST_MAINTENANCE_GUARD_NO_FROZEN_OR_PLANNED_RELEASE_NOT_FULL_REGRESSION',
    'sg11-final-remaining-checks': 'PARTIAL_16_24_SCOPE_GRANT_FAIL_NO_PLAN_CLEANUP_RELEASED_ONLY_NO_SUCCESS_PRODUCER_LIVE_COLD_OR_RUNNER_CLAIM',
    'sg11-workspace-native-initialization': 'PASS_FOURTH_FRESH_TASK_INITIALIZATION_READY_9814_TO_9C14_HANDLES16_LOCAL36_CLOSED_ONLY',
    'sg11-profile-suspended-sdk-seal': 'PASS_SDK_SEAL_SUBCOMPONENT_BEFORE_BUSINESS_SCOPE_FAILURE_REAL_SUSPENDED_CHILD_EIGHT_STAGES_NO_RESUME',
    'sg11-native-nul-device-stdio': 'PASS_THREE_OWNED_NUL_FDS_OPENED_VALIDATED_FLAGS_RESTORED_CLOSED_IN_THIS_FAILED_SCOPE_COMPONENT',
    'sg11-native-localappdata-environment': 'PASS_ORIGINAL_RESOURCE_TRUSTED_LOCALAPPDATA_CASE_CONFLICTS_OVERRIDDEN_OTHER_TEN_KEYS_UNCHANGED_NO_CHILD_ENV_CLAIM',
}
for key, status in updates.items():
    matches = [row for row in rows if row['case_id'] == key]
    assert len(matches) == 1
    matches[0]['round_42'] = status
new_key = 'sg11-profile-suspended-business-scope'
assert new_key not in {row['case_id'] for row in rows}
new_row = {key: '' for key in fields + ['round_42']}
new_row.update(case_id=new_key, scenario='新默认Low任务四读两写：原挂起scope准备被Host维护权限守卫拒绝，未冻结或apply；原无plan失败回收released0/0，不证有plan撤权', round_42='FAIL_ORIGINAL_HOST_MAINTENANCE_ACCESS_GUARD_BEFORE_SCOPE_FROZEN_EFFECTS_ZERO_NO_PLAN_CLEANUP_RELEASED_TASK_NO_REPLAY')
rows.append(new_row)
assert render([{key: row[key] for key in fields} for row in rows[:315]], fields) == mb
assert sum(row['round_42'] == 'NOT_RERUN_ROUND_42' for row in rows) == 309
matrix_after = render(rows, fields + ['round_42'])
summary = {
    'round': 42, 'result': 'FAIL_BUSINESS_SCOPE_COMPONENT',
    'scope': 'Original suspended scope preparation failed Host maintenance access; no scope-frozen or grant; no-plan cleanup is not planned mandatory recovery',
    'hostTask': 'bc6xug0pk', 'toolUseId': 'call_65fefcfa535d4653ace844ff2eaa7d7a', 'driverSha256': e['collectorSha256'],
    'nodePid': e['nodePid'], 'startedAt': e['startedAt'], 'finishedAt': e['finishedAt'], 'nodeExitCode': 1, 'driverExitCode': 1,
    'naturalWaitReturned': True, 'forcedTermination': False, 'componentWasProduced': True, 'componentPass': False,
    'sourceCount': 251, 'sourceAggregateSha256': source['aggregateSha256'], 'sourceChanged': [], 'imageChanged': False,
    'freshCheck': e['freshCheck'], 'errors': x['errors'], 'unknownOwnershipCount': 0, 'steps': x['steps'],
    'standingMode': 'workspace-write', 'readRootCount': 4, 'writeRootCount': 2, 'scopeCount': 4, 'profilePrivateTempCreated': False,
    'scopePreparationAttempted': True, 'scopePreparationReturned': False, 'scopeFrozenProduced': False,
    'failedTargetOrBaselineVersusCandidateKnown': False, 'scopePerStageNativeStatusesExported': False,
    'scopeEffectsSnapshots': [{'stage': z['stage'], 'scopeEffects': z['ownership']['scopeEffects'], 'preparationPending': z['ownership']['preparationPending'], 'scopeReleased': z['ownership']['scopeReleased']} for z in x['scopeSnapshots']],
    'scopeReleaseResult': x['scopeReleaseResult'], 'scopeReleaseBranch': 'no-plan-zero-effects', 'withPlanMandatoryRecoveryPassed': False,
    'nulEndpoints': x['nul'], 'nulRetained': 0, 'frameSnapshots': x['frameSnapshots'], 'nativeDrain': x['nativeDrain'], 'payloadResumed': False,
    'sealResult': x['sealResult'], 'sealTargets': {'fileObjects': 6, 'registryObjects': 2}, 'allEightSealEffectsAttemptedStatusZeroImmediatelyVerified': True,
    'finalProfileState': final['state'], 'finalSealState': final['sealState'], 'retainedHandles': 0, 'retainedAllocations': 0,
    'resourceTrail': [{'seq': z['receipt']['payload']['seq'], **{key: z['receipt']['payload']['resource'][key] for key in ['status', 'scopeEffects', 'retainedHandles', 'retainedAllocations', 'preparationPending', 'scopeReleased']}} for z in resources],
    'originalReleasedEntryId': x['releasedEntryId'], 'proofPhases': ['profile-owned', 'profile-seal-frozen'],
    'jobTerminal': 'failed', 'taskStatus': 'active', 'taskDrained': True, 'taskDecision': 'blocked', 'taskLimitations': x['task']['lastDecision']['limitations'],
    'successSettledLiveStrictColdProduced': False, 'absentSuccessAndScopeFields': missing,
    'workspaceInitialization': {'state': 'ready', 'birthEqualsFinal': True, 'directories': {name: {key: observation['directories'][name][key] for key in ['createdControl', 'initializationNeeded', 'control']} for name in ['work', 'tmp']}, 'nativeResources': observation['nativeResources']},
    'environmentVerification': {'ownedProofEntryId': v['ownedProofEntryId'], 'trustedMatchesActual': True, 'conflictingKeys': v['conflictingKeys'], 'otherKeys': v['otherKeys'], 'conflictsOverridden': True, 'otherEnvironmentUnchanged': True, 'childEnvironmentNotObserved': True},
    'installationRetained': True, 'readOnlyAdmission': False, 'runnerIpcAckQualified': False, 'productionScopeReady': False,
    'inventoryRows': 5485, 'inventoryUnchangedSha256': sha(ib), 'matrixRowsBefore': 315, 'matrixRowsAfter': 316,
}
outputs = {d / 'source.json': encode(source), d / 'summary.json': encode(summary), d / 'native-console.log': raw['run-console.log']}
def public_strings(value):
    if isinstance(value, dict):
        for key, item in value.items():
            yield key
            yield from public_strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from public_strings(item)
    elif isinstance(value, str):
        yield value
for path, data in outputs.items():
    values = public_strings(json.loads(data)) if path.suffix == '.json' else [data.decode('utf-8')]
    for value in values:
        assert not re.search('[A-Za-z]:[' + chr(92) * 2 + '/]', value), 'Absolute path in public evidence'
        assert 'S-1-15-' not in value and 'S-1-5-21-' not in value
index = {
    'round': 42, 'privateInputsRetainedUnchanged': private, 'previousRoundPrivateInputsUnchanged': previous_private,
    'artifacts': {path.relative_to(b).as_posix(): {'bytes': len(data), 'sha256': sha(data)} for path, data in outputs.items()},
    'report': {'path': 'round-42.md', 'bytes': len((b / 'round-42.md').read_bytes()), 'sha256': sha((b / 'round-42.md').read_bytes())},
    'archiveRecipe': {'path': 'round-42/archive-update.py', 'sha256': sha(Path(__file__).read_bytes())},
    'retainedInstallation': {'present': True, 'journalNotDecodedByArchive': True},
    'inventory': {'rows': 5485, 'unchangedBytes': len(ib), 'unchangedSha256': sha(ib)},
    'matrix': {'beforeBytes': len(mb), 'beforeSha256': sha(mb), 'afterBytes': len(matrix_after), 'afterSha256': sha(matrix_after)},
}
outputs[d / 'evidence-index.json'] = encode(index)
assert all(not path.exists() and not path.is_symlink() for path in outputs)
print(json.dumps({'mode': 'check' if a.check else 'run', 'effects': 0 if a.check else 'four-public-files-and-matrix-only', 'componentPass': False, 'originalNodeExitCode': 1, 'childCreated': True, 'payloadResumed': False, 'scopeFrozenProduced': False, 'scopeReleaseBranch': 'no-plan-zero-effects', 'originalLatestResourceStatus': 'released', 'jobTerminal': 'failed', 'taskDecision': 'blocked', 'successLiveStrictColdProduced': False, 'nativeInvokedByArchive': False, 'privateAssetsWritten': False, 'previousRoundThirtyUnchanged': True, 'inventoryUnchanged': True, 'matrixRowsBefore': 315, 'matrixRowsAfter': 316, 'matrixAfterSha256': sha(matrix_after), 'oldMatrixReconstructsExactly': True, 'publicArtifacts': len(outputs)}, ensure_ascii=False))
if a.run:
    assert inventory.read_bytes() == ib and matrix.read_bytes() == mb
    for path, data in outputs.items():
        with path.open('xb') as file:
            file.write(data)
    matrix.write_bytes(matrix_after)
    assert inventory.read_bytes() == ib
