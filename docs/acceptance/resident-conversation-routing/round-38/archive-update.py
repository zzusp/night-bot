from pathlib import Path
import argparse, csv, hashlib, io, json, re, sys

sys.stdout.reconfigure(encoding='utf-8')
ap = argparse.ArgumentParser()
g = ap.add_mutually_exclusive_group(required=True)
g.add_argument('--check', action='store_true')
g.add_argument('--run', action='store_true')
a = ap.parse_args()
r = Path.cwd().resolve()
b = r / 'docs/acceptance/resident-conversation-routing'
d = b / 'round-38'
assert Path(__file__).resolve() == d / 'archive-update.py'
sha = lambda data: hashlib.sha256(data).hexdigest()
encode = lambda value: (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()
prefix = 'docs/tmp/sg11-workspace-contract-final-'
inputs = {suffix: (r / (prefix + suffix)).read_bytes() for suffix in ['source.json', 'result.json', 'stdout.log', 'stderr.log', 'cases.json']}
s = json.loads(inputs['source.json'])
v = json.loads(inputs['result.json'])
c = json.loads(inputs['cases.json'])
assert s['head'] == '6d79b0a0279d3f94f2d72d21f51ab1d654b0f509'
assert s['branch'] == 'worktree-resident-conversation-routing'
assert s['files'] == v['sourceBefore'] == v['sourceAfter']
assert s['fileCount'] == len(s['files']) == 252
assert sha(json.dumps(s['files'], separators=(',', ':')).encode()) == s['aggregateSha256'] == '136226787036ce295e09871220919bc6bf432b25e5f71683ef0b78fedbb8bc25'
assert v['exitCode'] == 0 and v['naturalWaitReturned'] is True and v['forcedTermination'] is False and v['sourceChanged'] == []
assert inputs['stderr.log'] == b''
for name, digest in s['files'].items():
    assert sha((r / name).read_bytes()) == digest, name
log = inputs['stdout.log'].decode()
observed = {}
for line_no, line in enumerate(log.splitlines(), 1):
    match = re.fullmatch(r'ok \d+ - (.+)', line)
    if match:
        assert match[1] not in observed
        observed[match[1]] = line_no
assert len(observed) == 13 and not any(line.startswith('not ok ') for line in log.splitlines())
for key, expected in [('tests', 13), ('pass', 13), ('fail', 0), ('cancelled', 0), ('skipped', 0), ('todo', 0)]:
    assert re.search(rf'^# {key} {expected}$', log, re.M)
assert len(c['rows']) == 13 and set(observed) == {x['name'] for x in c['rows']}
assert sha((r / c['algorithmFile']).read_bytes()) == c['algorithmSha256']
for x in c['rows']:
    assert x['sourceSha256'] == s['files'][x['file']]
    assert x['resolution'] == 'STATIC' and x['kind'] == 'case' and x['groups'] == 'default'
    assert x['occurrence'] == 1 and re.fullmatch(r'[0-9a-f]{64}', x['registrationSha256'])

inventory = b / 'test-case-inventory.csv'
im = inventory.read_bytes()
assert len(im) == 3320505 and sha(im) == 'aeb6cc97bcedbcce7b7d63aa984159a18b699b7b67f347deb2e4e057f5464fdb'
reader = csv.DictReader(io.StringIO(im.decode()))
old = list(reader)
fields = reader.fieldnames
assert len(old) == 5472 and im.endswith(b'\n')
identity = lambda x: (x['file'], x['case_name'], str(x['occurrence']))
old_ids = {identity(x) for x in old}
assert len(old_ids) == len(old)
added = []
for x in c['rows']:
    row = {key: '' for key in fields}
    row.update(file=x['file'], line=str(x['line']), occurrence=str(x['occurrence']), case_name=x['name'], kind=x['kind'], groups=x['groups'], current_source_sha256=x['sourceSha256'], registration_sha256=x['registrationSha256'], resolution=x['resolution'], latest_evidence_status='PASS', evidence_id='docs/acceptance/resident-conversation-routing/round-38/workspace-contract.log', evidence_line=str(observed[x['name']]), evidence_sha256=sha(inputs['stdout.log']), evidence_round='38', evidence_test_sha256=x['sourceSha256'], version_boundary='Dirty worktree at HEAD 6d79b0a; round-38/workspace-contract-source.json and workspace-contract-result.json bind 252 files, aggregate ' + s['aggregateSha256'] + '; Host/SDK/SQLite and fake FFI only, no Native ABI/SD/OS claim.', disposition='RETAINED_CASE_WITH_BOUND_ROUND_38_EVIDENCE', evidence_selection_basis='Exact complete TAP title and original AST CallExpression source slice; unique file/name/occurrence; two static for-of titles retain their shared registration slice hash.', contract_classification='CURRENT_RUNNER', contract_evidence='Original scripts/test-pi.mjs default auto-discovery; ' + x['file'] + ':' + str(x['line']) + '; round-38/workspace-contract-cases.json')
    assert identity(row) not in old_ids
    added.append(row)
assert len({identity(x) for x in old + added}) == 5485
text = io.StringIO(newline='')
writer = csv.DictWriter(text, fieldnames=fields, lineterminator='\n')
writer.writerows(added)
new_inventory = im + text.getvalue().encode()
assert new_inventory[:len(im)] == im

matrix = b / 'matrix.csv'
mm = matrix.read_bytes()
assert len(mm) == 208843 and sha(mm) == '77fa88290ad87de4d1d1bcce503c7626acb61e5af6ddb7ca80eeee0e59323e4b'
reader = csv.DictReader(io.StringIO(mm.decode()))
mr = list(reader)
mf = reader.fieldnames
assert len(mr) == 298 and mf[-1] == 'round_37'
def render(rows, columns):
    out = io.StringIO(newline='')
    w = csv.DictWriter(out, fieldnames=columns, lineterminator='\n')
    w.writeheader()
    w.writerows(rows)
    return out.getvalue().encode()
assert render(mr, mf) == mm
for row in mr:
    row['round_38'] = 'NOT_RERUN_ROUND_38'
aggregate_rows = {
    'all-required-regressions': 'PARTIAL_WORKSPACE_INITIALIZATION_13_PASS_SCRIPTED_HOST_AND_FAKE_FFI_ONLY_OTHER_GROUPS_NOT_RERUN_NO_NATIVE_PROOF',
    'sg11-final-remaining-checks': 'PARTIAL_16_22_WEB_ROUTER_RECOVERY_LIFECYCLE_AND_RESOURCE_CONTRACT_13_PASS_16_21_PREPARED_NOT_NATIVE_EXECUTED',
}
for key, status in aggregate_rows.items():
    matches = [row for row in mr if row['case_id'] == key]
    assert len(matches) == 1
    matches[0]['round_38'] = status
ids = ['sg11-workspace-web-once-cold', 'sg11-workspace-failed-hidden-idle', 'sg11-workspace-original-double-error', 'sg11-workspace-untrusted-ready-denied', 'sg11-workspace-router-inner-replay', 'sg11-workspace-router-plan-rollback', 'sg11-workspace-admissions-close-idle', 'sg11-workspace-sealed-restore-adopt', 'sg11-workspace-local-address-reuse', 'sg11-workspace-nonnull-status-failure', 'sg11-workspace-nonnull-throw-failure', 'sg11-workspace-local-free-retained', 'sg11-workspace-handle-close-retained']
scenarios = ['Web并发、ready当前投影、冷重放与已有work仅初始化一次', 'failed工作区隐藏且idle，重放/重启不ack wake或再次初始化', 'Native边界与finish双错保原Error及ownership，不二次尝试', '请求fresh/ready字段不能授权初始化、claim、archive或ensure', '真实Router两task及新outer下同operation重放保逐task结果', '真实Router无效依赖事务回滚，不产生task或初始化', 'whenIdle/close等待admissions及同task重放，store最后关闭且拒新创建', 'sealed backup/restore/adopt保ready身份、work和review hold，不再初始化', '真实资源管理配假FFI：LocalFree成功后同地址新分配各释放一次', '真实资源管理配假FFI：nonnull out后status失败先认领再释放一次', '真实资源管理配假FFI：nonnull out后throw失败保原错误并释放一次', '真实资源管理配假FFI：LocalFree失败保attempted未closed，不重试或继续申请', '真实资源管理配假FFI：一CloseHandle失败仍关另一项，保原失败及ownership']
assert len(ids) == len(scenarios) == 13 and not set(ids) & {row['case_id'] for row in mr}
for i, (key, scenario) in enumerate(zip(ids, scenarios)):
    row = {key: '' for key in mf + ['round_38']}
    row.update(case_id=key, scenario=scenario, round_38='PASS_REAL_HOST_CONTRACT_NO_NATIVE' if i < 8 else 'PASS_REAL_RESOURCE_MANAGEMENT_FAKE_FFI_NO_OS')
    mr.append(row)
assert render([{key: row[key] for key in mf} for row in mr[:298]], mf) == mm
new_matrix = render(mr, mf + ['round_38'])
assert len(mr) == 311

outputs = {d / ('workspace-contract-' + suffix): data for suffix, data in inputs.items() if suffix.endswith('.json')}
outputs[d / 'workspace-contract.log'] = inputs['stdout.log']
outputs[d / 'workspace-contract-stderr.log'] = inputs['stderr.log']
summary = {'round': 38, 'scope': 'Section 16.22 non-Native contract regression only', 'head': s['head'], 'branch': s['branch'], 'workingTree': s['workingTree'], 'sourceCount': 252, 'sourceAggregateSha256': s['aggregateSha256'], 'command': v['command'], 'startedAt': v['startedAt'], 'finishedAt': v['finishedAt'], 'exitCode': 0, 'naturalWaitReturned': True, 'forcedTermination': False, 'sourceChanged': [], 'counts': {'tests': 13, 'pass': 13, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}, 'highLevelRealHostCases': 8, 'lowLevelFakeFfiResourceCases': 5, 'inventoryBefore': 5472, 'inventoryAfter': 5485, 'matrixBefore': 298, 'matrixAfter': 311, 'historicalInventoryPrefixSha256': sha(im), 'historicalMatrixReconstructionSha256': sha(mm), 'notProven': ['real Win32 ABI, Low birth SD or OS containment', 'legacy task without workspaceInitialization, dynamic coverage', 'simultaneous live Local alias rejection, dynamic coverage', 'Section 16.21 Native component', 'other required groups, live model/vendor, CI, merge or deployment'], 'caseMapping': [{'matrixCaseId': key, 'file': x['file'], 'case': x['name'], 'tapLine': observed[x['name']]} for key, x in zip(ids, c['rows'])]}
outputs[d / 'summary.json'] = encode(summary)
index = {'round': 38, 'artifacts': {p.relative_to(b).as_posix(): {'bytes': len(data), 'sha256': sha(data)} for p, data in outputs.items()}, 'report': {'path': 'round-38.md', 'bytes': len((b / 'round-38.md').read_bytes()), 'sha256': sha((b / 'round-38.md').read_bytes())}, 'archiveRecipe': {'path': 'round-38/archive-update.py', 'sha256': sha(Path(__file__).read_bytes())}, 'inventory': {'beforeSha256': sha(im), 'afterBytes': len(new_inventory), 'afterSha256': sha(new_inventory)}, 'matrix': {'beforeSha256': sha(mm), 'afterBytes': len(new_matrix), 'afterSha256': sha(new_matrix)}}
outputs[d / 'evidence-index.json'] = encode(index)
assert all(not p.exists() and not p.is_symlink() for p in outputs)
print(json.dumps({'mode': 'check' if a.check else 'run', 'effects': 0 if a.check else 'archive-files-and-two-ledgers-only', 'tests': 13, 'pass': 13, 'inventoryBefore': 5472, 'inventoryAfter': 5485, 'inventoryAfterSha256': sha(new_inventory), 'matrixBefore': 298, 'matrixAfter': 311, 'matrixAfterSha256': sha(new_matrix), 'oldInventoryRowsBytePreserved': True, 'oldMatrixReconstructsExactly': True, 'nativeExecuted': False, 'newArtifacts': len(outputs)}, ensure_ascii=False))
if a.run:
    assert inventory.read_bytes() == im and matrix.read_bytes() == mm
    for p, data in outputs.items():
        with p.open('xb') as f:
            f.write(data)
    inventory.write_bytes(new_inventory)
    matrix.write_bytes(new_matrix)
