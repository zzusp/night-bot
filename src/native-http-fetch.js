// MIT source-derived public-address/DNS/NAT64 and pinned HTTP transport; see licenses/dsh-web-fetch-http-MIT.txt.
import z from "@deepseek-ai/schemastery";
import { WebError } from "./native-web.js";
import { HttpFetchExecution } from "./runtime/http-fetch.js";
import {validateFetchUrl,isSameOrigin,classifyContentType,parseCharset,decoderForCharset} from "./runtime/http-content-policy.js";
import { proxyRouteFor } from "./native-http-proxy.js";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
//#region lib/types/network.js
/**
* Public-network resolution and address-pinned HTTP transport for `web-fetch-http`.
* One DNS answer set is validated before Undici receives it through a custom lookup,
* so the connection cannot resolve the hostname again to a private address.
*
* @module @deepseek-ai/dsh-web-fetch-http/network
*/
/** RFC 6052 prefix lengths that may carry an IPv4 destination through NAT64. */
const RFC6052_PREFIX_LENGTHS = [
	32,
	40,
	48,
	56,
	64,
	96
];
const IPV4ONLY_DISCOVERY_HOST = "ipv4only.arpa";
const IPV4ONLY_SENTINELS = new Set(["192.0.0.170", "192.0.0.171"]);
/**
* Return whether an address is globally reachable unicast. IPv4-mapped IPv6 is
* classified by its embedded IPv4 address; transition and translation prefixes
* remain blocked because their eventual IPv4 destination cannot be pinned here.
*
* @param input - textual IPv4 or IPv6 address.
* @returns true only for a public unicast destination.
*/
function isPublicIpAddress(input) {
	let parsed;
	try {
		parsed = ipaddr.parse(stripIpv6Brackets(input));
	} catch {
		return false;
	}
	if (parsed instanceof ipaddr.IPv4) return parsed.range() === "unicast";
	if (parsed.isIPv4MappedAddress()) return parsed.toIPv4Address().range() === "unicast";
	return parsed.range() === "unicast";
}
/**
* Resolve a hostname once and reject the complete answer set if any destination
* is not public. The returned addresses are the only ones the transport may use.
*
* @param hostname - URL hostname, including brackets when it is an IPv6 literal.
* @param signal - aborts the wait for system resolution; an in-flight OS lookup may finish unused.
* @param resolver - lookup implementation, overridden only by focused tests.
* @returns the validated, non-empty address set.
*/
async function resolvePublicAddresses(hostname, signal, resolver = lookup) {
	const unbracketed = stripIpv6Brackets(hostname);
	const literalFamily = isIP(unbracketed);
	const resolved = literalFamily === 0 ? await raceWithSignal(resolver(unbracketed, {
		all: true,
		order: "verbatim"
	}), signal) : [{
		address: unbracketed,
		family: literalFamily
	}];
	if (resolved.length === 0) throw new WebError(`hostname "${hostname}" resolved to no addresses`, "WEB_PROVIDER_ERROR");
	const nat64Prefixes = resolved.some((entry) => entry.family === 6 && isIP(entry.address) === 6) ? await discoverNat64Prefixes(signal, resolver) : [];
	const addresses = [];
	for (const entry of resolved) {
		if (entry.family !== 4 && entry.family !== 6 || isIP(entry.address) !== entry.family) throw new WebError(`hostname "${hostname}" resolved to an invalid IP address`, "WEB_PROVIDER_ERROR");
		if (!isPublicIpAddress(entry.address)) throw new WebError(`URL hostname "${hostname}" resolves to a non-public IP address`, "WEB_BLOCKED_URL");
		const translatedIpv4 = translatedIpv4Address(entry.address, nat64Prefixes);
		if (translatedIpv4 !== void 0 && !isPublicIpAddress(translatedIpv4)) throw new WebError(`URL hostname "${hostname}" resolves through NAT64 to a non-public IPv4 address`, "WEB_BLOCKED_URL");
		addresses.push({
			address: entry.address,
			family: entry.family
		});
	}
	return addresses;
}
/** Discover the active DNS64 prefix set using RFC 7050's reserved hostname. */
async function discoverNat64Prefixes(signal, resolver) {
	const discovered = await raceWithSignal(resolver(IPV4ONLY_DISCOVERY_HOST, {
		all: true,
		order: "verbatim"
	}), signal);
	const prefixes = [];
	const seen = /* @__PURE__ */ new Set();
	for (const entry of discovered) {
		if (entry.family !== 6 || isIP(entry.address) !== 6) continue;
		const bytes = ipaddr.parse(entry.address).toByteArray();
		for (const length of RFC6052_PREFIX_LENGTHS) {
			const embedded = embeddedIpv4Address(bytes, length);
			if (embedded === void 0 || !IPV4ONLY_SENTINELS.has(embedded)) continue;
			const prefixBytes = bytes.slice(0, length / 8);
			const key = `${String(length)}:${prefixBytes.join(".")}`;
			if (seen.has(key)) continue;
			seen.add(key);
			prefixes.push({
				bytes: prefixBytes,
				length
			});
		}
	}
	return prefixes;
}
/** Return the RFC 6052-embedded IPv4 address when an IPv6 address matches a discovered prefix. */
function translatedIpv4Address(input, prefixes) {
	if (isIP(input) !== 6) return void 0;
	const bytes = ipaddr.parse(input).toByteArray();
	for (const prefix of prefixes) {
		if (!prefix.bytes.every((byte, index) => bytes[index] === byte)) continue;
		const embedded = embeddedIpv4Address(bytes, prefix.length);
		if (embedded !== void 0) return embedded;
	}
}
/** Extract one IPv4 address from an RFC 6052 IPv6 layout. */
function embeddedIpv4Address(bytes, prefixLength) {
	if (prefixLength === 96) return bytes.slice(12, 16).join(".");
	if (bytes[8] !== 0) return void 0;
	const prefixBytes = prefixLength / 8;
	const beforeReservedOctet = 8 - prefixBytes;
	return [...bytes.slice(prefixBytes, prefixBytes + beforeReservedOctet), ...bytes.slice(9, 13 - beforeReservedOctet)].join(".");
}
/**
* Whether a hostname is an IP literal that {@link resolvePublicAddresses} would refuse.
*
* A proxied hop skips those checks because the proxy resolves the origin, but a literal needs no
* resolution: the address is already stated, and handing it to a proxy running on this machine
* would reach exactly the loopback or private service the checks exist to keep out of reach.
*
* @param hostname - a URL's hostname, bracketed or not.
* @returns true when the host is a literal address no request may be sent to.
*/
function isNonPublicIpLiteral(hostname) {
	const unbracketed = stripIpv6Brackets(hostname);
	return isIP(unbracketed) !== 0 && !isPublicIpAddress(unbracketed);
}
/**
* Fetch through an agent whose lookup callback returns only the already validated address set. The
* URL hostname remains intact for HTTP Host and TLS SNI.
*
* The agent is this request's own because the address set is: pinning is how this package refuses a
* DNS answer that changes between validation and connection, and it may not apply process-wide —
* an operator-configured MCP server or model endpoint on loopback is a supported destination, and
* only the URLs this tool fetches are the model's to choose.
*
* @param url - validated HTTP(S) URL the policy does not route through a proxy.
* @param addresses - public addresses returned by {@link resolvePublicAddresses}.
* @param headers - request headers.
* @param signal - request and body-read cancellation signal.
* @returns a response plus the disposer its consumer must call.
*/
async function requestPinned(url, addresses, headers, signal) {
	const { Agent, fetch } = await import("undici");
	const dispatcher = new Agent({
		autoSelectFamily: true,
		connect: { lookup: createPinnedLookup(addresses) }
	});
	try {
		return {
			response: await fetch(url, {
				method: "GET",
				redirect: "manual",
				headers,
				signal,
				dispatcher
			}),
			close: async () => {
				await dispatcher.close();
			}
		};
	} catch (error) {
		await dispatcher.close();
		throw error;
	}
}
/**
* Fetch through the dispatcher the proxy policy already installed, letting the proxy resolve the
* origin.
*
* No address set is pinned because none exists to pin: the proxy performs the lookup, and a
* connection pinned to a locally resolved address would reach the origin directly and defeat the
* proxy. The dispatcher is the process-wide one, so hops share its connection pool and no caller
* closes it.
*
* @param dispatcher - the route's dispatcher, from `proxyRouteFor`.
* @param url - validated HTTP(S) URL the policy routes through a proxy.
* @param headers - request headers.
* @param signal - request and body-read cancellation signal.
* @returns a response plus a disposer that releases nothing, so both paths close alike.
*/
async function requestVia(dispatcher, url, headers, signal) {
	const { fetch } = await import("undici");
	return {
		response: await fetch(url, {
			method: "GET",
			redirect: "manual",
			headers,
			signal,
			dispatcher
		}),
		close: () => Promise.resolve()
	};
}
/** Production network operations kept as an object so provider tests can replace resolution only. */
const publicHttpNetwork = Object.freeze({
	resolve: resolvePublicAddresses,
	request: requestPinned,
	requestVia
});
/**
* Build the connector lookup that serves a fixed validated answer set.
*
* @param addresses - public addresses retained from the preceding resolution.
* @returns a Node-compatible lookup callback that performs no network resolution.
*/
function createPinnedLookup(addresses) {
	return (hostname, options, callback) => {
		const family = typeof options.family === "number" ? options.family : options.family === "IPv4" ? 4 : options.family === "IPv6" ? 6 : 0;
		const eligible = family === 0 ? addresses : addresses.filter((address) => address.family === family);
		const selected = eligible[0];
		if (selected === void 0) {
			callback(Object.assign(/* @__PURE__ */ new Error(`no validated address for ${hostname} in family ${family}`), {
				code: "ENOTFOUND",
				hostname
			}), options.all === true ? [] : "", family);
			return;
		}
		if (options.all === true) {
			callback(null, eligible.map((address) => ({ ...address })));
			return;
		}
		callback(null, selected.address, selected.family);
	};
}
/** Race a non-cancellable OS lookup without letting it delay tool cancellation. */
function raceWithSignal(promise, signal) {
	const abortError = () => new Error("web fetch aborted during hostname resolution", { cause: signal.reason });
	if (signal.aborted) return Promise.reject(abortError());
	return new Promise((resolve, reject) => {
		const abort = () => {
			reject(abortError());
		};
		signal.addEventListener("abort", abort, { once: true });
		promise.then(resolve, reject).finally(() => {
			signal.removeEventListener("abort", abort);
		});
	});
}
/** WHATWG URL retains brackets around IPv6 hostnames; IP parsers do not. */
function stripIpv6Brackets(hostname) {
	return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}
