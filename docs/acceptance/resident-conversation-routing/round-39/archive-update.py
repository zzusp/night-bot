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
d = b / 'round-39'
assert Path(__file__).resolve() == d / 'archive-update.py'
sha = lambda data: hashlib.sha256(data).hexdigest()
encode = lambda value: (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()
pre = 'docs/tmp/sg11-profile-suspended-seal-'
expected = {
    'probe.mjs': (57812, '98f38589211a385e083830165c7955b034b227a216ed928bba1bd23ec5616546'),
    'checklist.md': (24112, 'd1af9ea06a1e2d2bc9fbf1a1ec445a155e58e9c9462934eee2a70a647dedf087'),
    'check.json': (31296, '621e166dbd7fd2294b0ee569858b909a98a83586692e38cb5c73ac13c6ae7f45'),
    'check-execution.json': (58152, '8ad3260aeaa8b9c985dc23da07fc68904e0b19aaab032ed8d6debeaec721c717'),
    'execute.py': (9634, '4487a4bfdeb7078c8c0a11534eba64409dbf0fb9c9834704e1a407d16cf1e9b5'),
    'run-check.json': (31296, '621e166dbd7fd2294b0ee569858b909a98a83586692e38cb5c73ac13c6ae7f45'),
    'run-console.log': (194, 'e2dd6b94d5036458dc2ab2f8ae72628915f09f3a5568e485bfe6117b6c924983'),
    'run-stderr.log': (0, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'),
    'run.json': (98567, '8c2e8309d11a3eed8cbfbbb56dca38c791fb10a8e2c06f48136c5cb23d2b1f23'),
    'execution.json': (57392, '4c4dea8130dfe76665091ce52be830c947a48c8f35eec9529456dd6ccb17cb1d'),
}
raw = {}
private = {}
for suffix, wanted in expected.items():
    path = r / (pre + suffix)
    info = path.lstat()
    assert path.is_file() and not path.is_symlink() and not getattr(info, 'st_file_attributes', 0) & 0x400
    data = path.read_bytes()
    assert (len(data), sha(data)) == wanted, suffix
    relative = path.relative_to(r).as_posix()
    assert subprocess.run(['git', 'check-ignore', '-q', '--', relative]).returncode == 0
    assert subprocess.check_output(['git', 'ls-files', '--', relative]) == b''
    assert subprocess.check_output(['git', 'diff', '--cached', '--name-only', '--', relative]) == b''
    raw[suffix] = data
    private[relative] = {'bytes': len(data), 'sha256': sha(data)}
x = json.loads(raw['run.json'])
e = json.loads(raw['execution.json'])
c = json.loads(raw['check.json'])
assert x['sourceBefore'] == x['sourceAfter'] == c['sourceBefore']
source = x['sourceBefore']
assert source['head'] == '6d79b0a0279d3f94f2d72d21f51ab1d654b0f509'
assert source['branch'] == 'worktree-resident-conversation-routing'
assert source['files'] == e['sourceBefore'] == e['sourceAfter'] and len(source['files']) == source['fileCount'] == 251
assert sha(json.dumps(source['files'], separators=(',', ':')).encode()) == source['aggregateSha256'] == 'b124530d35a98b1873b9c82de0b083837ce659b42f3075e668b810b901b9128b'
assert x['sourceChanged'] == e['sourceChanged'] == [] and e['imageChanged'] is False
assert e['imageBefore'] == e['imageAfter']
assert e['exitCode'] == 1 and e['naturalWaitReturned'] is True and e['forcedTermination'] is False and e['intervention'] is None
assert e['nativeRunCommandStarted'] is True and e['collectorSha256'] == expected['execute.py'][1]
assert 'collectorError' not in e and 'sourceReadbackError' not in e
assert x['componentPass'] is e['componentPass'] is False and e['componentWasProduced'] is True
assert e['freshCheck']['exitCode'] == 0 and e['freshCheck']['stderr'] == '' and raw['run-check.json'] == raw['check.json']
assert raw['run-stderr.log'] == b''
assert x['nativeFactoryEntered'] is x['nativeLoaderEntered'] is x['hostInstantiated'] is True
assert x['frameCreationAttempted'] is x['terminationAttempted'] is False and x['cleanupAttempted'] is True
assert x['nul'] == x['frameSnapshots'] == x['unknownOwnership'] == [] and x['nulRetained'] == 0
assert x['installationRetained'] is True and (r / c['installation']).is_dir()
assert len(x['errors']) == 2 and x['errors'][0]['code'] == 'ENOENT' and x['errors'][1]['code'] == 'ERR_ASSERTION'
assert x['errors'][0]['message'].endswith("NUL'") and 'out.settled&&out.releasedEntryId' in x['errors'][1]['message']
assert all(key not in x for key in ['settled', 'liveJobAudit', 'releasedLiveProofs', 'coldViaOriginalRecorder', 'cold'])
final = x['finalReceipt']
assert final == x['deletedReceipt']
assert final['state'] == 'registration-and-folder-absent' and final['launchAttempted'] is False
assert final['retainedHandles'] == final['retainedAllocations'] == 0 and final['sealState'] == 'not-started' and final['sealEffects'] == []
assert x['jobTerminal']['status'] == 'failed'
assert x['task']['status'] == 'active' and x['task']['drained'] is True
assert x['task']['lastDecision']['action'] == 'blocked' and 'TASK_EFFECT_UNCERTAIN_NO_REPLAY' in x['task']['lastDecision']['limitations']
trail = x['failureCommittedEntries']
registered = next(t for t in trail if t['receipt']['kind'] == 'registered')['receipt']['payload']
resource_entries = [t for t in trail if t['receipt']['kind'] == 'resource-ownership']
assert len(resource_entries) == 3
assert [t['receipt']['payload']['seq'] for t in resource_entries] == [1, 2, 3]
assert [t['receipt']['payload']['resource']['status'] for t in resource_entries] == ['planned', 'unknown-retained', 'released']
assert resource_entries[-1]['entryId'] == x['releasedEntryId'] == '2e7461b2'
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

inventory = b / 'test-case-inventory.csv'
ib = inventory.read_bytes()
assert len(ib) == 3335797 and sha(ib) == '4cb87a89885f8359d2b813580994d40dcd2d74bbc76ac4aac9138498e0891f2f'
assert len(list(csv.DictReader(io.StringIO(ib.decode())))) == 5485
matrix = b / 'matrix.csv'
mb = matrix.read_bytes()
assert len(mb) == 217156 and sha(mb) == 'fdd38b464cd6e4b6e6d877a5e775e6461a0145d887b1dc1d0d9fea8c05133ab3'
reader = csv.DictReader(io.StringIO(mb.decode()))
rows = list(reader)
fields = reader.fieldnames
assert len(rows) == 311 and fields[-1] == 'round_38'
def render(rows, fields):
    out = io.StringIO(newline='')
    writer = csv.DictWriter(out, fieldnames=fields, lineterminator='\n')
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue().encode()
assert render(rows, fields) == mb
for row in rows:
    row['round_39'] = 'NOT_RERUN_ROUND_39'
updates = {'all-required-regressions': 'PARTIAL_NATIVE_COMPONENT_FAIL_RELATIVE_NUL_ENOENT_BEFORE_FRAME_SINGLE_WORKSPACE_INITIALIZATION_PASS_NOT_FULL_REGRESSION', 'sg11-final-remaining-checks': 'PARTIAL_16_21_FAIL_NUL_PREPARATION_ORIGINAL_PROFILE_RELEASED_TASK_BLOCKED_NO_REPLAY_16_22_SINGLE_INITIALIZATION_PASS'}
for key, status in updates.items():
    matches = [row for row in rows if row['case_id'] == key]
    assert len(matches) == 1
    matches[0]['round_39'] = status
new = [('sg11-workspace-native-initialization', '真实Host默认创建一次新task：work/tmp出生9814到9c14，ready且16句柄36Local全闭；非OS隔离证明', 'PASS_SINGLE_FRESH_TASK_NATIVE_INITIALIZATION_READY_9814_TO_9C14_HANDLES16_LOCAL36_CLOSED_ONLY'), ('sg11-profile-suspended-sdk-seal', '原挂起child与SDK seal组件首错相对NUL路径ENOENT，frame和seal未开始；原Profile已回收提交released但Job失败/task no-replay', 'FAIL_RELATIVE_NUL_ENOENT_BEFORE_FRAME_SEAL_NOT_STARTED_NODE1_ORIGINAL_PROFILE_RELEASED_TASK_BLOCKED_NO_REPLAY')]
assert not {key for key, _, _ in new} & {row['case_id'] for row in rows}
for key, scenario, status in new:
    row = {key: '' for key in fields + ['round_39']}
    row.update(case_id=key, scenario=scenario, round_39=status)
    rows.append(row)
assert render([{key: row[key] for key in fields} for row in rows[:311]], fields) == mb
matrix_after = render(rows, fields + ['round_39'])
summary = {'round': 39, 'result': 'FAIL', 'scope': 'Original suspended SDK seal component; not full OS acceptance', 'hostTask': 'b00nfcgdy', 'toolUseId': 'call_4525ad2e645f4ae5b22ba64cc5b7d8c5', 'driverSha256': e['collectorSha256'], 'nodePid': e['nodePid'], 'startedAt': e['startedAt'], 'finishedAt': e['finishedAt'], 'nodeExitCode': e['exitCode'], 'driverExitCode': 1, 'naturalWaitReturned': e['naturalWaitReturned'], 'forcedTermination': False, 'componentWasProduced': True, 'componentPass': False, 'sourceCount': 251, 'sourceAggregateSha256': source['aggregateSha256'], 'sourceChanged': [], 'imageChanged': False, 'freshCheck': e['freshCheck'], 'steps': x['steps'], 'failure': {'firstCode': 'ENOENT', 'operation': "probe open('NUL', 'r') resolved relative to worktree", 'secondCode': 'ERR_ASSERTION', 'secondAssertion': 'out.settled&&out.releasedEntryId'}, 'frameCreationAttempted': False, 'terminationAttempted': False, 'nulCount': 0, 'nulRetained': 0, 'sealState': final['sealState'], 'sealEffects': [], 'originalCleanupAttempted': True, 'originalFinalProfileState': final['state'], 'originalFinalRetainedHandles': 0, 'originalFinalRetainedAllocations': 0, 'resourceTrail': [{'seq': t['receipt']['payload']['seq'], 'status': t['receipt']['payload']['resource']['status'], 'retainedHandles': t['receipt']['payload']['resource']['retainedHandles'], 'retainedAllocations': t['receipt']['payload']['resource']['retainedAllocations']} for t in resource_entries], 'originalReleasedEntryId': x['releasedEntryId'], 'originalReceiptBindingVerified': True, 'jobTerminal': 'failed', 'taskStatus': 'active', 'taskDrained': True, 'taskDecision': 'blocked', 'taskLimitations': x['task']['lastDecision']['limitations'], 'successSettledProduced': False, 'strictColdProofProduced': False, 'workspaceInitialization': {'state': 'ready', 'directories': {name: {key: observation['directories'][name][key] for key in ['createdControl', 'initializationNeeded', 'control']} for name in ['work', 'tmp']}, 'nativeResources': observation['nativeResources']}, 'installationRetained': True, 'unknownOwnershipCount': 0, 'readOnlyAdmission': False, 'runnerIpcAckQualified': False, 'productionScopeReady': False, 'inventoryRows': 5485, 'inventoryUnchangedSha256': sha(ib), 'matrixRowsBefore': 311, 'matrixRowsAfter': 313}
outputs = {d / 'source.json': encode(source), d / 'summary.json': encode(summary), d / 'native-console.log': raw['run-console.log']}
for data in outputs.values():
    assert not re.search(rb'[A-Za-z]:[\\/]', data), 'Absolute path in public evidence'
    assert b'S-1-15-' not in data and b'S-1-5-21-' not in data
index = {'round': 39, 'privateInputsRetainedUnchanged': private, 'artifacts': {p.relative_to(b).as_posix(): {'bytes': len(data), 'sha256': sha(data)} for p, data in outputs.items()}, 'report': {'path': 'round-39.md', 'bytes': len((b / 'round-39.md').read_bytes()), 'sha256': sha((b / 'round-39.md').read_bytes())}, 'archiveRecipe': {'path': 'round-39/archive-update.py', 'sha256': sha(Path(__file__).read_bytes())}, 'inventory': {'rows': 5485, 'unchangedBytes': len(ib), 'unchangedSha256': sha(ib)}, 'matrix': {'beforeBytes': len(mb), 'beforeSha256': sha(mb), 'afterBytes': len(matrix_after), 'afterSha256': sha(matrix_after)}}
outputs[d / 'evidence-index.json'] = encode(index)
assert all(not p.exists() and not p.is_symlink() for p in outputs)
print(json.dumps({'mode': 'check' if a.check else 'run', 'effects': 0 if a.check else 'four-public-files-and-matrix-only', 'originalComponentPass': False, 'originalNodeExitCode': 1, 'originalLatestResourceStatus': 'released', 'originalTaskDecision': 'blocked-no-replay', 'nativeInvokedByArchive': False, 'privateAssetsWritten': False, 'inventoryUnchanged': True, 'matrixRowsBefore': 311, 'matrixRowsAfter': 313, 'matrixAfterSha256': sha(matrix_after), 'oldMatrixReconstructsExactly': True, 'publicArtifacts': len(outputs)}, ensure_ascii=False))
if a.run:
    assert inventory.read_bytes() == ib and matrix.read_bytes() == mb
    for p, data in outputs.items():
        with p.open('xb') as f:
            f.write(data)
    matrix.write_bytes(matrix_after)
    assert inventory.read_bytes() == ib
