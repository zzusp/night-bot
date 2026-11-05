import {snapshotJsonValue, assertNever} from '../native-values.js'

const label = path => path === '' ? 'arguments' : path
const property = (path, key) => path === '' ? key : `${path}.${key}`
const own = (value, key) => Object.hasOwn(value, key)

// The application's observedAt contract is a timezone-explicit timestamp that
// its evidence gate can parse to a finite instant. Check the calendar ourselves:
// Date.parse alone normalizes impossible dates (for example February 30).
// Leap seconds are excluded because the evidence gate cannot represent them.
function isDateTime(value) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/.exec(value)
  if (!parts) return false
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHourText, offsetMinuteText] = parts
  const year = Number(yearText), month = Number(monthText), day = Number(dayText)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && Number(hourText) <= 23 && Number(minuteText) <= 59 && Number(secondText) <= 59
    && (offsetHourText === undefined || Number(offsetHourText) <= 23 && Number(offsetMinuteText) <= 59)
    && Number.isFinite(Date.parse(value))
}

// JSON Schema uniqueItems compares JSON data, including objects regardless of key
// insertion order. This token stream remains stack-safe for deep tool values.
function equalityKey(value) {
  const chunks = [], tasks = [{value}]
  while (tasks.length) {
    const task = tasks.pop()
    if (own(task, 'text')) { chunks.push(task.text); continue }
    const current = task.value
    if (current === null || typeof current !== 'object') { chunks.push(JSON.stringify(current)); continue }
    const array = Array.isArray(current), keys = array ? null : Object.keys(current).sort()
    chunks.push(array ? '[' : '{'); tasks.push({text:array ? ']' : '}'})
    for (let i = (array ? current.length : keys.length) - 1; i >= 0; i--) {
      if (i < (array ? current.length : keys.length) - 1) tasks.push({text:','})
      const key = array ? i : keys[i]
      tasks.push({value:current[key]})
      if (!array) tasks.push({text:JSON.stringify(key)+':'})
    }
  }
  return chunks.join('')
}

/**
 * Validate one captured JSON value with an explicit work stack. Capture precedes
 * schema evaluation, so getters are read once and cannot change a branch's input.
 * Every container is captured once, including unconstrained/open properties;
 * schema traversal never rescans a subtree merely to prove it is JSON.
 *
 * This is the application tool contract, shared by native and code RPC calls.
 * The caller owns supported-schema admission; this evaluator never runs code.
 */
export function validateToolSchemaValue(schema, input, path = 'value') {
  let value
  try { value = snapshotJsonValue(input) } catch { /* hostile data is not a tool value */ }
  if (value === undefined) return [`"${label(path)}" must be a lossless JSON value`]
  const errors = []
  const tasks = [{kind: 'visit', schema, value, path, errors}]
  while (tasks.length) {
    const task = tasks.pop()
    if (task.kind === 'union') {
      const matched = task.branches.reduce((count, errors) => count + (errors.length === 0 ? 1 : 0), 0)
      if (matched !== 1) task.errors.push(`"${label(task.path)}" must match exactly one oneOf branch (matched ${matched})`)
      continue
    }
    if (task.kind === 'extras') {
      for (const key of Object.keys(task.value)) if (!own(task.properties, key)) task.errors.push(`"${property(task.path, key)}" is not a declared property (additionalProperties: false)`)
      continue
    }
    const {schema: node, value: current, path: at, errors: out} = task
    const fail = expected => out.push(`"${label(at)}" must be ${expected}`)
    if (own(node, 'oneOf')) {
      const branches = node.oneOf.map(() => [])
      tasks.push({kind: 'union', branches, path: at, errors: out})
      for (let i = node.oneOf.length - 1; i >= 0; i--) tasks.push({kind: 'visit', schema: node.oneOf[i], value: current, path: at, errors: branches[i]})
      continue
    }
    if (!own(node, 'type')) {
      if (own(node, 'enum') && !node.enum.some(item => equalityKey(item) === equalityKey(current))) fail(`one of ${JSON.stringify(node.enum)}`)
      else if (own(node, 'const') && equalityKey(current) !== equalityKey(node.const)) fail(JSON.stringify(node.const))
      continue
    }
    switch (node.type) {
      case 'object': {
        if (current === null || typeof current !== 'object' || Array.isArray(current)) { fail('an object'); break }
        const properties = own(node, 'properties') ? node.properties : {}
        for (const key of own(node, 'required') ? node.required : []) if (!own(current, key)) out.push(`missing required property "${property(at, key)}"`)
        if (node.additionalProperties === false) tasks.push({kind: 'extras', value: current, properties, path: at, errors: out})
        const entries = Object.entries(properties)
        for (let i = entries.length - 1; i >= 0; i--) {
          const [key, child] = entries[i]
          if (own(current, key)) tasks.push({kind: 'visit', schema: child, value: current[key], path: property(at, key), errors: out})
        }
        break
      }
      case 'array':
        if (!Array.isArray(current)) { fail('an array'); break }
        if (own(node, 'minItems') && current.length < node.minItems) fail(`an array with at least ${node.minItems} items`)
        if (own(node, 'maxItems') && current.length > node.maxItems) fail(`an array with at most ${node.maxItems} items`)
        if (node.uniqueItems === true) {
          const seen = new Set()
          for (const item of current) { const key = equalityKey(item); if (seen.has(key)) { fail('an array with unique items'); break } seen.add(key) }
        }
        if (own(node, 'items')) for (let i = current.length - 1; i >= 0; i--) tasks.push({kind: 'visit', schema: node.items, value: current[i], path: `${at}[${i}]`, errors: out})
        break
      case 'string': case 'number': case 'integer': case 'boolean': case 'null': {
        const valid = node.type === 'null' ? current === null : node.type === 'integer' ? Number.isInteger(current) : typeof current === node.type
        if (!valid) { fail(node.type === 'null' ? 'null' : `a${node.type === 'integer' ? 'n' : ''} ${node.type}`); break }
        if (node.type === 'number' || node.type === 'integer') {
          if (own(node, 'minimum') && current < node.minimum) fail(`at least ${node.minimum}`)
          if (own(node, 'maximum') && current > node.maximum) fail(`at most ${node.maximum}`)
        }
        if (node.type === 'string') {
          // JSON Schema lengths count Unicode code points, not UTF-16 units.
          let length = 0; for (const _ of current) length++
          if (own(node, 'minLength') && length < node.minLength) fail(`a string with at least ${node.minLength} characters`)
          if (own(node, 'maxLength') && length > node.maxLength) fail(`a string with at most ${node.maxLength} characters`)
          if (own(node, 'pattern') && !new RegExp(node.pattern, 'u').test(current)) fail(`a string matching ${JSON.stringify(node.pattern)}`)
          if (node.format === 'date-time' && !isDateTime(current)) fail('a valid date-time with an explicit timezone')
        }
        if (own(node, 'enum') && !node.enum.includes(current)) fail(`one of ${JSON.stringify(node.enum)}`)
        else if (own(node, 'const') && current !== node.const) fail(JSON.stringify(node.const))
        break
      }
      default: assertNever(node.type, 'JsonSchemaType')
    }
  }
  return errors
}
