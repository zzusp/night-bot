from pathlib import Path
import csv,hashlib,io,json,re,shutil,sys
sys.stdout.reconfigure(encoding='utf-8')
assert sys.argv[1:] in (['--check'],['--run'])
base=Path('docs/acceptance/resident-conversation-routing');out=base/'round-34'
assert not out.exists()
sha=lambda b:hashlib.sha256(b).hexdigest()
def facts(p):
 raw=p.read_bytes();return {'bytes':len(raw),'sha256':sha(raw)}
def spans(text):
 pattern=re.compile(r'("(?:[^"]|"")*"|[^,\r\n]*)(,|\r?\n|$)');result=[];cells=[];at=0
 while at<len(text):
  m=pattern.match(text,at);assert m and m.end()>at;cells.append((m.start(1),m.end(1)));at=m.end()
  if m[2]!=',':result.append(cells);cells=[]
 assert not cells
 return result
def encode(value):return '"'+value.replace('"','""')+'"' if any(c in value for c in ',\r\n"') else value
copies={};runs={};maps=[]
for group in ['check','profile-smoke']:
 prefix='docs/tmp/sg11-profile-current-'+group
 for suffix,target in [('-source.json',group+'-source.json'),('.log',group+'.log'),('-stderr.log',group+'-stderr.log'),('-result.json',group+'-result.json')]:copies[prefix+suffix]=target
 source=json.loads(Path(prefix+'-source.json').read_bytes());result=json.loads(Path(prefix+'-result.json').read_bytes())
 assert result['exitCode']==0 and result['sourceChanged']==[] and result['intervention'] is None and result['forcedTermination'] is False
 maps.extend([source['files'],result['sourceEnd']['files']]);runs[group]={'source':source,'result':result}
 for role,meta in result['artifacts'].items():assert facts(Path(meta['path']))=={k:meta[k] for k in ['bytes','sha256']}
assert all(m==maps[0] for m in maps) and len(maps[0])==1125
aggregate=sha(json.dumps(maps[0],sort_keys=True,separators=(',',':')).encode())
assert aggregate=='f302cf519b33b09f8709d8ad49ef7887b3e929685d6f66ed0b3f88b52b988fb7'
assert maps[0]['src/process/windows-profile.js']=='2d89946f09a7011923be51833730694447ddbeef4e27845b030c69b2dabf7f45'
assert maps[0]['docs/process-fork-manifest.json']=='a819b051a90b5e76f4b1f13f8cf70aeb9d61e20df78fd4f58a91cb7ab545c5e1'
name='Windows LPAC runner requires durable Job protocol before current-token executable resolution'
log=Path('docs/tmp/sg11-profile-current-profile-smoke.log');lines=log.read_text(encoding='utf-8').splitlines()
assert lines[0].startswith('✔ '+name+' (') and sum(x.startswith('✔ ') for x in lines)==1
for label,n in [('tests',1),('pass',1),('fail',0),('cancelled',0),('skipped',0),('todo',0)]:assert 'ℹ '+label+' '+str(n) in lines
source=Path('test/pi-native-process.test.js').read_bytes();assert sha(source)==maps[0]['test/pi-native-process.test.js']
assert source.decode().splitlines()[26].startswith("test('"+name+"',")
guards=[json.loads(x) for x in Path('docs/tmp/sg11-profile-current-check.log').read_text(encoding='utf-8').splitlines()]
assert len(guards)==3
inventory=base/'test-case-inventory.csv';raw=inventory.read_bytes();assert sha(raw)=='b1bdb346d123d45f2ab44c652fd2eab83adb06c2576284e7286b1d245168a018'
text=raw.decode();reader=csv.DictReader(io.StringIO(text,newline=''));fields=reader.fieldnames;rows=list(reader)
assert len(rows)==5472 and len({(r['file'],r['case_name'],r['occurrence']) for r in rows})==5472
matches=[i for i,r in enumerate(rows) if r['file']=='test/pi-native-process.test.js' and r['case_name']==name and r['occurrence']=='1'];assert len(matches)==1
i=matches[0];before=rows[i];assert before['current_source_sha256']==sha(source) and before['line']=='27'
updates={'evidence_id':(out/'profile-smoke.log').as_posix(),'evidence_line':'1','evidence_sha256':sha(log.read_bytes()),'evidence_round':'34','version_boundary':'Uncommitted HEAD 6d79b0a plus 1125-path round 34 source aggregate '+aggregate+'; Profile 2d89946f / manifest a819b051. Exact original registration, real runner import and durable Job protocol refusal before Native; no Profile/temp creation, Job ACK or launch.','disposition':'RETAINED_CASE_WITH_BOUND_ROUND_34_EVIDENCE','evidence_selection_basis':'Exact anchored original registration; one complete PASS name at log line 1; zero fail/cancel/skip/todo. No inference for other registrations.'}
changes={k:v for k,v in updates.items() if before[k]!=v};original_spans=spans(text);patches=[];raw_before={}
for field,value in changes.items():
 start,end=original_spans[i+1][fields.index(field)];raw_before[field]=text[start:end];patches.append((start,end,encode(value)))
