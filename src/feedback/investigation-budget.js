/** Investigation input and publication output are deliberately separate budgets. */
export const investigationBudget=Object.freeze({calls:96,evidenceCharacters:200000,pageCharacters:16000,reportCharacters:46000,appendixCharacters:22000,timeoutMs:15*60*1000})
export function diagnosticCompactionSettings(model){
 if(!Number.isSafeInteger(model?.contextWindow)||model.contextWindow<=0)throw new Error('FEEDBACK_CONTEXT_WINDOW_INVALID')
 const reserveTokens=Math.max(1,Math.floor(model.contextWindow*.2))
 return {enabled:true,reserveTokens,keepRecentTokens:Math.min(12000,Math.floor((model.contextWindow-reserveTokens)/3))}
}

export const diagnosticOutputTokens=model=>Math.max(1,Math.min(16384,model.maxTokens??16384,Math.floor(model.contextWindow/8)))
