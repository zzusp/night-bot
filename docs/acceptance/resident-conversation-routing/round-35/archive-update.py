from pathlib import Path
import csv,hashlib,io,json,re,subprocess,sys
sys.stdout.reconfigure(encoding='utf-8')
assert sys.argv[1:] in (['--check'],['--run'])
root=Path.cwd();base=root/'docs/acceptance/resident-conversation-routing';out=base/'round-35'
assert root.as_posix().endswith('/resident-conversation-plan/night-bot')
sha=lambda value:hashlib.sha256(value).hexdigest()
def facts(path):
    value=path.read_bytes();return {'bytes':len(value),'sha256':sha(value)}
def spans(text):
    pattern=re.compile(r'("(?:[^"]|"")*"|[^,\r\n]*)(,|\r?\n|$)');result=[];cells=[];at=0
    while at<len(text):
        match=pattern.match(text,at);assert match and match.end()>at
        cells.append((match.start(1),match.end(1)));at=match.end()
        if match[2]!=',':result.append(cells);cells=[]
    assert not cells
    return result
def encode(value):
    return '"'+value.replace('"','""')+'"' if any(char in value for char in ',\r\n"') else value
assert base.is_dir() and out.is_dir()
assert not (out/'windows-profile-unlaunched-summary.json').exists() and not (out/'batch-index.json').exists()
prefix='docs/tmp/sg11-profile-unlaunched-'
expected={
    'probe.mjs':'9e90a078b30cba1db279b0ae872b1bad3cadff1e88d763eaca8160cf77bb6aa4',
    'check.json':'0c6861aa68d8c71a2038f225064793c991145244929046d2f26f80657d422de5',
    'check-execution.json':'f9e3281cf241ecf5189982d8c7469475876a0f1a2d166fe22fbf4bc5a6c2a4ca',
    'checklist.md':'64bb20e673f7b98f23dc5468e16bc36c0d57b49b3a2e2acb80c91f785bd5d1ce',
    'execute.py':'31a3c20c9252f36223194c13e397463db5cccc8594d843b2b8e371eacb82bc70',
    'execution.json':'9fb5c6554e2dc7bff2b9eb472b27cbd45f38816d08f2cf5db07643f4413f0456',
    'postmortem-journal.json':'d601d999b050fffa35ac88ae8c4c1bc874e3ba71db46088e17a386857e0ef8ab',
    'postmortem-state.json':'493e677ce09445c1f3e2a7819e7ceb390e578f3a393307cace353fa79b90eb32',
    'run-check.json':'0c6861aa68d8c71a2038f225064793c991145244929046d2f26f80657d422de5',
    'run-console.log':sha(b''),'run-stderr.log':sha(b'')}
private={}
for suffix,digest in expected.items():
    path=root/(prefix+suffix);assert not path.is_symlink() and facts(path)['sha256']==digest,suffix
    spelling=path.relative_to(root).as_posix()
    assert subprocess.run(['git','check-ignore','-q','--',spelling],cwd=root).returncode==0
    assert subprocess.check_output(['git','ls-files','--',spelling],cwd=root)==b''
    assert subprocess.check_output(['git','diff','--cached','--name-only','--',spelling],cwd=root)==b''
    private[spelling]=facts(path)
assert not (root/(prefix+'run.json')).exists()
execution=json.loads((root/(prefix+'execution.json')).read_bytes())
check=json.loads((root/(prefix+'check.json')).read_bytes())
check_execution=json.loads((root/(prefix+'check-execution.json')).read_bytes())
journal=json.loads((root/(prefix+'postmortem-journal.json')).read_bytes())
state=json.loads((root/(prefix+'postmortem-state.json')).read_bytes())
assert execution['nodePid']==48888 and execution['exitCode']==3221225477 and execution['naturalWaitReturned'] is True
assert execution['forcedTermination'] is False and execution['intervention'] is None and 'componentPass' not in execution and 'collectorError' not in execution
assert execution['sourceChanged']==[] and execution['sourceBefore']==execution['sourceAfter']==check['sourceBefore']['files']
aggregate=sha(json.dumps(execution['sourceBefore'],sort_keys=True,separators=(',',':')).encode())
assert len(execution['sourceBefore'])==1125 and aggregate=='f302cf519b33b09f8709d8ad49ef7887b3e929685d6f66ed0b3f88b52b988fb7'
assert execution['freshCheckCommand']==check_execution['command'] and execution['freshCheck']['exitCode']==0 and execution['freshCheck']['stderr']==''
assert (root/(prefix+'run-check.json')).read_bytes()==(root/(prefix+'check.json')).read_bytes()
assert journal['journal']['strict']['passed'] is True and journal['journal']['committedBytes']==journal['journal']['totalBytes']==42274
assert journal['journal']['uncommittedBytes']==0 and journal['journal']['sha256']=='a2366fff4e24eb9cd97733179beb029919231ea875d4159ec47291bb9bada5d1'
assert len(journal['entrySequence'])==26 and journal['journal']['lastCommitted']['id']=='5f2ed82c'
assert [entry['receipt']['kind'] for entry in journal['jobEntries']]==['registered','resource-ownership']
registered,planned=journal['jobEntries'];assert registered['entryId']=='605221ca' and planned['entryId']=='45cfa2d2'
assert planned['receipt']['payload']['seq']==1 and planned['receipt']['payload']['resource']['status']=='planned' and 'privateProof' not in planned['receipt']['payload']
for key in ['jobId','owner','kind','label','startedAt','toolCall']:
    assert registered['receipt']['payload'][key]==planned['receipt']['payload'][key]
