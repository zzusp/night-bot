import test from 'node:test'
import assert from 'node:assert/strict'
import {startPreview, FIXTURE_TOKEN} from './preview.mjs'

test('generic add HTTP saves declared plugin fields with create-only, auth, CSRF and runtime boundaries', async t => {
  const fixture = await startPreview({port: 0})
  t.after(() => fixture.close())
  const origin = fixture.origin
  const read = async (path, options = {}) => {
    const response = await fetch(origin + path, options)
    return {status: response.status, body: await response.json(), headers: response.headers}
  }
  assert.equal((await read('/api/settings/channels')).status, 401)
  const login = await read('/api/login', {method: 'POST', headers: {origin, 'content-type': 'application/json'}, body: JSON.stringify({token: FIXTURE_TOKEN})})
  assert.equal(login.status, 200)
  const headers = {origin, 'content-type': 'application/json', cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': login.body.csrfToken}
  let catalog = await read('/api/settings/channels', {headers})
  const plugin = catalog.body.items.find(row => row.type === 'fixture-custom')
  assert.equal(plugin.configurable, true)
  assert.equal(plugin.fields.find(row => row.name === 'credential').type, 'credential-ref')
  const body = {type: plugin.type, channelId: 'api-created-custom', enabled: false, config: {room: 'api-target', credential: 'FIXTURE_CUSTOM_KEY', listen: false}, createOnly: true, expectedVersion: catalog.body.version}
  const save = input => read('/api/settings/channels', {method: 'POST', headers, body: JSON.stringify(input)})
  assert.equal((await read('/api/settings/channels', {method: 'POST', headers: {...headers, 'x-csrf-token': ''}, body: JSON.stringify(body)})).status, 403)
  assert.deepEqual((await save(body)).body, {ok: true, restartRequired: true})
  catalog = await read('/api/settings/channels', {headers})
  const saved = catalog.body.channels.find(row => row.channelId === body.channelId)
  assert.deepEqual(saved.config, body.config)
  assert.equal(saved.enabled, false)
  assert.equal(saved.editable, true)
  assert.equal(JSON.stringify(saved).includes('dingtalk'), false)
  const duplicate = await save({...body, config: {...body.config, room: 'must-not-overwrite'}, expectedVersion: catalog.body.version})
  assert.equal(duplicate.status, 409)
  assert.equal(duplicate.body.error, 'CHANNEL_INSTANCE_EXISTS')
  const unchanged = await read('/api/settings/channels', {headers})
  assert.deepEqual(unchanged.body, catalog.body)
  assert.equal((await save({...body, createOnly: false, enabled: true, expectedVersion: catalog.body.version})).status, 200)
  catalog = await read('/api/settings/channels', {headers})
  const blocked = await save({...body, createOnly: false, expectedVersion: catalog.body.version})
  assert.equal(blocked.status, 409)
  assert.equal(blocked.body.error, 'CHANNEL_EDIT_REQUIRES_STOP')
})
