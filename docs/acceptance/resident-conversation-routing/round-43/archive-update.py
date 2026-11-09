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
d = b / 'round-43'
assert Path(__file__).resolve() == d / 'archive-update.py'
sha = lambda data: hashlib.sha256(data).hexdigest()
encode = lambda value: (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()
pre = 'docs/tmp/sg11-profile-scope-context-'
expected = {
    'probe.mjs': (74261, 'deeb1231fb0ac6a2d3a0b1e40d7fb72575f69a9c554f34bb773f8c802efe55d9'),
    'checklist.md': (45445, '8428185bb44abccacef0a33695c6a26e73b5f968df26efabd6a5e0a99d6b9820'),
    'check.json': (32103, '300d6e404d69afcd63872af6dad2d80faa7f440a9c08e70335cb08aa830d4409'),
    'check-execution.json': (58399, '6b54b5771ad3f2874d3cf9236ace3886ecf4b35b6bbb4eb8a1915561a9953cab'),
    'execute.py': (9632, 'c12e5ef6671d780d481aed809695dbd5abe92ec13297df4a017be5a4f73192be'),
    'run-check.json': (32103, '300d6e404d69afcd63872af6dad2d80faa7f440a9c08e70335cb08aa830d4409'),
    'run-console.log': (193, '9e32ad848aed8f2da726a80d40a7a4ee994f470a2b84e99518088045092a1e64'),
    'run-stderr.log': (0, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'),
    'run.json': (228260, 'a33bf26e6683f341d9d136288bdeb9398e757a34830c9fe5163f8e2756ea562f'),
    'execution.json': (57380, '9de39983f1b7548f6769275d7dd2477450486898369fead8e00ebe5e7b306a5e'),
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
old_index_bytes = (b / 'round-42/evidence-index.json').read_bytes()
assert len(old_index_bytes) == 8374 and sha(old_index_bytes) == 'e4f6725442492337f0c5aece0df07c72d9157968198302957cd98c2224db8112'
old_index = json.loads(old_index_bytes)
previous_private = old_index['previousRoundPrivateInputsUnchanged'] | old_index['privateInputsRetainedUnchanged']
assert len(previous_private) == 40
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
assert sha(json.dumps(source['files'], separators=(',', ':')).encode()) == source['aggregateSha256'] == '2bb71e7b3a7e64fc315413d22be9c2023588ff7f3de0acb47ebe5dace2c58e18'
assert source['files']['src/process/windows-profile.js'] == 'a2d30ea9b53ed819ad6aba87105650d655660ea891407c7161a706499f2cdf5a'
assert x['sourceChanged'] == e['sourceChanged'] == [] and e['imageBefore'] == e['imageAfter'] and e['imageChanged'] is False
assert e['exitCode'] == 1 and e['nodePid'] == 99892 and e['naturalWaitReturned'] is True and e['forcedTermination'] is False and e['intervention'] is None
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
context = x['errors'][0]['privateScopeHostMaintenance']
target = context['target']
descriptors = context['descriptors']
materials_root = next(z for z in x['scopeRoots'] if Path(z['path']).name == 'materials')
assert context['kind'] == 'scope-host-maintenance' and context['site'] == 'prepare.candidate'
assert context['preparationStage'] == 'scope'
assert context['mask'] == 0x40000 and context['allowed'] is False and context['granted'] == 0
assert target['name'] == materials_root['path'] and target['fileId'] == materials_root['fileId']
assert target['kind'] == 1 and target['directory'] is True and target['access'] == materials_root['access'] == 'read'
assert set(descriptors) == {'actual', 'expected', 'original', 'candidate'}
assert descriptors['actual'] == descriptors['expected'] == descriptors['candidate']
assert descriptors['original'] != descriptors['candidate']
def public_error(value):
    result = {key: value[key] for key in ['name', 'message', 'code', 'api', 'win32Code'] if key in value}
    if 'errors' in value:
        result['errors'] = [public_error(item) for item in value['errors']]
    return result
public_errors = [public_error(value) for value in x['errors']]
diagnostic = {
    'site': context['site'], 'preparationStage': context['preparationStage'],
    'targetRole': 'materials-root', 'targetAccess': 'read', 'targetDirectory': True,
    'mask': context['mask'], 'maskName': 'WRITE_DAC', 'allowed': False, 'granted': 0,
    'actualEqualsExpected': True, 'actualEqualsCandidate': True, 'originalEqualsCandidate': False,
    'privateContextIncluded': False, 'source': pre + 'run.json',
}
missing = ['scopePreparationResult', 'scopePreparationCommitted', 'scopePreparationAfter', 'scopeStageEvidence', 'settled', 'liveJobAudit', 'releasedLiveProofs', 'coldViaOriginalRecorder', 'cold']
assert all(key not in x for key in missing)
assert x['unknownOwnership'] == [] and x['nulRetained'] == 0 and len(x['nul']) == 3
for z in x['nul']:
    assert z['device'] == 'NUL' and z['namespacePath'] == chr(92) * 2 + '.' + chr(92) + 'NUL' and z['fd'] > 2
    assert all(z[key] is True for key in ['opened', 'validationAttempted', 'closeAttempted', 'closed'])
    assert z['flagsBefore'] == z['flagsAfter'] == 0
assert [z['stage'] for z in x['frameSnapshots']] == ['original-frame-bound', 'original-seal-complete', 'native-drained', 'native-handles-closed']
for z in x['frameSnapshots']:
    assert z['pid'] == 71796 and z['childCreated'] is z['assigned'] is z['preparationReleased'] is True
    assert z['payloadResumed'] is z['resumeAttempted'] is z['pendingPreparation'] is False
assert all(x['frameSnapshots'][-1][key] is True for key in ['initialThreadCloseAttempted', 'processCloseAttempted', 'jobCloseAttempted'])
assert all(x['frameSnapshots'][-1][key] is False for key in ['threadPresent', 'processPresent', 'jobPresent'])
assert x['nativeDrain'] == {'pid': 71796, 'childCreated': True, 'processSettled': True, 'jobEmpty': True, 'exitCode': 1}
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
assert resources[-1]['entryId'] == x['releasedEntryId'] == '6377bc3b' and resources[-1]['receipt']['payload']['resource'] == x['released']
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
assert len(mb) == 244161 and sha(mb) == '8fd704176eaf2f19899b8fa735aea4d893439dda5da0a5a50cb0a06ddd5943af'
reader = csv.DictReader(io.StringIO(mb.decode()))
rows, fields = list(reader), reader.fieldnames
assert len(rows) == 316 and fields[-1] == 'round_42'
def render(rows, fields):
    out = io.StringIO(newline='')
    writer = csv.DictWriter(out, fieldnames=fields, lineterminator='\n')
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue().encode()
assert render(rows, fields) == mb
for row in rows:
    row['round_43'] = 'NOT_RERUN_ROUND_43'
updates = {
    'all-required-regressions': 'PARTIAL_CANDIDATE_MATERIALS_WRITE_DAC_GUARD_FAIL_PRIVATE_DIAGNOSTIC_NOT_FULL_REGRESSION',
    'sg11-final-remaining-checks': 'PARTIAL_16_25_CANDIDATE_DIAGNOSTIC_FAIL_NO_PLAN_RELEASED_ONLY_NO_SUCCESS_PRODUCER_LIVE_COLD_OR_RUNNER_CLAIM',
    'sg11-workspace-native-initialization': 'PASS_FRESH_TASK_INITIALIZATION_READY_9814_TO_9C14_HANDLES16_LOCAL36_CLOSED_ONLY',
    'sg11-profile-suspended-sdk-seal': 'PASS_SDK_SEAL_SUBCOMPONENT_BEFORE_CANDIDATE_SCOPE_FAILURE_REAL_SUSPENDED_CHILD_EIGHT_STAGES_NO_RESUME',
    'sg11-native-nul-device-stdio': 'PASS_THREE_OWNED_NUL_FDS_OPENED_VALIDATED_FLAGS_RESTORED_CLOSED_IN_THIS_FAILED_SCOPE_COMPONENT',
    'sg11-native-localappdata-environment': 'PASS_ORIGINAL_RESOURCE_TRUSTED_LOCALAPPDATA_CASE_CONFLICTS_OVERRIDDEN_OTHER_TEN_KEYS_UNCHANGED_NO_CHILD_ENV_CLAIM',
    'sg11-profile-suspended-business-scope': 'FAIL_PREPARE_CANDIDATE_MATERIALS_READ_ROOT_HOST_WRITE_DAC_40000_DENIED_BEFORE_SCOPE_FROZEN_NO_PLAN_RELEASED_TASK_NO_REPLAY',
}
for key, status in updates.items():
    matches = [row for row in rows if row['case_id'] == key]
    assert len(matches) == 1
    matches[0]['round_43'] = status
assert render([{key: row[key] for key in fields} for row in rows], fields) == mb
assert sum(row['round_43'] == 'NOT_RERUN_ROUND_43' for row in rows) == 309
matrix_after = render(rows, fields + ['round_43'])
summary = {
    'round': 43, 'result': 'FAIL_BUSINESS_SCOPE_COMPONENT_WITH_PRIVATE_CANDIDATE_DIAGNOSTIC',
    'scope': 'Candidate materials read-root DACL failed original Host WRITE_DAC guard before scope-frozen; no-plan cleanup is not planned mandatory recovery',
    'hostTask': 'bkjb3x5hl', 'toolUseId': 'call_a852fb48a4f045d1a5679c3aa4fca2aa', 'driverSha256': e['collectorSha256'],
    'nodePid': e['nodePid'], 'startedAt': e['startedAt'], 'finishedAt': e['finishedAt'], 'nodeExitCode': 1, 'driverExitCode': 1,
    'naturalWaitReturned': True, 'forcedTermination': False, 'componentWasProduced': True, 'componentPass': False,
    'sourceCount': 251, 'sourceAggregateSha256': source['aggregateSha256'], 'sourceChanged': [], 'imageChanged': False,
    'freshCheck': e['freshCheck'], 'errors': public_errors, 'hostMaintenanceDiagnostic': diagnostic, 'unknownOwnershipCount': 0, 'steps': x['steps'],
    'standingMode': 'workspace-write', 'readRootCount': 4, 'writeRootCount': 2, 'scopeCount': 4, 'profilePrivateTempCreated': False,
    'scopePreparationAttempted': True, 'scopePreparationReturned': False, 'scopeFrozenProduced': False,
    'failedTargetRoleAndBaselineVersusCandidateKnown': True, 'scopePerStageNativeStatusesExported': False,
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
    'inventoryRows': 5485, 'inventoryUnchangedSha256': sha(ib), 'matrixRowsBefore': 316, 'matrixRowsAfter': 316,
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
        assert 'privateScopeHostMaintenance' not in value
        assert all(secret not in value for secret in [target['name'], target['fileId'], *descriptors.values()])
index = {
    'round': 43, 'privateInputsRetainedUnchanged': private, 'previousRoundPrivateInputsUnchanged': previous_private,
    'artifacts': {path.relative_to(b).as_posix(): {'bytes': len(data), 'sha256': sha(data)} for path, data in outputs.items()},
    'report': {'path': 'round-43.md', 'bytes': len((b / 'round-43.md').read_bytes()), 'sha256': sha((b / 'round-43.md').read_bytes())},
    'archiveRecipe': {'path': 'round-43/archive-update.py', 'sha256': sha(Path(__file__).read_bytes())},
    'retainedInstallation': {'present': True, 'journalNotDecodedByArchive': True},
    'inventory': {'rows': 5485, 'unchangedBytes': len(ib), 'unchangedSha256': sha(ib)},
    'matrix': {'beforeBytes': len(mb), 'beforeSha256': sha(mb), 'afterBytes': len(matrix_after), 'afterSha256': sha(matrix_after)},
}
outputs[d / 'evidence-index.json'] = encode(index)
assert all(not path.exists() and not path.is_symlink() for path in outputs)
print(json.dumps({'mode': 'check' if a.check else 'run', 'effects': 0 if a.check else 'four-public-files-and-matrix-only', 'componentPass': False, 'diagnosticSite': 'prepare.candidate', 'targetRole': 'materials-root', 'mask': '0x40000', 'privateContextIncluded': False, 'originalNodeExitCode': 1, 'childCreated': True, 'payloadResumed': False, 'scopeFrozenProduced': False, 'scopeReleaseBranch': 'no-plan-zero-effects', 'originalLatestResourceStatus': 'released', 'jobTerminal': 'failed', 'taskDecision': 'blocked', 'successLiveStrictColdProduced': False, 'nativeInvokedByArchive': False, 'privateAssetsWritten': False, 'previousRoundFortyUnchanged': True, 'inventoryUnchanged': True, 'matrixRowsBefore': 316, 'matrixRowsAfter': 316, 'matrixAfterSha256': sha(matrix_after), 'oldMatrixReconstructsExactly': True, 'publicArtifacts': len(outputs)}, ensure_ascii=False))
if a.run:
    assert inventory.read_bytes() == ib and matrix.read_bytes() == mb
    for path, data in outputs.items():
        with path.open('xb') as file:
            file.write(data)
    matrix.write_bytes(matrix_after)
    assert inventory.read_bytes() == ib