assert state['taskFields']['status']=='active' and state['databaseQueryOnly']==1 and state['databaseFilesChanged']==[] and state['tempChildren']==[]
assert state['delayedCrashQuery']['exitCode']==0 and state['delayedCrashQuery']['result']['matchingEvents']==0
inventory=base/'test-case-inventory.csv';inventory_facts=facts(inventory)
assert inventory_facts=={'bytes':3320505,'sha256':'aeb6cc97bcedbcce7b7d63aa984159a18b699b7b67f347deb2e4e057f5464fdb'}
assert len(list(csv.DictReader(io.StringIO(inventory.read_text(encoding='utf-8'),newline=''))))==5472
matrix=base/'matrix.csv';raw=matrix.read_bytes();assert sha(raw)=='b2c40bd2e747486a92029bdcc31a84ffb748093774c245a0e50ff60ea1f2217f'
text=raw.decode();reader=csv.DictReader(io.StringIO(text,newline=''));fields=reader.fieldnames;rows=list(reader)
assert len(rows)==295 and fields[-1]=='round_34' and 'round_35' not in fields
annotations={
    'all-required-regressions':'BLOCKED_PROFILE_UNLAUNCHED_NODE_ACCESS_VIOLATION_0XC0000005_COMPONENT_UNKNOWN_PLANNED_UNRESOLVED_OTHER_GROUPS_NOT_RERUN',
    'sg11-final-remaining-checks':'BLOCKED_REAL_PROFILE_UNLAUNCHED_CRASH_PLANNED_COMMITTED_NO_PROOF_RELEASED_SETTLED_NATIVE_STAGE_UNKNOWN'}
assert set(annotations).issubset({row['case_id'] for row in rows})
updated=text
for row_index,cells in reversed(list(enumerate(spans(text)))):
    at=cells[-1][1];value='round_35' if row_index==0 else annotations.get(rows[row_index-1]['case_id'],'NOT_RERUN_ROUND_35')
    updated=updated[:at]+','+value+updated[at:]
new={field:'' for field in fields+['round_35']}
new.update({'case_id':'sg11-profile-unlaunched-real-host','scenario':'真实Host与原durable producer的未启动Profile组件；Node访问冲突异常，最后只有已提交planned，未证资源释放','round_35':'ACCESS_VIOLATION_NODE_EXIT_0XC0000005_COMPONENT_UNKNOWN_STRICT_COMMITTED_PLANNED_ONLY_NO_RELEASED_SETTLED_RETAINED'})
assert new['case_id'] not in {row['case_id'] for row in rows}
suffix=','.join(encode(new[field]) for field in fields+['round_35'])+'\n';updated+=suffix
reverse=updated[:-len(suffix)]
for cells in reversed(spans(reverse)):
    start,end=cells[-1];reverse=reverse[:start-1]+reverse[end:]
