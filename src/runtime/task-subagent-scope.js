const owners=new WeakSet()
export const markTaskSubagent=actor=>owners.add(actor)
export const isTaskSubagent=actor=>owners.has(actor)
