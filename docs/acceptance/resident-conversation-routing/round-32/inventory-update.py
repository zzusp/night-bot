from pathlib import Path
import csv, hashlib, io, json, re, sys
sys.stdout.reconfigure(encoding='utf-8')
assert sys.argv[1:] in (['--check'],['--run'])
base=Path('docs/acceptance/resident-conversation-routing')
sha=lambda data:hashlib.sha256(data).hexdigest()
def records(text):
 pattern=re.compile(r'("(?:[^"]|"")*"|[^,\r\n]*)(,|\r?\n|$)')
 rows=[];cells=[];pos=0;start=0
 while pos<len(text):
  match=pattern.match(text,pos)
  assert match and match.end()>pos
  cells.append((match.start(1),match.end(1)))
  pos=match.end()
  if match[2]!=',':rows.append({'start':start,'end':pos,'cells':cells});cells=[];start=pos
 assert not cells
 return rows
def encode(value):
 value=str(value)
 return '"'+value.replace('"','""')+'"' if any(c in value for c in ',\r\n"') else value
path=base/'test-case-inventory.csv';raw=path.read_bytes()
assert sha(raw)=='fdbca7918643bb7131b4b2fc363b40ad312d63969c7f1bee17fe816d5d73d0bf'
text=raw.decode('utf-8');spans=records(text)
reader=csv.DictReader(io.StringIO(text,newline=''));fields=reader.fieldnames;old=list(reader)
assert len(old)==5468 and len(spans)==len(old)+1
lookup={(r['file'],r['case_name'],int(r['occurrence'])):i for i,r in enumerate(old)}
assert len(lookup)==len(old)
declared=json.loads((base/'round-32/case-declarations.json').read_text(encoding='utf-8'))
bykey={(r['file'],r['name'],r['occurrence']):r for r in declared['rows']}
patches=[];changes=[];insertions=[];seen=set()
for group in ['routing','domain']:
 source=json.loads((base/f'round-32/{group}-source.json').read_text(encoding='utf-8'))
 result=json.loads((base/f'round-32/{group}-result.json').read_text(encoding='utf-8'))
 assert result['exitCode']==0 and result['sourceChanged']==[]
 assert source['aggregateSha256']==result['sourceEnd']['aggregateSha256']=='e91dade5513fdcdc5c6a33691f2fba4bbff47358d4aaae73d2a5f77725a544d4'
 cases=json.loads((base/f'round-32/{group}-cases.json').read_text(encoding='utf-8'))
 for case in cases['cases']:
  key=(case['file'],case['name'],case['occurrence']);assert key not in seen;seen.add(key)
  declaration=bykey[key]
  assert source['files'][case['file']]==case['sourceSha256']==declaration['sourceSha256']
  assert case['status']=='PASS'
  values={'line':str(declaration['line']),'current_source_sha256':case['sourceSha256'],
   'latest_evidence_status':'PASS','evidence_id':(base/f'round-32/{group}.log').as_posix(),
   'evidence_line':str(case['line']),'evidence_sha256':cases['logSha256'],'evidence_round':'32',
   'version_boundary':f'round32/{group}-source.json and {group}-result.json pin dirty worktree; historical registration hash retained; current declaration hash in {group}-cases.json; no Native/live vendor inference',
   'skip_or_block_reason':'','disposition':'RETAINED_CASE_WITH_BOUND_ROUND_32_EVIDENCE',
   'evidence_test_sha256':case['sourceSha256'],
   'evidence_selection_basis':f'Exact full title and observed nesting matched unique current AST registration in original {group} graph; zero unmatched cases'}
  if key in lookup:
   index=lookup[key];before={};raw_before={}
   for field,value in values.items():
    if old[index][field]==value:continue
    start,end=spans[index+1]['cells'][fields.index(field)]
    before[field]=old[index][field];raw_before[field]=text[start:end]
    patches.append((start,end,encode(value)))
   changes.append({'key':list(key),'rowIndex':index,'fieldsBefore':before,'rawCellsBefore':raw_before})
  else:
   row={field:'' for field in fields}
   row.update(values);row.update({'file':case['file'],'occurrence':str(case['occurrence']),'case_name':case['name'],
    'kind':case['kind'],'groups':case['groups'],'registration_sha256':case['registrationSha256'],
    'resolution':case['resolution'],'contract_classification':'CURRENT_RUNNER',
    'contract_evidence':f'scripts/test-pi.mjs domain; {case["file"]}:{declaration["line"]}; round-32/domain-cases.json'})
   insertions.append({'key':list(key),'row':row})
