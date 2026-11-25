import {fail} from './security.js'

const frameInterval = 750, heartbeatInterval = 2500, streamLimit = 24

/** The native observers publish only wakeups. Keep at most one pending intent
 * per kind and never let slow HTTP clients back up the Pi event loop. */
export function createSessionEvents() {
  const closers = new Set()
  let stopped = false
  return {
    close() {stopped = true;for (const close of closers) close()},
    async open(response,{persistence,target,validate,readLive}) {
      if (stopped || !persistence?.subscribeSessionView) fail('SESSION_EVENTS_UNAVAILABLE',503)
      const initial = await target()
      await validate()
      if (response.destroyed) return
      if (stopped || closers.size >= streamLimit) fail('SESSION_EVENTS_UNAVAILABLE',503)
      let timer,heartbeat,off,busy=false,closed=false,history=false,live=false,check=false,lastFrame,recheckLive=false,committing=false
      const close = (destroy = false) => {
        if (closed) return
        closed = true;clearTimeout(timer);clearInterval(heartbeat);off?.();closers.delete(close)
        if (!response.destroyed) {if (destroy || response.writableNeedDrain) response.destroy();else response.end()}
      }
      const send = (type,data={}) => {
        if (closed) return
        if (response.writableNeedDrain) {close(true);return}
        response.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
      }
      const schedule = () => {
        if (!closed&&!busy&&timer===undefined) timer=setTimeout(flush,frameInterval).unref()
      }
      async function flush() {
        timer=undefined;busy=true
        const work={history,live,check};history=live=check=false
        try {
          if (work.history || work.check) {
            await validate()
            if ((await target()).key!==initial.key) fail('SESSION_PAGE_STALE',409)
          }
          if (work.history) send('history')
          if ((work.live || work.check && recheckLive) && !closed) {
            const value=await readLive()
            // A commit detected during an asynchronous frame belongs before it.
            if (!history&&value.sessionId===initial.id) {
              // A pending read can precede a failed commit; the browser may
              // need to retry history even without a successful commit wakeup.
              if (!committing&&value.committing&&!work.history) send('history')
              committing=value.committing
              recheckLive=value.live.items.some(row=>row.kind==='tool-result')
              const {committing:_,...activity}=value
              const frame=JSON.stringify(activity)
              if (frame!==lastFrame) {lastFrame=frame;send('live',activity)}
            }
          }
          if (work.check) send('heartbeat')
        } catch (error) {
          if ([401,403,404,409].includes(error.status)) send('invalidate',{status:error.status,code:error.code})
          close()
        } finally {
          busy=false
          if (history||live||check) schedule()
        }
      }
      if (initial.id) off=persistence.subscribeSessionView(initial.id,kind=>{
        if (kind==='history') history=true
        else if (kind==='live') live=true
        schedule()
      })
      closers.add(close)
      response.once('close',()=>close())
      response.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store, no-transform','x-accel-buffering':'no'})
      heartbeat=setInterval(()=>{check=true;schedule()},heartbeatInterval).unref()
      // Subscribe before asking the browser to catch up, so the handoff cannot
      // miss a commit between the initial HTTP snapshot and the stream.
      send('ready')
      if (initial.id) {live=true;schedule()}
    },
  }
}
