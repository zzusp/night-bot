import {getCurrentTools,getDeclaredTools,getToolStateChanges,toToolDeclaration} from '@earendil-works/pi-ai'

const system=(toolsAdded=[],toolsRemoved=[])=>({role:'system',content:'',timestamp:0,toolsAdded,toolsRemoved})
/** Night admits only complete committed declaration histories. Pi owns catalog
 * replay and interface comparison; no execution permissions derive from this view.
 * The returned updates are native Pi system messages, keyed by audit message id.
 */
export function piToolCatalog(messages,tools=[],mode,history){
 if(mode!==undefined&&!['in-history','addition-only'].includes(mode))throw new TypeError('Unsupported Pi tool update mode')
 const updates=new Map()
 const present=new Set(messages.filter(message=>message.role==='developer').map(message=>message.id))
 if(!mode||!history||history.updates.some(update=>!present.has(update.messageId))){
  return {tools:tools.filter(tool=>!mode||!tool.deferLoading).map(toToolDeclaration),updates}
 }
 const baseline=system(history.tools.map(toToolDeclaration))
 const declarations=getDeclaredTools([baseline,...history.updates.map(update=>system(update.additions.map(toToolDeclaration)))])
 const activeNames=new Set(tools.map(tool=>tool.name))
 const admitted=declaration=>mode!=='addition-only'||activeNames.has(declaration.name)
 const catalog=new Map(declarations.filter(admitted).map(tool=>[tool.name,tool]))
 const initial=history.tools.filter(tool=>!tool.deferLoading&&admitted(tool)).map(toToolDeclaration)
 let state=initial
 const committed=new Map(history.updates.map(update=>[update.messageId,update]))
 for(const message of messages){
  if(message.role!=='developer'||!committed.has(message.id))continue
  // Resolve declarations from this committed update, never the live executable
  // registry. Removed historical schemas remain available to in-history routes.
  const introduced=new Map(committed.get(message.id).additions.map(tool=>[tool.name,toToolDeclaration(tool)]))
  const deltas=[]
  for(const block of message.content){
   let operation
   if(block.type==='tool-addition'){
    const declaration=introduced.get(block.toolName)??catalog.get(block.toolName)
    if(declaration&&admitted(declaration))operation=system([declaration])
   }else if(block.type==='tool-removal'&&mode==='in-history')operation=system([],[{name:block.toolName}])
   if(!operation)continue
   const next=getCurrentTools([system(state),operation])
   const change=getToolStateChanges(state,next)
   if(change.toolsAdded.length||change.toolsRemoved.length)deltas.push(system(change.toolsAdded,change.toolsRemoved))
   state=next
  }
  updates.set(message.id,deltas)
 }
 return {tools:initial,updates}
}
