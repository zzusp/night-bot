// MIT source-derived compatibility preflight; no dsh-app-boot runtime import.
// Manifest/include resolution retains attributed source; DSH ABI admission is removed.
import {createRequire,isBuiltin} from 'node:module'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {existsSync,readFileSync,realpathSync} from 'node:fs'
import {dirname,extname,isAbsolute,join} from 'node:path'
import {load} from 'js-yaml'
import {ModuleLoader} from '@deepseek-ai/cordis-plugin-loader'
import {entryListSchema,applyEntryPatches} from '@deepseek-ai/cordis-plugin-include'
// DSH plugins have no ABI in Night Bot. Reject them before module evaluation;
// a profile compatibility.json cannot turn an unsupported ABI into support.
export function evaluatePluginCompatibility(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new TypeError('Plugin manifest must be an object')
  if (!Object.hasOwn(manifest, 'peerDependencies')) return
  const dependencies = manifest.peerDependencies
  if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) throw new TypeError('Plugin peerDependencies must be an object')
  const peers = {}
  for (const [name, range] of Object.entries(dependencies)) {
    if (typeof range !== 'string') throw new TypeError('Plugin peer dependency range must be a string')
    if (name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')) peers[name] = range
  }
  if (Object.keys(peers).length) return {name:manifest.name, version:manifest.version, peers}
}
export function pluginCompatibilityWarning(issue) {
  return `Plugin ${issue.name ?? '(unnamed)'} declares unsupported DSH peers ${JSON.stringify(issue.peers)}. Night Bot uses Pi and does not implement the DSH plugin ABI.`
}

function barePackageName(request) {
	if (!request || request[0] === "." || request[0] === "/" || request[0] === "\\" || request[0] === "#" || request.includes(":") || isBuiltin(request)) return;
	const first = request.indexOf("/");
	if (request[0] !== "@") return first < 0 ? request : request.slice(0, first);
	if (first < 0) return;
	const second = request.indexOf("/", first + 1);
	return second < 0 ? request : request.slice(0, second);
}

function resolvePluginResource(specifier, parentURL) {
	const loader = ModuleLoader.fromInternal();
	if (loader === void 0) throw new Error("Plugin metadata requires the Node module resolver");
	return fileURLToPath((loader.version === "v2" ? loader.resolveSync(parentURL, {
		specifier,
		attributes: {}
	}) : loader.resolveSync(specifier, parentURL, {})).url);
}

