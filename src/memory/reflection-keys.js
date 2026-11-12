import {label} from './format.js'
import {failure} from '../runtime/files.js'

// Review receipts own the association; names never encode task/event identity.
export function reflectionMemoryKey(lesson){
  if(!label(lesson.memoryKey))throw failure('REFLECTION_MEMORY_KEY_INVALID')
  return lesson.memoryKey
}

const destinationKey=destination=>destination?.memory?.topic==='experience'&&label(destination.memory.key)?destination.memory.key:undefined

// Historical reviews are audit, not retry instructions. Read only explicit
// associations; an unsupported/missing association must not poison other work.
export function reviewMemoryKeys(review){
  const lessons=Array.isArray(review.lessons)?review.lessons:[],destinations=Array.isArray(review.destinations)?review.destinations:[]
  return [...new Set([...lessons.map(lesson=>lesson?.memoryKey).filter(label),...destinations.map(destinationKey).filter(Boolean)])]
}

export function reviewLessonMemoryKey(review,index){
  const lesson=review.lessons[index]
  if(label(lesson?.memoryKey))return lesson.memoryKey
  // The saved destination array is parallel to lessons. Do not infer a name
  // from a task prefix or match an unrelated/unpaired historical destination.
  if(lesson?.memoryKey===undefined&&Array.isArray(review.destinations)&&review.destinations.length===review.lessons.length&&review.lessons.every(row=>row?.memoryKey===undefined)&&review.destinations.every(destinationKey))return destinationKey(review.destinations[index])
}

export function reflectionRetrySupported(review){
  return review.memoryKeyVersion===1&&(review.lessons===undefined||Array.isArray(review.lessons)&&review.lessons.every(lesson=>label(lesson?.memoryKey)))
}

export function assignReflectionMemoryKeys(lessons,entries,reviews){
  const used=new Set(entries.map(entry=>entry.key))
  for(const review of Object.values(reviews))for(const key of reviewMemoryKeys(review))used.add(key)
  return lessons.map(lesson=>{
    // A known rejected/unattempted reservation can move if another writer took
    // its name. An uncertain or committed effect must keep its receipt identity.
    if(lesson.memoryKey&&(!entries.some(entry=>entry.key===lesson.memoryKey)||lesson.applied||['committed','uncertain'].includes(lesson.memoryWrite)))return lesson
    let memoryKey=lesson.key,suffix=2
    while(used.has(memoryKey))memoryKey=lesson.key+'-'+suffix++
    used.add(memoryKey)
    return {...lesson,memoryKey}
  })
}
