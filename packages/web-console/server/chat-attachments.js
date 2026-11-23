import {createHash} from 'node:crypto'
import {fileLeafName} from '../../../src/native-attachment-storage.js'
import {fail} from './security.js'

export const WEB_CHAT_ATTACHMENT_BYTES = 8 * 1024 * 1024
export const WEB_CHAT_BODY_BYTES = Math.ceil(WEB_CHAT_ATTACHMENT_BYTES / 3) * 4 + 132_000
const types = new Set(['image/png','image/jpeg','image/webp','image/gif'])
const mime = /^[a-z0-9][a-z0-9.+_-]{0,63}\/[a-z0-9][a-z0-9.+_-]{0,63}$/u
const sha = bytes => createHash('sha256').update(bytes).digest('hex')

export function parseWebChatAttachments(input) {
  if (input === undefined) return []
  if (!Array.isArray(input) || input.length > 8) fail('CHAT_ATTACHMENTS_INVALID', 400)
  let total = 0
  return input.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).length !== 3
      || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 255
      || typeof item.mediaType !== 'string' || !mime.test(item.mediaType)
      || typeof item.data !== 'string' || !item.data.length || item.data.length % 4 !== 0) fail('CHAT_ATTACHMENTS_INVALID', 400)
    if (item.data.length > Math.ceil(WEB_CHAT_ATTACHMENT_BYTES / 3) * 4) fail('CHAT_ATTACHMENTS_TOO_LARGE', 413)
    const bytes = Buffer.from(item.data, 'base64')
    if (!bytes.length || bytes.toString('base64') !== item.data) fail('CHAT_ATTACHMENTS_INVALID', 400)
    total += bytes.length
    if (total > WEB_CHAT_ATTACHMENT_BYTES) fail('CHAT_ATTACHMENTS_TOO_LARGE', 413)
    return {name: fileLeafName(item.name), mediaType: item.mediaType, bytes, hash: sha(bytes)}
  })
}

export function admitWebChatAttachments(service, input) {
  return saveParsedWebChatAttachments(service, parseWebChatAttachments(input))
}

export async function saveParsedWebChatAttachments(service, parsed) {
  if (!parsed.length) return []
  if (!service?.saveImages || !service?.saveFile) fail('CHAT_ATTACHMENTS_UNAVAILABLE', 503)
  try {
    const images = parsed.filter(item => types.has(item.mediaType))
    const imageRefs = images.length ? await service.saveImages(images.map(({name,mediaType,bytes}) => ({name,mediaType,data:bytes}))) : []
    let imageIndex = 0
    const result = []
    for (const item of parsed) {
      const image = types.has(item.mediaType)
      result.push({type:image?'image':'file', attachment:image ? imageRefs[imageIndex++] : await service.saveFile({name:item.name,data:item.bytes}),
        name:item.name, mediaType:item.mediaType, submittedSha256:item.hash})
    }
    return result
  } catch(error) {
    if (/^(?:INVALID_IMAGE|IMAGE_TYPE_MISMATCH|UNSUPPORTED_IMAGE_TYPE|TOO_MANY_IMAGES|IMAGE_TOO_|IMAGES_TOO_)/u.test(error?.code ?? '')) fail('CHAT_ATTACHMENTS_INVALID', 400)
    fail('CHAT_ATTACHMENTS_UNAVAILABLE', 503)
  }
}

// Only call with a reference owned by a verified server-side message or task.
export async function readWebChatAttachment(service, value) {
  if (!service) fail('CHAT_ATTACHMENTS_UNAVAILABLE', 503)
  if (value.type === 'image') {
    const {data,ref} = await service.readImage(value.attachment)
    return {image:{data,mediaType:ref.mediaType,name:value.name},complete:true}
  }
  if (value.type !== 'file') fail('CHAT_ATTACHMENTS_INVALID',400)
  const chunks = []; let bytes = 0
  for await (const chunk of service.readFileStream(value.attachment)) {
    bytes += chunk.byteLength
    if (bytes > WEB_CHAT_ATTACHMENT_BYTES) fail('CHAT_ATTACHMENTS_TOO_LARGE',413)
    chunks.push(chunk)
  }
  return {file:{data:Buffer.concat(chunks,bytes),mediaType:value.mediaType,name:value.name},complete:true}
}
