export const MAX_COMPOSER_FILES = 8;
export const MAX_COMPOSER_FILE_BYTES = 8 * 1024 * 1024;
export type ComposerAttachment = {name: string; mediaType: string; data: string};
export class AttachmentInputError extends Error {}

export function newComposerRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // getRandomValues is also available on private HTTP installations.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function encodeAttachments(files: readonly File[]): Promise<ComposerAttachment[]> {
  if (files.length > MAX_COMPOSER_FILES || files.some(file => !file.size) || files.reduce((sum, file) => sum + file.size, 0) > MAX_COMPOSER_FILE_BYTES) {
    throw new AttachmentInputError('最多添加 8 个非空文件，合计不超过 8 MiB。');
  }
  if (files.some(file => !file.name.trim() || file.name.length > 255)) throw new AttachmentInputError('附件文件名无效，请更名后重新添加。');
  try {
    const attachments: ComposerAttachment[] = [];
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const chunks: string[] = [];
      for (let offset = 0; offset < bytes.length; offset += 0x8000) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
      const mediaType = /^[a-z0-9][a-z0-9.+_-]{0,63}\/[a-z0-9][a-z0-9.+_-]{0,63}$/.test(file.type) ? file.type : 'application/octet-stream';
      attachments.push({name: file.name, mediaType, data: btoa(chunks.join(''))});
    }
    return attachments;
  } catch {
    throw new AttachmentInputError('附件暂时无法读取，请重新添加后发送。');
  }
}
