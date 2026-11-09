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
d = b / 'round-40'
assert Path(__file__).resolve() == d / 'archive-update.py'
sha = lambda data: hashlib.sha256(data).hexdigest()
encode = lambda value: (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()
pre = 'docs/tmp/sg11-profile-suspended-seal-nul-'
expected = {
    'probe.mjs': (57932, '152dae8824313136edbbd5cf44c12b51642187054cb3039efd916f7bb34131ed'),
    'checklist.md': (25613, '42ffdc199c179f3469a52df20e4ac8fa72fe856b1402e59603742ccdcd38a603'),
    'check.json': (31395, 'c22434eb7e5c247bb9fbed7bd4dc8974ab26af2f7675fb6e47629ab5da794fb1'),
    'check-execution.json': (59344, '2728e1de471571804d35b32e5cc79fb71cc1d21fcd5ee3d2f7945ca3a9449472'),
    'execute.py': (9642, 'be8c1ca2bf7e88225951f7e6e92b7b2f3007f622d4deeb88da48f57c5a5b2a6f'),
    'run-check.json': (31395, 'c22434eb7e5c247bb9fbed7bd4dc8974ab26af2f7675fb6e47629ab5da794fb1'),
    'run-console.log': (198, 'd6d14fc2749870250a3d348f753668a591a3f5810562db24a11ab8b8a11fb695'),
    'run-stderr.log': (0, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'),
    'run.json': (101387, '5b1e6658e39b23e4952295497aaacb92a059fc068751c60ac45b535b9628d9f5'),
    'execution.json': (57441, '10653998a642489f63c6502c6a52ffcc59d8188596f12f3ae99da3e32c56ac73'),
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
previous_private = json.loads((b / 'round-39/evidence-index.json').read_bytes())['privateInputsRetainedUnchanged']
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
assert sha(json.dumps(source['files'], separators=(',', ':')).encode()) == source['aggregateSha256'] == '6ed31f06646a6194baa20671a11c389805f46724de401ce8c6875ad0220fcb78'
assert x['sourceChanged'] == e['sourceChanged'] == [] and e['imageChanged'] is False and e['imageBefore'] == e['imageAfter']
assert e['exitCode'] == 1 and e['naturalWaitReturned'] is True and e['forcedTermination'] is False and e['intervention'] is None
assert e['nativeRunCommandStarted'] is True and e['collectorSha256'] == expected['execute.py'][1]
assert 'collectorError' not in e and 'sourceReadbackError' not in e
assert x['componentPass'] is e['componentPass'] is False and e['componentWasProduced'] is True
assert e['freshCheck']['exitCode'] == 0 and e['freshCheck']['stderr'] == '' and raw['run-check.json'] == raw['check.json']
assert raw['run-stderr.log'] == b''
assert x['hostInstantiated'] is x['nativeLoaderEntered'] is x['nativeFactoryEntered'] is True
assert x['frameCreationAttempted'] is x['cleanupAttempted'] is True and x['terminationAttempted'] is False
assert x['installationRetained'] is True and (r / c['installation']).is_dir()
assert x['unknownOwnership'] == [] and x['nulRetained'] == 0
assert len(x['nul']) == 3 and [z['id'] for z in x['nul']] == [0, 1, 2]
assert [z['fd'] for z in x['nul']] == [3, 4, 5] and [z['flags'] for z in x['nul']] == ['r', 'w', 'w']
for z in x['nul']:
    assert z['device'] == 'NUL' and z['namespacePath'] == chr(92) * 2 + '.' + chr(92) + 'NUL'
    assert all(z[k] is True for k in ['opened', 'validationAttempted', 'closeAttempted', 'closed'])
    assert z['flagsBefore'] == z['flagsAfter'] == 0
assert len(x['errors']) == 2 and x['errors'][0]['code'] == 'WINDOWS_LPAC_OWNERSHIP_RETAINED' and x['errors'][1]['code'] == 'ERR_ASSERTION'
assert len(x['errors'][0]['errors']) == 1
assert x['errors'][0]['errors'][0]['api'] == 'CreateProcessW' and x['errors'][0]['errors'][0]['win32Code'] == 203
assert 'out.settled&&out.releasedEntryId' in x['errors'][1]['message']
assert all(key not in x for key in ['settled', 'liveJobAudit', 'releasedLiveProofs', 'coldViaOriginalRecorder', 'cold'])
assert x['proofEntries'] == [] and x['failedCreateTerminationOwnedByOriginal'] is False
assert len(x['frameSnapshots']) == 3
assert [z['stage'] for z in x['frameSnapshots']] == ['original-failed-create', 'native-drained', 'native-handles-closed']
for z in x['frameSnapshots']:
    assert z['pid'] is None and z['childCreated'] is z['assigned'] is z['payloadResumed'] is False
    assert z['jobConfigured'] is z['preparationReleased'] is True and z['pendingPreparation'] is False
    assert z['processPresent'] is z['threadPresent'] is False
assert x['frameSnapshots'][-1]['jobCloseAttempted'] is True and x['frameSnapshots'][-1]['jobPresent'] is False
assert x['nativeDrain'] == {'pid': None, 'childCreated': False, 'processSettled': True, 'jobEmpty': True, 'exitCode': None}
final = x['finalReceipt']
assert final == x['deletedReceipt']
assert final['state'] == 'registration-and-folder-absent' and final['launchAttempted'] is True
assert final['retainedHandles'] == final['retainedAllocations'] == 0 and final['sealState'] == 'not-started' and final['sealEffects'] == []
assert x['jobTerminal']['status'] == 'failed'
assert x['task']['status'] == 'active' and x['task']['drained'] is True
assert x['task']['lastDecision']['action'] == 'blocked' and 'TASK_EFFECT_UNCERTAIN_NO_REPLAY' in x['task']['lastDecision']['limitations']
trail = x['failureCommittedEntries']
registered = next(t for t in trail if t['receipt']['kind'] == 'registered')['receipt']['payload']
resource_entries = [t for t in trail if t['receipt']['kind'] == 'resource-ownership']
assert len(resource_entries) == 3 and [t['receipt']['payload']['seq'] for t in resource_entries] == [1, 2, 3]
assert [t['receipt']['payload']['resource']['status'] for t in resource_entries] == ['planned', 'unknown-retained', 'released']
assert resource_entries[-1]['entryId'] == x['releasedEntryId'] == '1455975a'
assert resource_entries[-1]['receipt']['payload']['resource'] == x['released']
for t in resource_entries:
    q = t['receipt']['payload']
    assert q['jobId'] == registered['jobId'] == x['jobId']
    assert q['owner'] == registered['owner'] == x['ownerId'] == x['executionIdentity']['owner']
    assert q['toolCall'] == registered['toolCall'] and q['startedAt'] == registered['startedAt'] and q['kind'] == registered['kind']
assert registered['toolCall']['callId'] == x['executionIdentity']['callId']
assert registered['toolCall']['rootCallId'] == x['executionIdentity']['rootCallId']
assert registered['toolCall']['toolName'] == x['executionIdentity']['name']
init = x['workspaceInitialization']
assert init['state'] == 'ready' and init['sessionId'] == x['task']['sessionId'] == x['ownerId']
assert init['creationCommandId'] == x['task']['workspaceInitialization']['creationCommandId']
observation = init['observation']
for name in ['work', 'tmp']:
    z = observation['directories'][name]
    assert z['createdControl'] == 0x9814 and z['initializationNeeded'] is True and z['control'] == 0x9c14
assert observation['nativeResources'] == {'handles': {'acquired': 16, 'closed': 16, 'retained': 0}, 'local': {'acquired': 36, 'closed': 36, 'retained': 0}}
assert all(x[key] is False for key in ['readOnlyAdmission', 'runnerIpcAckQualified', 'productionScopeReady'])
inventory = b / 'test-case-inventory.csv'
ib = inventory.read_bytes()
assert len(ib) == 3335797 and sha(ib) == '4cb87a89885f8359d2b813580994d40dcd2d74bbc76ac4aac9138498e0891f2f'
assert len(list(csv.DictReader(io.StringIO(ib.decode())))) == 5485
matrix = b / 'matrix.csv'
mb = matrix.read_bytes()
assert len(mb) == 223884 and sha(mb) == 'e67f80b8831860e6b832bd6601574590e06f599bb9f5d292b073016e1ec82af1'
reader = csv.DictReader(io.StringIO(mb.decode()))
rows = list(reader)
fields = reader.fieldnames
assert len(rows) == 313 and fields[-1] == 'round_39'
def render(rows, fields):
    out = io.StringIO(newline='')
    writer = csv.DictWriter(out, fieldnames=fields, lineterminator='\n')
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue().encode()
assert render(rows, fields) == mb
for row in rows:
    row['round_40'] = 'NOT_RERUN_ROUND_40'
updates = {
    'all-required-regressions': 'PARTIAL_NUL_DEVICE_STDIO_PASS_SDK_COMPONENT_FAIL_CREATEPROCESSW_203_NO_CHILD_SINGLE_INITIALIZATION_PASS_NOT_FULL_REGRESSION',
    'sg11-final-remaining-checks': 'PARTIAL_16_21_FAIL_CREATEPROCESSW_203_NUL3_CLOSED_PROFILE_RELEASED_TASK_BLOCKED_NO_REPLAY_16_22_SINGLE_INITIALIZATION_PASS',
    'sg11-workspace-native-initialization': 'PASS_SECOND_FRESH_TASK_NATIVE_INITIALIZATION_READY_9814_TO_9C14_HANDLES16_LOCAL36_CLOSED_ONLY',
    'sg11-profile-suspended-sdk-seal': 'FAIL_RECORDED_CREATEPROCESSW_WIN32_203_CHILD_NOT_CREATED_SEAL_NOT_STARTED_NODE1_ORIGINAL_PROFILE_RELEASED_TASK_BLOCKED_NO_REPLAY',
}
for key, status in updates.items():
    matches = [row for row in rows if row['case_id'] == key]
    assert len(matches) == 1
    matches[0]['round_40'] = status
new_key = 'sg11-native-nul-device-stdio'
assert new_key not in {row['case_id'] for row in rows}
new_row = {key: '' for key in fields + ['round_40']}
new_row.update(case_id=new_key, scenario='真实绝对NUL设备三自有fd3/4/5打开校验并单次关闭，flags恢复0；不证明child继承或SDK seal', round_40='PASS_REAL_NUL_DEVICE_THREE_OWNED_FDS_VALIDATED_FLAGS_RESTORED_CLOSED_NO_CHILD_INHERITANCE_CLAIM')
rows.append(new_row)
assert render([{key: row[key] for key in fields} for row in rows[:313]], fields) == mb
matrix_after = render(rows, fields + ['round_40'])
summary = {
    'round': 40, 'result': 'FAIL', 'scope': 'Original suspended SDK seal component; NUL endpoint subcheck passed, no child created',
    'hostTask': 'brwocec65', 'toolUseId': 'call_9bbd8d4c670349ebb8c61762ff2cba2a', 'driverSha256': e['collectorSha256'],
    'nodePid': e['nodePid'], 'startedAt': e['startedAt'], 'finishedAt': e['finishedAt'], 'nodeExitCode': e['exitCode'], 'driverExitCode': 1,
    'naturalWaitReturned': True, 'forcedTermination': False, 'componentWasProduced': True, 'componentPass': False,
    'sourceCount': 251, 'sourceAggregateSha256': source['aggregateSha256'], 'sourceChanged': [], 'imageChanged': False, 'freshCheck': e['freshCheck'], 'steps': x['steps'],
    'failure': {'outerCode': 'WINDOWS_LPAC_OWNERSHIP_RETAINED', 'recordedNativeApi': 'CreateProcessW', 'recordedWin32Code': 203, 'rootCauseNotEstablished': True, 'childCreated': False, 'secondCode': 'ERR_ASSERTION', 'secondAssertion': 'out.settled&&out.releasedEntryId'},
    'nulEndpointResult': 'PASS', 'nulEndpoints': x['nul'], 'nulRetained': 0, 'frameCreationAttempted': True, 'frameSnapshots': x['frameSnapshots'], 'nativeDrain': x['nativeDrain'],
    'noChildBranchNotPostLaunchJobZeroProof': True, 'terminationAttempted': False, 'sealState': final['sealState'], 'sealEffects': [],
    'originalCleanupAttempted': True, 'originalFinalProfileState': final['state'], 'originalFinalRetainedHandles': 0, 'originalFinalRetainedAllocations': 0,
    'resourceTrail': [{'seq': t['receipt']['payload']['seq'], 'status': t['receipt']['payload']['resource']['status'], 'retainedHandles': t['receipt']['payload']['resource']['retainedHandles'], 'retainedAllocations': t['receipt']['payload']['resource']['retainedAllocations']} for t in resource_entries],
    'originalReleasedEntryId': x['releasedEntryId'], 'originalReceiptBindingVerified': True, 'jobTerminal': 'failed', 'taskStatus': 'active', 'taskDrained': True, 'taskDecision': 'blocked', 'taskLimitations': x['task']['lastDecision']['limitations'],
    'successSettledProduced': False, 'strictColdProofProduced': False,
    'workspaceInitialization': {'state': 'ready', 'directories': {name: {key: observation['directories'][name][key] for key in ['createdControl', 'initializationNeeded', 'control']} for name in ['work', 'tmp']}, 'nativeResources': observation['nativeResources']},
    'installationRetained': True, 'unknownOwnershipCount': 0, 'readOnlyAdmission': False, 'runnerIpcAckQualified': False, 'productionScopeReady': False,
    'inventoryRows': 5485, 'inventoryUnchangedSha256': sha(ib), 'matrixRowsBefore': 313, 'matrixRowsAfter': 314,
}
outputs = {d / 'source.json': encode(source), d / 'summary.json': encode(summary), d / 'native-console.log': raw['run-console.log']}
for data in outputs.values():
    assert not re.search(rb'[A-Za-z]:[\\/]', data), 'Absolute path in public evidence'
    assert b'S-1-15-' not in data and b'S-1-5-21-' not in data
index = {
    'round': 40, 'privateInputsRetainedUnchanged': private, 'previousRoundPrivateInputsUnchanged': previous_private,
    'artifacts': {p.relative_to(b).as_posix(): {'bytes': len(data), 'sha256': sha(data)} for p, data in outputs.items()},
    'report': {'path': 'round-40.md', 'bytes': len((b / 'round-40.md').read_bytes()), 'sha256': sha((b / 'round-40.md').read_bytes())},
    'archiveRecipe': {'path': 'round-40/archive-update.py', 'sha256': sha(Path(__file__).read_bytes())},
    'inventory': {'rows': 5485, 'unchangedBytes': len(ib), 'unchangedSha256': sha(ib)},
    'matrix': {'beforeBytes': len(mb), 'beforeSha256': sha(mb), 'afterBytes': len(matrix_after), 'afterSha256': sha(matrix_after)},
}
outputs[d / 'evidence-index.json'] = encode(index)
assert all(not p.exists() and not p.is_symlink() for p in outputs)
print(json.dumps({'mode': 'check' if a.check else 'run', 'effects': 0 if a.check else 'four-public-files-and-matrix-only', 'originalComponentPass': False, 'originalNodeExitCode': 1, 'recordedWin32Code': 203, 'nulEndpointsPassed': 3, 'originalLatestResourceStatus': 'released', 'originalTaskDecision': 'blocked-no-replay', 'nativeInvokedByArchive': False, 'privateAssetsWritten': False, 'previousRoundTenUnchanged': True, 'inventoryUnchanged': True, 'matrixRowsBefore': 313, 'matrixRowsAfter': 314, 'matrixAfterSha256': sha(matrix_after), 'oldMatrixReconstructsExactly': True, 'publicArtifacts': len(outputs)}, ensure_ascii=False))
if a.run:
    assert inventory.read_bytes() == ib and matrix.read_bytes() == mb
    for p, data in outputs.items():
        with p.open('xb') as f:
            f.write(data)
    matrix.write_bytes(matrix_after)
    assert inventory.read_bytes() == ib
