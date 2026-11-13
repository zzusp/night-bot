import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {pathToFileURL} from 'node:url'
import {resolve} from 'node:path'
const [before,after,file]=process.argv.slice(2);assert.ok(before&&after&&file)
const db=new DatabaseSync(file,{readOnly:true}),all=(table,where='',args=[])=>db.prepare('SELECT body FROM '+table+' '+where).all(...args).map(row=>JSON.parse(row.body)),get=(table,id,optional=false)=>{const row=db.prepare('SELECT body FROM '+table+' WHERE id=?').get(id);if(!row&&!optional)throw Error('Missing source');return row?JSON.parse(row.body):null}
try{
 db.exec('BEGIN')
 const conversations=[...new Set(all('dynamic_triage').filter(r=>r.state==='pending').map(r=>r.conversationId))],results=[]
 for(const code of [before,after]){const {createRouterLedger}=await import(pathToFileURL(resolve(code,'src/channels/router-ledger.js')).href),ledger=createRouterLedger({db,all,get}),samples=[],output=[]
  for(let round=0;round<5;round++){const start=performance.now(),rows=conversations.map(conversationId=>ledger.query({kind:'triage.pending',conversationId,limit:15}));samples.push(Math.round((performance.now()-start)*100)/100);output.push(rows)}
  results.push({samples,output})
 }
 assert.deepEqual(results[0].output,results[1].output)
 const stats=db.prepare('SELECT count(*) AS rows,sum(length(body)) AS chars FROM dynamic_sources').get()
 console.log(JSON.stringify({sources:stats.rows,sourceChars:stats.chars,pendingConversations:conversations.length,beforeMs:results[0].samples,afterMs:results[1].samples,resultsIdentical:true,readOnly:true}))
}finally{db.close()}
