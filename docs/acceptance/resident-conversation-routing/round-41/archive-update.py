from pathlib import Path, PureWindowsPath
import argparse, csv, hashlib, io, json, re, subprocess, sys

sys.stdout.reconfigure(encoding='utf-8')
p = argparse.ArgumentParser()
g = p.add_mutually_exclusive_group(required=True)
g.add_argument('--check', action='store_true')
g.add_argument('--run', action='store_true')
a = p.parse_args()
r = Path.cwd().resolve()
b = r / 'docs/acceptance/resident-conversation-routing'
d = b / 'round-41'
assert Path(__file__).resolve() == d / 'archive-update.py'
sha = lambda data: hashlib.sha256(data).hexdigest()
encode = lambda value: (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()
pre = 'docs/tmp/sg11-profile-suspended-seal-localappdata-'
expected = {
    'probe.mjs': (59958, 'b035dc304676e5bfb31e883b17883ca53505e72dda21e870edd6fd7004b1e866'),
    'checklist.md': (30166, '11bab611e384d535ab4fe556a5ef1147e4798023bef0308072ab99fea8b34511'),
    'check.json': (31662, 'ad9ed50b2d9adabd7478ef01ae972abf18d99f1b1f4600ecca2de781975e5e78'),
    'check-execution.json': (59699, '2304a94f735a120200437a7a78f417bcf7b74f9da8462443b0f441f170fd20b7'),
    'execute.py': (9660, '5976ef645f93a7d87f58171e69d20836dfd49f185528f08b44fd03f7c800a24d'),
    'run-check.json': (31662, 'ad9ed50b2d9adabd7478ef01ae972abf18d99f1b1f4600ecca2de781975e5e78'),
    'run-console.log': (209, '852888ae623f0cd4f7328bd930fc7b0d50b3e25360b999281c265343e45710a8'),
    'run-stderr.log': (0, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'),
    'run.json': (441696, 'a910e6412862ba60ac77b11ce8fa7e42198bf2b1e7fefb247e0855d14c00659d'),
    'execution.json': (57547, '34d7f107f1f2d557c37e1ecc7671345e2b1b2bc8ee46362c8d3211371de4a823'),
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
old_index = json.loads((b / 'round-40/evidence-index.json').read_bytes())
previous_private = old_index['previousRoundPrivateInputsUnchanged'] | old_index['privateInputsRetainedUnchanged']
assert len(previous_private) == 20
for name, wanted in previous_private.items():
    private_input(name, wanted)
x = json.loads(raw['run.json'])
e = json.loads(raw['execution.json'])
c = json.loads(raw['check.json'])
assert x['sourceBefore'] == x['sourceAfter'] == c['sourceBefore']
source = x['sourceBefore']
assert source['head'] == '6d79b0a0279d3f94f2d72d21f51ab1d654b0f509'
assert source['branch'] == 'worktree-resident-conversation-routing'
assert source['files'] == e['sourceBefore'] == e['sourceAfter'] and len(source['files']) == source['fileCount'] == 251
assert sha(json.dumps(source['files'], separators=(',', ':')).encode()) == source['aggregateSha256'] == 'bcda7a4c1ae09d79b643bc9efc8e979a9e981398c8a719f11930a42dc4486d05'
assert source['files']['src/process/windows-profile.js'] == '8f65c6ec916bf7da309e8bff9f5175ae7ad8d9a2f672212fd943f7d17496fff4'
assert x['sourceChanged'] == e['sourceChanged'] == [] and e['imageChanged'] is False and e['imageBefore'] == e['imageAfter']
assert e['exitCode'] == 0 and e['naturalWaitReturned'] is True and e['forcedTermination'] is False and e['intervention'] is None
assert e['nativeRunCommandStarted'] is True and e['collectorSha256'] == expected['execute.py'][1]
assert 'collectorError' not in e and 'sourceReadbackError' not in e
assert x['componentPass'] is e['componentPass'] is e['componentWasProduced'] is True
assert e['freshCheck']['exitCode'] == 0 and e['freshCheck']['stderr'] == '' and raw['run-check.json'] == raw['check.json']
assert raw['run-stderr.log'] == b'' and x['errors'] == x['unknownOwnership'] == []
assert x['hostInstantiated'] is x['nativeLoaderEntered'] is x['nativeFactoryEntered'] is True
assert x['frameCreationAttempted'] is x['terminationAttempted'] is x['cleanupAttempted'] is True
assert x['installationRetained'] is True and (r / c['installation']).is_dir()
assert len(x['nul']) == 3 and x['nulRetained'] == 0
for z in x['nul']:
    assert z['device'] == 'NUL' and z['namespacePath'] == chr(92) * 2 + '.' + chr(92) + 'NUL'
    assert z['fd'] > 2 and all(z[k] is True for k in ['opened', 'validationAttempted', 'closeAttempted', 'closed'])
    assert z['flagsBefore'] == z['flagsAfter'] == 0
assert len(x['frameSnapshots']) == 4
assert [z['stage'] for z in x['frameSnapshots']] == ['original-frame-bound', 'original-seal-complete', 'native-drained', 'native-handles-closed']
for z in x['frameSnapshots']:
    assert z['pid'] == 42812 and z['childCreated'] is z['assigned'] is z['jobConfigured'] is z['preparationReleased'] is True
    assert z['payloadResumed'] is z['resumeAttempted'] is z['pendingPreparation'] is False
last_frame = x['frameSnapshots'][-1]
assert all(last_frame[k] is True for k in ['initialThreadCloseAttempted', 'processCloseAttempted', 'jobCloseAttempted'])
assert all(last_frame[k] is False for k in ['processPresent', 'threadPresent', 'jobPresent'])
assert x['nativeDrain'] == {'pid': 42812, 'childCreated': True, 'processSettled': True, 'jobEmpty': True, 'exitCode': 1}
assert all(x['sealResult'][k] is True for k in ['profileOwned', 'profileSealed', 'nativeTokenQualified', 'observationHandlesClosed'])
assert x['sealedReceipt']['sealed'] is True and x['sealedReceipt']['sealState'] == 'sealed'
assert len(x['sealTargets']) == len(x['sealedReceipt']['sealEffects']) == 8
assert sorted(z['kind'] for z in x['sealTargets']) == [1, 1, 1, 1, 1, 1, 4, 4]
assert all(z['attempted'] is True and z['status'] == 0 and z['immediateVerified'] is True for z in x['sealedReceipt']['sealEffects'])
final = x['finalReceipt']
assert final == x['deletedReceipt']
assert final['state'] == 'registration-and-folder-absent' and final['sealed'] is True and final['sealState'] == 'sealed'
assert final['retainedHandles'] == final['retainedAllocations'] == 0
assert x['independentTempAbsent'] is True and len(x['independentSdkAbsent']) == 6
assert x['jobTerminal']['status'] == 'completed'
assert x['task']['status'] == 'active' and x['task']['drained'] is True
assert x['task']['lastDecision']['action'] == 'wait' and x['task']['lastDecision']['limitations'] == []
audit = x['liveJobAudit']
registered = x['registration']['receipt']['payload']
assert len(audit) == 7 and sum(z['kind'] == 'registered' for z in audit) == 1
resources = [z['payload'] for z in audit if z['kind'] == 'resource-ownership']
assert [z['seq'] for z in resources] == [1, 2, 3, 4, 5]
assert [z['resource']['status'] for z in resources] == ['planned', 'unknown-retained', 'unknown-retained', 'unknown-retained', 'released']
assert resources[-1]['resource'] == x['released'] and x['releasedEntryId'] == 'aa234f8a'
assert x['released']['retainedHandles'] == x['released']['retainedAllocations'] == x['released']['scopeEffects'] == 0
assert all(x['released'][k] is True for k in ['threadRestored', 'childSettled', 'jobEmpty', 'nativeHandlesClosed', 'scopeReleased', 'profileAbsent'])
assert x['released']['preparationPending'] is False
for z in audit:
    q = z['payload']
    assert q['jobId'] == registered['jobId'] == x['jobId']
    assert q['owner'] == registered['owner'] == x['ownerId'] == x['executionIdentity']['owner']
    assert all(q[k] == registered[k] for k in ['toolCall', 'startedAt', 'kind'])
assert registered['toolCall']['callId'] == x['executionIdentity']['callId']
assert registered['toolCall']['rootCallId'] == x['executionIdentity']['rootCallId']
assert registered['toolCall']['toolName'] == x['executionIdentity']['name']
settled = x['settled']['receipt']
assert x['settled']['entryId'] == 'd87d53b3' and settled in audit and settled['kind'] == 'settled'
assert settled['payload']['status'] == 'completed' and settled['payload']['producerReported'] is True
proofs = x['proofEntries']
assert [z['receipt']['payload']['privateProof']['phase'] for z in proofs] == ['profile-owned', 'profile-seal-frozen']
for z in proofs:
    assert z['receipt'] in audit
    assert z['receipt']['payload']['privateProof']['profileName'] == final['name']
    assert z['receipt']['payload']['privateProof']['profileSid'] == final['sid']
v = x['launchEnvironmentVerification']
assert v['ownedProofEntryId'] == proofs[0]['entryId'] == '73f7a3c9'
roots = [z for z in proofs[0]['receipt']['payload']['privateProof']['objects'] if z['kind'] == 1 and z['role'] == 'profile' and z['directory'] and z['parent'] is None]
assert len(roots) == 1 and roots[0]['name'] == v['sdkRoot']
sdk = PureWindowsPath(v['sdkRoot'])
assert sdk.name == final['name'] and sdk.parent.name.upper() == 'PACKAGES'
assert sdk.parent.parent == PureWindowsPath(v['trustedLocalAppData']) == PureWindowsPath(v['actualLocalAppData'])
assert v['conflictsOverridden'] is v['otherEnvironmentUnchanged'] is True
assert v['conflictingKeys'] == ['LOCALAPPDATA', 'localappdata', 'LoCaLaPpDaTa']
env = x['launch']['env']
assert env['LOCALAPPDATA'] == v['actualLocalAppData']
assert [k for k in env if k.upper() == 'LOCALAPPDATA'] == ['LOCALAPPDATA']
expected_other = c['target']['environmentBase'] | {'HOME': x['launch']['cwd'], 'USERPROFILE': x['launch']['cwd']}
expected_temp = str(PureWindowsPath(x['policy']['tempRoot']) / final['name'])
expected_other |= {k: expected_temp for k in ['TEMP', 'TMP', 'TMPDIR']}
assert sorted(v['otherKeys']) == sorted(expected_other)
assert set(env) == set(expected_other) | {'LOCALAPPDATA'}
assert all(env[k] == value for k, value in expected_other.items())
assert x['liveUnresolved'] == x['cold']['unresolved'] == []
assert x['coldViaOriginalRecorder'] == x['releasedLiveProofs'] and len(x['releasedLiveProofs']) == 2
for z, proof in zip(x['releasedLiveProofs'], proofs):
    assert z['owner'] == x['ownerId'] and z['jobId'] == x['jobId']
    assert z['entryId'] == proof['entryId'] and z['privateProof'] == proof['receipt']['payload']['privateProof']
    assert z['resource'] == x['released']
cold_job = [z for z in x['cold']['audit'] if z['domain'] == 'job' and z['payload']['jobId'] == x['jobId']]
assert cold_job == audit
journal = Path(x['cold']['journalPath'])
assert journal.is_relative_to(r / c['installation'])
journal_bytes = journal.read_bytes()
assert len(journal_bytes) == x['cold']['bytes'] == 98651
assert sha(journal_bytes) == x['cold']['sha256'] == '2406bb99e2214f171d54dee985e03c138371099d0c31bec07e499e7d2ecf3b8a'
init = x['workspaceInitialization']
assert init['state'] == 'ready' and init['sessionId'] == x['task']['sessionId'] == x['ownerId']
assert init['creationCommandId'] == x['task']['workspaceInitialization']['creationCommandId']
observation = init['observation']
for name in ['work', 'tmp']:
    z = observation['directories'][name]
    assert z['createdControl'] == 0x9814 and z['initializationNeeded'] is True and z['control'] == 0x9c14
assert observation['nativeResources'] == {'handles': {'acquired': 16, 'closed': 16, 'retained': 0}, 'local': {'acquired': 36, 'closed': 36, 'retained': 0}}
assert all(x[k] is False for k in ['readOnlyAdmission', 'runnerIpcAckQualified', 'productionScopeReady'])
inventory = b / 'test-case-inventory.csv'
ib = inventory.read_bytes()
assert len(ib) == 3335797 and sha(ib) == '4cb87a89885f8359d2b813580994d40dcd2d74bbc76ac4aac9138498e0891f2f'
assert len(list(csv.DictReader(io.StringIO(ib.decode())))) == 5485
matrix = b / 'matrix.csv'
mb = matrix.read_bytes()
assert len(mb) == 230512 and sha(mb) == '0f2d1ba35c4f73821771c9e5d53315477c011252601939615f669e51e79b0623'
reader = csv.DictReader(io.StringIO(mb.decode()))
rows = list(reader)
fields = reader.fieldnames
assert len(rows) == 314 and fields[-1] == 'round_40'
def render(rows, fields):
    out = io.StringIO(newline='')
    writer = csv.DictWriter(out, fieldnames=fields, lineterminator='\n')
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue().encode()
assert render(rows, fields) == mb
for row in rows:
    row['round_41'] = 'NOT_RERUN_ROUND_41'
updates = {
    'all-required-regressions': 'PARTIAL_LOCALAPPDATA_AND_SUSPENDED_SDK_SEAL_COMPONENT_PASS_ORIGINAL_DRAIN_RELEASE_SETTLED_LIVE_COLD_NOT_FULL_REGRESSION',
    'sg11-final-remaining-checks': 'PARTIAL_16_23_ENVIRONMENT_AND_16_21_COMPONENT_PASS_NO_RESUME_ACK_CONPTY_BUSINESS_SCOPES_OLD_TREE_OR_FULL_PLATFORM_CLAIM',
    'sg11-workspace-native-initialization': 'PASS_THIRD_FRESH_TASK_NATIVE_INITIALIZATION_READY_9814_TO_9C14_HANDLES16_LOCAL36_CLOSED_ONLY',
    'sg11-profile-suspended-sdk-seal': 'PASS_COMPONENT_REAL_SUSPENDED_CHILD_TOKEN_SDK_SEAL_ORIGINAL_TERMINATE_DRAIN_DELETE_RELEASE_SETTLED_LIVE_STRICT_COLD_NO_RESUME',
    'sg11-native-nul-device-stdio': 'PASS_REAL_NUL_DEVICE_THREE_OWNED_FDS_VALIDATED_FLAGS_RESTORED_CLOSED_IN_THIS_SUSPENDED_COMPONENT',
}
for key, status in updates.items():
    matches = [row for row in rows if row['case_id'] == key]
    assert len(matches) == 1
    matches[0]['round_41'] = status
new_key = 'sg11-native-localappdata-environment'
assert new_key not in {row['case_id'] for row in rows}
new_row = {key: '' for key in fields + ['round_41']}
new_row.update(case_id=new_key, scenario='同真实Profile原方法：LOCALAPPDATA等本Job已提交SDK根绑定路径，三大小写冲突覆盖且其它10键不变；未Resume不证child内环境', round_41='PASS_REAL_RESOURCE_TRUSTED_LOCALAPPDATA_THREE_CASE_CONFLICTS_OVERRIDDEN_OTHER_TEN_KEYS_UNCHANGED_NO_CHILD_ENV_VISIBILITY_CLAIM')
rows.append(new_row)
assert render([{key: row[key] for key in fields} for row in rows[:314]], fields) == mb
matrix_after = render(rows, fields + ['round_41'])
summary = {
    'round': 41, 'result': 'PASS_COMPONENT_ONLY', 'scope': 'Original suspended SDK seal and LocalAppData environment; no Resume or full platform claim',
    'hostTask': 'bw76t7k0s', 'toolUseId': 'call_15a945dabc044329b5f78602c20e2deb', 'driverSha256': e['collectorSha256'],
    'nodePid': e['nodePid'], 'startedAt': e['startedAt'], 'finishedAt': e['finishedAt'], 'nodeExitCode': 0, 'driverExitCode': 0, 'naturalWaitReturned': True,
    'forcedTermination': False, 'componentWasProduced': True, 'componentPass': True, 'sourceCount': 251, 'sourceAggregateSha256': source['aggregateSha256'],
    'sourceChanged': [], 'imageChanged': False, 'freshCheck': e['freshCheck'], 'steps': x['steps'], 'errors': [], 'unknownOwnershipCount': 0,
    'environmentVerification': {'ownedProofEntryId': v['ownedProofEntryId'], 'trustedMatchesActual': True, 'conflictingKeys': v['conflictingKeys'], 'otherKeys': v['otherKeys'], 'conflictsOverridden': True, 'otherEnvironmentUnchanged': True, 'childEnvironmentNotObserved': True},
    'nulEndpoints': x['nul'], 'nulRetained': 0, 'frameSnapshots': x['frameSnapshots'], 'nativeDrain': x['nativeDrain'], 'payloadResumed': False,
    'sealResult': x['sealResult'], 'sealTargets': {'fileObjects': 6, 'registryObjects': 2}, 'allEightSealEffectsAttemptedStatusZeroImmediatelyVerified': True,
    'independentTempAbsent': True, 'independentSdkFileObjectsAbsent': 6, 'finalProfileState': final['state'], 'retainedHandles': 0, 'retainedAllocations': 0,
    'resourceTrail': [{'seq': z['seq'], 'status': z['resource']['status'], 'retainedHandles': z['resource']['retainedHandles'], 'retainedAllocations': z['resource']['retainedAllocations']} for z in resources],
    'originalReleasedEntryId': x['releasedEntryId'], 'originalSettledEntryId': x['settled']['entryId'], 'producerReported': True, 'jobTerminal': 'completed', 'taskStatus': 'active', 'taskDrained': True, 'taskDecision': 'wait', 'taskLimitations': [],
    'proofPhases': ['profile-owned', 'profile-seal-frozen'], 'releasedLiveProofCount': 2, 'originalRecorderColdEqualsReleasedLive': True,
    'strictCold': {'journalBytes': len(journal_bytes), 'journalSha256': sha(journal_bytes), 'auditRecords': len(x['cold']['audit']), 'jobRecords': len(cold_job), 'jobAuditEqualsLive': True, 'unresolvedCount': 0},
    'workspaceInitialization': {'state': 'ready', 'directories': {name: {key: observation['directories'][name][key] for key in ['createdControl', 'initializationNeeded', 'control']} for name in ['work', 'tmp']}, 'nativeResources': observation['nativeResources']},
    'installationRetained': True, 'readOnlyAdmission': False, 'runnerIpcAckQualified': False, 'productionScopeReady': False,
    'inventoryRows': 5485, 'inventoryUnchangedSha256': sha(ib), 'matrixRowsBefore': 314, 'matrixRowsAfter': 315,
}
outputs = {d / 'source.json': encode(source), d / 'summary.json': encode(summary), d / 'native-console.log': raw['run-console.log']}
for data in outputs.values():
    assert not re.search(rb'[A-Za-z]:[\\/]', data), 'Absolute path in public evidence'
    assert b'S-1-15-' not in data and b'S-1-5-21-' not in data
index = {
    'round': 41, 'privateInputsRetainedUnchanged': private, 'previousRoundPrivateInputsUnchanged': previous_private,
    'artifacts': {p.relative_to(b).as_posix(): {'bytes': len(data), 'sha256': sha(data)} for p, data in outputs.items()},
    'report': {'path': 'round-41.md', 'bytes': len((b / 'round-41.md').read_bytes()), 'sha256': sha((b / 'round-41.md').read_bytes())},
    'archiveRecipe': {'path': 'round-41/archive-update.py', 'sha256': sha(Path(__file__).read_bytes())},
    'retainedJournal': {'bytes': len(journal_bytes), 'sha256': sha(journal_bytes)},
    'inventory': {'rows': 5485, 'unchangedBytes': len(ib), 'unchangedSha256': sha(ib)},
    'matrix': {'beforeBytes': len(mb), 'beforeSha256': sha(mb), 'afterBytes': len(matrix_after), 'afterSha256': sha(matrix_after)},
}
outputs[d / 'evidence-index.json'] = encode(index)
assert all(not p.exists() and not p.is_symlink() for p in outputs)
print(json.dumps({'mode': 'check' if a.check else 'run', 'effects': 0 if a.check else 'four-public-files-and-matrix-only', 'componentPass': True, 'environmentVerificationPassed': True, 'originalNodeExitCode': 0, 'childCreated': True, 'payloadResumed': False, 'originalLatestResourceStatus': 'released', 'jobTerminal': 'completed', 'taskDecision': 'wait', 'strictColdEqualsLive': True, 'nativeInvokedByArchive': False, 'privateAssetsWritten': False, 'previousRoundTwentyUnchanged': True, 'inventoryUnchanged': True, 'matrixRowsBefore': 314, 'matrixRowsAfter': 315, 'matrixAfterSha256': sha(matrix_after), 'oldMatrixReconstructsExactly': True, 'publicArtifacts': len(outputs)}, ensure_ascii=False))
if a.run:
    assert inventory.read_bytes() == ib and matrix.read_bytes() == mb
    for p, data in outputs.items():
        with p.open('xb') as f:
            f.write(data)
    matrix.write_bytes(matrix_after)
    assert inventory.read_bytes() == ib
