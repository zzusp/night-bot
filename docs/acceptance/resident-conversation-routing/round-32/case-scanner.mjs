import {readFile,readdir,writeFile} from 'node:fs/promises'
import {parse} from 'acorn'
import {createHash} from 'node:crypto'
import {stripTypeScriptTypes} from 'node:module'
import {resolve,dirname,relative,sep} from 'node:path'
const U=Symbol('unknown'), rows=[], sources=new Map();let currentSource=''
const sha=s=>createHash('sha256').update(s).digest('hex')
const valid=v=>v!==U
function bind(n,v,e){if(!n)return;if(n.type==='AssignmentPattern'){bind(n.left,v===undefined?value(n.right,e):v,e);return}if(n.type==='Identifier')e[n.name]=v;else if(n.type==='ArrayPattern')n.elements.forEach((x,i)=>bind(x,v===U?U:v?.[i],e));else if(n.type==='ObjectPattern')n.properties.forEach(p=>p.type==='RestElement'?bind(p.argument,U,e):bind(p.value,v===U?U:v?.[p.key.name??p.key.value],e))}
function value(n,e){
 if(!n)return U
 switch(n.type){
 case 'Literal':return n.value
 case 'Identifier':return n.name==='undefined'?undefined:Object.hasOwn(e,n.name)?e[n.name]:U
 case 'TemplateLiteral':{const a=n.expressions.map(x=>value(x,e));return a.every(valid)?n.quasis.map((q,i)=>q.value.cooked+(i<a.length?String(a[i]):'')).join(''):U}
 case 'ArrayExpression':{const a=[];for(const p of n.elements){const v=value(p?.type==='SpreadElement'?p.argument:p,e);if(p?.type==='SpreadElement'){if(v===U)return U;a.push(...v)}else a.push(v)}return a}
 case 'ObjectExpression':{const a={};for(const p of n.properties){if(p.type==='SpreadElement'){const v=value(p.argument,e);if(v===U)return U;Object.assign(a,v)}else{const k=p.computed?value(p.key,e):p.key.name??p.key.value;if(k===U)return U;a[k]=value(p.value,e)}}return a}
 case 'UnaryExpression':{const v=value(n.argument,e);if(v===U)return U;switch(n.operator){case '!':return !v;case '-':return -v;case '+':return +v;case 'typeof':return typeof v;default:return U}}
 case 'BinaryExpression':{const a=value(n.left,e),b=value(n.right,e);if(a===U||b===U)return U;switch(n.operator){case '+':return a+b;case '-':return a-b;case '*':return a*b;case '===':return a===b;case '!==':return a!==b;case '<':return a<b;case '<=':return a<=b;case '>':return a>b;case '>=':return a>=b;default:return U}}
 case 'ConditionalExpression':{const t=value(n.test,e);return t===U?U:value(t?n.consequent:n.alternate,e)}
 case 'LogicalExpression':{const a=value(n.left,e);if(a===U)return U;return n.operator==='??'?a??value(n.right,e):n.operator==='&&'?a&&value(n.right,e):a||value(n.right,e)}
 case 'MemberExpression':{const a=value(n.object,e),k=n.computed?value(n.property,e):n.property.name;return a===U||k===U?U:a?.[k]??U}
 case 'ArrowFunctionExpression':return {arrow:n,env:e,repr:currentSource.slice(n.start,n.end)}
 case 'FunctionExpression':return {repr:currentSource.slice(n.start,n.end)}
 case 'CallExpression':{
 const c=n.callee,args=n.arguments.map(x=>value(x,e))
 if(c.type==='Identifier'&&args.every(valid)&&['String','Boolean','Number','encodeURIComponent'].includes(c.name))return ({String,Boolean,Number,encodeURIComponent})[c.name](...args)
 const invoke=(a,v,i)=>{if(!a?.arrow)return U;const env={...a.env};a.arrow.params.forEach((p,j)=>bind(p,j===0?v:i,env));return a.arrow.body.type==='BlockStatement'?U:value(a.arrow.body,env)}
 if(c.type==='Identifier'&&c.name==='permutations'&&Array.isArray(args[0])){const perm=a=>a.length?a.flatMap((v,i)=>perm(a.filter((_,j)=>i!==j)).map(p=>[v,...p])):[[]];return perm(args[0])}
 if(c.type==='MemberExpression'){
 const k=c.computed?value(c.property,e):c.property.name
 if(c.object.type==='Identifier'&&['Object','JSON'].includes(c.object.name)&&args.every(valid)){
  if(c.object.name==='JSON'&&k==='stringify')return JSON.stringify(args[0],(_k,v)=>v===U?undefined:v)
  if(k==='freeze')return args[0];if(k==='entries')return Object.entries(args[0]);if(k==='keys')return Object.keys(args[0]);if(k==='values')return Object.values(args[0])
 }
 const a=value(c.object,e);if(a===U||args.some(x=>x===U))return U;if(k==='toString'&&a?.repr)return a.repr
 if(Array.isArray(a))switch(k){case 'entries':return [...a.entries()];case 'slice':return a.slice(...args);case 'join':return a.join(...args);case 'concat':return a.concat(...args);case 'toReversed':return a.toReversed();case 'map':{const b=a.map((v,i)=>invoke(args[0],v,i));return b.every(valid)?b:U}case 'filter':{const b=a.map((v,i)=>invoke(args[0],v,i));return b.every(valid)?a.filter((_,i)=>b[i]):U}}
 if(typeof a==='string'&&['slice','toUpperCase','toLowerCase','replaceAll','split','repeat','includes','startsWith','endsWith'].includes(k))return a[k](...args)
 }return U
 }
 default:return U
 }
}
function callee(n){if(n?.type==='Identifier')return n.name;if(n?.type==='MemberExpression')return callee(n.object)+'.'+(n.property.name??n.property.value);return ''}
function hasTests(n,names){if(!n||typeof n!=='object')return false;if(n.type==='CallExpression'&&isTest(n,names))return true;return Object.entries(n).some(([k,v])=>!['loc','start','end'].includes(k)&&(Array.isArray(v)?v.some(x=>hasTests(x,names)):hasTests(v,names)))}
function isTest(n,names){const s=callee(n.callee);return [...names].some(x=>s===x||['.skip','.todo','.only','.describe','.describe.skip'].some(k=>s===x+k))||/^(?:t|context)\.test$/.test(s)}
function scan(ast,source,file,names,initial={}){
 const seen=new Set()
 function walk(n,e={},parents=[],conditional=false){
  if(!n||typeof n!=='object')return
  if(n.type==='Program'||n.type==='BlockStatement'){const scope={...e};for(const q of n.body)walk(q,scope,parents,conditional);return}
  if(n.type==='VariableDeclaration'){for(const d of n.declarations){if(d.init&&['ArrowFunctionExpression','FunctionExpression'].includes(d.init.type)&&hasTests(d.init.body,names)){bind(d.id,{registration:d.init,env:{...e}},e);names.add(d.id.name)}else{if(d.init?.type==='ConditionalExpression'&&[d.init.consequent,d.init.alternate].some(x=>x.type==='Identifier'&&names.has(x.name)))names.add(d.id.name);const v=value(d.init,e);if(v!==U||!Object.hasOwn(e,d.id.name))bind(d.id,v,e);if(hasTests(d.init,names))walk(d.init,e,parents,conditional)}}return}
  if(n.type==='ForOfStatement'&&hasTests(n.body,names)){
   const vs=value(n.right,e)
   if(Array.isArray(vs)){for(const v of vs){const next={...e};bind(n.left.type==='VariableDeclaration'?n.left.declarations[0].id:n.left,v,next);walk(n.body,next,parents,conditional)}}
   else {const next={...e};bind(n.left.type==='VariableDeclaration'?n.left.declarations[0].id:n.left,U,next);walk(n.body,next,parents,true)}
   return
  }
  if(n.type==='IfStatement'&&hasTests(n,names)){const v=value(n.test,e);if(v===U){walk(n.consequent,{...e},parents,true);walk(n.alternate,{...e},parents,true)}else walk(v?n.consequent:n.alternate,e,parents,conditional);return}
  if(n.type==='CallExpression'&&n.callee.type==='Identifier'&&e[n.callee.name]?.registration){const r=e[n.callee.name],env={...r.env,...e};r.registration.params.forEach((p,i)=>bind(p,value(n.arguments[i],e),env));walk(r.registration.body,env,parents,conditional);return}
  if(n.type==='CallExpression'&&isTest(n,names)){
   const v=value(n.arguments[0],e),title=v===U?'UNRESOLVED: '+source.slice(n.arguments[0]?.start,n.arguments[0]?.end):String(v)
   const full=[...parents,title].join(' > '),key=n.start+':'+full
   const kind=callee(n.callee).includes('describe')||['describe','suite'].includes(callee(n.callee))?'suite':'case'
   {rows.push({file,line:n.loc.start.line,name:full,title,kind,resolution:v===U?'UNRESOLVED':'STATIC',conditional,sourceSha256:sha(source),registrationSha256:sha(source.slice(n.start,n.end)),mode:callee(n.callee).endsWith('.skip')?'skip':callee(n.callee).endsWith('.todo')?'todo':'test'})}
   const cb=n.arguments.find(x=>['ArrowFunctionExpression','FunctionExpression'].includes(x.type))
   if(cb)walk(cb.body,{...e},[...parents,title],conditional)
   return
  }
  if(n.type==='FunctionDeclaration'){if(hasTests(n.body,names))e[n.id.name]={registration:n,env:{...e}};return}
  for(const[k,v]of Object.entries(n)){if(['loc','start','end','id','params'].includes(k))continue;if(Array.isArray(v))for(const q of v)walk(q,e,parents,conditional);else if(v&&typeof v==='object')walk(v,e,parents,conditional)}
 }
 walk(ast,initial)
}
async function graph(file,seen=new Set()){
 if(seen.has(file))return seen;seen.add(file)
 let s=sources.get(file);if(s===undefined){try{s=await readFile(file,'utf8')}catch{return seen}}
 let a;try{a=parse(s,{ecmaVersion:'latest',sourceType:'module'})}catch{return seen}
 const specs=[];function w(n){if(!n||typeof n!=='object')return;if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(n.type)&&n.source)specs.push(n.source.value);if(n.type==='ImportExpression'&&n.source.type==='Literal')specs.push(n.source.value);if(n.type==='CallExpression'&&n.callee.name==='require'&&n.arguments[0]?.type==='Literal')specs.push(n.arguments[0].value);for(const[k,v]of Object.entries(n)){if(['start','end','loc'].includes(k))continue;if(Array.isArray(v))v.forEach(w);else if(v&&typeof v==='object')w(v)}}w(a)
 for(const spec of specs)if(typeof spec==='string'&&spec.startsWith('.')){const next=relative(process.cwd(),resolve(dirname(file),spec)).split(sep).join('/');if(!next.startsWith('../'))await graph(next,seen)}return seen
}
const runner=parse(await readFile('scripts/test-pi.mjs','utf8'),{ecmaVersion:'latest',sourceType:'module'})
const definitions=value(runner.body.find(n=>n.type==='VariableDeclaration'&&n.declarations[0].id.name==='groups').declarations[0].init,{})
const memberships={};for(const group of ['routing','domain']){const found=new Set();for(const root of definitions[group])for(const file of await graph('test/'+root+'.test.js'))if(file.endsWith('.test.js'))found.add(file);memberships[group]=[...found].sort()}
const files=[...new Set(Object.values(memberships).flat())].sort()
for(const file of files){const source=await readFile(file,'utf8');currentSource=source;sources.set(file,source);const ast=parse(source,{ecmaVersion:'latest',sourceType:'module',locations:true}),names=new Set();for(const n of ast.body)if(n.type==='ImportDeclaration'&&n.source.value==='node:test')for(const s of n.specifiers)if(s.type==='ImportDefaultSpecifier'||['test','it','describe','suite'].includes(s.imported?.name))names.add(s.local.name);scan(ast,source,file,names)}
const occurrences=new Map();for(const row of rows){const k=JSON.stringify([row.file,row.name]);row.occurrence=(occurrences.get(k)??0)+1;occurrences.set(k,row.occurrence);row.groups=Object.keys(memberships).filter(group=>memberships[group].includes(row.file)).join('|')}
await writeFile('docs/tmp/sg12-current-routing-domain-declarations.json',JSON.stringify({scannerOrigin:'Original AST scan/graph functions from sg11-case-inventory.mjs; selected original runner routing/domain graphs only',files,memberships,rows},null,2)+String.fromCharCode(10),{flag:'wx'})
console.log(JSON.stringify({files:files.length,registrations:rows.length,groups:Object.fromEntries(Object.entries(memberships).map(([g,fs])=>[g,{files:fs.length,registrations:rows.filter(row=>fs.includes(row.file)).length}])),unresolved:rows.filter(row=>row.resolution==='UNRESOLVED')}))
