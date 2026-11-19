// A bounded stage of independent reads, not a task scheduler. Preserve order
// and join admitted work on failure before its caller releases ownership.
export async function mapIndependentReads(values,limit,read){
 if(!Number.isSafeInteger(limit)||limit<1)throw new TypeError('Positive read concurrency required')
 const results=new Array(values.length);let next=0,failure
 await Promise.all(Array.from({length:Math.min(limit,values.length)},async()=>{
  while(!failure&&next<values.length){const index=next++;try{results[index]=await read(values[index],index)}catch(error){failure??={error}}}
 }))
 if(failure)throw failure.error
 return results
}
export const SAFE_TOOL_PARALLELISM_POLICY='工具调用按数据与资源依赖安排：已具备本会话原生工具时，同批发出互不依赖、不会争用资源的调用，不机械逐个等待；前一步输出作为后一步输入、读写冲突、权限/租约/回执与不可逆副作用仍按顺序核验。是否实际并行由工具安全声明和Host限流决定，不因工具名称像只读就放开，不增加工具、不拆任务或另建子执行会话。短命令前台执行；只有确实长且可与其他已授权步骤重叠的工作才使用已有后台作业能力，提交后先做独立工作，真正依赖结果时再等待通知或阻塞读取，不忙轮询。后台返回ID不等于完成，不跳过同作业游标、回执、取消、drain和完成守卫。'