//#endregion
const LOCAL_FETCH_PROVIDER_ID = "http";
class NativeHttpFetchProvider extends HttpFetchExecution {
 id = LOCAL_FETCH_PROVIDER_ID;
 constructor(limits, resolveAddresses = publicHttpNetwork.resolve, network = publicHttpNetwork, route = proxyRouteFor) {
  super(limits, {
   policy: {validateFetchUrl, isSameOrigin, classifyContentType, parseCharset, decoderForCharset, isNonPublicIpLiteral},
   resolve: resolveAddresses, network, route
  });
 }
}
//#endregion
//#region lib/types/index.js
/**
* Anonymous public HTTP(S) `WebFetchProvider` plugin. It contributes to the
* `ctx.web` registry without owning the service.
*
* @module @deepseek-ai/dsh-web-fetch-http
*/
const MAX_NODE_TIMER_DELAY_MS = 2147483647;
/** Default `User-Agent`: an explicit product agent, never a browser disguise. */
const DEFAULT_USER_AGENT = "night-bot/0.1.0";
/** Cordis plugin name used by loader diagnostics. */
const name = "night-native-http-fetch";
/** The web seam this provider registers into. */
const inject = ["web"];
const Config = z.object({
	maxResponseBytes: z.number().default(5e6),
	maxBodyChars: z.number().default(1e5),
	timeoutMs: z.number().default(3e4),
	maxRedirects: z.number().default(5),
	userAgent: z.string().default(DEFAULT_USER_AGENT)
});
/** A resource limit (byte/char/length/timeout cap) must be a positive finite number. */
function assertPositiveFinite(name, value) {
	if (!Number.isFinite(value) || value <= 0) throw new Error(`web-fetch-http: ${name} must be a positive finite number`);
}
/** Node coerces larger timer delays to 1 ms, so reject them at configuration time. */
function assertTimeoutMs(value) {
	assertPositiveFinite("timeoutMs", value);
	if (value > MAX_NODE_TIMER_DELAY_MS) throw new Error(`web-fetch-http: timeoutMs must be no greater than ${MAX_NODE_TIMER_DELAY_MS}`);
}
/** The redirect hop cap must be a non-negative integer (0 follows no redirects). */
function assertNonNegativeInteger(name, value) {
	if (!Number.isInteger(value) || value < 0) throw new Error(`web-fetch-http: ${name} must be a non-negative integer`);
}
/** Register the local HTTP(S) fetch provider with `ctx.web`. */
function apply(ctx, config) {
	const resolved = config;
	assertPositiveFinite("maxResponseBytes", resolved.maxResponseBytes);
	assertPositiveFinite("maxBodyChars", resolved.maxBodyChars);
	assertTimeoutMs(resolved.timeoutMs);
	assertNonNegativeInteger("maxRedirects", resolved.maxRedirects);
	const limits = {
		maxResponseBytes: resolved.maxResponseBytes,
		maxBodyChars: resolved.maxBodyChars,
		timeoutMs: resolved.timeoutMs,
		maxRedirects: resolved.maxRedirects,
		userAgent: resolved.userAgent
	};
	const provider=new NativeHttpFetchProvider(limits);
	ctx.web.registerFetchProvider(provider);
	ctx.provide("nativeHttpFetch",Object.freeze({owner:name,provider}));
}
//#endregion
export { Config, DEFAULT_USER_AGENT, NativeHttpFetchProvider, NativeHttpFetchProvider as HttpFetchProvider, LOCAL_FETCH_PROVIDER_ID, apply, inject, name };
export const httpPolicy=Object.freeze({isPublicIpAddress,resolvePublicAddresses,createPinnedLookup,validateFetchUrl,isSameOrigin,classifyContentType,parseCharset,translatedIpv4Address,embeddedIpv4Address});

// Low-level transport accepts an already validated pin set; public provider policy remains above it.
export const httpTransport=Object.freeze({requestPinned,requestVia});
