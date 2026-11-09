from pathlib import Path
import csv,hashlib,io,json,re,shutil,subprocess,sys
sys.stdout.reconfigure(encoding='utf-8')
assert sys.argv[1:] in (['--check'],['--run'],['--cleanup-check'],['--cleanup'])
root=Path.cwd();base=root/'docs/acceptance/resident-conversation-routing';out=base/'round-36'
assert root.as_posix().endswith('/resident-conversation-plan/night-bot')
sha=lambda value:hashlib.sha256(value).hexdigest()
def facts(path):
    value=path.read_bytes();return {'bytes':len(value),'sha256':sha(value)}
guard_copies={
    'docs/tmp/sg11-profile-fixed-check-source.json':'guard-source.json',
    'docs/tmp/sg11-profile-fixed-check.log':'guard.log',
    'docs/tmp/sg11-profile-fixed-check-stderr.log':'guard-stderr.log',
    'docs/tmp/sg11-profile-fixed-check-result.json':'guard-result.json',
    'docs/tmp/sg11-profile-fixed-collector.py':'guard-collector.py'}
if sys.argv[1] in ['--cleanup-check','--cleanup']:
    index_path=out/'batch-index.json';index=json.loads(index_path.read_bytes())
    assert index['cleanup']['state']=='PENDING_EXACT_FIVE_GUARD_FILES'
    checked={}
    for spelling,target in guard_copies.items():
        path=root/spelling;info=path.lstat();assert path.is_file() and not path.is_symlink() and not getattr(info,'st_file_attributes',0)&0x400
        assert facts(path)==index['cleanup']['exactTemporaryFiles'][spelling]
        assert facts(out/target)==facts(path);checked[spelling]=facts(path)
    if sys.argv[1]=='--cleanup':
        before=sha(index_path.read_bytes())
        for spelling in checked:(root/spelling).unlink()
        index['cleanup'].update({'state':'CLEANED_EXACT_FIVE_GUARD_FILES','removedFiles':checked,'priorIndexSha256':before,'effects':5,'nativePrivateAssetsAndInstallationsUntouched':True})
        index_path.write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    print(json.dumps({'mode':sys.argv[1],'effects':0 if sys.argv[1]=='--cleanup-check' else 5,'exactGuardTemporaryFiles':checked,'nativeOrInstallationCleanup':False},ensure_ascii=False));sys.exit(0)
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
assert base.is_dir() and out.is_dir() and not (out/'batch-index.json').exists() and not (out/'windows-profile-unlaunched-summary.json').exists()
prefix='docs/tmp/sg11-profile-unlaunched-fixed-'
expected={
    'probe.mjs':'ba0b0d2e29ef9d4be8615c93f4d73986479782294e2e9382e48c988f56a5b9d3',
    'check.json':'013b54a4a95896a5500be8ea4602f4c113b6f4dd5a478d07a41838b67ad82610',
    'check-execution.json':'47ec927e63a3a48edbbede2d91c6d634c0f7dda7c40bbc6f22dfd2373e91d2da',
    'checklist.md':'878b101249b88a37c8e3f6408946da587c7d54b9138645644bb638c491a865d2',
    'execute.py':'1bd40f92137d7102181af57ee162b3db7505246c8e889d400471d0569cc8926f',
    'execution.json':'5fdaadb285d9e13ef2f1cb31b958d0ad05ce68fbcaa1874bfe06bc7fc92fbd92',
    'run.json':'f00874409ff9f6432d5b56e73fcf19a912f51c9903bdc0a16b4baa69057c2f81',
    'run-check.json':'013b54a4a95896a5500be8ea4602f4c113b6f4dd5a478d07a41838b67ad82610',
    'run-console.log':'0d15ced598c1b0fe394348c0c8de5475cdd85841f2572fc1910976677c0fb6f7',
    'run-stderr.log':sha(b'')}
private={}
for suffix,digest in expected.items():
    path=root/(prefix+suffix);assert not path.is_symlink() and facts(path)['sha256']==digest,suffix
    spelling=path.relative_to(root).as_posix()
    assert subprocess.run(['git','check-ignore','-q','--',spelling],cwd=root).returncode==0
    assert subprocess.check_output(['git','ls-files','--',spelling],cwd=root)==b''
    assert subprocess.check_output(['git','diff','--cached','--name-only','--',spelling],cwd=root)==b''
    private[spelling]=facts(path)
