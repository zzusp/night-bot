// MIT source-derived compatibility preflight; no dsh-app-boot runtime import.
// Legacy DSH peers describe the retained v4 ABI, independently of the Pi SDK/app version.
import {createRequire,isBuiltin} from 'node:module'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {existsSync,readFileSync,realpathSync} from 'node:fs'
import {dirname,extname,isAbsolute,join} from 'node:path'
import {load} from 'js-yaml'
import {ModuleLoader} from '@deepseek-ai/cordis-plugin-loader'
import {entryListSchema,applyEntryPatches} from '@deepseek-ai/cordis-plugin-include'
import semver,{parse} from 'semver'
export const LEGACY_PEER_ABI_VERSION='0.2.1-alpha.2'
export const getDshRuntimeVersion=()=>LEGACY_PEER_ABI_VERSION

function objectOf$1(value, field) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${field} must be an object`);
	return value;
}
function runtimeVersionOf(value) {
	if (typeof value !== "string" || semver.valid(value) === null) throw new Error(`Invalid dsh runtime version: ${JSON.stringify(value)}; expected a semantic version`);
	return value;
}
function identityField(manifest, field) {
	const value = Object.hasOwn(manifest, field) ? manifest[field] : void 0;
	if (typeof value !== "string" || value.trim() === "") throw new Error(`Plugin manifest ${field} must be a non-empty string when dsh peers are incompatible`);
	return value;
}

function evaluatePluginCompatibility(manifest, exemptions = {}, runtimeVersion = getDshRuntimeVersion()) {
	runtimeVersionOf(runtimeVersion);
	const fields = objectOf$1(manifest, "Plugin manifest");
	if (!Object.hasOwn(fields, "peerDependencies")) return void 0;
	const dependencies = objectOf$1(fields.peerDependencies, "Plugin manifest peerDependencies");
	const peers = {};
	for (const [name, range] of Object.entries(dependencies)) {
		if (typeof range !== "string") throw new Error(`Plugin manifest peerDependencies[${JSON.stringify(name)}] must be a string`);
		if (name !== "@deepseek-ai/dsh" && !name.startsWith("@deepseek-ai/dsh-")) continue;
		const requirement = [
			"workspace:^",
			"workspace:~",
			"workspace:*"
		].includes(range) ? runtimeVersion : range;
		if (requirement.trim() === "" || !semver.satisfies(runtimeVersion, requirement, { includePrerelease: true })) peers[name] = range;
	}
	if (Object.keys(peers).length === 0) return void 0;
	const name = identityField(fields, "name");
	const version = identityField(fields, "version");
	const key = `${name}@${version}`;
	return {
		name,
		version,
		runtimeVersion,
		peers,
		exempted: (Object.hasOwn(exemptions, key) ? exemptions[key] : void 0)?.includes(runtimeVersion) === true
	};
}
/**
* Describe incompatible peers, their risk, and the exact-version remedy.
* Surfaces with their own grant mechanism or locale render the structured result themselves.
* @param issue - incompatible plugin/runtime result, including exempted mismatches.
* @returns an English diagnostic for logs and stderr.
*/
function pluginCompatibilityWarning(issue) {
	const key = `${issue.name}@${issue.version}`;
	return `Plugin ${key} is incompatible with dsh ${issue.runtimeVersion}: peerDependencies ${JSON.stringify(issue.peers)}. Running it may cause crashes or data loss. Update the plugin or install a plugin version compatible with this dsh runtime. To accept this risk explicitly, grant the exact-version exemption for ${key} on dsh ${issue.runtimeVersion} with \`dsh plugin allow-version\` or the plugin manager, then retry the installation or restart dsh. Exact-version exemption: ${issue.exempted ? "active" : "not active"}.`;
}

