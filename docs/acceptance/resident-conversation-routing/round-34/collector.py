from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, os, subprocess, sys, shutil
sys.stdout.reconfigure(encoding='utf-8')
root=Path.cwd()
assert root.as_posix().endswith('/resident-conversation-plan/night-bot')
assert len(sys.argv)==2 and sys.argv[1] in ('check','profile-smoke')
group=sys.argv[1]
prefix=root/'docs/tmp'/('sg11-profile-current-'+group)
paths={key:Path(str(prefix)+suffix) for key,suffix in {
 'source':'-source.json','log':'.log','stderr':'-stderr.log','result':'-result.json'
}.items()}
assert all(not p.exists() for p in paths.values()), 'Refusing to overwrite an existing execution'
def git(*args):
 return subprocess.check_output(['git',*args],cwd=root).decode('utf-8').strip()
def sha(data): return hashlib.sha256(data).hexdigest()
def snapshot():
 raw=subprocess.check_output(['git','ls-files','-z','--cached','--others','--exclude-standard'],cwd=root)
 names=set(raw.decode('utf-8').split('\0'))-{''}
 roots=('src/','bin/','scripts/','test/','packages/')
 suffixes={'.js','.mjs','.cjs','.ts','.tsx','.json','.yaml','.yml','.ps1','.sh','.css','.html','.md','.node'}
 fixed={'package.json','pnpm-lock.yaml','pnpm-workspace.yaml','config.example.json','AGENTS.md','README.md','DESIGN.md','THIRD_PARTY.md','docs/process-fork-manifest.json'}
 selected=sorted(p for p in names if p in fixed or (p.startswith(roots) and Path(p).suffix.lower() in suffixes))
 files={}
 for name in selected:
  p=root/name
  if p.is_file():
   assert p.resolve().is_relative_to(root.resolve()), 'Source path escapes worktree: '+name
   files[name]=sha(p.read_bytes())
  else: files[name]=None
 encoded=json.dumps(files,sort_keys=True,separators=(',',':')).encode()
 return {'head':git('rev-parse','HEAD'),'branch':git('branch','--show-current'),
  'dirtyWorkingTree':bool(git('status','--porcelain=v1','--untracked-files=no')),
  'scope':'Git-visible source/test/scripts/packages and explicit root contracts; includes absent tracked source paths; excludes installation data, secrets, node_modules and acceptance records',
  'fileCount':len(files),'aggregateSha256':sha(encoded),'files':files}
def write_json(path,value):
 with path.open('x',encoding='utf-8',newline='\n') as f:
  json.dump(value,f,ensure_ascii=False,indent=2); f.write('\n')
started=datetime.now(timezone.utc).isoformat()
before=snapshot()
assert before['branch']=='worktree-resident-conversation-routing'
assert before['files']['src/process/windows-profile.js']=='2d89946f09a7011923be51833730694447ddbeef4e27845b030c69b2dabf7f45'
assert before['files']['docs/process-fork-manifest.json']=='a819b051a90b5e76f4b1f13f8cf70aeb9d61e20df78fd4f58a91cb7ab545c5e1'
versions={}
for name,args in {'node':['node','--version'],'pnpm':['pwsh','-NoProfile','-NonInteractive','-Command','pnpm --version; exit $LASTEXITCODE']}.items():
 versions[name]=subprocess.check_output(args,cwd=root).decode('utf-8').strip()
write_json(paths['source'],{'group':group,'capturedAt':started,**before,'versions':versions,
 'testConcurrencyEnvironment':os.environ.get('NIGHT_BOT_TEST_CONCURRENCY'),
 'collectorSha256':sha(Path(__file__).read_bytes())})
command=(['pwsh','-NoProfile','-NonInteractive','-Command','pnpm check; exit $LASTEXITCODE'] if group=='check' else ['node','--test','--test-name-pattern','^Windows LPAC runner requires durable Job protocol before current-token executable resolution$','test/pi-native-process.test.js'])
result={'group':group,'command':command,'startedAt':started,'source':paths['source'].relative_to(root).as_posix(),
 'sourceStartSha256':before['aggregateSha256'],'versions':versions,'intervention':None,'forcedTermination':False}
print(json.dumps({'event':'START','group':group,'sourceCount':before['fileCount'],
 'aggregateSha256':before['aggregateSha256'],'source':result['source']},ensure_ascii=False),flush=True)
with paths['log'].open('xb') as out,paths['stderr'].open('xb') as err:
 process=subprocess.Popen(command,cwd=root,stdout=out,stderr=err)
 result['collectorChildPid']=process.pid
 result['exitCode']=process.wait()
result['finishedAt']=datetime.now(timezone.utc).isoformat()
after=snapshot()
result['sourceEnd']=after
result['sourceChanged']=[{'path':p,'before':before['files'].get(p),'after':after['files'].get(p)}
 for p in sorted(set(before['files'])|set(after['files'])) if before['files'].get(p)!=after['files'].get(p)]
result['artifacts']={key:{'path':p.relative_to(root).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())}
 for key,p in paths.items() if key!='result'}
write_json(paths['result'],result)
print(json.dumps({'event':'END','group':group,'exitCode':result['exitCode'],'sourceChanged':result['sourceChanged'],
 'result':paths['result'].relative_to(root).as_posix()},ensure_ascii=False),flush=True)
sys.exit(result['exitCode'])