updated=text
for start,end,value in sorted(patches,reverse=True):updated=updated[:start]+value+updated[end:]
current_spans=spans(updated);reverse=updated
for start,end,value in sorted([(current_spans[i+1][fields.index(k)][0],current_spans[i+1][fields.index(k)][1],v) for k,v in raw_before.items()],reverse=True):reverse=reverse[:start]+value+reverse[end:]
assert reverse.encode()==raw
inventory_meta={'path':inventory.as_posix(),'beforeBytes':len(raw),'beforeSha256':sha(raw),'afterBytes':len(updated.encode()),'afterSha256':sha(updated.encode()),'identityRows':5472,'newOrDeletedIdentities':0,'changedRowIndex':i,'identity':{k:before[k] for k in ['file','case_name','occurrence']},'before':before,'after':{**before,**changes},'rawCellsBefore':raw_before,'changedFields':list(changes),'reverseVerifiedSha256':sha(reverse.encode()),'testSourceUnchanged':True,'registrationShaPreserved':True}
matrix=base/'matrix.csv';mraw=matrix.read_bytes();assert sha(mraw)=='28b87048d05b7920a1b96fc403971baa72af22947e5dcf46de1fe064b4378215'
mt=mraw.decode();reader=csv.DictReader(io.StringIO(mt,newline=''));mf=reader.fieldnames;mr=list(reader);assert len(mr)==294 and 'round_34' not in mf
annotations={'source-import-native-guard':'PASS_THREE_ORIGINAL_GUARDS_EXIT0_PROFILE_2D89946F_MANIFEST_A819_1125_F302_STABLE','all-required-regressions':'PARTIAL_CURRENT_THREE_GUARDS_AND_EXACT_RUNNER_REFUSAL1_PASS_OTHER_GROUPS_NOT_RERUN_ROUND34','sg11-final-remaining-checks':'PARTIAL_CURRENT_THREE_GUARDS_AND_RUNNER_REFUSAL_PASS_FULL_PROFILE_NATIVE_AND_OTHER_GROUPS_NOT_VALIDATED'}
assert set(annotations).issubset({r['case_id'] for r in mr})
mt_new=mt
for row_index,cells in reversed(list(enumerate(spans(mt)))):
 at=cells[-1][1];value='round_34' if row_index==0 else annotations.get(mr[row_index-1]['case_id'],'NOT_RERUN_ROUND_34');mt_new=mt_new[:at]+','+value+mt_new[at:]
new={f:'' for f in mf+['round_34']};new.update({'case_id':'sg11-current-profile-import-job-refusal','scenario':'当前真实runner导入出生Low最小Profile增量；缺durable Job协议时Native前拒绝，不代表Profile创建通过','round_34':'PASS_EXACT_ORIGINAL_REGISTRATION1_NATIVE_NOT_ENTERED_PROFILE_2D89946F_F302_ZERO_SKIP_EXIT0'})
assert new['case_id'] not in {r['case_id'] for r in mr}
suffix=','.join(encode(new[f]) for f in mf+['round_34'])+'\n';mt_new+=suffix
rev=mt_new[:-len(suffix)]
for cells in reversed(spans(rev)):
 start,end=cells[-1];rev=rev[:start-1]+rev[end:]
assert rev.encode()==mraw
matrix_meta={'path':matrix.as_posix(),'beforeBytes':len(mraw),'beforeSha256':sha(mraw),'afterBytes':len(mt_new.encode()),'afterSha256':sha(mt_new.encode()),'businessRowsBefore':294,'businessRowsAfter':295,'columnAdded':'round_34','existingRowAnnotations':annotations,'existingNotRerunRows':291,'newRow':new,'appendedRawSuffix':suffix,'reverseVerifiedSha256':sha(rev.encode())}
copies['docs/tmp/sg11-profile-current-collector.py']='collector.py';copies[Path(__file__).as_posix()]='archive-update.py'
metadata={target:{**facts(Path(source)),'temporarySource':source} for source,target in copies.items()}
index={'round':34,'head':runs['check']['source']['head'],'dirtyWorkingTree':True,'sourceCount':1125,'aggregateSha256':aggregate,'fourSourceMapsIdentical':True,'tasks':{'check':'b180fo2xi','profile-smoke':'b77rpld9m'},'commands':{g:runs[g]['result']['command'] for g in runs},'guardOriginalOutputs':guards,'smoke':{'file':'test/pi-native-process.test.js','line':27,'caseName':name,'sourceSha256':sha(source),'log':'profile-smoke.log','logLine':1,'pass':1,'fail':0,'cancelled':0,'skip':0,'todo':0,'realRunnerImported':True,'nativeProfileTempCreated':False},'files':metadata,'inventory':inventory_meta,'matrix':matrix_meta,'cleanup':{'state':'PENDING_CHECK_AND_EXACT_CLEANUP','exactTemporaryFiles':{p:facts(Path(p)) for p in copies},'cleanupScript':'docs/tmp/sg11-profile-current-cleanup.py'},'boundaries':{'sg11':'ACTIVE','sg12':'ACTIVE','oldRound33Unchanged':True,'productionScopeReady':False,'nativeProfileMandatoryConptyValidated':False,'routingDomainOrLowComponentRerun':False,'gitWritesChannelCiDeploy':False}}
if sys.argv[1]=='--run':
 out.mkdir()
 for source,target in copies.items():
  shutil.copyfile(source,out/target);assert facts(out/target)=={k:metadata[target][k] for k in ['bytes','sha256']}
 inventory.write_bytes(updated.encode());matrix.write_bytes(mt_new.encode())
 (out/'batch-index.json').write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
print(json.dumps({'mode':sys.argv[1],'effects':0 if sys.argv[1]=='--check' else 14,'files':len(metadata)+1,'sourceCount':1125,'aggregate':aggregate,'inventory':{k:inventory_meta[k] for k in ['afterBytes','afterSha256','changedFields','reverseVerifiedSha256']},'matrix':{k:matrix_meta[k] for k in ['afterBytes','afterSha256','reverseVerifiedSha256']}},ensure_ascii=False))
