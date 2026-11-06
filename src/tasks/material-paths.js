import {basename, dirname, isAbsolute, join, resolve} from 'node:path'

const fail = () => { throw Object.assign(new Error('TASK_MATERIAL_PATH_BINDING_INVALID'), {code:'TASK_MATERIAL_PATH_BINDING_INVALID'}) }
const leaf = value => typeof value === 'string' && value !== '.' && value !== '..' && basename(value) === value && !/[\\/\0]/.test(value)
// Only Host-owned material filenames are relocatable. Source text, resource
// identities, provider messages, authorization and effect evidence stay opaque.
export function bindTaskMaterialPaths(material, materialsDirectory) {
  if (!material || typeof material.path !== 'string' || !Array.isArray(material.resources)) fail()
  const origin = resolve(materialsDirectory)
  const fields = {path:basename(material.path)}
  if (dirname(material.path) !== origin || !/^source-[a-f0-9]{32}\.json$/.test(fields.path)) fail()
  for (const [index, resource] of (material.resources ?? []).entries()) {
    if (!resource || typeof resource !== 'object') fail()
    if (resource.status !== 'read') continue
    if (typeof resource.path !== 'string') fail()
    if (dirname(resource.path) !== origin || !/^resource-[a-f0-9]{16}-[a-f0-9]{16}\.(txt|png|jpg|webp|gif|bin)$/.test(basename(resource.path))) fail()
    fields[`resources.${index}.path`] = basename(resource.path)
    if (resource.value?.image) {
      if (resource.value.image.path !== resource.path) fail()
      fields[`resources.${index}.value.image.path`] = basename(resource.path)
    }
  }
  return {...material, pathBindings:{version:1,kind:'task-material-relative',origin,fields}}
}
export function resolveTaskMaterialPaths(material, materialsDirectory, target) {
  if (!material || !material.pathBindings) return material // historical packets stay root-bound
  const {version,kind,origin,fields,...extra} = material.pathBindings
  if (version !== 1 || kind !== 'task-material-relative' || typeof origin !== 'string' || !isAbsolute(origin) || resolve(origin) !== origin || Object.keys(extra).length || !fields || typeof fields !== 'object' || Array.isArray(fields)) fail()
  // Reconstruct the exact allowlist from the packet; reject extra/missing fields
  // and mismatched raw evidence before deriving any destination paths.
  const expected = bindTaskMaterialPaths({...material,pathBindings:undefined}, origin).pathBindings.fields
  if (JSON.stringify(Object.entries(fields).sort()) !== JSON.stringify(Object.entries(expected).sort())) fail()
  if (!leaf(fields.path) || join(resolve(materialsDirectory), fields.path) !== target) fail()
  const copy = structuredClone(material)
  for (const [field,name] of Object.entries(fields)) {
    if (!leaf(name)) fail()
    const keys = field.split('.'); let entry = copy
    for (const key of keys.slice(0,-1)) entry = entry[key]
    if (entry[keys.at(-1)] !== join(origin,name)) fail()
    entry[keys.at(-1)] = join(resolve(materialsDirectory),name)
  }
  return copy
}