function readManifest(filename) {
	return JSON.parse(readFileSync(filename, "utf8"));
}
/** Render the patch wording an Include would report, through the profile's logger. */
function patchWarning(ctx) {
	return (message, ...args) => {
		let index = 0;
		ctx.logger.warn(message.replace(/%C/g, () => JSON.stringify(args[index++])));
	};
}
function manifestOf(ctx, name, parentURL) {
	if (name.startsWith("cordis:")) return void 0;
	const specifier = name.startsWith("#") ? resolvePluginResource(name, parentURL) : name;
	const packages = ctx.get("pluginPackages");
	const pkg = packages?.packageOf(specifier, parentURL);
	if (pkg !== void 0) return readManifest(pkg.manifestPath);
	const bare = barePackageName(specifier);
	if (bare !== void 0 && packages === void 0) for (const path of createRequire(parentURL).resolve.paths(bare)) {
		const filename = join(path, bare, "package.json");
		if (existsSync(filename)) return readManifest(filename);
	}
	if (!isAbsolute(specifier) && !specifier.startsWith(".") && !specifier.startsWith("file:")) return void 0;
	const url = isAbsolute(specifier) ? pathToFileURL(specifier) : new URL(specifier, parentURL);
	let dir;
	try {
		dir = dirname(realpathSync(fileURLToPath(url)));
	} catch (error) {
		if ([
			"ENOENT",
			"ENOTDIR",
			"EISDIR"
		].includes(String(error.code))) return void 0;
		throw error;
	}
	while (true) try {
		return readManifest(join(dir, "package.json"));
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
		const parent = dirname(dir);
		if (parent === dir) return void 0;
		dir = parent;
	}
}
/** Prepare profile or preset rows before the owning application passes them to Loader.
* Only a compatibility conflict denies a row: an entry whose manifest cannot be resolved keeps
* the Loader's own import failure. A denied ordinary row gains `disabled`; a native Include that
* reaches a denied plugin is denied as a whole, because its file is never rewritten.
* @param ctx Context carrying launcher-owned profile facts; all contexts reject DSH ABI dependencies.
* @param entries Complete effective entry list, after patch composition.
* @param parentURL Resolution base of the tree that will import these rows.
* @param binName Diagnostic prefix for a denied row; defaults to `night-bot`.
* @returns Detached rows with incompatible entries denied; does not load historical compatibility exemptions.
* @throws For malformed compatibility permissions or a profile composition without a resolution base.
*/
function prepareProfileEntries(ctx, entries, parentURL, binName = "night-bot") {
	return preflight(ctx, entries, parentURL, (row, reason) => {
		const label = typeof row.id === "string" ? `row ${JSON.stringify(row.id)}` : row.name;
		process.stderr.write(`${binName}: disabling profile plugin ${label}: ${reason}\n`);
	}).rows;
}
function preflight(ctx, entries, parentURL, report) {
	const rows = structuredClone(entries);
	if (parentURL === void 0) throw new Error("Profile compatibility preflight requires a resolution base");

	const includes = /* @__PURE__ */ new Set();
	/** Only a compatibility conflict denies a row; every other failure keeps the Loader's own diagnosis. */
	const denial = (row, base) => {
		try {
			const manifest = manifestOf(ctx, row.name, base);
			if (manifest === void 0) return void 0;
			const issue = evaluatePluginCompatibility(manifest);
			return issue === void 0 ? void 0 : pluginCompatibilityWarning(issue);
		} catch (error) {
			return `its declared peer dependencies cannot be validated: ${error instanceof Error ? error.message : String(error)}`;
		}
	};
	const deny = (row, reason) => {
		row.disabled = true;
		if (row.group) row.group = false;
		report(row, reason);
	};
	const check = (rows, base) => {
		let blocked = false;
		for (const row of rows) {
			if (row.disabled === true && !row.group) continue;
			const conflict = denial(row, base);
			if (conflict !== void 0) {
				deny(row, conflict);
				blocked = true;
				continue;
			}
			if ((row.group === true || row.name === "cordis:group" || row.name === "@deepseek-ai/cordis-plugin-group") && Array.isArray(row.config) && check(row.config, base)) blocked = true;
			if (row.name !== "cordis:include" && row.name !== "@deepseek-ai/cordis-plugin-include") continue;
			const reached = includedConflicts(row, base);
			if (reached !== void 0) {
				deny(row, reached);
				blocked = true;
			}
		}
		return blocked;
	};
	/** Whether a native Include reaches a denied plugin; an unreadable one has no compatibility opinion. */
	const includedConflicts = (row, base) => {
		const config = row.config;
		if (typeof config?.path !== "string" || ![
			".yml",
			".yaml",
			".json"
		].includes(extname(config.path))) return;
		const requested = isAbsolute(config.path) ? config.path : fileURLToPath(new URL(config.path, base));
		const filename = existsSync(requested) ? realpathSync(requested) : requested;
		if (includes.has(filename)) return void 0;
		includes.add(filename);
		try {
			let data;
			try {
				data = load(readFileSync(filename, "utf8"), { schema: entryListSchema });
			} catch (error) {
				if (error.code !== "ENOENT" || config.initial === void 0) return void 0;
				data = config.initial;
			}
			if (!Array.isArray(data)) return void 0;
			return check(applyEntryPatches(data, config.patches, patchWarning(ctx)), pathToFileURL(filename).href) ? `its included file ${filename} reaches an incompatible plugin, and that file is never rewritten` : void 0;
		} finally {
			includes.delete(filename);
		}
	};
	return {
		rows,
		blocked: check(rows, parentURL)
	};
}

export {prepareProfileEntries}
