from pathlib import Path
import csv, hashlib, io, json, re, subprocess, sys

sys.stdout.reconfigure(encoding='utf-8')
assert sys.argv[1:] in (['--check'], ['--run'])
root = Path.cwd()
base = root / 'docs/acceptance/resident-conversation-routing'
out = base / 'round-37'
assert root.as_posix().endswith('/resident-conversation-plan/night-bot')
assert base.is_dir() and out.is_dir()
sha = lambda data: hashlib.sha256(data).hexdigest()
def facts(path):
    data = path.read_bytes()
    return {'bytes': len(data), 'sha256': sha(data)}
def encode(value):
    return '"' + value.replace('"', '""') + '"' if any(char in value for char in ',\r\n"') else value
def spans(text):
    pattern = re.compile(r'("(?:[^"]|"")*"|[^,\r\n]*)(,|\r?\n|$)')
    result, cells, at = [], [], 0
    while at < len(text):
        match = pattern.match(text, at)
        assert match and match.end() > at
        cells.append((match.start(1), match.end(1)))
        at = match.end()
        if match[2] != ',':
            result.append(cells)
            cells = []
    assert not cells
    return result

prefix = 'docs/tmp/sg11-readroots-qualification-'
expected = {
    'probe.mjs': (26987, '5f35a20d0ed3ec865606b9db43f1d98579a0a00ae5aef9ee6f0f9ebb76ad8d2f'),
    'checklist.md': (15575, 'b533d60e792f35ac2918fa3937abad039d87a095ef6eacc25cca504e10ed9335'),
    'check.json': (6991, '22e8557d6b882788da025a524089995664c041f8fa78f27cbd3327123d721460'),
    'check-execution.json': (7421, 'fe7e754d7fed3a79d696dcec4bea8660b2849d6481c162ea0bfdf748596a3387'),
    'execute.py': (8584, 'efe49dba30f988f7f27d6987c5de763dda56b2d4cc776bf623bba7f779457879'),
    'run-check.json': (6991, '22e8557d6b882788da025a524089995664c041f8fa78f27cbd3327123d721460'),
    'run-console.log': (446, '22050597734c27542e47969af0d27eb4aa30db2f74bd2f0ef3faceae70ba8dbb'),
    'run-stderr.log': (0, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'),
    'run.json': (84296, '8e3c2f6001b0997dab2f7231ad003c4e098bcdcd368f3868ad18c18f1bf31fcc'),
    'execution.json': (7638, '4e36bc96a4c32ddd46bfa89e6a74f7817961c024cc8522938ca8bc196849b462'),
}
private = {}
for suffix, (size, digest) in expected.items():
    spelling = prefix + suffix
    path = root / spelling
    info = path.lstat()
    assert path.is_file() and not path.is_symlink() and not getattr(info, 'st_file_attributes', 0) & 0x400
    assert facts(path) == {'bytes': size, 'sha256': digest}, suffix
    assert subprocess.run(['git', 'check-ignore', '-q', '--', spelling], cwd=root).returncode == 0
    assert subprocess.check_output(['git', 'ls-files', '--', spelling], cwd=root) == b''
    assert subprocess.check_output(['git', 'diff', '--cached', '--name-only', '--', spelling], cwd=root) == b''
    private[spelling] = facts(path)
checked = json.loads((root / (prefix + 'check.json')).read_bytes())
prepared = json.loads((root / (prefix + 'check-execution.json')).read_bytes())
execution = json.loads((root / (prefix + 'execution.json')).read_bytes())
native = json.loads((root / (prefix + 'run.json')).read_bytes())
assert execution['exitCode'] == 0 and execution['naturalWaitReturned'] is True
assert execution['qualificationWasProduced'] is True and execution['qualified'] is True
assert execution['intervention'] is None and execution['forcedTermination'] is False
assert 'collectorError' not in execution and 'sourceReadbackError' not in execution
assert execution['sourceChanged'] == [] and execution['inputChanged'] is False
assert prepared['syntax']['exitCode'] == prepared['exitCode'] == 0
assert prepared['stderr'] == '' and prepared['sourceChanged'] == []
assert checked['effects'] == 0 and all(checked[key] is False for key in ['nativeExecuted', 'hostInstantiated', 'forestObserved'])
assert execution['freshCheckCommand'] == prepared['command']
assert execution['freshCheck']['exitCode'] == 0 and execution['freshCheck']['stderr'] == ''
assert (root / (prefix + 'run-check.json')).read_bytes() == (root / (prefix + 'check.json')).read_bytes()
run_command = [*prepared['command']]
run_command[2] = '--run'
assert execution['runCommand'] == run_command
assert execution['collectorSha256'] == expected['execute.py'][1]
maps = [checked['sourceBefore']['files'], prepared['sourceBefore']['files'], prepared['sourceAfter']['files'], execution['sourceBefore'], execution['sourceAfter'], native['sourceBefore']['files'], native['sourceAfter']['files']]
assert all(value == maps[0] for value in maps) and len(maps[0]) == 19
aggregate = sha(json.dumps(maps[0], ensure_ascii=False, separators=(',', ':')).encode())
assert aggregate == 'c34655b38cffadf86319bf8fe892cb521f28879aa88b2dc2dc153611819d81a7'
assert native['sourceChanged'] == [] and native['qualified'] is True and native['unchangedVerified'] is True
assert all(native[key] == [] for key in ['errors', 'qualificationFailures', 'drift', 'unknownOwnership'])
assert native['before']['complete'] is True and native['after']['complete'] is True
assert native['readOnlyAdmission'] is False and native['labelOriginQualified'] is False and native['productionScopeReady'] is False
assert native['hostInstantiated'] is False and native['nativeExecuted'] is True
assert all(item['releaseAttempted'] and item['closed'] for item in native['handles'] + native['allocations'])
assert native['counts'] == {'beforeTargets': 8, 'afterTargets': 8, 'boundaryAncestors': 12, 'internalEdges': 4, 'edgeObservations': 4, 'protectedEdges': 0, 'inheritanceAttempts': 4, 'queryHandles': 40, 'localAllocations': 16, 'privateSecurityAllocations': 4, 'retainedHandles': 0, 'retainedAllocations': 0, 'ownershipKnown': True}
assert native['input'] == checked['input']
assert native['inputAfter'] == execution['inputAfter'] == {'bytes': checked['input']['bytes'], 'sha256': checked['input']['sha256']}
input_path = root / checked['input']['path']
assert facts(input_path) == native['inputAfter']
original = json.loads(input_path.read_bytes())
task = Path(original['policy']['taskRoot'])
relative = lambda path: Path(path).relative_to(task).as_posix()
assert len(native['roots']) == 4
for bound in native['roots']:
    historical = next(item for item in original['scopeRoots'] if item['path'] == bound['path'])
    assert set(historical) == {'path', 'fileId', 'access'} and historical['access'] == 'read'
    assert historical['fileId'] == bound['fileId'] and bound['expectedDirectory'] is True
    for phase in ['before', 'after']:
        actual = next(item for item in native[phase]['forest'] if item['path'] == bound['path'])
        assert actual['directory'] is True and actual['fileId'] == historical['fileId']
assert all(item['settledDacl'] and item['control'] == 0x8c04 and item['label'] is None for item in native['baseline'])
assert all(edge['status'] == 'qualified' and edge['sameOwnedOriginal'] is True and edge['byteEqualOriginal'] is True for edge in native['edges'])
forest = [{'path': relative(item['path']), 'directory': item['directory'], 'control': item['control'], 'controlHex': format(item['control'], 'x'), 'label': item['label'], 'descriptorSha256': item['descriptorSha256']} for item in native['before']['forest']]
edges = [{**{key: edge[key] for key in ['status', 'sameOwnedOriginal', 'byteEqualOriginal', 'flags', 'nativeStatus']}, 'parent': relative(edge['parent']), 'child': relative(edge['child'])} for edge in native['edges']]

inventory = base / 'test-case-inventory.csv'
inventory_facts = facts(inventory)
assert inventory_facts == {'bytes': 3320505, 'sha256': 'aeb6cc97bcedbcce7b7d63aa984159a18b699b7b67f347deb2e4e057f5464fdb'}
assert len(list(csv.DictReader(io.StringIO(inventory.read_bytes().decode(), newline='')))) == 5472
matrix = base / 'matrix.csv'
raw = matrix.read_bytes()
assert len(raw) == 202662 and sha(raw) == '22334bdd73e9934a5a3f4444c69e27000e228d36ce5b881500a21149768e202a'
text = raw.decode()
reader = csv.DictReader(io.StringIO(text, newline=''))
fields = reader.fieldnames
rows = list(reader)
assert len(rows) == 297 and fields[-1] == 'round_36' and 'round_37' not in fields
annotations = {
    'all-required-regressions': 'PARTIAL_RETAINED_FOUR_READROOTS_FOREST_DACL_AND_INTERNAL_INHERITANCE_PASS_NO_RO_ADMISSION_FULL_LPAC_OTHER_GROUPS_NOT_VALIDATED',
    'sg11-final-remaining-checks': 'PARTIAL_READROOTS_8_TARGETS_4_EDGES_STABLE_40_HANDLES_20_ALLOCATIONS_RELEASED_R35_UNKNOWN_AND_NULL_WRITE_RECOVERY_RETAINED',
}
assert set(annotations).issubset({row['case_id'] for row in rows})
updated = text
for row_index, cells in reversed(list(enumerate(spans(text)))):
    at = cells[-1][1]
    value = 'round_37' if row_index == 0 else annotations.get(rows[row_index - 1]['case_id'], 'NOT_RERUN_ROUND_37')
    updated = updated[:at] + ',' + value + updated[at:]
new = {field: '' for field in fields + ['round_37']}
new.update({'case_id': 'sg11-readroots-qualification-forest', 'scenario': '原R36四readRoots完整forest只读观察；真实类型和原FileID绑定，DACL与内部继承窄资格，非RO准入', 'round_37': 'PASS_READROOTS_FOREST_DACL_8_TARGETS_4_NATIVE_EDGES_BEFORE_AFTER_STABLE_NODE0_40_HANDLES_20_ALLOCATIONS_CLOSED_NO_ADMISSION'})
assert new['case_id'] not in {row['case_id'] for row in rows}
suffix = ','.join(encode(new[field]) for field in fields + ['round_37']) + '\n'
updated += suffix
reverse = updated[:-len(suffix)]
for cells in reversed(spans(reverse)):
    start, end = cells[-1]
    reverse = reverse[:start - 1] + reverse[end:]
assert reverse.encode() == raw

summary = {
    'round': 37, 'disposition': 'PASS_RETAINED_READROOTS_FOREST_DACL_AND_INTERNAL_INHERITANCE_ONLY',
    'head': checked['sourceBefore']['head'], 'dirtyWorkingTree': True,
    'sourceCount': 19, 'aggregateSha256': aggregate, 'sevenRecordedSourceMapsIdentical': True,
    'input': checked['input'], 'historicalDirectoryFieldPresent': False,
    'rootDirectoryTypesVerifiedByThisRunNativeAndOriginalFileId': True,
    'execution': {'hostTaskId': 'b3d4gbol0', 'toolUseId': 'call_6e384faca0ad43f1bdd3a2d4cef63db4', 'command': 'python -I docs/tmp/sg11-readroots-qualification-execute.py --run', **{key: execution[key] for key in ['startedAt', 'finishedAt', 'nodePid', 'exitCode', 'naturalWaitReturned', 'qualificationWasProduced', 'qualified', 'intervention', 'forcedTermination', 'sourceChanged', 'inputChanged']}},
    'freshCheck': execution['freshCheck'], 'freshArgvAndStdoutExactlyMatchReviewed': True,
    'probeStartedAt': native['startedAt'], 'probeFinishedAt': native['finishedAt'],
    'beforeComplete': native['before']['complete'], 'afterComplete': native['after']['complete'],
    'qualified': native['qualified'], 'unchangedVerified': native['unchangedVerified'],
    'forest': forest, 'internalEdges': edges, 'counts': native['counts'], 'calls': native['calls'],
    'directoryTargets': sum(item['directory'] for item in forest),
    'fileTargets': sum(not item['directory'] for item in forest),
    'afterSameOwnedBeforeCount': sum(item['sameOwnedBefore'] for item in native['after']['forest']),
    'afterByteEqualBeforeCount': sum(item['byteEqualBefore'] for item in native['after']['forest']),
    'errors': native['errors'], 'qualificationFailures': native['qualificationFailures'],
    'drift': native['drift'], 'unknownOwnership': native['unknownOwnership'],
    'allActualHandlesAndAllocationsAttemptedClosed': True,
    'securityQuery': native['securityQuery'], 'inheritance': native['inheritance'],
    'scope': native['qualificationScope'], 'limitations': native['limitations'],
    'boundaries': {'readOnlyAdmission': False, 'labelOriginQualified': False, 'productionScopeReady': False, 'sg11': 'ACTIVE', 'sg12': 'ACTIVE', 'sourceWindowReleasedBeforeArchive': True, 'hostInstantiated': False, 'newSdkProfileTempOrBusinessChild': False, 'nativeBusinessSet': False, 'failedNonnullOrReleaseFailureInjected': False, 'protectedEdgeExecuted': False, 'existingNullWriteRecoveryValidated': False, 'oldRound35UnknownClosed': False, 'newNodeTestRegistrations': 0, 'guardOrOtherGroupRerun': False, 'gitWritesChannelCiDeploy': False},
    'privateEvidenceIndex': 'batch-index.json',
}
summary_bytes = (json.dumps(summary, ensure_ascii=False, indent=2) + '\n').encode()
console_bytes = (root / (prefix + 'run-console.log')).read_bytes()
report = base / 'round-37.md'
report_bytes = report.read_bytes()
metadata = {'readroots-qualification-summary.json': {'bytes': len(summary_bytes), 'sha256': sha(summary_bytes)}, 'native-console.log': {**facts(root / (prefix + 'run-console.log')), 'temporarySource': prefix + 'run-console.log'}, 'archive-update.py': facts(Path(__file__))}
matrix_meta = {'path': matrix.relative_to(root).as_posix(), 'beforeBytes': len(raw), 'beforeSha256': sha(raw), 'afterBytes': len(updated.encode()), 'afterSha256': sha(updated.encode()), 'businessRowsBefore': 297, 'businessRowsAfter': 298, 'columnAdded': 'round_37', 'existingRowAnnotations': annotations, 'existingNotRerunRows': 295, 'newRow': new, 'appendedRawSuffix': suffix, 'reverseVerifiedSha256': sha(reverse.encode())}
index = {'round': 37, 'disposition': summary['disposition'], 'head': summary['head'], 'dirtyWorkingTree': True, 'sourceCount': 19, 'aggregateSha256': aggregate, 'sourceFiles': maps[0], 'sevenRecordedSourceMapsIdentical': True, 'input': checked['input'], 'files': metadata, 'report': {'path': report.relative_to(root).as_posix(), **facts(report)}, 'privateEvidence': private, 'matrix': matrix_meta, 'inventory': {'path': inventory.relative_to(root).as_posix(), **inventory_facts, 'identityRows': 5472, 'changed': False, 'newOrDeletedIdentities': 0}, 'cleanup': {'newTenPrivateAssets': 'RETAINED_FOR_REVIEW', 'oldRound35AndRound36AssetsInstallationsJournalsLocks': 'UNMODIFIED_NO_CLEANUP', 'disposableIntermediateFilesCreated': 0, 'cleanupRequired': False}, 'boundaries': summary['boundaries']}
index_bytes = (json.dumps(index, ensure_ascii=False, indent=2) + '\n').encode()
for data in [summary_bytes, index_bytes, report_bytes, console_bytes, Path(__file__).read_bytes()]:
    content = data.decode()
    assert not re.search(r'S-1-\d+(?:-\d+)+', content)
    assert not re.search(r'[A-Za-z]:[\\/]', content)
    assert not re.search(r'(?<![a-fA-F0-9])[a-fA-F0-9]{48}(?![a-fA-F0-9])', content)
new_files = {'native-console.log': console_bytes, 'readroots-qualification-summary.json': summary_bytes, 'batch-index.json': index_bytes}
assert all(not (out / name).exists() and not (out / name).is_symlink() for name in new_files)
if sys.argv[1] == '--run':
    assert matrix.read_bytes() == raw and facts(inventory) == inventory_facts
    for name, data in new_files.items():
        with (out / name).open('xb') as file:
            file.write(data)
    matrix.write_bytes(updated.encode())
print(json.dumps({'mode': sys.argv[1], 'effects': 0 if sys.argv[1] == '--check' else 4, 'hostOrNativeExecuted': False, 'privateAssetsRetained': len(private), 'sourceMapsEqual': len(maps), 'sourceCount': len(maps[0]), 'inventoryUnchanged': True, 'matrix': matrix_meta, 'summary': {'bytes': len(summary_bytes), 'sha256': sha(summary_bytes)}, 'report': facts(report)}, ensure_ascii=False))
