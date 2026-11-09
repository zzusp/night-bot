export const PI_FILE_SOURCE_DEFAULTS=Object.freeze({maxBufferedBytes:10485760,maxBufferedLines:32768,maxEditBytes:1048576,maxEditCount:32,maxWriteBytes:1048576,maxArgumentBytes:2097152,maxTransportBytes:33554432,maxPathCharacters:4096,maxOperationTargets:4096,windowMaxLines:2000,windowMaxBytes:51200,windowMaxLineCharacters:2000,windowMaxFileBytes:536870912,windowMaxScanBytes:16777216,windowMaxChunks:4096})

export function validatePiFileSourceConfig(value){
 if(value===undefined)return
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.entries(value).some(([key,limit])=>!Object.hasOwn(PI_FILE_SOURCE_DEFAULTS,key)||!Number.isSafeInteger(limit)||limit<1)||value.windowMaxBytes!==undefined&&value.windowMaxBytes<256)throw Object.assign(new Error('NIGHT_BOT_FILE_TOOLS_CONFIG_INVALID'),{code:'NIGHT_BOT_FILE_TOOLS_CONFIG_INVALID'})
}
