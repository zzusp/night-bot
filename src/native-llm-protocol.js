// MIT source-derived abstract adapter and credential/attribution vocabulary; no legacy LlmRuntime.
import {createRequire} from 'node:module';
import {LlmError} from './native-llm-errors.js';
import {normalizeApiKey,INVALID_CREDENTIAL_CODE} from './native-message-protocol.js';
export * from './native-llm-errors.js';
export * from './native-message-protocol.js';
const {version}=createRequire(import.meta.url)('../package.json');
export const APP_IDENTITY={product:'night-bot',version,url:'https://github.com/zzusp/night-bot'};
export function userAgent(identity=APP_IDENTITY){return identity.product+'/'+identity.version+' (+'+identity.url+')'}
export function attributionHeaders(identity=APP_IDENTITY){return {'user-agent':userAgent(identity)}}
var LlmAdapter = class {
	/**
	* Describe one provider route owned by this adapter.
	* @param provider - a route passed to `registerAdapter()` for this instance.
	* @returns detached display metadata whose id must equal `provider`.
	*/
	providerInfo(provider) {
		return {
			id: provider,
			name: provider
		};
	}
	/**
	* Return the provider-owned retry policy captured with this route.
	* @param _provider - a route passed to `registerAdapter()` for this instance.
	* @returns a resolved policy, or `undefined` to use the normal defaults.
	*/
	providerRetryPolicy(_provider) {}
	/**
	* Resolve provider-side request-image pricing for one exact model route.
	* The default declares none, so consumers fall back to their own neutral
	* estimate. Implementations must answer synchronously without I/O; the
	* token meter resolves this per measurement.
	* @param _provider - a route passed to `registerAdapter()` for this instance.
	* @param _model - exact model id passed to {@link GenerateOptions.model}.
	* @returns route-owned image pricing, or `undefined` when the route declares none.
	*/
	imageRequestPricing(_provider, _model) {}
	/**
	* List models this adapter can currently advertise for one owned provider.
	* Core routing accepts unlisted model ids; catalog-driven entry points such
	* as the GUI may require membership. Adapters used there must advertise
	* their available models; the base empty catalog offers no GUI selection.
	* @param _provider - one provider route owned by this adapter.
	* @returns discoverable models in adapter-preferred order.
	*/
	listModels(_provider) {
		return Promise.resolve([]);
	}
	/**
	* Resolve all metadata available for one exact model. This query is
	* independent of the advisory catalog and does not validate request routing.
	* @param provider - one provider route owned by this adapter.
	* @param model - exact model id passed to {@link GenerateOptions.model}.
	* @param _signal - cancellation for this exact-model lookup; asynchronous
	*   implementations must settle promptly after it aborts.
	* @returns provider/model identity plus any context, call-default, and reasoning metadata.
	*/
	resolveModel(provider, model, _signal) {
		return Promise.resolve({
			provider,
			id: model,
			name: model
		});
	}
	/**
	* Bind exact model metadata and the eventual request dispatch to one adapter generation.
	* Dynamic adapters override this so settings changes between preparation and
	* dispatch cannot combine one generation's capabilities with another's endpoint.
	* @param provider - registered provider route.
	* @param model - exact model id.
	* @param signal - cancellation for model resolution.
	* @returns model metadata and a one-generation stream entry point.
	*/
	async prepareCall(provider, model, signal) {
		return {
			model: await this.resolveModel(provider, model, signal),
			stream: (options) => this.stream(options)
		};
	}
};
function assertUsableApiKey(raw, pkg, ref) {
	const checked = normalizeApiKey(raw);
	if (checked.ok) return checked.value;
	throw new LlmError(checked.reason === "empty" ? `${pkg}: the API key resolved from ${ref} is blank; set ${ref} to the raw key or export it in the launching environment` : `${pkg}: the API key resolved from ${ref} contains characters no HTTP header can carry; set ${ref} to the raw key alone`, INVALID_CREDENTIAL_CODE);
}
export {LlmAdapter,assertUsableApiKey};
