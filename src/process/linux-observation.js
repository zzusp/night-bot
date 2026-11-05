// Application Linux process observations. A /proc sample is evidence with an
// explicit completeness flag, never an atomic kernel ownership receipt.
import {readFileSync,readdirSync} from 'node:fs'
const nativeIO={readFile:path=>readFileSync(path,'utf8'),readDir:path=>readdirSync(path),kill:(pid,signal)=>process.kill(pid,signal)}
const pidValue=value=>Number.isSafeInteger(value) && value>0
const deadState=state=>['Z','X','x'].includes(state)
const identity=row=>Object.freeze({pid:row.pid,started:row.started})
export function decodeLinuxStat(text,expectedPid) {
  if(typeof text !== 'string' || text.length>65536)return undefined
  const match=/^([1-9]\d*) \([\s\S]*\) ([A-Za-z]) (.*)\n?$/u.exec(text)
  if(!match)return undefined
  const pid=Number(match[1]),values=match[3].trim().split(/\s+/)
  if(!pidValue(pid) || (expectedPid!==undefined && pid!==expectedPid) || values.length<19)return undefined
  const fields=[values[0],values[1],values[2],values[3],values[4]]
  if(values.some(value=>! /^-?\d+$/.test(value)) || !/^\d+$/.test(values[18]))return undefined
  const [parentPid,pgrp,session,ttyDevice,tpgid]=fields.map(Number)
  if(![parentPid,pgrp,session,ttyDevice,tpgid].every(Number.isSafeInteger) || parentPid<0 || pgrp<0 || session<0)return undefined
  return Object.freeze({pid,parentPid,pgrp,session,ttyDevice,tpgid,state:match[2],started:values[18]})
}
export function observeLinuxPid(pid,io=nativeIO) {
  if(!pidValue(pid))return Object.freeze({state:'unknown'})
  try {
    const row=decodeLinuxStat(io.readFile(`/proc/${pid}/stat`),pid)
    return row ? Object.freeze({state:deadState(row.state)?'dead':'alive',row}) : Object.freeze({state:'unknown'})
  } catch(error) {return Object.freeze({state:['ENOENT','ESRCH'].includes(error.code)?'dead':'unknown'})}
}
// Compatibility only for the retained attributed stdin-readiness detector.
export function readLinuxStat(io,pid) {return observeLinuxPid(pid,io).row}
function listPids(io) {
  const entries=io.readDir('/proc')
  if(!Array.isArray(entries))throw new Error('invalid Linux process directory sample')
  const pids=new Set()
  for(const entry of entries)if(typeof entry==='string' && /^[1-9]\d*$/.test(entry)) {
    const pid=Number(entry)
    if(!pidValue(pid))throw new Error('invalid Linux process identifier')
    pids.add(pid)
  }
  return pids
}
export class LinuxProcessSample {
  #rows
  #byPid
  constructor(rows,complete) {
    this.#rows=Object.freeze(rows.map(row=>Object.freeze({...row})))
    this.#byPid=new Map(this.#rows.map(row=>[row.pid,row]))
    this.complete=complete===true
    Object.freeze(this)
  }
  status(member) {
    if(!pidValue(member?.pid) || typeof member.started!=='string' || !/^\d+$/.test(member.started))return 'unknown'
    const row=this.#byPid.get(member.pid)
    if(!row)return this.complete?'dead':'unknown'
    return row.started!==member.started || deadState(row.state)?'dead':'alive'
  }
  alive(member) {const state=this.status(member);return state==='unknown'?undefined:state==='alive'}
  tree(rootPid) {
    const root=this.#byPid.get(rootPid)
    if(!root)return []
    const children=new Map()
    for(const row of this.#rows) {
      const parent=this.#byPid.get(row.parentPid)
      // A recycled parent cannot adopt a child that predates that identity.
      if(parent && BigInt(row.started)>=BigInt(parent.started)) {
        const siblings=children.get(parent.pid)??[];siblings.push(row);children.set(parent.pid,siblings)
      }
    }
    const result=[],seen=new Set(),stack=[[root,false]]
    while(stack.length) {
      const [row,expanded]=stack.pop()
      if(expanded){result.push(identity(row));continue}
      if(seen.has(row.pid))continue
      seen.add(row.pid);stack.push([row,true])
      for(const child of children.get(row.pid)??[])if(!seen.has(child.pid))stack.push([child,false])
    }
    return result
  }
  session(sessionId) {return this.#rows.filter(row=>row.session===sessionId).map(identity)}
  groupState(groupId) {
    const members=this.#rows.filter(row=>row.pgrp===groupId)
    if(members.some(row=>!deadState(row.state)))return 'alive'
    return this.complete?'dead':'unknown'
  }
}
export function sampleLinuxProcesses(io=nativeIO) {
  const initial=listPids(io),rows=[]
  let complete=true
  for(const pid of initial) {
    const first=observeLinuxPid(pid,io)
    if(!first.row){if(first.state==='unknown')complete=false;continue}
    const second=observeLinuxPid(pid,io)
    if(!second.row || second.row.started!==first.row.started) {complete=false;continue}
    rows.push(second.row)
  }
  let closing
  try {closing=listPids(io)}catch {return new LinuxProcessSample(rows,false)}
  const sampled=new Set(rows.map(row=>row.pid))
  for(const pid of closing)if(!initial.has(pid) || !sampled.has(pid))complete=false
  // Rows that disappeared during the directory bracket are not a live proof.
  const retained=rows.filter(row=>closing.has(row.pid))
  return new LinuxProcessSample(retained,complete)
}
export function linuxProcessGroupHasLiveMembers(groupId,io=nativeIO) {
  try {const state=sampleLinuxProcesses(io).groupState(groupId);return state==='unknown'?undefined:state==='alive'}catch{return undefined}
}
export class LinuxProcessInspector {
  constructor(io=nativeIO,stdinWaiting=()=>false) {this.io=io;this.stdinWaiting=stdinWaiting}
  snapshot() {return sampleLinuxProcesses(this.io)}
  observe(member) {
    const result=observeLinuxPid(member?.pid,this.io)
    if(!result.row)return result.state
    return result.row.started!==member.started?'dead':result.state
  }
  isAlive(member) {const state=this.observe(member);return state==='unknown'?undefined:state==='alive'}
  signalProcess(member,signal) {if(this.observe(member)==='alive')this.io.kill(member.pid,signal)}
  signalGroup(groupId,signal) {if(!pidValue(groupId))throw new Error('invalid Linux process group');this.io.kill(-groupId,signal)}
  foregroundPgid(shellPid) {const row=observeLinuxPid(shellPid,this.io).row;return row?.tpgid>0?row.tpgid:undefined}
  isStdinWaiting(groupId,shellPid) {return this.stdinWaiting(groupId,shellPid)}
}
