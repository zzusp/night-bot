import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, lstatSync, readFileSync, writeFileSync, realpathSync, openSync, fsyncSync, closeSync } from 'node:fs'
import { join, resolve, parse, isAbsolute } from 'node:path'
const digest = json => 'sha256:' + createHash('sha256').update(json).digest('hex')
const ordered = value => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value
export const modelContentScope = header => digest(JSON.stringify([header.id, header.createdAt])).slice(7)
const fail = code => { throw Object.assign(new Error(code), { code }) }
const contentFields = new Set(['text', 'body', 'reply', 'request', 'objective', 'context', 'goalText', 'policy', 'groupResponsibility', 'question', 'summary', 'answer', 'title'])
// scope、摘要和字典键本身有成本，短文本直接展示比建立引用更小。
const indexText = value => Buffer.byteLength(value) >= 512
const syncDirectory = path => {
  if (process.platform === 'win32') return
  const fd = openSync(path, 'r')
  try { fsyncSync(fd) } finally { closeSync(fd) }
}

export const modelContextInstructions = `当前业务输入或工具结果中的contentRef仅标识本会话已准入的不可变业务文件，不是会话历史、Pi上下文或授权证明。contextRef是超预算视图的完整快照，contextPath是相对它的JSON Pointer；路径段的~和/分别转义为~0和~1。readRequired/contextReadRequired表示正文尚待按当前问题核对，未展开、截断、相同正文或模型复述都不能证明已读或取得授权。使用原生文件工具读取path或用model_content_read读取contentRef/path并按nextOffset续读；留意原生read的行长和总量限制，不把部分结果当全文。核对来源ID、作者、版本、更正和撤销及未知效果，业务输入文件不替代当前Task授权和效果收据。索引不自动注入旧正文、不重建消息或压缩摘要；可见历史与上下文只由官方Pi维护。`

// Application-owned immutable file catalog, not a conversation/context engine.
// Factory setup runs before SDK creation, so its captured logical metadata is
// used consistently for file identity both before and after AgentSession exists.
export function createOfficialModelContentIndex(actor,{root}={}){
  const native=actor?.piSession?.sessionManager.getHeader()
  const header=actor?.metadata??(native&&{id:native.id,createdAt:native.timestamp,cwd:native.cwd})
  if(!header||header.id!==actor.id||typeof header.cwd!=='string'||!isAbsolute(header.cwd))fail('MODEL_CONTENT_OFFICIAL_IDENTITY_REQUIRED')
  return createContentIndex(header,{root:root??resolve(header.cwd,'.night/model-content')})
}

