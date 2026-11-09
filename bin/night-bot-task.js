#!/usr/bin/env node
import {loadConfig} from '../src/config.js'
import {backupTask,restoreTask,inspectTaskArchive,validateTaskArchive,rebuildTaskIndex,recoverTaskRestore,acknowledgeTaskRestore,adoptTaskArchive} from '../src/tasks/archive.js'
const [file,command,taskOrSource,destination]=process.argv.slice(2)
try{
  if(!file||!['backup','restore','validate','rebuild','rebuild-index','recover-restore','acknowledge','adopt'].includes(command))throw Error('Usage: night-bot-task CONFIG backup TASK_ID DEST | restore ARCHIVE | validate TASK_ID | rebuild TASK_DIRECTORY | rebuild-index | recover-restore | acknowledge TASK_ID REVIEW_NOTE | adopt TASK_ID')
  const config=await loadConfig(file)
  const result=command==='backup'?await backupTask(config,taskOrSource,destination):command==='restore'?await restoreTask(config,taskOrSource):command==='rebuild'?await restoreTask(config,taskOrSource,{rebuild:true}):command==='adopt'?await adoptTaskArchive(config,taskOrSource):command==='acknowledge'?await acknowledgeTaskRestore(config,taskOrSource,destination):command==='rebuild-index'?await rebuildTaskIndex(config):command==='recover-restore'?await recoverTaskRestore(config):await inspectTaskArchive(config,taskOrSource)
  console.log(JSON.stringify(result,null,2))
}catch(error){console.error(error.code??error.message);process.exitCode=1}