assert reverse.encode()==raw
summary={
    'round':35,'disposition':'ACCESS_VIOLATION_COMPONENT_UNKNOWN_RESOURCE_UNRESOLVED',
    'head':'6d79b0a0279d3f94f2d72d21f51ab1d654b0f509','dirtyWorkingTree':True,'sourceCount':1125,'aggregateSha256':aggregate,'sourceChanged':[],
    'hostTaskId':'bghshp88o','toolUseId':'call_c3072470231b42cd89ab742fb31dfcde',
    'run':{key:execution[key] for key in ['startedAt','finishedAt','nodePid','exitCode','naturalWaitReturned','forcedTermination','intervention']},
    'freshCheck':execution['freshCheck'],'freshArgvExactlyMatchesReviewed':True,'freshStdoutExactlyMatchesReviewed':True,
    'componentPass':None,'componentPassWasProduced':False,'rawRunJsonExists':False,
    'journal':{key:journal['journal'][key] for key in ['bytes','sha256','strict','committedBytes','totalBytes','uncommittedBytes','lastCommitted']},
    'committedEntryCount':26,
    'jobAnchors':[{'entryId':entry['entryId'],'timestamp':entry['timestamp'],'kind':entry['receipt']['kind'],'seq':entry['receipt']['payload'].get('seq'),'resourceStatus':entry['receipt']['payload'].get('resource',{}).get('status'),'privateProofPhase':None} for entry in journal['jobEntries']],
    'profileOwnedProofCommitted':False,'settledCommitted':False,'releasedCommitted':False,'unknownRetainedCommitted':False,
    'offlineDecoderSources':journal['decoderSources'],'offlineDecoderPreparationError':journal['preparationError'],
    'sqlite':{'authority':'Original dynamic.db with WAL; mode=ro and query_only=ON','taskStatus':'active','drained':False,'recovering':False,'runSequence':1,'sessionBound':True,'executionRows':0,'taskEventRows':0,'databaseFilesChanged':state['databaseFilesChanged']},
    'crashQueries':[state['primaryCrashQuery'],state['delayedCrashQuery']['result']],
    'faultModule':None,'faultOffset':None,'exactNodeCreationTime':None,'accessViolationSource':'Node process exit code, not a matching Windows event',
    'resourceAfterCrash':{'installationExists':True,'installationIsReparse':False,'tempChildCount':0,'sdkProfileOrRegistrationObserved':False,'osResourceReleased':None,'locksRetained':True,'lockOwnerPids':[entry['pid'] for entry in state['lockOwners']]},
    'coreAssessment':{'factoryPlannedCommitReached':True,'factoryAwaitReturned':None,'sdkCreateCalledOrSucceeded':None,'hostAwaitOrSettledDefectProven':False,'noReplay':'Original source chain retained; no restart performed','faultMayHaveOccurredEarlierAndSurfacedLater':True},
    'privateEvidence':private,
    'boundaries':{'productionScopeReady':False,'sg11':'ACTIVE','sg12':'ACTIVE','hostOrNativeRerun':False,'secondDeleteOrTailRepairOrCleanup':False,'gitWritesChannelCiDeploy':False,'newNodeTestRegistrations':0,'sourceWindowReleasedBeforePostmortem':True,'plannedSnapshotNotPostCrashState':True}}
summary_bytes=(json.dumps(summary,ensure_ascii=False,indent=2)+'\n').encode()
report=base/'round-35.md';assert report.is_file()
report_bytes=report.read_bytes();assert '普通断言FAIL'.encode() in report_bytes
matrix_meta={'path':matrix.relative_to(root).as_posix(),'beforeBytes':len(raw),'beforeSha256':sha(raw),'afterBytes':len(updated.encode()),'afterSha256':sha(updated.encode()),'businessRowsBefore':295,'businessRowsAfter':296,'columnAdded':'round_35','existingRowAnnotations':annotations,'existingNotRerunRows':293,'newRow':new,'appendedRawSuffix':suffix,'reverseVerifiedSha256':sha(reverse.encode())}
index={'round':35,'disposition':summary['disposition'],'head':summary['head'],'dirtyWorkingTree':True,'sourceCount':1125,'aggregateSha256':aggregate,'sourceWindowReleased':True,'hostTaskId':'bghshp88o','files':{'windows-profile-unlaunched-summary.json':{'bytes':len(summary_bytes),'sha256':sha(summary_bytes)},'archive-update.py':facts(Path(__file__))},'report':{'path':report.relative_to(root).as_posix(),**facts(report)},'matrix':matrix_meta,'inventory':{'path':inventory.relative_to(root).as_posix(),**inventory_facts,'identityRows':5472,'changed':False,'newOrDeletedIdentities':0},'privateEvidence':private,'cleanup':{'installationJournalWalLocksSdkAndElevenPrivateAssets':'RETAINED_UNRESOLVED_DO_NOT_REPLAY_OR_DELETE','temporaryArchiveFilesCreated':0},'boundaries':summary['boundaries']}
index_bytes=(json.dumps(index,ensure_ascii=False,indent=2)+'\n').encode()
for content in [summary_bytes,index_bytes,report_bytes]:
    decoded=content.decode();assert not re.search(r'S-1-\d+(?:-\d+)+',decoded) and not re.search(r'[A-Za-z]:[\\/]',decoded)
if sys.argv[1]=='--run':
    assert matrix.read_bytes()==raw and facts(inventory)==inventory_facts
    with (out/'windows-profile-unlaunched-summary.json').open('xb') as file:file.write(summary_bytes)
    with (out/'batch-index.json').open('xb') as file:file.write(index_bytes)
    matrix.write_bytes(updated.encode())
print(json.dumps({'mode':sys.argv[1],'effects':0 if sys.argv[1]=='--check' else 3,'privateAssetsRetained':len(private),'rawAbsent':True,'inventoryUnchanged':True,'matrix':matrix_meta,'summary':{'bytes':len(summary_bytes),'sha256':sha(summary_bytes)},'report':facts(report)},ensure_ascii=False))