function createContentIndex(header, {root}) {
  root = resolve(root)
  const values = new Map()
  const decoded = new Map()
  const pages = new Map()
  const scope = modelContentScope(header)
  const scopes = new Map([[scope, root]])
  function checkedDirectory(path, create = true) {
    if (!existsSync(path)) {
      if (!create) fail('MODEL_CONTENT_MISSING')
      const parent = resolve(path, '..')
      if (parent !== path) checkedDirectory(parent)
      try { mkdirSync(path) } catch (error) { if (error.code !== 'EEXIST') throw error }
      syncDirectory(parent)
    }
    const info = lstatSync(path)
    if (!info.isDirectory() || info.isSymbolicLink()) fail('MODEL_CONTENT_DIRECTORY_INVALID')
    const canonical = realpathSync(path), expected = resolve(path)
    if ((process.platform === 'win32' ? canonical.toLowerCase() !== expected.toLowerCase() : canonical !== expected) && parse(path).root !== path) fail('MODEL_CONTENT_DIRECTORY_INVALID')
  }
  checkedDirectory(resolve(root)); checkedDirectory(join(root, scope))
  const filename = ref => {
    const match = /^([a-f0-9]{64}):sha256:([a-f0-9]{64})$/.exec(ref)
    if (!match || !scopes.has(match[1])) fail('MODEL_CONTENT_NOT_ADMITTED')
    const directory = join(scopes.get(match[1]), match[1])
    checkedDirectory(directory, false)
    return join(directory, match[2] + '.json')
  }
  function load(ref) {
    if (values.has(ref)) return values.get(ref)
    const path = filename(ref)
    if (!existsSync(path)) fail('MODEL_CONTENT_MISSING')
    const info = lstatSync(path)
    if (!info.isFile() || info.isSymbolicLink()) fail('MODEL_CONTENT_FILE_INVALID')
    const json = readFileSync(path, 'utf8')
    if (!ref.endsWith(digest(json))) fail('MODEL_CONTENT_DIGEST_MISMATCH')
    values.set(ref, json)
    return json
  }
  function store(value) {
    const json = JSON.stringify(value, (_key, child) => ordered(child))
    if (json === undefined) fail('MODEL_CONTENT_VALUE_INVALID')
    const ref = scope + ':' + digest(json)
    const path = filename(ref)
    if (!values.has(ref)) {
      try {
        const fd = openSync(path, 'wx', 0o600)
        try { writeFileSync(fd, json); fsyncSync(fd) } finally { closeSync(fd) }
        syncDirectory(join(root, scope))
      }
      catch (error) { if (error.code !== 'EEXIST') throw error; if (load(ref) !== json) fail('MODEL_CONTENT_DIGEST_MISMATCH') }
      values.set(ref, json)
    }
    return { contentRef: ref, path, format: typeof value === 'string' ? 'text' : 'json', bytes: Buffer.byteLength(json) }
  }
  function project(value) {
    const localObjects = new Set()
    const reference = value => { const stored = store(value); return { contentRef: stored.contentRef, path: stored.path, format: 'json' } }
    function visit(item, key) {
      if (item && typeof item === 'object' && ['entries', 'events', 'logs', 'diagnostics', 'context', 'results', 'payload', 'output', 'data', 'evidence'].includes(key)
        && Buffer.byteLength(JSON.stringify(item)) >= 2048) return reference(item)
      if (typeof item === 'string' && indexText(item)) {
        const ref = reference(item)
        // The immutable file is the definition; never eagerly reinject a long body.
        return ref
      }
      if (item && typeof item === 'object') {
        const json = JSON.stringify(item, (_key, child) => ordered(child))
        if (json.length >= 240) {
          const ref = scope + ':' + digest(json)
          if (localObjects.has(ref)) return reference(item)
          localObjects.add(ref)
        }
      }
      if (Array.isArray(item)) {
        if (key === undefined && Buffer.byteLength(JSON.stringify(item)) >= 2048) return reference(item)
        return item.map(child => visit(child))
      }
      if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, key === 'contentRef' ? child : visit(child, key)]))
      return item
    }
    const projected = visit(value)
    return projected
  }
  function selected(contentRef, path) {
    if (typeof path !== 'string' || path && !path.startsWith('/')) fail('MODEL_CONTENT_READ_INVALID')
    if (!decoded.has(contentRef)) decoded.set(contentRef, JSON.parse(load(contentRef)))
    let value = decoded.get(contentRef)
    for (const encoded of path ? path.slice(1).split('/') : []) {
      if (/~(?![01])/u.test(encoded)) fail('MODEL_CONTENT_PATH_INVALID')
      const key = encoded.replaceAll('~1', '/').replaceAll('~0', '~')
      if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) fail('MODEL_CONTENT_PATH_INVALID')
      value = value[key]
    }
    return value
  }
  function read({ contentRef, path = '', offset = 0, limit = 4000 }) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 16000) fail('MODEL_CONTENT_READ_INVALID')
    const pageKey = JSON.stringify([contentRef, path])
    if (!pages.has(pageKey)) {
      const value = selected(contentRef, path)
      pages.set(pageKey, { text: typeof value === 'string' ? value : JSON.stringify(value), format: typeof value === 'string' ? 'text' : 'json', resolvedRef: store(value) })
    }
    const { text, format, resolvedRef } = pages.get(pageKey)
    if (offset > text.length) fail('MODEL_CONTENT_READ_INVALID')
    const end = Math.min(offset + limit, text.length)
    return { contentRef, path, format, offset, totalLength: text.length,
      text: text.slice(offset, end), nextOffset: end < text.length ? end : null, resolvedRef }
  }
  function install(agentCtx, isCurrent = async () => true) {
    const systemPrompt=agentCtx.get('systemPrompt'),tools=agentCtx.get('tools')
    if(!systemPrompt||!tools)fail('MODEL_CONTENT_SCOPED_SERVICES_REQUIRED')
    systemPrompt.section({ name: 'dingtalk:model-content', order: 20, text: modelContextInstructions })
    tools.register({ name: 'model_content_read', effectClass: 'read', description: '读取本会话已准入contentRef的精确内容。支持JSON Pointer和分页；未知引用不能读取。',
      parameters: { type: 'object', properties: { contentRef: { type: 'string' }, path: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 16000 } }, required: ['contentRef'], additionalProperties: false },
      // An explicit read is the leaf of the index. Re-projecting its `text`
      // changes the page contract into another reference instead of evidence.
      output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      async execute(args, exec) {
        exec.signal.throwIfAborted(); if (!await isCurrent()) fail('MODEL_CONTENT_SESSION_STALE')
        const value = selected(args.contentRef, args.path ?? '')
        if (value && typeof value === 'object') {
          const offset = args.offset ?? 0, limit = Math.min(args.limit ?? 20, 20), entries = Object.entries(value)
          if (!Number.isSafeInteger(offset) || offset < 0 || offset > entries.length || !Number.isSafeInteger(limit) || limit < 1) fail('MODEL_CONTENT_READ_INVALID')
          const end = Math.min(offset + limit, entries.length)
          return { contentRef: args.contentRef, path: args.path ?? '', format: 'json-index', valueKind: Array.isArray(value) ? 'array' : 'object', totalEntries: entries.length,
            entries: entries.slice(offset, end).map(([key, child]) => ({ key, ...(child && typeof child === 'object' || typeof child === 'string' && (child.length >= 120 || contentFields.has(key))
              ? { valueRef: store(child) } : { value: child }) })), nextOffset: end < entries.length ? end : null }
        }
        // Explicit repeated reads must return the same requested page, even if
        // a prior Host/tool message already contains the original definition.
        return read(args)
      } })
  }
  function wrapOutput(output) {
    return { ...output, render: (args, value) => output.render(args, value).map(block => {
      if (block.type !== 'text') return block
      let payload
      try { payload = JSON.parse(block.text) } catch { payload = { text: block.text } }
      return { ...block, text: JSON.stringify(host(payload)) }
    }) }
  }
  function instruction(text, label = '详细上下文') {
    if (typeof text !== 'string' || !indexText(text)) return text
    const file = store(text)
    return `${label}已保存在${file.path}（JSON字符串；contentRef=${file.contentRef}）。按当前问题用已有文件能力定位相关段落，先核对授权边界，不必整包回灌；未读取部分不能当作已知。`
  }
  // Budget the actual serialized Host text, after all field-level projection.
  // One immutable definition carries overflow; pointers never imply it was read.
  function host(value, { projected: alreadyProjected = false } = {}) {
    const projected = alreadyProjected ? value : project(value)
    const bytes = value => Buffer.byteLength(JSON.stringify(value) ?? '')
    if (bytes(projected) <= 3000) return projected
    const snapshot = store(projected)
    if (Object.hasOwn(projected, 'contextRef') || Object.hasOwn(projected, 'contextReadRequired'))
      return { contextRef: snapshot.contentRef, contextReadRequired: true }
    const result = { ...projected, contextRef: snapshot.contentRef, contextReadRequired: true }
    const pointer = key => '/' + key.replaceAll('~', '~0').replaceAll('/', '~1')
    const candidates = Object.keys(projected).sort((a, b) => bytes(projected[b]) - bytes(projected[a]))
    for (const key of candidates) {
      if (bytes(result) <= 2800) break
      const reference = { contextPath: pointer(key), readRequired: true }
      if (bytes(reference) < bytes(result[key])) result[key] = reference
    }
    // Arbitrarily many or long keys must also fit without dropping their data.
    return bytes(result) <= 3000 ? result : { contextRef: snapshot.contentRef, contextReadRequired: true }
  }
  return { project, host, store, read, install, wrapOutput, instruction }
}
