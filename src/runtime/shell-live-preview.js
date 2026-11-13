/** Non-consuming, bounded snapshots of the admitted foreground process only.
 * No spill reads, model cursor updates, synthetic exit status, or terminal hooks.
 */
export function startShellLivePreview(exec,readProcess,{intervalMs=250}={}){
 let closed=false,busy=false,last='',disabled=false,pending=Promise.resolve()
 const perform=async()=>{
  if(closed||busy||disabled||exec.signal.aborted)return
  busy=true
  try{
   const proc=readProcess();if(!proc?.observed)return
   const out=proc.observed.stdout.readFrom(0),err=proc.observed.stderr.readFrom(0)
   // Ring eviction could remove a credential prefix. Do not expose a detached
   // tail as a full snapshot; withdraw the preview and await the final policy.
   if(out.lossy||err.lossy||out.text.length+err.text.length>65536){disabled=true;await exec.publishPartial({content:[]});return}
   const text=out.text+(err.text?'\n[stderr]\n'+err.text:'')
   if(text.length>65536){disabled=true;await exec.publishPartial({content:[]});return}
   if(text===last||closed||exec.signal.aborted)return
   last=text
   await exec.publishPartial({content:[{type:'text',text}]})
  }catch{disabled=true;try{exec.withdrawPartial?.()}catch{}}finally{busy=false}
 }
 const sample=()=>{if(busy||closed)return pending;pending=perform();return pending}
 const timer=setInterval(()=>void sample(),intervalMs);timer.unref?.()
 const close=()=>{closed=true;clearInterval(timer);exec.signal.removeEventListener('abort',close);return pending}
 exec.signal.addEventListener('abort',close,{once:true})
 return {close,sample}
}