assert len(seen)==287 and len(changes)==283 and len(insertions)==4
updated=text
for start,end,value in sorted(patches,reverse=True):updated=updated[:start]+value+updated[end:]
assert updated.endswith('\n')
inserted_text=''.join(','.join(encode(item['row'][field]) for field in fields)+'\n' for item in insertions)
updated+=inserted_text
new_rows=list(csv.DictReader(io.StringIO(updated,newline='')))
assert len(new_rows)==5472
assert len({(r['file'],r['case_name'],r['occurrence']) for r in new_rows})==5472
reverse=updated[:-len(inserted_text)];reverse_spans=records(reverse)
reverse_patches=[]
for item in changes:
 for field,value in item['rawCellsBefore'].items():
  start,end=reverse_spans[item['rowIndex']+1]['cells'][fields.index(field)]
  reverse_patches.append((start,end,value))
for start,end,value in sorted(reverse_patches,reverse=True):reverse=reverse[:start]+value+reverse[end:]
assert reverse.encode('utf-8')==raw
inventory_meta={'path':path.as_posix(),'beforeBytes':len(raw),'beforeSha256':sha(raw),'afterBytes':len(updated.encode()),
 'afterSha256':sha(updated.encode()),'beforeRows':len(old),'afterRows':len(new_rows),'updatedRows':len(changes),
 'newRows':len(insertions),'changedCells':len(patches),'fieldsBefore':changes,'insertions':insertions,
 'insertedSuffix':inserted_text,'reverseVerifiedSha256':sha(reverse.encode())}
mpath=base/'matrix.csv';mraw=mpath.read_bytes()
assert sha(mraw)=='39412c578cf4cbaeba693ff0bf8db3f7d176fe2f1d88c1ae624f202c43780a50'
mt=mraw.decode('utf-8');mspans=records(mt)
mreader=csv.DictReader(io.StringIO(mt,newline=''));mfields=mreader.fieldnames;mrows=list(mreader)
assert len(mrows)==293 and len(mspans)==294 and 'round_32' not in mfields
statuses={
 'routing-regression':'PASS_72_ZERO_SKIP_NATURAL_EXIT0_1124_SOURCE_E91_STABLE',
 'domain-regression':'PASS_215_ZERO_SKIP_NATURAL_EXIT0_1124_SOURCE_E91_STABLE',
 'sg11-domain-final':'PASS_215_CURRENT_DOMAIN13_FILES_E91_NOT_PRIOR_393_COUNT',
 'all-required-regressions':'PARTIAL_ROUTING72_DOMAIN215_PASS_E91_DEFAULT_RUNTIME_CONTAINMENT_GUARDS_NOT_RUN_ROUND32',
 'sg11-final-remaining-checks':'PARTIAL_ROUTING72_PASS_E91_CONTAINMENT_AND_FINAL_GUARDS_NOT_RUN_ROUND32'}
assert set(statuses)<={r['case_id'] for r in mrows}
mpatches=[]
for i,record in enumerate(mspans):
 value='round_32' if i==0 else statuses.get(mrows[i-1]['case_id'],'NOT_RERUN_ROUND_32')
 at=record['cells'][-1][1];mpatches.append((at,','+encode(value)))
mut=mt
for at,value in reversed(mpatches):mut=mut[:at]+value+mut[at:]
mut_spans=records(mut);inverse=mut
for record in reversed(mut_spans):
 start,end=record['cells'][-1];inverse=inverse[:start-1]+inverse[end:]
assert inverse.encode()==mraw
meta={'inventory':inventory_meta,'matrix':{'path':mpath.as_posix(),'beforeBytes':len(mraw),'beforeSha256':sha(mraw),
 'afterBytes':len(mut.encode()),'afterSha256':sha(mut.encode()),'businessRows':293,'columnAdded':'round_32',
 'changedBusinessRows':statuses,'notRerunRows':288,'reverseVerifiedSha256':sha(inverse.encode())}}
if sys.argv[1]=='--run':
 target=Path('docs/tmp/sg12-current-routing-domain-csv-delta.json');assert not target.exists()
 target.write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
 path.write_bytes(updated.encode());mpath.write_bytes(mut.encode())
print(json.dumps({'mode':sys.argv[1],'effects':0 if sys.argv[1]=='--check' else 3,
 'inventoryUpdatedRows':len(changes),'inventoryNewRows':len(insertions),'inventoryRows':len(new_rows),
 'inventoryAfterSha256':meta['inventory']['afterSha256'],'matrixAfterSha256':meta['matrix']['afterSha256'],
 'inventoryReverseSha256':meta['inventory']['reverseVerifiedSha256'],'matrixReverseSha256':meta['matrix']['reverseVerifiedSha256']},ensure_ascii=False))
