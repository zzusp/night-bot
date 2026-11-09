import { mkdir, readFile, open, rename, unlink, realpath, lstat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'

async function withCleanup(primary, actions) {
  const errors = primary ? [primary] : []
  for (const action of actions) try { await action() } catch (error) { errors.push(error) }
  return errors.length > 1 ? new AggregateError(errors, 'Native state operation and cleanup failed', { cause: primary ?? errors[0] }) : errors[0]
}
const active = new Set()
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const unitName = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)
export class DomainError extends Error {
  constructor(code, message, options = {}) { super(message, options); this.name = 'DomainError'; this.code = code; if (options.detail) this.detail = options.detail }
}
export const domainTable = valueSchema => ({ valueSchema })
export function defineDomain(spec) {
  if (!unitName(spec?.name) || !Number.isSafeInteger(spec.version) || spec.version < 0 || !record(spec.tables)
    || Object.keys(spec.tables).some(name => !unitName(name)) || Object.values(spec.tables).some(table => typeof table.valueSchema?.parse !== 'function')
    || spec.global && (typeof spec.global.schema?.parse !== 'function' || spec.global.schema.safeParse(null).success))
    throw new TypeError('NATIVE_DOMAIN_SPEC_INVALID')
  return spec
}
/** Same single-document JSON format as the former transport/workspace backend.
 * Only the active authoritative single-document domains are supported. Unknown
 * layouts fail explicitly; this is not an untested generic storage replacement.
 */
