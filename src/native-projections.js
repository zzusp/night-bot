import {Service} from '@deepseek-ai/cordis'
const offset=value=>{if(!Number.isSafeInteger(value)||value<0)throw new TypeError('Session offset must be a non-negative safe integer');return value}
const before=value=>offset(value)-1
const put=(object,key,value)=>Object.defineProperty(object,key,{value,enumerable:true,writable:true,configurable:true})
const rowFor=(rows,key)=>Object.hasOwn(rows,key)?rows[key]:undefined
/** Transient folds over committed Pi-backed audit events. The journal remains
 * authoritative: checkpoints can accelerate reads but cannot extend its end. */
export default class NativeProjections extends Service{
 constructor(ctx){super(ctx,'sessionProjections');this.registrations=new Map();this.listeners=new Set();ctx.on('session/created',session=>{if(session.seq!==0)return;for(const r of this.registrations.values())if(!r.cells.has(session))r.cells.set(session,{state:r.def.init(session.header,session.inheritedEventCount),observedSeq:-1,views:[undefined,undefined]})});ctx.on('session/event',(session,event)=>this.drive(session,event))}
 register(definition){
  if(typeof definition.key!=='string'||!definition.key||!Number.isSafeInteger(definition.stateVersion)||definition.stateVersion<0)throw new Error('Projection needs a key and non-negative safe stateVersion')
  const wire=definition.wire,def={key:definition.key,stateVersion:definition.stateVersion,stateSchema:definition.stateSchema,init:(...args)=>definition.init(...args),apply:(...args)=>definition.apply(...args),...wire?{wire:{viewSchema:wire.viewSchema,view:state=>wire.view(state)}}:{}}
  return this.ctx.effect(()=>{let r=this.registrations.get(def.key);if(r){if(r.def.stateVersion!==def.stateVersion)throw new Error(`session projection key ${JSON.stringify(def.key)} is already registered at stateVersion ${r.def.stateVersion}`);r.refs++}else{r={def,cells:new WeakMap(),refs:1};this.registrations.set(def.key,r)}return()=>{if(--r.refs===0&&this.registrations.get(def.key)===r)this.registrations.delete(def.key)}},'native projection registration')
 }
 onChanged(listener){const cell={listener};const dispose=this.ctx.effect(()=>{this.listeners.add(cell);return()=>this.listeners.delete(cell)},'native projection subscription');return()=>void dispose()}
 buildCell(def,header,inherited,events){let state=def.init(header,inherited);for(const event of events)state=def.apply(state,event);return{state,observedSeq:events.at(-1)?.seq??-1,views:[undefined,undefined]}}
 advance(def,cell,session,through){for(let seq=cell.observedSeq+1;seq<=through;seq++){const event=session.eventAt(seq);if(!event||event.seq!==seq)throw new Error(`session projection ${JSON.stringify(def.key)} cannot advance across missing seq ${seq}`);const next=def.apply(cell.state,event);if(!Object.is(next,cell.state)){cell.views[0]=cell.views[1];cell.views[1]=undefined}cell.state=next;cell.observedSeq=seq}}
 cellFor(r,session){let cell=r.cells.get(session);if(!cell){cell=this.buildCell(r.def,session.header,session.inheritedEventCount,session.snapshotEvents());r.cells.set(session,cell)}else this.advance(r.def,cell,session,before(session.seq));return cell}
 materializeCells(session){for(const r of this.registrations.values())this.cellFor(r,session)}
 stateOf(session,key){const r=this.registrations.get(key);if(!r)return;this.materializeCells(session);return this.cellFor(r,session).state}
 viewCell(r,cell){if(!r.def.wire)throw new Error('Projection has no wire view');return r.def.wire.viewSchema.parse(r.def.wire.view(cell.state))}
 snapshot(session,keys){this.materializeCells(session);const values={},selected=keys===undefined?undefined:new Set(keys);for(const r of this.registrations.values())if(r.def.wire&&(!selected||selected.has(r.def.key)))put(values,r.def.key,this.viewCell(r,this.cellFor(r,session)));return{asOfSeq:before(session.seq),values}}
 cachedSnapshot(session,keys){const values={},selected=keys===undefined?undefined:new Set(keys);let asOfSeq;for(const r of this.registrations.values()){if(!r.def.wire||selected&&!selected.has(r.def.key))continue;const cell=r.cells.get(session);if(!cell)continue;put(values,r.def.key,this.viewCell(r,cell));asOfSeq=asOfSeq===undefined?cell.observedSeq:Math.min(asOfSeq,cell.observedSeq)}return asOfSeq===undefined?undefined:{asOfSeq,values}}
 checkpoint(session){const rows={};for(const r of this.registrations.values()){const cell=this.cellFor(r,session);put(rows,r.def.key,{ver:r.def.stateVersion,seq:cell.observedSeq,val:structuredClone(cell.state)})}return rows}
 restoreFloor(checkpoint){let floor;for(const r of this.registrations.values()){const row=rowFor(checkpoint,r.def.key),need=row&&row.ver===r.def.stateVersion?Math.max(row.seq+1,0):0;floor=floor===undefined?need:Math.min(floor,need)}return floor===undefined?undefined:offset(Math.max(floor-1,0))}
 viewCheckpoint(checkpoint,keys){const values={},selected=keys===undefined?undefined:new Set(keys);for(const r of this.registrations.values()){const def=r.def,row=rowFor(checkpoint,def.key);if(!def.wire||selected&&!selected.has(def.key)||!row||row.ver!==def.stateVersion)continue;let state;try{state=def.stateSchema.parse(row.val)}catch{continue}put(values,def.key,def.wire.viewSchema.parse(def.wire.view(state)))}return values}
 restore(checkpoint,events,baseSeq,header,inherited){
  const endSeq=events.at(-1)?.seq??before(baseSeq),values={},refreshed={}
  for(const r of this.registrations.values()){const def=r.def,row=rowFor(checkpoint,def.key),usable=row!==undefined&&row.ver===def.stateVersion&&row.seq>=before(baseSeq)&&row.seq<=endSeq;if(!usable&&baseSeq>0)throw new Error(`session projection ${JSON.stringify(def.key)} cannot restore from seq ${baseSeq}; re-read from seq 0`);let state=usable?def.stateSchema.parse(row.val):def.init(header,inherited);for(let index=(usable?row.seq:before(baseSeq))-baseSeq+1;index<events.length;index++){const event=events[index];if(!event||event.seq!==baseSeq+index)throw new Error(`session projection ${JSON.stringify(def.key)} cannot restore across missing seq ${baseSeq+index}`);state=def.apply(state,event)}if(def.wire)put(values,def.key,def.wire.viewSchema.parse(def.wire.view(state)));put(refreshed,def.key,{ver:def.stateVersion,seq:endSeq,val:state})}
  return{snapshot:{asOfSeq:endSeq,values},checkpoint:refreshed}
 }
 hydrate(session,checkpoint,events,baseSeq){const endSeq=events.at(-1)?.seq??before(baseSeq);if([...this.registrations.values()].every(r=>r.cells.get(session)?.observedSeq===endSeq)){const values={};for(const r of this.registrations.values())if(r.def.wire)put(values,r.def.key,this.viewCell(r,r.cells.get(session)));return{asOfSeq:endSeq,values}}const restored=this.restore(checkpoint,events,baseSeq,session.header,session.inheritedEventCount);for(const r of this.registrations.values()){const row=rowFor(restored.checkpoint,r.def.key),current=r.cells.get(session);if(row&&(!current||current.observedSeq<=row.seq))r.cells.set(session,{state:row.val,observedSeq:row.seq,views:[undefined,undefined]})}return restored.snapshot}
 drive(session,event){
  offset(event.seq)
  for(const r of this.registrations.values()){let cell=r.cells.get(session);if(cell&&cell.observedSeq>=event.seq)continue;if(!cell){cell=this.buildCell(r.def,session.header,session.inheritedEventCount,session.snapshotEvents(0,event.seq));r.cells.set(session,cell)}else this.advance(r.def,cell,session,event.seq-1)
   const next=r.def.apply(cell.state,event),changed=!Object.is(next,cell.state);cell.state=next;cell.observedSeq=event.seq
   if(changed&&r.def.wire){cell.views[0]=cell.views[1];cell.views[1]=this.listeners.size?r.def.wire.view(next):undefined;if(this.listeners.size&&!Object.is(cell.views[0],cell.views[1])){const value=r.def.wire.viewSchema.parse(cell.views[1]);for(const {listener}of this.listeners)try{Promise.resolve(listener(session,r.def.key,value,event.seq)).catch(error=>this.ctx.logger.warn(error))}catch(error){this.ctx.logger.warn(error)}}}
  }
 }
}
