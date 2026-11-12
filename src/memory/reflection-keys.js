import {label} from './format.js'
import {failure} from '../runtime/files.js'

// Review receipts own the association; names never encode task/event identity.
export function reflectionMemoryKey(lesson){
  if(!label(lesson.memoryKey))throw failure('REFLECTION_MEMORY_KEY_INVALID')
  return lesson.memoryKey
}

export function assignReflectionMemoryKeys(lessons,entries,reviews){
  const used=new Set(entries.map(entry=>entry.key))
  for(const review of Object.values(reviews))for(const lesson of review.lessons??[])used.add(reflectionMemoryKey(lesson))
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
