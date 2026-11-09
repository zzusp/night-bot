export class AttachmentError extends Error {constructor(message,code,options){super(message,options);this.name='AttachmentError';this.code=code}}
export const attachmentFailure=(code,message,cause)=>new AttachmentError(message,code,cause===undefined?undefined:{cause})
export const digestPattern=/^sha256:([a-f0-9]{64})$/
export function attachmentDigest(ref){const hash=digestPattern.exec(String(ref?.attachmentId))?.[1];if(!hash)throw attachmentFailure('INVALID_ATTACHMENT_REF','Attachment reference is invalid.');return hash}
export function positive(value){if(!Number.isSafeInteger(value)||value<=0)throw attachmentFailure('INVALID_ATTACHMENT_REF','Image dimensions and limits must be positive integers.');return value}