execution=json.loads((root/(prefix+'execution.json')).read_bytes());native=json.loads((root/(prefix+'run.json')).read_bytes());check=json.loads((root/(prefix+'check.json')).read_bytes());prepared=json.loads((root/(prefix+'check-execution.json')).read_bytes())
guard_source=json.loads((root/'docs/tmp/sg11-profile-fixed-check-source.json').read_bytes());guard_result=json.loads((root/'docs/tmp/sg11-profile-fixed-check-result.json').read_bytes())
assert execution['exitCode']==0 and execution['componentPass'] is True and execution['naturalWaitReturned'] is True and execution['sourceChanged']==[] and execution['intervention'] is None and execution['forcedTermination'] is False and 'collectorError' not in execution
assert native['componentPass'] is True and native['errors']==[] and execution['freshCheckCommand']==prepared['command'] and execution['freshCheck']['exitCode']==0 and execution['freshCheck']['stderr']==''
assert (root/(prefix+'run-check.json')).read_bytes()==(root/(prefix+'check.json')).read_bytes()
assert guard_result['exitCode']==0 and guard_result['sourceChanged']==[] and guard_result['intervention'] is None and guard_result['forcedTermination'] is False
maps=[guard_source['files'],guard_result['sourceEnd']['files'],check['sourceBefore']['files'],execution['sourceBefore'],execution['sourceAfter'],native['sourceBefore']['files'],native['sourceAfter']['files']]
assert all(value==maps[0] for value in maps) and len(maps[0])==1125
aggregate=sha(json.dumps(maps[0],sort_keys=True,separators=(',',':')).encode());assert aggregate=='37c9bb7f56e2d07d07183e90857ee247b607f28ed0d5bc713118515448272170'
assert maps[0]['src/process/windows-profile.js']=='944b9419740fa342d4dcbd838b35567815dcc621a26bdc0e698d21df237eec13' and maps[0]['docs/process-fork-manifest.json']=='ca04fdeb7148efb6c4d91d9abc8e3caad93127990506ec53b2e998b58112e2a6'
for name,meta in guard_result['artifacts'].items():assert facts(root/meta['path'])=={key:meta[key] for key in ['bytes','sha256']}
guards=[json.loads(line) for line in (root/'docs/tmp/sg11-profile-fixed-check.log').read_text(encoding='utf-8').splitlines()];assert len(guards)==3
job=native['jobId'];cold_job=[receipt for receipt in native['cold']['audit'] if receipt['domain']=='job' and receipt['payload']['jobId']==job];assert cold_job==native['liveJobAudit'] and len(cold_job)==5
assert [entry['kind'] for entry in cold_job]==['registered','resource-ownership','resource-ownership','resource-ownership','settled']
assert [entry['payload']['resource']['status'] for entry in cold_job if entry['kind']=='resource-ownership']==['planned','unknown-retained','released']
assert native['released']['status']=='released' and native['released']['profileAbsent'] is True and native['released']['retainedHandles']==native['released']['retainedAllocations']==0
assert native['settled']['receipt']['payload']['producerReported'] is True and native['settled']['receipt']['payload']['status']=='completed'
assert native['liveUnresolved']==native['cold']['unresolved']==[] and native['coldViaOriginalRecorder']==native['releasedLiveProofs']
assert native['finalReceipt']['launchAttempted'] is False and native['finalReceipt']['state']=='registration-and-folder-absent'
assert all(item['attempted'] and item['closed'] for item in native['observer']['handles']+native['observer']['allocations'])
journal_bytes=Path(native['cold']['journalPath']).read_bytes();assert len(journal_bytes)==native['cold']['bytes']==61199 and sha(journal_bytes)==native['cold']['sha256']=='a018e16c707482e473bb8409645fa60a901987e94fddd7b1aa54f89e9bd0fc12'
assert native['task']['status']=='active' and native['task']['drained'] is True and native['independentTempAbsent'] is True and len(native['independentSdkDirectoriesAbsent'])==2
inventory=base/'test-case-inventory.csv';inventory_facts=facts(inventory);assert inventory_facts=={'bytes':3320505,'sha256':'aeb6cc97bcedbcce7b7d63aa984159a18b699b7b67f347deb2e4e057f5464fdb'}
matrix=base/'matrix.csv';raw=matrix.read_bytes();assert sha(raw)=='f0da44c0fd024d7f00794cf1d10583eddf0dbf5ef5827a9aa986f32a2ad374fa'
text=raw.decode();reader=csv.DictReader(io.StringIO(text,newline=''));fields=reader.fieldnames;rows=list(reader);assert len(rows)==296 and fields[-1]=='round_35' and 'round_36' not in fields
annotations={
    'source-import-native-guard':'PASS_THREE_ORIGINAL_GUARDS_EXIT0_PROFILE_944B_MANIFEST_CA04_1125_37C9_STABLE',
    'all-required-regressions':'PARTIAL_NEW_PROFILE_UNLAUNCHED_COMPONENT_AND_THREE_GUARDS_PASS_FULL_LPAC_AND_OTHER_GROUPS_NOT_VALIDATED',
    'sg11-final-remaining-checks':'PARTIAL_REAL_PROFILE_UNLAUNCHED_PROOF_RELEASED_SETTLED_STRICT_COLD_PASS_R35_UNKNOWN_RETAINED_FULL_CHAIN_NOT_VALIDATED'}
