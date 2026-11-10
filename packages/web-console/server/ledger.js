import {DatabaseSync} from 'node:sqlite'
import {lstat} from 'node:fs/promises'
import {join} from 'node:path'
import {digest, fail} from './security.js'

export async function openWebLedger(directory, scope) {
  const file = join(directory, 'delivery.sqlite')
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const stat = await lstat(file + suffix).catch(error => {if (error.code !== 'ENOENT') throw error})
    if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)) fail('WEB_LEDGER_PATH_UNSAFE')
  }
  const db = new DatabaseSync(file)
  try {
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, conversation TEXT NOT NULL, group_id TEXT NOT NULL, payload TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS request_conversation ON requests(conversation,created_at);
    CREATE TABLE IF NOT EXISTS replies (id TEXT PRIMARY KEY, conversation TEXT NOT NULL, payload TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL, message_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS web_conversation (scope TEXT PRIMARY KEY, conversation TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS reply_conversation ON replies(conversation,created_at); CREATE INDEX IF NOT EXISTS reply_message ON replies(conversation,message_id);`)
    // 接纳期间退出既不能证明拒绝，也不能授权重新提交。
    db.prepare("UPDATE requests SET status='unknown' WHERE status='pending'").run()
  } catch (error) {db.close(); throw error}
  // Pin once under SQLite's write lock. Existing histories remain separate and untouched.
  const canonical = candidate => {
    if (!scope) return undefined
    const key = JSON.stringify([scope.channelId, scope.senderId])
    db.exec('BEGIN IMMEDIATE')
    try {
      let id = db.prepare('SELECT conversation FROM web_conversation WHERE scope=?').get(key)?.conversation
      if (!id) {
        const first = db.prepare("SELECT conversation FROM requests WHERE json_extract(payload, '$[3]')=? AND json_extract(payload, '$[4]')=? ORDER BY created_at,rowid LIMIT 1").get(scope.senderId, scope.channelId)
        id = first?.conversation ?? candidate ?? ('web-' + digest(key).slice(0, 32))
        db.prepare('INSERT INTO web_conversation VALUES (?,?)').run(key, id)
      }
      db.exec('COMMIT')
      return id
    } catch (error) {db.exec('ROLLBACK'); throw error}
  }
  const request = id => {
    const row = db.prepare('SELECT * FROM requests WHERE id=?').get(id)
    return row && {requestId: row.id, conversationId: row.conversation, groupId: row.group_id, status: row.status}
  }
  const messages = conversation => [
    ...db.prepare('SELECT rowid AS sequence,* FROM requests WHERE conversation=? ORDER BY created_at DESC,rowid DESC LIMIT 501').all(conversation).map(row => ({sequence: row.sequence, id: row.id, requestId: row.id, role: 'user', text: row.text, createdAt: row.created_at, status: row.status})),
    ...db.prepare('SELECT rowid AS sequence,* FROM replies WHERE conversation=? ORDER BY created_at DESC,rowid DESC LIMIT 501').all(conversation).map(row => ({sequence: row.sequence, id: row.message_id, role: 'assistant', text: row.text, createdAt: row.created_at, status: 'delivered'})),
  // 相同时间先显示用户消息，再显示回复；各表内保留真实插入顺序，不把随机 ID 当作时间。
  ].sort((left, right) => left.createdAt.localeCompare(right.createdAt)
    || (left.role === right.role ? left.sequence - right.sequence : left.role === 'user' ? -1 : 1))
    .map(({sequence, ...message}) => message)
  return {
    canonical,
    selected(conversationId, messageId) {
      const user=db.prepare('SELECT id,text FROM requests WHERE conversation=? AND id=?').get(conversationId,messageId)
      const replies=db.prepare('SELECT id FROM replies WHERE conversation=? AND message_id=? LIMIT 2').all(conversationId,messageId)
      if((user?1:0)+replies.length!==1)return null
      return user?{role:'user',messageId:user.id,messageVersion:1,text:user.text}:{role:'assistant',notificationId:replies[0].id}
    },
    hasChat: conversationId => !!db.prepare('SELECT 1 FROM requests WHERE conversation=? LIMIT 1').get(conversationId),
    reserve({requestId, conversationId, groupId, text, senderId, channelId}) {
      const payload = JSON.stringify([conversationId, groupId, text, senderId, channelId])
      const old = db.prepare('SELECT payload FROM requests WHERE id=?').get(requestId)
      if (old) {
        if (old.payload !== payload) fail('CHAT_REQUEST_CONFLICT', 409)
        return {...request(requestId), duplicate: true}
      }
      if (scope && (channelId !== scope.channelId || senderId !== scope.senderId || canonical(conversationId) !== conversationId)) fail('WEB_CHAT_SINGLETON', 409)
      db.prepare('INSERT INTO requests VALUES (?,?,?,?,?,?,?)').run(requestId, conversationId, groupId, payload, text, 'pending', new Date().toISOString())
      return {...request(requestId), duplicate: false}
    },
    settle(requestId, status) {
      db.prepare('UPDATE requests SET status=? WHERE id=?').run(status, requestId)
      return request(requestId)
    },
    request,
    chats({offset = 0, limit = 30} = {}) {
      const total = db.prepare('SELECT COUNT(DISTINCT conversation) AS n FROM requests').get().n
      const rows = db.prepare('SELECT conversation,MAX(created_at) AS updated_at FROM (SELECT conversation,created_at FROM requests UNION ALL SELECT conversation,created_at FROM replies) GROUP BY conversation ORDER BY updated_at DESC,conversation LIMIT ? OFFSET ?').all(limit, offset)
      const items = rows.map(row => {
        const first = db.prepare('SELECT text FROM requests WHERE conversation=? ORDER BY rowid LIMIT 1').get(row.conversation)
        const latest = db.prepare('SELECT status FROM requests WHERE conversation=? ORDER BY rowid DESC LIMIT 1').get(row.conversation)
        return {id: row.conversation, title: first.text.slice(0, 80), updatedAt: row.updated_at, status: latest.status === 'accepted' ? 'ready' : latest.status}
      }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      return {items, total, nextOffset: offset + items.length < total ? offset + items.length : null}
    },
    chat(conversationId) {
      const total = db.prepare('SELECT COUNT(*) AS n FROM requests WHERE conversation=?').get(conversationId).n
      const canonicalConversationId = scope ? canonical() : undefined
      if (!total) return conversationId === canonicalConversationId ? {conversationId, canonicalConversationId, messages: [], status: 'ready', truncated: false} : null
      const rows = messages(conversationId)
      const latest = db.prepare('SELECT status FROM requests WHERE conversation=? ORDER BY rowid DESC LIMIT 1').get(conversationId)
      return {conversationId, ...(scope ? {canonicalConversationId} : {}), messages: rows.slice(-500), truncated: rows.length > 500, status: latest.status === 'accepted' ? 'ready' : latest.status}
    },
    transport(channelId, senderId) {
      const validate = envelope => {
        if (envelope.type !== 'chat' || envelope.channelId !== channelId || envelope.senderId !== senderId
          || typeof envelope.deliveryKey !== 'string' || typeof envelope.text !== 'string'
          || !db.prepare("SELECT id FROM requests WHERE conversation=? AND json_extract(payload, '$[3]')=? AND json_extract(payload, '$[4]')=? LIMIT 1").get(envelope.conversationId, senderId, channelId)) fail('WEB_DELIVERY_SCOPE_INVALID', 403)
      }
      const payload = envelope => JSON.stringify([envelope.channelId, envelope.conversationId, envelope.senderId, envelope.text, envelope.replyToMessageId ?? null])
      const readback = envelope => {
        validate(envelope)
        const row = db.prepare('SELECT * FROM replies WHERE id=?').get(envelope.deliveryKey)
        if (!row) return undefined
        if (row.payload !== payload(envelope)) fail('WEB_DELIVERY_CONFLICT', 409)
        return {messageId: row.message_id, conversationId: row.conversation, status: 'delivered', visible: true, observedAt: row.created_at}
      }
      return {
        capabilities: {conversationTypes: ['chat'], quotedReplies: ['chat'], files: []},
        async send(envelope) {
          validate(envelope)
          const prior = readback(envelope)
          if (prior) return prior
          const messageId = 'web-reply-' + digest(envelope.deliveryKey).slice(0, 32)
          db.prepare('INSERT INTO replies VALUES (?,?,?,?,?,?)').run(envelope.deliveryKey, envelope.conversationId, payload(envelope), envelope.text, new Date().toISOString(), messageId)
          return readback(envelope)
        },
        readback,
        async readMessage(envelope) {
          if (envelope.type !== 'chat' || envelope.channelId !== channelId) fail('WEB_DELIVERY_SCOPE_INVALID', 403)
          const row = db.prepare("SELECT * FROM requests WHERE id=? AND conversation=? AND json_extract(payload, '$[3]')=? AND json_extract(payload, '$[4]')=?").get(envelope.messageId, envelope.conversationId, senderId, channelId)
          if (!row) fail('WEB_MESSAGE_NOT_FOUND', 404)
          return {messageId: row.id, conversationId: row.conversation, senderId, text: row.text, occurredAt: row.created_at}
        },
      }
    },
    close() {db.close()},
  }
}