const PROFILE_COMPATIBILITY_FILENAME = "compatibility.json";
/** Published and scoped npm package names, as npm accepts them in a manifest dependency key. */
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
/** Whether a decoded record accepts only exact DSH versions. */
function isVersionList(value) {
	return Array.isArray(value) && value.every((version) => typeof version === "string" && isExactPluginVersion(version));
}
/** Test whether an exemption names a canonical exact SemVer, including build metadata.
* @param value Version supplied by a manifest or user.
* @returns False for ranges, prefixes, whitespace, and malformed versions.
*/
function isExactPluginVersion(value) {
	const parsed = parse(value);
	return parsed !== null && value === `${parsed.version}${parsed.build.length === 0 ? "" : `+${parsed.build.join(".")}`}`;
}
/** Validate one explicit exemption without granting it.
* @param packageVersion Exact npm package-name@version, never an installation spec or range.
* @param runtimeVersion Exact DSH version, including prerelease and build metadata.
* @throws When either identity is not canonical.
*/
function validatePluginVersionExemption(packageVersion, runtimeVersion) {
	const separator = packageVersion.lastIndexOf("@");
	if (separator <= 0 || !PACKAGE_NAME.test(packageVersion.slice(0, separator)) || !isExactPluginVersion(packageVersion.slice(separator + 1)) || !isExactPluginVersion(runtimeVersion)) throw new Error("Version exemptions require an exact npm package-name@version and an exact DSH runtime version");
}
/** Read the profile's independent compatibility file without loading plugins.
* A missing file authorizes nothing. An unreadable or unparsable file authorizes nothing and is
* reported instead of failing, so a bad file can never make the profile unusable; rejected records
* are skipped while the remaining valid ones still apply.
* @param profileDir Absolute profile directory.
* @returns Accepted exemptions plus every problem found; no manifest fallback is used.
*/
function readProfileCompatibility(profileDir) {
	const filename = join(profileDir, PROFILE_COMPATIBILITY_FILENAME);
	const unreadable = (reason) => ({
		exemptions: {},
		warnings: [`${filename} ${reason}; treating the profile as having no exemptions`],
		rewritable: false
	});
	let text;
	try {
		text = readFileSync(filename, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return {
			exemptions: {},
			warnings: [],
			rewritable: true
		};
		return unreadable(`cannot be read (${String(error)})`);
	}
	let value;
	try {
		value = JSON.parse(text);
	} catch (error) {
		return unreadable(`is not valid JSON (${String(error)})`);
	}
	if (value === null || typeof value !== "object" || Array.isArray(value)) return unreadable("must map exact package@version keys to DSH version lists");
	const exemptions = {};
	const warnings = [];
	for (const [key, versions] of Object.entries(value)) {
		const separator = key.lastIndexOf("@");
		if (separator <= 0 || !PACKAGE_NAME.test(key.slice(0, separator)) || !isExactPluginVersion(key.slice(separator + 1))) {
			warnings.push(`${filename}: ${JSON.stringify(key)} is not an exact package-name@version key; the record is ignored`);
			continue;
		}
		if (!isVersionList(versions)) {
			warnings.push(`${filename}: ${key} must contain a list of exact DSH versions; the record is ignored`);
			continue;
		}
		exemptions[key] = versions;
	}
	return {
		exemptions,
		warnings,
		rewritable: warnings.length === 0
	};
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
/** Prepare profile or preset rows before the owning DSH caller passes them to Loader.
* Only a compatibility conflict denies a row: an entry whose manifest cannot be resolved keeps
* the Loader's own import failure. A denied ordinary row gains `disabled`; a native Include that
* reaches a denied plugin is denied as a whole, because its file is never rewritten.
* @param ctx Context carrying launcher-owned profile facts; non-profile contexts retain their rows.
* @param entries Complete effective entry list, after patch composition.
* @param parentURL Resolution base of the tree that will import these rows.
* @param binName Diagnostic prefix for a denied row; defaults to `dsh`.
* @returns Detached rows with incompatible entries denied; reads the profile compatibility file once.
* @throws For malformed compatibility permissions or a profile composition without a resolution base.
*/
function prepareProfileEntries(ctx, entries, parentURL, binName = "dsh") {
	return preflight(ctx, entries, parentURL, (row, reason) => {
		const label = typeof row.id === "string" ? `row ${JSON.stringify(row.id)}` : row.name;
		process.stderr.write(`${binName}: disabling profile plugin ${label}: ${reason}\n`);
	}).rows;
}
function preflight(ctx, entries, parentURL, report) {
	const rows = structuredClone(entries);
	const profile = ctx.get("profileContext");
	if (profile === void 0) return {
		rows,
		blocked: false
	};
	if (parentURL === void 0) throw new Error("Profile compatibility preflight requires a resolution base");
	const { exemptions, warnings } = readProfileCompatibility(profile.dir);
	for (const warning of warnings) process.stderr.write(`${warning}\n`);
	const includes = /* @__PURE__ */ new Set();
	/** Only a compatibility conflict denies a row; every other failure keeps the Loader's own diagnosis. */
	const denial = (row, base) => {
		try {
			const manifest = manifestOf(ctx, row.name, base);
			if (manifest === void 0) return void 0;
			const issue = evaluatePluginCompatibility(manifest, exemptions);
			return issue === void 0 || issue.exempted ? void 0 : pluginCompatibilityWarning(issue);
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

export {evaluatePluginCompatibility,pluginCompatibilityWarning,readProfileCompatibility,prepareProfileEntries}