assert set(annotations).issubset({row['case_id'] for row in rows});updated=text
for row_index,cells in reversed(list(enumerate(spans(text)))):
    at=cells[-1][1];value='round_36' if row_index==0 else annotations.get(rows[row_index-1]['case_id'],'NOT_RERUN_ROUND_36');updated=updated[:at]+','+value+updated[at:]
new={field:'' for field in fields+['round_36']};new.update({'case_id':'sg11-profile-unlaunched-fixed-host','scenario':'修复后新根真实Host未launch Profile准备、原proof、唯一回收、released与Job settled及严格cold；不关闭旧unknown','round_36':'PASS_REAL_HOST_PROFILE_UNLAUNCHED_PROOF_RELEASED_PRODUCER_REPORTED_STRICT_COLD_NO_UNRESOLVED_NODE0_37C9'})
assert new['case_id'] not in {row['case_id'] for row in rows};suffix=','.join(encode(new[field]) for field in fields+['round_36'])+'\n';updated+=suffix;reverse=updated[:-len(suffix)]
for cells in reversed(spans(reverse)):
    start,end=cells[-1];reverse=reverse[:start-1]+reverse[end:]
assert reverse.encode()==raw
proof=native['proofEntry']['receipt']['payload']['privateProof'];roles={role:sum(item['role']==role for item in proof['objects']) for role in sorted({item['role'] for item in proof['objects']})}
summary={
    'round':36,'disposition':'PASS_NEW_ROOT_REAL_PROFILE_UNLAUNCHED_COMPONENT_ONLY','head':'6d79b0a0279d3f94f2d72d21f51ab1d654b0f509','dirtyWorkingTree':True,'sourceCount':1125,'aggregateSha256':aggregate,'sevenSourceMapsIdentical':True,
    'guard':{'taskId':'bqkm061l1','toolUseId':'call_ffbccd29fad64b71b4e1834c9cef7aab','command':guard_result['command'],'startedAt':guard_result['startedAt'],'finishedAt':guard_result['finishedAt'],'exitCode':0,'sourceChanged':[],'originalOutputs':guards},
    'nativeRun':{'taskId':'b25egmf4e','toolUseId':'call_1be5787c86ea4031902eff808cc75b92','command':'python -I docs/tmp/sg11-profile-unlaunched-fixed-execute.py --run',**{key:execution[key] for key in ['startedAt','finishedAt','nodePid','exitCode','naturalWaitReturned','componentPass','sourceChanged','intervention','forcedTermination']}},
    'freshCheck':execution['freshCheck'],'freshArgvExactlyMatchesReviewed':True,'freshStdoutExactlyMatchesReviewed':True,
    'steps':native['steps'],'errors':native['errors'],'task':{'status':native['task']['status'],'drained':native['task']['drained'],'lastAction':native['task']['lastDecision']['action']},
    'scopeRoots':{'read':4,'writePrivateTemp':1,'oldReadRootsDaclQualified':False},
    'observer':{'handles':native['observer']['handles'],'allocations':native['observer']['allocations'],'reads':native['observer']['reads'],'control':native['observer']['snapshot']['control'],'controlHex':format(native['observer']['snapshot']['control'],'x'),'label':native['observer']['snapshot']['label'],'closedBeforeProof':native['steps'].index('independent-temp-observation-closed')<native['steps'].index('commitOwnedProof-returned')},
    'proof':{'phase':proof['phase'],'scopeCount':proof['scopeCount'],'objectRoles':roles,'liveAndOriginalRecorderColdEqual':True},
    'jobAudit':[{'kind':entry['kind'],'seq':entry['payload'].get('seq'),'status':entry['payload'].get('resource',{}).get('status',entry['payload'].get('status')),'proofPhase':entry['payload'].get('privateProof',{}).get('phase'),'producerReported':entry['payload'].get('producerReported')} for entry in cold_job],
    'released':{key:value for key,value in native['released'].items() if key not in ['profileName','profileSid']},
    'settled':{'entryId':native['settled']['entryId'],'status':'completed','producerReported':True},
    'journal':{'bytes':native['cold']['bytes'],'sha256':native['cold']['sha256'],'originalDecodePiJournalRequireComplete':True,'explicitOriginalPortableCodec':True,'actualDiskBytesIndependentlyMatched':True,'sameJobColdAuditEqualsLive':True},
    'liveUnresolved':native['liveUnresolved'],'coldUnresolved':native['cold']['unresolved'],'independentTempAbsent':True,'independentSdkDirectoryCountAbsent':2,
    'profileLifecycle':{name:{key:value for key,value in native[name].items() if key in ['state','created','creationAttempted','launchAttempted','cleanupAttempted','deleteAttempted','retainedHandles','retainedAllocations','threadRestored','sealed','sealState']} for name in ['createdReceipt','deletedReceipt','finalReceipt']},
    'privateEvidence':private,'boundaries':{'newInstallationRetained':True,'sourceWindowReleasedBeforeArchive':True,'oldRound35UnknownRetained':True,'oldRound35InstallationAndEvidenceUntouched':True,'productionScopeReady':False,'sg11':'ACTIVE','sg12':'ACTIVE','fullLpacMandatoryLaunchJobAckConptyValidated':False,'existingNullBusinessTreesValidated':False,'knownFolderFailedNonnullBranchExecuted':False,'nativeBodyCallCountsInstrumented':False,'hostOrNativeRerun':False,'newNodeTestRegistrations':0,'gitWritesChannelCiDeploy':False}}
