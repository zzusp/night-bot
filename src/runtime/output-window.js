/** Application output limits. Only text produced by Night tools is admitted;
 * binary streams must be decoded by their owning transport first. Windows keep
 * complete Unicode scalar values and account for their encoded UTF-8 bytes. */
function budget(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Output budget must be a non-negative safe integer')
  return value
}
export function textWindow({headBytes = 0, tailBytes = 0} = {}) {
  const headLimit = budget(headBytes), tailLimit = budget(tailBytes), capacity = budget(headLimit + tailLimit)
  let seen = 0, whole = '', head = '', headSize = 0, headClosed = headLimit === 0
  let suffix = [], first = 0, suffixSize = 0
  return Object.freeze({
    append(value) {
      if (typeof value !== 'string') throw new TypeError('Output window accepts text only')
      const text = value.toWellFormed()
      seen += Buffer.byteLength(text)
      whole = seen <= capacity ? whole + text : undefined
      if (!headClosed) for (const scalar of text) {
        const size = Buffer.byteLength(scalar)
        if (headSize + size > headLimit) { headClosed = true; break }
        head += scalar; headSize += size
      }
      if (tailLimit === 0) return
      // At most tailLimit UTF-16 units can contribute to the suffix. Avoid a
      // JavaScript loop over a potentially huge discarded middle of a chunk.
      let candidate = text
      if (text.length > tailLimit) {
        suffix = []; first = 0; suffixSize = 0
        candidate = text.slice(-tailLimit)
        const initial = candidate.charCodeAt(0)
        if (initial >= 0xdc00 && initial <= 0xdfff) candidate = candidate.slice(1)
      }
      for (const scalar of candidate) {
        const size = Buffer.byteLength(scalar)
        suffix.push({scalar, size}); suffixSize += size
        while (suffixSize > tailLimit) suffixSize -= suffix[first++].size
      }
      if (first > 1024 || first > suffix.length / 2) { suffix = suffix.slice(first); first = 0 }
    },
    snapshot() {
      if (seen <= capacity) return {text: whole, truncated: false, omittedBytes: 0}
      return {text: head + suffix.slice(first).map(part => part.scalar).join(''), truncated: true, omittedBytes: seen - headSize - suffixSize}
    },
  })
}
export function boundText(text, limits) {
  const window = textWindow(limits); window.append(text); return window.snapshot()
}
export function itemWindow(maxItems) {
  const limit = budget(maxItems), values = []; let seen = 0
  return Object.freeze({
    append(value) { seen++; if (values.length < limit) { values.push(value); return true } return false },
    snapshot() { return {values: values.slice(), seen, dropped: seen - values.length} },
  })
}
