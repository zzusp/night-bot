import {createRequire} from 'node:module'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {randomUUID,createHash} from 'node:crypto'
import {resolve,join} from 'node:path'
import {spawnSync} from 'node:child_process'

const output=process.argv[2]
if(!output)throw Error('Usage: node create-file-fixtures.mjs OUTPUT_DIRECTORY (must not exist)')
const directory=resolve(output)
await mkdir(directory)
const cases=[{name:'material-proof.pdf',code:'PDF-'+randomUUID().slice(0,8).toUpperCase(),a:23,b:38},
  {name:'material-proof.docx',code:'DOC-'+randomUUID().slice(0,8).toUpperCase(),a:31,b:12}]
const {chromium}=createRequire(new URL('../../../../packages/web-console/package.json',import.meta.url))('@playwright/test')
const browser=await chromium.launch({channel:'msedge',headless:true})
try{
 const page=await browser.newPage()
 const sample=cases[0]
 await page.setContent(`<h1>Original file delivery test</h1><p>Validation code: ${sample.code}</p><p>Value A: ${sample.a}</p><p>Value B: ${sample.b}</p><p>Question: A + B = ?</p>`)
 await page.pdf({path:join(directory,sample.name),format:'A4'})
}finally{await browser.close()}
const python=`import sys, zipfile
from xml.sax.saxutils import escape
name, code, a, b = sys.argv[1:]
body = ''.join('<w:p><w:r><w:t>'+escape(t)+'</w:t></w:r></w:p>' for t in ['Original file delivery test', 'Validation code: '+code, 'Value A: '+a, 'Value B: '+b, 'Question: A + B = ?'])
with zipfile.ZipFile(name, 'x', zipfile.ZIP_DEFLATED) as z:
 z.writestr('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
 z.writestr('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
 z.writestr('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'</w:body></w:document>')`
const sample=cases[1],run=spawnSync('python',['-I','-c',python,join(directory,sample.name),sample.code,String(sample.a),String(sample.b)],{encoding:'utf8'})
if(run.status!==0)throw Error(run.stderr||'DOCX fixture generation failed')
for(const sample of cases){const bytes=await readFile(join(directory,sample.name));Object.assign(sample,{expected:sample.a+sample.b,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')})}
await writeFile(join(directory,'manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),cases},null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify({directory,cases:cases.map(({name,bytes,sha256})=>({name,bytes,sha256}))}))