summary_bytes=(json.dumps(summary,ensure_ascii=False,indent=2)+'\n').encode()
copies={**guard_copies,prefix+'run-console.log':'native-console.log'}
metadata={target:{**facts(root/source),'temporarySource':source} for source,target in copies.items()};metadata['windows-profile-unlaunched-summary.json']={'bytes':len(summary_bytes),'sha256':sha(summary_bytes)};metadata['archive-update.py']=facts(Path(__file__))
report=base/'round-36.md';assert report.is_file();report_bytes=report.read_bytes()
matrix_meta={'path':matrix.relative_to(root).as_posix(),'beforeBytes':len(raw),'beforeSha256':sha(raw),'afterBytes':len(updated.encode()),'afterSha256':sha(updated.encode()),'businessRowsBefore':296,'businessRowsAfter':297,'columnAdded':'round_36','existingRowAnnotations':annotations,'existingNotRerunRows':293,'newRow':new,'appendedRawSuffix':suffix,'reverseVerifiedSha256':sha(reverse.encode())}
index={'round':36,'disposition':summary['disposition'],'head':summary['head'],'dirtyWorkingTree':True,'sourceCount':1125,'aggregateSha256':aggregate,'sevenSourceMapsIdentical':True,'hostTasks':{'guard':'bqkm061l1','native':'b25egmf4e'},'files':metadata,'report':{'path':report.relative_to(root).as_posix(),**facts(report)},'matrix':matrix_meta,'inventory':{'path':inventory.relative_to(root).as_posix(),**inventory_facts,'identityRows':5472,'changed':False,'newOrDeletedIdentities':0},'privateEvidence':private,'cleanup':{'state':'PENDING_EXACT_FIVE_GUARD_FILES','exactTemporaryFiles':{spelling:facts(root/spelling) for spelling in guard_copies},'nativePrivateAssetsAndNewInstallation':'RETAINED_FOR_REVIEW','oldRound35InstallationAndEvidence':'UNTOUCHED','temporaryArchiveOrCleanupFilesCreated':0},'boundaries':summary['boundaries']}
index_bytes=(json.dumps(index,ensure_ascii=False,indent=2)+'\n').encode()
for value in [summary_bytes,index_bytes,report_bytes,*((root/path).read_bytes() for path in copies)]:
    content=value.decode();assert not re.search(r'S-1-\d+(?:-\d+)+',content) and not re.search(r'[A-Za-z]:[\\/]',content)
if sys.argv[1]=='--run':
    assert matrix.read_bytes()==raw and facts(inventory)==inventory_facts
    for source,target in copies.items():shutil.copyfile(root/source,out/target);assert facts(out/target)==facts(root/source)
    with (out/'windows-profile-unlaunched-summary.json').open('xb') as file:file.write(summary_bytes)
    with (out/'batch-index.json').open('xb') as file:file.write(index_bytes)
    matrix.write_bytes(updated.encode())
print(json.dumps({'mode':sys.argv[1],'effects':0 if sys.argv[1]=='--check' else len(copies)+3,'privateNativeAssetsRetained':len(private),'inventoryUnchanged':True,'sourceMapsEqual':len(maps),'matrix':matrix_meta,'summary':{'bytes':len(summary_bytes),'sha256':sha(summary_bytes)},'report':facts(report)},ensure_ascii=False))