export async function openNativeDomains({ root, onChange = () => {}, onObserverError = () => {}, beforeCommit, afterRename, pathCodec } = {}) {
  root = resolve(root); await mkdir(root, { recursive: true, mode: 0o700 }); root = await realpath(root)
  const domains = new Map(), opening = new Set(), flights = new Set()
  let facilityClosed = false
  async function openDomain(spec) {
    defineDomain(spec)
    if (facilityClosed) throw new DomainError('closed', 'Native storage facility is closed')
    if (spec.layout && spec.layout !== 'single') throw new DomainError('facet-unsupported', 'Native authoritative domains require single layout')
    if (spec.invalidRecords === 'backup-and-skip') throw new DomainError('facet-unsupported', 'Authoritative native domains do not skip corrupt records')
    const path = join(root, spec.name + '.json')
    if (opening.has(spec.name) || domains.has(spec.name) || active.has(path)) throw new DomainError('already-open', 'Domain is already open: ' + spec.name)
    opening.add(spec.name); active.add(path)
    try {
      const entry = await lstat(path).catch(error => { if (error.code === 'ENOENT') return; throw error })
      if (entry && (!entry.isFile() || entry.isSymbolicLink())) throw new DomainError('invalid-record', 'Domain file must be a regular file')
      let document
      try { document = JSON.parse(await readFile(path, 'utf8')) } catch (error) {
        if (error.code !== 'ENOENT') throw new DomainError('invalid-record', 'Domain document cannot be read', { cause: error })
        document = { unit: { name: spec.name, version: spec.version }, global: null, tables: {} }
      }
      document = pathCodec?.domain(spec.name,document,true)??document
      if (!record(document) || document.unit?.name !== spec.name || !record(document.tables)) throw new DomainError('invalid-record', 'Malformed domain document')
      if (document.unit.version !== spec.version) throw new DomainError('version-mismatch', 'Domain version mismatch: ' + spec.name)
      const tables = new Map()
      const parse = (schema, value, table, key) => {
        try { return schema.parse(value) } catch (cause) { throw new DomainError('invalid-record', 'Invalid stored domain record', { cause, detail: { table, key } }) }
      }
      for (const [name, table] of Object.entries(spec.tables)) {
        const saved = document.tables[name] ?? {}
        if (!record(saved)) throw new DomainError('invalid-record', 'Invalid domain table: ' + name)
        tables.set(name, new Map(Object.entries(saved).map(([key, value]) => [key, parse(table.valueSchema, value, name, key)])))
      }
      let globalValue = spec.global ? document.global == null ? structuredClone(spec.global.initial) : parse(spec.global.schema, document.global, '', '') : undefined
      let chain = Promise.resolve(), closing, closed = false, poisoned
      const assertReadable = () => { if (poisoned) throw poisoned; if (closed) throw new DomainError('closed', 'Domain is closed') }
      const enqueue = action => {
        if (poisoned) return Promise.reject(poisoned)
        if (closing) return Promise.reject(new DomainError('closed', 'Domain is closing'))
        const result = chain.then(action); chain = result.catch(() => {}); return result
      }
      const emit = change => { try { onChange({ domain: spec.name, ...change }) } catch (error) { try { onObserverError(error) } catch { /* committed state cannot be rolled back by observers */ } } }
      async function persist(change) {
        const nextTables = Object.fromEntries([...tables].map(([name, values]) => [name, Object.fromEntries(values)]))
        let nextGlobal = globalValue ?? null
        if (change.table === '') nextGlobal = change.value
        else if (change.operation === 'deleted') delete nextTables[change.table][change.key]
        else Object.defineProperty(nextTables[change.table], change.key, { value: change.value, enumerable: true, writable: true, configurable: true })
        const bytes = JSON.stringify(pathCodec?.domain(spec.name,{ unit: { name: spec.name, version: spec.version }, global: nextGlobal, tables: nextTables },false)??{ unit: { name: spec.name, version: spec.version }, global: nextGlobal, tables: nextTables }, null, 2) + '\n'
        const temporary = join(root, '.' + spec.name + '-' + randomUUID())
        let handle, renamed = false, primary
        try {
          await beforeCommit?.({ domain: spec.name, change })
          handle = await open(temporary, 'wx', 0o600); await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = undefined
          await rename(temporary, path); renamed = true; await afterRename?.({ domain: spec.name, change })
          // A committed rename must not be reported as definitely unapplied if
          // the directory fsync fails. The caller must preserve uncertainty.
          if (process.platform !== 'win32') {
            const directory = await open(root, 'r')
            let syncFailure
            try { await directory.sync() } catch (error) { syncFailure = error }
            const failure = await withCleanup(syncFailure, [() => directory.close()])
            if (failure) throw failure
          }
        } catch (error) { primary = error }
        const failure = await withCleanup(primary, [() => handle?.close(), () => unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })])
        if (failure && renamed) {
          poisoned = Object.assign(new Error('NATIVE_DOMAIN_COMMIT_UNCERTAIN', { cause: failure }), { code: 'NATIVE_DOMAIN_COMMIT_UNCERTAIN', committed: true })
          throw poisoned
        }
        if (failure) throw failure
      }
      const handles = new Map()
      const domain = {
        name: spec.name,
        get global() {
          if (!spec.global) throw new Error('Domain has no global slot')
          return globalHandle
        },
        table(name) {
          assertReadable()
          if (!tables.has(name)) throw new Error('Unknown native table: ' + name)
          if (handles.has(name)) return handles.get(name)
          const values = tables.get(name)
          const table = {
            get: key => { assertReadable(); return values.get(key) },
            entries: () => { assertReadable(); return [...values.entries()][Symbol.iterator]() },
            keys: () => { assertReadable(); return [...values.keys()][Symbol.iterator]() },
            get size() { assertReadable(); return values.size },
            put: (key, value) => enqueue(async () => {
              const change = { table: name, key, operation: 'put', value }
              await persist(change); values.set(key, value); emit(change)
            }),
            delete: key => enqueue(async () => {
              if (!values.has(key)) return false
              const change = { table: name, key, operation: 'deleted' }
              await persist(change); values.delete(key); emit(change); return true
            }),
            update: (key, fn) => enqueue(async () => {
              if (!values.has(key)) throw new DomainError('missing-key', 'Missing domain record: ' + key)
              const value = fn(values.get(key)), change = { table: name, key, operation: 'put', value }
              await persist(change); values.set(key, value); emit(change); return value
            }),
          }
          handles.set(name, table); return table
        },
        close() {
          return closing ??= (async () => { await chain; closed = true; domains.delete(spec.name); active.delete(path) })()
        },
      }
      const globalHandle = { get: () => { assertReadable(); return globalValue }, set: value => enqueue(async () => {
        const change = { table: '', key: '', operation: 'put', value }; await persist(change); globalValue = value; emit(change)
      }) }
      if (facilityClosed) { await domain.close(); throw new DomainError('closed', 'Native storage facility closed during open') }
      domains.set(spec.name, domain); return domain
    } catch (error) { active.delete(path); throw error } finally { opening.delete(spec.name) }
  }
  return { root, config: { backend: 'native-json' }, open: spec => {
      const work = openDomain(spec); flights.add(work); work.then(() => flights.delete(work), () => flights.delete(work)); return work
    }, get: name => domains.get(name),
    async closeAll() { facilityClosed = true; await Promise.allSettled([...flights]); await Promise.all([...domains.values()].map(domain => domain.close())) } }
}
