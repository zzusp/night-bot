/** The current application executes one task through official Pi. Legacy
 * split-execution selectors must fail before creating task storage. */
export function assertPiTaskBackend(value){
 if(value?.executionBackend!==undefined&&value.executionBackend!=='pi')throw Object.assign(new Error('TASK_EXECUTION_BACKEND_UNSUPPORTED'),{code:'TASK_EXECUTION_BACKEND_UNSUPPORTED'})
}
export function assertPiTaskBackendConfiguration(config){assertPiTaskBackend(config);assertPiTaskBackend(config?.resident?.taskSessions)}
