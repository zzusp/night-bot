import {deadline, timeoutOf} from './deadlines.js'
import {WebError} from '../native-capability-errors.js'

const redirectStatuses = new Set([301, 302, 303, 307, 308])

function transportError(error, signal) {
  const timeout = timeoutOf(signal, 'WEB_FETCH_TIMEOUT')
  if (timeout) return new WebError('web fetch timed out', 'WEB_FETCH_TIMEOUT', {cause: timeout})
  if (signal.aborted) return new WebError('web fetch aborted', 'WEB_ABORTED', {cause: error})
  if (error instanceof WebError) return error
  return new WebError(`web fetch failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', {cause: error})
}

// A stream supplied by a provider need not implement signal cancellation itself.
// Keep a rejection handler on the losing read and remove our listener on either outcome.
async function readWithSignal(reader, signal) {
  signal.throwIfAborted()
  let abort
  const interrupted = new Promise((_, reject) => {
    abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, {once: true})
  })
  try { return await Promise.race([reader.read(), interrupted]) }
  finally { signal.removeEventListener('abort', abort) }
}

/** Application HTTP execution owns the whole exchange, from deadline to body
 * release. The injected policy owns URL, public-address and MIME decisions;
 * transports receive only that policy's approved destinations/routes. */
export class HttpFetchExecution {
  constructor(limits, {policy, resolve, network, route}) {
    this.limits = limits
    this.policy = policy
    this.resolveAddresses = resolve
    this.network = network
    this.route = route
  }

  available() { return true }

  async fetch(request, signal) {
    if (signal?.aborted) throw new WebError('web fetch aborted', 'WEB_ABORTED', {cause: signal.reason})
    const clock = deadline(signal, this.limits.timeoutMs, 'WEB_FETCH_TIMEOUT')
    try {
      const result = await this.followAndRead(request.url, clock.signal)
      clock.signal.throwIfAborted()
      return result
    }
    catch (error) { throw transportError(error, clock.signal) }
    finally { clock[Symbol.dispose]() }
  }

  async followAndRead(initialUrl, signal) {
    let url = this.policy.validateFetchUrl(initialUrl)
    for (let hops = 0; ; hops++) {
      signal.throwIfAborted()
      const exchange = await this.requestOnce(url, signal)
      let failed = false
      try {
        signal.throwIfAborted()
        const {response} = exchange
        if (!redirectStatuses.has(response.status)) return await this.readBody(response, url, signal)
        if (hops >= this.limits.maxRedirects) {
          throw new WebError(`exceeded the maximum of ${this.limits.maxRedirects} redirects`, 'WEB_REDIRECT_BLOCKED')
        }
        const location = response.headers.get('location')
        if (location === null) throw new WebError(`redirect response (HTTP ${response.status}) without a Location header`, 'WEB_PROVIDER_ERROR')
        let target
        try { target = new URL(location, url) }
        catch (cause) { throw new WebError(`invalid redirect Location "${location}"`, 'WEB_PROVIDER_ERROR', {cause}) }
        target = this.policy.validateFetchUrl(target.toString())
        if (!this.policy.isSameOrigin(target, url)) {
          throw new WebError(`cross-origin redirect to ${target.origin} is not followed automatically; retry against that URL directly`, 'WEB_REDIRECT_BLOCKED')
        }
        url = target
      } catch (error) {
        failed = true
        throw error
      } finally {
        // Release even malformed redirects and policy failures. Failed cancel must
        // never hide the policy error or prevent closing the owned dispatcher.
        try { await exchange.response.body?.cancel() } catch {}
        try { await exchange.close() } catch (error) { if (!failed) throw error }
      }
    }
  }

  async requestOnce(url, signal) {
    const headers = {
      'user-agent': this.limits.userAgent,
      accept: 'text/html,application/xhtml+xml,text/*;q=0.9,application/json;q=0.8'
    }
    try {
      signal.throwIfAborted()
      const route = this.route(url)
      if (route.proxied && !this.policy.isNonPublicIpLiteral(url.hostname)) {
        return await this.network.requestVia(route.dispatcher, url, headers, signal)
      }
      const addresses = await this.resolveAddresses(url.hostname, signal)
      signal.throwIfAborted()
      return await this.network.request(url, addresses, headers, signal)
    } catch (error) { throw transportError(error, signal) }
  }

  async readBody(response, finalUrl, signal) {
    const contentType = response.headers.get('content-type')
    const kind = this.policy.classifyContentType(contentType)
    if (kind === undefined) throw new WebError(`unsupported content type "${contentType ?? 'unknown'}"`, 'WEB_UNSUPPORTED_CONTENT_TYPE')
    const decoder = this.policy.decoderForCharset(this.policy.parseCharset(contentType))
    const {bytes, truncatedByBytes} = await this.readCapped(response, signal)
    const decoded = decoder.decode(bytes)
    return {
      url: finalUrl.toString(),
      statusCode: response.status,
      body: {kind, content: decoded.slice(0, this.limits.maxBodyChars)},
      truncated: truncatedByBytes || decoded.length > this.limits.maxBodyChars
    }
  }

  async readCapped(response, signal) {
    const declared = response.headers.get('content-length')
    if (declared !== null && Number(declared) > this.limits.maxResponseBytes && Number.isFinite(Number(declared))) {
      throw new WebError(`response exceeds the maximum of ${this.limits.maxResponseBytes} bytes`, 'WEB_FETCH_TOO_LARGE')
    }
    if (!response.body) return {bytes: new Uint8Array(), truncatedByBytes: false}
    const reader = response.body.getReader()
    const chunks = []
    let length = 0
    let truncatedByBytes = false
    try {
      for (;;) {
        const {done, value} = await readWithSignal(reader, signal)
        if (done) break
        const remaining = this.limits.maxResponseBytes - length
        const part = value.byteLength > remaining ? value.subarray(0, remaining) : value
        // Detach retained bytes: a producer can reuse or mutate its backing buffer.
        if (part.byteLength > 0) chunks.push(part.slice())
        length += part.byteLength
        if (value.byteLength > remaining) { truncatedByBytes = true; break }
      }
    } catch (error) { throw transportError(error, signal) }
    finally {
      try { await reader.cancel() } catch {}
      reader.releaseLock()
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength }
    return {bytes, truncatedByBytes}
  }
}
