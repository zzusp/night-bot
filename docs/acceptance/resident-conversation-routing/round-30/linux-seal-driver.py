import sys,pathlib,subprocess,hashlib,json,shutil
mode=sys.argv[1];assert len(sys.argv)==2 and mode in ('--check','--run')
root=pathlib.Path('docs/tmp');stage=root/'sg11-linux-six-build-context';manifest=root/'sg11-linux-six-sealed-source.json'
assert root.is_dir() and stage.parent.is_dir() and not stage.exists() and not manifest.exists()
assert subprocess.run(['git','check-ignore','--quiet',str(stage)]).returncode==0
files=['Dockerfile','.dockerignore','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','config.example.json','LICENSE','THIRD_PARTY.md','scripts/docker-entrypoint.sh','packages/web-console/package.json','packages/web-console/pnpm-lock.yaml','packages/web-console/pnpm-workspace.yaml','packages/web-console/index.html','packages/web-console/tsconfig.json','packages/web-console/vite.config.ts','packages/web-console/night-channel.json']
prefixes=['licenses/','bin/','src/','packages/dingtalk-core/','packages/web-console/src/','packages/web-console/server/','packages/web-console/licenses/']
def sources():
 names=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z']).decode().split('\0');result={}
 for n in sorted(set(names)):
  if not (n in files or any(n.startswith(p) for p in prefixes)):continue
  p=pathlib.Path(n)
  if not p.exists():continue
  assert p.is_file() and not p.is_symlink(),n
  assert not any(v in ('node_modules','data','accounts','skills','.env','.git','dist') for v in p.parts),n
  result[n]=hashlib.sha256(p.read_bytes()).hexdigest()
 return result
payload=root/'sg11-linux-six-payload';payloadManifest=root/'sg11-linux-six-payload-source.json'
assert not payload.exists() and not payloadManifest.exists()
assert subprocess.run(['git','check-ignore','--quiet',str(payload)]).returncode==0
payloadInputs={n:n for n in ['test/native-shell-kernel-wire.test.js','test/native-managed-shell-kernel.test.js','test/native-memory-privacy-kernel.test.js','test/fixtures/memory-host.js']}
payloadInputs['test/fixtures/sg11-linux-provider-observer.mjs']='docs/tmp/sg11-linux-provider-observer.mjs'
for n in payloadInputs.values():assert pathlib.Path(n).is_file() and not pathlib.Path(n).is_symlink()
payloadHashes={target:hashlib.sha256(pathlib.Path(source).read_bytes()).hexdigest() for target,source in payloadInputs.items()}
before=sources();assert before['scripts/docker-entrypoint.sh']=='def816be0b4bbf669a8a9178000355fd98527bd1e7ac2213e404089d79b8f8ad';assert len(before)>100
assert before['Dockerfile']=='fe541e3b02f34ede0fa157ebff229652b878b588647a45038ca2d9ada5ac753c'
for n in before:assert pathlib.Path(n).suffix not in ('.log','.db','.pem','.key'),n
print(json.dumps({'mode':mode,'effects':0 if mode=='--check' else None,'sourceCount':len(before),'privateRuntimeIncluded':False}))
if mode=='--check':sys.exit()
stage.mkdir()
for n,digest in before.items():
 content=pathlib.Path(n).read_bytes();assert hashlib.sha256(content).hexdigest()==digest,n
 target=stage/n;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(content)
assert sources()==before,'SOURCE_DRIFT_WHILE_SEALING'
assert sorted(p.relative_to(stage).as_posix()for p in stage.rglob('*')if p.is_file())==list(before)
for n,digest in before.items():assert hashlib.sha256((stage/n).read_bytes()).hexdigest()==digest,n
sourceMapSha256=hashlib.sha256(''.join(n+' '+h+chr(10)for n,h in before.items()).encode('utf-8')).hexdigest()
record={'head':subprocess.check_output(['git','rev-parse','HEAD']).decode().strip(),'dirtyWorkingTree':True,'sourceFiles':before,'contextPath':stage.as_posix(),'sourceMapSha256':sourceMapSha256,'contextEncoding':'sorted-name-space-sha256-newline-v1','sourceChangedWhileSealing':[],'portableRuntimeDataIncluded':False}
with manifest.open('x',encoding='utf-8')as f:json.dump(record,f,indent=2);f.write(chr(10))
print(json.dumps({'sealed':True,'sourceCount':len(before),'sourceMapSha256':sourceMapSha256}))

payload.mkdir()
for target,source in payloadInputs.items():
 content=pathlib.Path(source).read_bytes();assert hashlib.sha256(content).hexdigest()==payloadHashes[target]
 out=payload/target;out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(content)
assert {target:hashlib.sha256(pathlib.Path(source).read_bytes()).hexdigest() for target,source in payloadInputs.items()}==payloadHashes
assert sorted(p.relative_to(payload).as_posix() for p in payload.rglob('*') if p.is_file())==sorted(payloadInputs)
for target,digest in payloadHashes.items():assert hashlib.sha256((payload/target).read_bytes()).hexdigest()==digest
with payloadManifest.open('x',encoding='utf-8') as f:json.dump({'payloadPath':payload.as_posix(),'sourceInputs':payloadInputs,'payloadFiles':payloadHashes,'readOnlyContainerTarget':'/opt/night-bot/test','realVendorExecuted':False},f,indent=2);f.write(chr(10))
print(json.dumps({'payloadSealed':True,'files':len(payloadHashes),'runtimeOrCredentialsIncluded':False}))
