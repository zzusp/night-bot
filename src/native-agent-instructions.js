// MIT source-derived instruction discovery/rendering/reconciliation; see licenses/dsh-agent-instructions-MIT.txt.
// Pi official resources own current instruction context; Night supplies scoped IO and budgets.
import {scopeOf} from './native-scope.js';
import {officialWorkingDirectoryOrigin} from './native-working-directory.js';
import { homedir } from "node:os";

import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import z from "@deepseek-ai/schemastery";
// Root locations are explicit native paths; source labels are logical metadata,
// never environment variables or path-resolution aliases.
const INSTRUCTION_HOME_DISPLAY='night-bot://instructions', AGENTS_HOME_DISPLAY='night-bot://agents';
function configuredDirectory(path,label){
 if(typeof path!=='string'||!isAbsolute(path))throw Object.assign(new TypeError('Instruction root must be absolute: '+label),{code:'NIGHT_INSTRUCTION_ROOT_INVALID'})
 return resolve(path)
}
const resolveAgentsHome=configured=>configuredDirectory(configured??join(homedir(),'.agents'),'agentsHome');
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { assertNever } from "./native-values.js";
import { createHash } from "node:crypto";
//#region lib/types/config.js
/**
* Configuration normalization for workspace instruction discovery and rendering.
*
* @module @deepseek-ai/dsh-agent-instructions/config
*/
const DEFAULT_PROJECT_ROOT_MARKERS = [".git"];
const DEFAULT_INSTRUCTION_FILE_CANDIDATES = ["AGENTS.md", "CLAUDE.md"];
const DEFAULT_LOCAL_INSTRUCTION_FILE_CANDIDATES = ["AGENTS.local.md", "CLAUDE.local.md"];
const DEFAULT_MAX_SOURCE_BYTES = 1048576;
const RESERVED_PATH_SEGMENTS = new Set([
	"",
	".",
	".."
]);
const Config = z.object({
    instructionHome: z.string(),
    agentsHome: z.string(),
	projectRootMarkers: z.array(z.string()).default([...DEFAULT_PROJECT_ROOT_MARKERS]),
	maxBytes: z.number().required(),
	maxSourceBytes: z.number().step(1).min(1).default(DEFAULT_MAX_SOURCE_BYTES),
	instructionFileCandidates: z.array(z.string()).default([...DEFAULT_INSTRUCTION_FILE_CANDIDATES]),
	localInstructionFileCandidates: z.array(z.string()).default([...DEFAULT_LOCAL_INSTRUCTION_FILE_CANDIDATES])
});
/**
* Resolve explicit application instruction roots and valid same-directory candidates.
* Environment variables do not select instruction roots.
* @param config - user-facing plugin configuration.
* @returns normalized runtime configuration.
*/
function resolveConfig(config) {
	return {
		...resolveDiscoveryConfig({
            instructionHome:config.instructionHome,agentsHome:config.agentsHome,
			...config.projectRootMarkers === void 0 ? {} : { projectRootMarkers: config.projectRootMarkers },
			...config.instructionFileCandidates === void 0 ? {} : { instructionFileCandidates: config.instructionFileCandidates },
			...config.localInstructionFileCandidates === void 0 ? {} : { localInstructionFileCandidates: config.localInstructionFileCandidates }
		}),
		maxBytes: config.maxBytes,
		maxSourceBytes: config.maxSourceBytes ?? DEFAULT_MAX_SOURCE_BYTES
	};
}
/**
* Resolve the subset of configuration used before instruction content is rendered.
*
* The harness home comes from the process environment through
* the explicit instruction root; the row cannot point instruction loading at a second
* root that other harness consumers would not share. An owner that already
* resolved the homes passes them as `instructionHome` and `agentsHome`, which are
* normalized here so discovery and reconciliation use the same values.
* @param config - optional discovery controls plus the already-resolved homes.
* @returns normalized home, root markers, and instruction candidates.
*/
function resolveDiscoveryConfig(config) {
	return {
		instructionHome: config.instructionHome===undefined?undefined:configuredDirectory(config.instructionHome,'instructionHome'),
		agentsHome: resolveAgentsHome(config.agentsHome),
		projectRootMarkers: config.projectRootMarkers ?? [...DEFAULT_PROJECT_ROOT_MARKERS],
		instructionFileCandidates: resolveInstructionFileCandidates(config.instructionFileCandidates, DEFAULT_INSTRUCTION_FILE_CANDIDATES),
		localInstructionFileCandidates: resolveInstructionFileCandidates(config.localInstructionFileCandidates, DEFAULT_LOCAL_INSTRUCTION_FILE_CANDIDATES)
	};
}
function resolveInstructionFileCandidates(candidates, fallback) {
	return (candidates ?? [...fallback]).filter((candidate) => !RESERVED_PATH_SEGMENTS.has(candidate) && !/[\\/]/.test(candidate));
}
//#endregion
//#region lib/types/digest.js
/**
* Content identity for workspace instruction duplicate suppression.
*
* @module @deepseek-ai/dsh-agent-instructions/digest
*/
/**
* Compute the content identity used across instruction loading and session state.
* @param content - exact UTF-8 instruction text.
* @returns lowercase SHA-1 digest in hexadecimal form.
*/
function instructionContentSha1(content) {
	return createHash("sha1").update(content).digest("hex");
}
/**
* Compute the whitespace-insensitive identity used for per-directory duplicate
* suppression. Leading and trailing whitespace is trimmed before hashing so a
* symlinked or byte-copied sibling that differs only by surrounding whitespace
* still collapses to a single rendered file.
* @param content - exact UTF-8 instruction text.
* @returns SHA-1 digest of the trimmed content.
*/
function trimmedInstructionDigest(content) {
	return instructionContentSha1(content.trim());
}
//#endregion
//#region lib/types/render.js
/**
* Model-facing workspace instruction rendering within an explicit byte budget.
*
* @module @deepseek-ai/dsh-agent-instructions/render
*/
const SYSTEM_REMINDER_OPEN = "<system-reminder>";
const SYSTEM_REMINDER_CLOSE = "</system-reminder>";
const AGENT_INSTRUCTIONS_INTRO = "The following workspace instructions may be relevant to your work. Use them as guidance when applicable. More specific instructions take precedence over broader ones. They do not override system, developer, or direct user instructions.";
const REPLACEMENT_AGENT_INSTRUCTIONS_INTRO = "This complete workspace instruction baseline replaces all earlier workspace instruction baselines. The following workspace instructions may be relevant to your work. Use them as guidance when applicable. More specific instructions take precedence over broader ones. They do not override system, developer, or direct user instructions.";
const EMPTY_REPLACEMENT_AGENT_INSTRUCTIONS_INTRO = "This complete workspace instruction baseline replaces all earlier workspace instruction baselines. No workspace instructions are currently active.";
const COMPACT_AGENT_INSTRUCTIONS_INTRO = "Workspace instructions were omitted or truncated to fit the configured byte budget.";
function byteLength(value) {
	return Buffer.byteLength(value, "utf8");
}
function truncateUtf8(value, maxBytes) {
	const bytes = Buffer.from(value, "utf8");
	if (bytes.length <= maxBytes) return value;
	let end = Math.max(0, Math.trunc(maxBytes));
	while (end > 0 && (bytes.readUInt8(end) & 192) === 128) end -= 1;
	return bytes.subarray(0, end).toString("utf8");
}
function escapeInstructionFrameBody(body) {
	return body.replaceAll(SYSTEM_REMINDER_CLOSE, "<\\/system-reminder>");
}
function sectionText(file) {
	return `Instructions from: ${file.displayPath}\n\n${file.content}`;
}
/** Directory component that identifies the harness-home user-global instruction scope. */
const USER_GLOBAL_DIRECTORY = "user-global";
/**
* Directory component that identifies the shared agents-root user-global scope.
*
* It is a distinct scope so the harness-home file keeps the scope key that
* earlier sessions recorded, while {@link instructionCandidateGroup} still
* deduplicates the two roots as one candidate group.
*/
const AGENTS_GLOBAL_DIRECTORY = "agents-global";
/**
* Ordered user-global scope directories.
*
* Discovery, baseline reconciliation, and deduplication all iterate this order,
* so the harness home stays the candidate that decides content duplicates
* against the shared agents root.
*/
const USER_GLOBAL_DIRECTORIES = [USER_GLOBAL_DIRECTORY, AGENTS_GLOBAL_DIRECTORY];
/**
* File name of the user-global instruction file under each user-global root.
* Discovery (`<root>/<name>`) and reconciliation (the user-global scope key's
* candidate component) both key on this name, so it lives in one place: were the
* two to disagree, the user-global instruction would load but never reconcile.
*/
const USER_GLOBAL_FILE = "AGENTS.md";
/**
* Derive the logical instruction scope from a model-facing path.
* @param displayPath - project-relative or user-global instruction path.
* @returns `user-global`, `agents-global`, `.`, or the containing project-relative directory.
*/
function scopeForDisplayPath(displayPath) {
	if (displayPath === `${INSTRUCTION_HOME_DISPLAY}/AGENTS.md`) return USER_GLOBAL_DIRECTORY;
	if (displayPath === `${AGENTS_HOME_DISPLAY}/AGENTS.md`) return AGENTS_GLOBAL_DIRECTORY;
	return dirname(displayPath);
}
/**
* Whether a decoded scope directory is one of the two user-global roots.
* @param directory - `user-global`, `agents-global`, `.`, or a project-relative directory.
* @returns true for the harness-home and shared agents-root scopes.
*/
function isUserGlobalDirectory(directory) {
	return directory === "user-global" || directory === "agents-global";
}
/**
* Candidate group of one decoded scope directory.
*
* The harness home and the shared agents root are the ordered candidates of one
* user-global candidate group: identical trimmed content renders once, and an
* unobservable candidate preserves the last-good state of its group. Every
* project directory forms its own group.
* @param directory - `user-global`, `agents-global`, `.`, or a project-relative directory.
* @returns the shared group key of both user-global roots, or the directory itself.
*/
function instructionCandidateGroup(directory) {
	return directory === "agents-global" ? USER_GLOBAL_DIRECTORY : directory;
}
/** Directory names that {@link scopeForDisplayPath} reads as a user-global scope, not a project path. */
const RESERVED_SCOPE_DIRECTORIES = new Set(USER_GLOBAL_DIRECTORIES);
/**
* Keep a project-relative path out of the user-global scope namespace.
*
* A project directory whose name equals a user-global scope directory would
* otherwise resolve to the global root for probing and joins the global
* candidate group for deduplication. Escaping the collision with a leading `.`
* keeps the file in its own project scope.
* @param relativePath - project-root-relative path using the platform separator.
* @returns the path, with a leading `.` component when its first component collides.
*/
function escapeProjectDisplayPath(relativePath) {
	const separatorIndex = relativePath.search(/[\\/]/);
	const first = separatorIndex < 0 ? relativePath : relativePath.slice(0, separatorIndex);
	return RESERVED_SCOPE_DIRECTORIES.has(first) ? `.${sep}${relativePath}` : relativePath;
}
const SCOPE_SEPARATOR = "\0";
/**
* Compose the reconciliation key for one instruction candidate file.
* Each loaded candidate is tracked independently, so the key pairs the logical
* directory with the exact candidate file name behind a NUL separator that no
* directory path or file name can contain. Distinct candidates in one directory
* (`AGENTS.md` vs `CLAUDE.md`, a base file vs its `.local` overlay) therefore
* never collide in the scope-keyed state maps.
* @param directory - `user-global`, `agents-global`, `.`, or a project-relative directory.
* @param candidateName - instruction file name within that directory.
* @returns the per-candidate logical scope key.
*/
function candidateScopeKey(directory, candidateName) {
	return `${directory}${SCOPE_SEPARATOR}${candidateName}`;
}
/**
* Derive the per-candidate scope key for a loaded instruction file.
* @param displayPath - project-relative or user-global instruction path.
* @returns the scope key pairing the file's directory with its name.
*/
function instructionScopeKey(displayPath) {
	return candidateScopeKey(scopeForDisplayPath(displayPath), basename(displayPath));
}
/**
* Recover the directory and candidate name that {@link candidateScopeKey} encoded.
* @param scope - a per-candidate scope key.
* @returns the directory scope and the candidate file name within it.
*/
function decodeScopeKey(scope) {
	const separator = scope.indexOf(SCOPE_SEPARATOR);
	/* v8 ignore next -- every scope key is produced by candidateScopeKey, which always inserts the separator. */
	if (separator < 0) return {
		directory: scope,
		candidateName: ""
	};
	return {
		directory: scope.slice(0, separator),
		candidateName: scope.slice(separator + 1)
	};
}
const ADDITIONAL_INSTRUCTIONS_GUIDANCE = "Use them as guidance when relevant; more specific instructions take precedence. They do not override system, developer, or direct user instructions.";
function additionalSectionText(file) {
	const scope = scopeForDisplayPath(file.displayPath);
	const applicability = isUserGlobalDirectory(scope) ? "These user-global instructions apply to all work." : `These instructions apply to work under \`${scope}\`.`;
	return [
		`Additional instructions from: ${file.displayPath}`,
		"",
		`${applicability} ${ADDITIONAL_INSTRUCTIONS_GUIDANCE}`,
		"",
		file.content
	].join("\n");
}
const BASELINE_RENDER_STYLE = {
	intro: AGENT_INSTRUCTIONS_INTRO,
	section: sectionText
};
function baselineRenderStyle(files, replacePreviousBaseline) {
	if (replacePreviousBaseline !== true) return BASELINE_RENDER_STYLE;
	return {
		...BASELINE_RENDER_STYLE,
		intro: files.length === 0 ? EMPTY_REPLACEMENT_AGENT_INSTRUCTIONS_INTRO : REPLACEMENT_AGENT_INSTRUCTIONS_INTRO
	};
}
function changedSectionText(item) {
	const { change, file } = item;
	if (change.action === "set") return additionalSectionText(file);
	if (change.action === "remove") return `Instructions removed: ${change.path}\n\nThe previously loaded instructions from this file no longer apply.`;
	return [
		`Updated instructions from: ${change.path}`,
		"",
		"This file changed after it was loaded. Use the following content instead of the previously loaded instructions from this file.",
		"",
		file.content
	].join("\n");
}
/**
* Render one reconciliation batch and retain only transitions that fit.
* @param items - ordered state transitions and current file contents.
* @param maxBytes - maximum UTF-8 bytes allowed in the rendered batch.
* @returns bounded prompt text and the transitions actually represented by it.
*/
function renderInstructionChanges(items, maxBytes) {
	const byAbsolutePath = new Map(items.map((item) => [item.file.absolutePath, item]));
	const rendered = renderInstructionContext(items.map((item) => item.file), maxBytes, {
		intro: "",
		section(file) {
			const item = byAbsolutePath.get(file.absolutePath);
			/* v8 ignore next -- the renderer receives exactly the files used to construct this map. */
			return item === void 0 ? "" : changedSectionText({
				...item,
				file
			});
		}
	});
	const represented = new Set(rendered.represented.map((file) => file.absolutePath));
	return {
		text: rendered.text,
		changes: items.filter((item) => represented.has(item.file.absolutePath)).map((item) => item.change)
	};
}
function markerText(maxBytes, omitted, truncated) {
	if (omitted.length === 0 && truncated.length === 0) return "";
	const parts = [];
	if (omitted.length > 0) parts.push(`omitted ${omitted.map((file) => file.displayPath).join(", ")}`);
	if (truncated.length > 0) parts.push(`truncated ${truncated.map((item) => `${item.displayPath} from ${item.originalBytes} to ${item.includedBytes} bytes`).join(", ")}`);
	return `Workspace instruction budget ${maxBytes} bytes: ${parts.join("; ")}`;
}
function buildInstructionText(files, maxBytes, omitted, truncated, style) {
	return [
		SYSTEM_REMINDER_OPEN,
		escapeInstructionFrameBody([
			markerText(maxBytes, omitted, truncated),
			style.intro,
			...files.map((file) => style.section(file))
		].filter((block) => block.length > 0).join("\n\n")),
		SYSTEM_REMINDER_CLOSE
	].join("\n");
}
function withTruncatedContent(file, includedBytes) {
	return {
		...file,
		content: truncateUtf8(file.content, includedBytes)
	};
}
function truncateToFit(file, includedFiles, maxBytes, omitted, style) {
	const originalBytes = byteLength(file.content);
	let low = 0;
	let high = originalBytes;
	let best = withTruncatedContent(file, 0);
	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		const candidate = withTruncatedContent(file, mid);
		const truncated = [{
			displayPath: file.displayPath,
			originalBytes,
			includedBytes: byteLength(candidate.content)
		}];
		if (byteLength(buildInstructionText([...includedFiles, candidate], maxBytes, omitted, truncated, style)) <= maxBytes) {
			best = candidate;
			low = mid + 1;
		} else high = mid - 1;
	}
	return best;
}
function renderInstructionContext(files, maxBytes, style) {
	if (maxBytes <= 0 || !Number.isFinite(maxBytes)) return {
		text: "",
		omitted: files,
		truncated: [],
		represented: []
	};
	const fullText = buildInstructionText(files, maxBytes, [], [], style);
	if (byteLength(fullText) <= maxBytes) return {
		text: fullText,
		omitted: [],
		truncated: [],
		represented: files
	};
	for (let start = 1; start < files.length; start += 1) {
		const included = files.slice(start);
		const omitted = files.slice(0, start).map((file) => ({
			absolutePath: file.absolutePath,
			displayPath: file.displayPath
		}));
		const suffixText = buildInstructionText(included, maxBytes, omitted, [], style);
		if (byteLength(suffixText) <= maxBytes) return {
			text: suffixText,
			omitted,
			truncated: [],
			represented: included
		};
	}
	const mostSpecific = files.at(-1);
	/* v8 ignore next -- callers only reach this after a non-empty fullText was built. */
	if (mostSpecific === void 0) return {
		text: "",
		omitted: [],
		truncated: [],
		represented: []
	};
	const omitted = files.slice(0, -1).map((file) => ({
		absolutePath: file.absolutePath,
		displayPath: file.displayPath
	}));
	const originalBytes = byteLength(mostSpecific.content);
	for (const candidateStyle of [style, {
		...style,
		intro: COMPACT_AGENT_INSTRUCTIONS_INTRO
	}]) {
		const truncatedFile = truncateToFit(mostSpecific, [], maxBytes, omitted, candidateStyle);
		const includedBytes = byteLength(truncatedFile.content);
		const truncated = [{
			displayPath: mostSpecific.displayPath,
			originalBytes,
			includedBytes
		}];
		const text = buildInstructionText([truncatedFile], maxBytes, omitted, truncated, candidateStyle);
		if (byteLength(text) <= maxBytes) return {
			text,
			omitted,
			truncated,
			represented: includedBytes > 0 || originalBytes === 0 ? [mostSpecific] : []
		};
	}
	const truncated = [{
		displayPath: mostSpecific.displayPath,
		originalBytes,
		includedBytes: 0
	}];
	const compactNotice = escapeInstructionFrameBody(markerText(maxBytes, omitted, truncated));
	const compactWithHeading = escapeInstructionFrameBody([compactNotice, style.section(withTruncatedContent(mostSpecific, 0))].join("\n\n"));
	if (byteLength(compactWithHeading) <= maxBytes) return {
		text: compactWithHeading,
		omitted,
		truncated,
		represented: originalBytes === 0 ? [mostSpecific] : []
	};
	return {
		text: byteLength(compactNotice) <= maxBytes ? compactNotice : truncateUtf8(compactNotice, maxBytes),
		omitted,
		truncated,
		represented: []
	};
}
/**
* Render a baseline together with the exact source files semantically represented in it.
* @param files - loaded files ordered from broadest to most specific.
* @param options - rendering byte budget and whether this baseline supersedes a visible predecessor.
* @returns bounded public rendering plus files with surviving content, including genuinely empty files.
* @internal
*/
function renderAgentInstructionSet(files, options) {
	const style = baselineRenderStyle(files, options.replacePreviousBaseline);
	const { represented, ...rendered } = renderInstructionContext(files, options.maxBytes, style);
	return {
		rendered,
		included: represented
	};
}
/**
* Render the baseline instruction chain with deterministic precedence budgeting.
* @param files - loaded files ordered from broadest to most specific.
* @param options - rendering byte budget and whether this baseline supersedes a visible predecessor.
* @returns bounded baseline prompt text and budget diagnostics.
*/
function renderAgentInstructions(files, options) {
	return renderAgentInstructionSet(files, options).rendered;
}
//#endregion
//#region lib/types/files.js
/**
* Instruction-file discovery and bounded, abort-aware provider reads.
*
* @module @deepseek-ai/dsh-agent-instructions/files
*/
/**
* Ordered user-global instruction roots: the harness home, then the shared
* agents root. Both contribute the fixed {@link USER_GLOBAL_FILE} candidate and
* form one candidate group, so a file that matches the harness-home content
* renders once.
* @param config - normalized discovery configuration.
* @returns the roots in model precedence order.
*/
function userGlobalRoots(config) {
 const roots=[]
 if(config.instructionHome!==undefined)roots.push({directory:USER_GLOBAL_DIRECTORY,home:config.instructionHome,display:INSTRUCTION_HOME_DISPLAY})
 roots.push({directory:AGENTS_GLOBAL_DIRECTORY,home:config.agentsHome,display:AGENTS_HOME_DISPLAY})
 return roots
}
function signalOptions(signal) {
	return signal === void 0 ? void 0 : { signal };
}
function isMissingPathError(error) {
	return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
}
function isMissingProviderPathError(error) {
	return error instanceof Error && "code" in error && error.code === "FS_NOT_FOUND";
}
async function nodeStatFile(path, signal) {
	try {
		signal?.throwIfAborted();
		const info = await stat(path);
		signal?.throwIfAborted();
		if (!info.isFile()) return { kind: "absent" };
		return {
			kind: "present",
			info: { size: info.size }
		};
	} catch (error) {
		signal?.throwIfAborted();
		return isMissingPathError(error) ? { kind: "absent" } : { kind: "unavailable" };
	}
}
async function fsStatFile(path, fileSystem, signal) {
	try {
		const target = await fileSystem.resolve(path, signalOptions(signal));
		signal?.throwIfAborted();
		const info = await fileSystem.stat(target, signal);
		signal?.throwIfAborted();
		if (info?.type !== "file") return { kind: "absent" };
		return {
			kind: "present",
			info: {
				target,
				version: info.version,
				...info.size === void 0 ? {} : { size: info.size }
			}
		};
	} catch {
		signal?.throwIfAborted();
		return { kind: "unavailable" };
	}
}
async function statFile(path, fileSystem, signal) {
	return fileSystem === void 0 ? nodeStatFile(path, signal) : fsStatFile(path, fileSystem, signal);
}
async function existsAsMarker(path, fileSystem, signal) {
	if (fileSystem !== void 0) try {
		const target = await fileSystem.resolve(path, signalOptions(signal));
		return await fileSystem.stat(target, signal) !== void 0;
	} catch (error) {
		signal?.throwIfAborted();
		if (isMissingProviderPathError(error)) return false;
		throw error;
	}
	try {
		signal?.throwIfAborted();
		await stat(path);
		signal?.throwIfAborted();
		return true;
	} catch (error) {
		signal?.throwIfAborted();
		if (isMissingPathError(error)) return false;
		throw error;
	}
}
/**
* Walk upward to the first directory containing a configured root marker.
* @param cwd - absolute session working directory where the walk begins.
* @param markers - child names that identify a project root.
* @param fileSystem - optional provider used instead of host filesystem probes.
* @param signal - cancellation for provider and host probes.
* @returns the discovered project root, or `cwd` when no marker exists.
* @throws the original marker metadata error or cancellation reason when a probe is unavailable.
*/
async function findProjectRoot(cwd, markers, fileSystem, signal, boundary) {
	let current = resolve(cwd);
	for (;;) {
		for (const marker of markers) if (await existsAsMarker(join(current, marker), fileSystem, signal)) return current;
		if(boundary&&current===resolve(boundary))return current;
		const parent = dirname(current);
		if (parent === current) return resolve(cwd);
		current = parent;
	}
}
/**
* Build the inclusive root-to-cwd directory chain.
* @param root - root directory expected to contain or equal `cwd`.
* @param cwd - most-specific directory in the chain.
* @returns directories ordered from broadest to most specific.
*/
function ancestorChain(root, cwd) {
	const chain = [];
	let current = resolve(cwd);
	const resolvedRoot = resolve(root);
	while (current !== resolvedRoot) {
		chain.push(current);
		const parent = dirname(current);
		/* v8 ignore next -- discovery always supplies cwd or an ancestor root. */
		if (parent === current) break;
		current = parent;
	}
	chain.push(resolvedRoot);
	return chain.reverse();
}
/**
* Find descendant directories crossed between a cwd and a touched file.
* @param root - current working directory that bounds nested discovery.
* @param touchedPath - absolute path or path relative to `root`.
* @returns descendant directories from shallowest through the touched file's parent.
*/
function descendantDirsBetween(root, touchedPath) {
	const resolvedRoot = resolve(root);
	const targetDir = dirname(isAbsolute(touchedPath) ? resolve(touchedPath) : resolve(resolvedRoot, touchedPath));
	const rel = relative(resolvedRoot, targetDir);
	if (rel.length === 0 || rel.startsWith("..") || isAbsolute(rel)) return [];
	return ancestorChain(resolvedRoot, targetDir).slice(1);
}
/**
* Convert an absolute instruction path to its project display path.
* @param root - project root used as the display base.
* @param path - absolute path to display.
* @returns the collision-free root-relative path.
*/
function relativeDisplay(root, path) {
	return escapeProjectDisplayPath(relative(root, path));
}
async function allExistingInstructionFiles(dir, root, instructionFileCandidates, fileSystem, signal) {
	const found = [];
	for (const candidate of instructionFileCandidates) {
		const path = join(dir, candidate);
		const probe = await statFile(path, fileSystem, signal);
		switch (probe.kind) {
			case "present":
				found.push({
					absolutePath: path,
					displayPath: relativeDisplay(root, path),
					...probe.info
				});
				continue;
			case "absent":
			case "unavailable": continue;
			/* v8 ignore next 2 -- StatFileProbe is closed; this arm only makes adding a kind a compile error. */
			default: assertNever(probe, "StatFileProbe");
		}
	}
	return found;
}
async function discoverInstructionFiles(options, fileSystem) {
	const config = resolveDiscoveryConfig(options);
	const files = [];
	const seen = /* @__PURE__ */ new Set();
	const addFile = (file) => {
		if (seen.has(file.absolutePath)) return;
		seen.add(file.absolutePath);
		files.push(file);
	};
	for (const root of userGlobalRoots(config)) {
		const absolutePath = join(root.home, USER_GLOBAL_FILE);
		const probe = await statFile(absolutePath, fileSystem, options.signal);
		switch (probe.kind) {
			case "present":
				addFile({
					absolutePath,
					displayPath: `${root.display}/${USER_GLOBAL_FILE}`,
					...probe.info
				});
				continue;
			case "absent":
			case "unavailable": continue;
			/* v8 ignore next 2 -- StatFileProbe is closed; this arm only makes adding a kind a compile error. */
			default: assertNever(probe, "StatFileProbe");
		}
	}
	const cwd = resolve(options.cwd);
	const projectRoot = options.projectRoot ?? await findProjectRoot(cwd, config.projectRootMarkers, fileSystem, options.signal);
	for (const dir of ancestorChain(projectRoot, cwd)) for (const candidates of [config.instructionFileCandidates, config.localInstructionFileCandidates]) for (const file of await allExistingInstructionFiles(dir, projectRoot, candidates, fileSystem, options.signal)) addFile(file);
	// Successful application tool observations select additional instruction
	// directories. File contents still pass the same scoped reader and budgets;
	// this list contains paths, never a second conversation or publication log.
	for(const touchedPath of options.discoveredPaths??[]) {
		if(typeof touchedPath!=='string'||!isAbsolute(touchedPath))throw new TypeError('Absolute observed instruction path required');
		for(const dir of descendantDirsBetween(projectRoot,touchedPath))for(const candidates of [config.instructionFileCandidates,config.localInstructionFileCandidates])for(const file of await allExistingInstructionFiles(dir,projectRoot,candidates,fileSystem,options.signal))addFile(file);
	}
	return files;
}
/**
* Discover host-visible user-global and root-to-cwd instruction candidates.
* All present candidates in each directory are returned; trimmed-content
* duplicates are collapsed later, once content is read.
* @param options - cwd, resolved harness home, root marker, and candidate configuration.
* @returns path-deduplicated instruction candidates in model precedence order.
* @throws the original root-marker metadata error or cancellation reason when
* discovery cannot identify the project root.
*/
async function discoverBaselineInstructionFiles(options) {
	return (await discoverInstructionFiles(options)).map(({ absolutePath, displayPath }) => ({
		absolutePath,
		displayPath
	}));
}
async function* nodeTextChunks(path, signal) {
	const stream = createReadStream(path, {
		encoding: "utf8",
		signal
	});
	for await (const chunk of stream) yield String(chunk);
}
async function readBounded(file, maxSourceBytes, fileSystem, signal) {
	signal?.throwIfAborted();
	if (file.size !== void 0 && file.size > maxSourceBytes) return void 0;
	try {
		const chunks = fileSystem === void 0 || file.target === void 0 ? nodeTextChunks(file.absolutePath, signal) : await fileSystem.streamText(file.target, signal);
		const parts = [];
		let bytes = 0;
		for await (const chunk of chunks) {
			signal?.throwIfAborted();
			bytes += Buffer.byteLength(chunk, "utf8");
			if (bytes > maxSourceBytes) return void 0;
			parts.push(chunk);
		}
		signal?.throwIfAborted();
		return parts.join("");
	} catch {
		signal?.throwIfAborted();
		return;
	}
}
/**
* Drop later candidates whose trimmed content duplicates an earlier candidate in
* the same candidate group. Different groups never collapse even when identical;
* within one group the earliest candidate in discovery order is kept and its
* original bytes are rendered. The two user-global roots form one group, so a
* shared file matching the harness-home content collapses behind it. A candidate
* that symlinks a sibling resolves to the same content and collapses here like
* any byte-identical real file.
* @param files - loaded files in discovery order.
* @returns the retained files in the same order.
*/
function dedupInstructionFilesByCandidateGroup(files) {
	const keptDigestsByGroup = /* @__PURE__ */ new Map();
	const kept = [];
	for (const file of files) {
		const group = instructionCandidateGroup(scopeForDisplayPath(file.displayPath));
		let digests = keptDigestsByGroup.get(group);
		if (digests === void 0) {
			digests = /* @__PURE__ */ new Set();
			keptDigestsByGroup.set(group, digests);
		}
		const digest = trimmedInstructionDigest(file.content);
		if (digests.has(digest)) continue;
		digests.add(digest);
		kept.push(file);
	}
	return kept;
}
/**
* Discover, read, and render the baseline instruction chain.
* @param options - discovery, source-size, byte-budget, and cancellation configuration.
* @param fileSystem - optional provider used instead of host filesystem reads.
* @returns rendered baseline context, or undefined when nothing can be loaded.
* @throws the original root-marker metadata error or cancellation reason when
* discovery cannot identify the project root.
*/
async function loadBaselineInstructions(options, fileSystem) {
	return (await loadBaselineInstructionSet(options, fileSystem))?.rendered;
}
/**
* Load a baseline together with the files retained after rendering.
* @param options - discovery, source-size, byte-budget, and cancellation configuration.
* @param fileSystem - optional provider used instead of host filesystem reads.
* @returns rendered context and retained files, an explicit empty replacement set, or undefined when empty or disabled.
*/
async function loadBaselineInstructionSet(options, fileSystem) {
	const config = resolveConfig(options);
	if (config.maxBytes <= 0 || !Number.isFinite(config.maxBytes)) return void 0;
	if (config.maxSourceBytes <= 0 || !Number.isFinite(config.maxSourceBytes)) return void 0;
	const discovered = await discoverInstructionFiles(options, fileSystem);
	const loaded = [];
	for (const file of discovered) {
		const content = await readBounded(file, config.maxSourceBytes, fileSystem, options.signal);
		if (content !== void 0) loaded.push({
			absolutePath: file.absolutePath,
			displayPath: file.displayPath,
			content,
			...file.version === void 0 ? {} : { version: file.version }
		});
	}
	const kept = dedupInstructionFilesByCandidateGroup(loaded);
	if (kept.length === 0) {
		if (options.replacePreviousBaseline !== true) return void 0;
		const { rendered, included } = renderAgentInstructionSet([], {
			maxBytes: config.maxBytes,
			replacePreviousBaseline: true
		});
		return {
			rendered,
			observed: [],
			deduped: [],
			included
		};
	}
	const keptPaths = new Set(kept.map((file) => file.absolutePath));
	const { rendered, included } = renderAgentInstructionSet(kept, {
		maxBytes: config.maxBytes,
		...options.replacePreviousBaseline === void 0 ? {} : { replacePreviousBaseline: options.replacePreviousBaseline }
	});
	return {
		rendered,
		observed: loaded,
		deduped: loaded.filter((file) => !keptPaths.has(file.absolutePath)),
		included
	};
}
// Official resource loading owns instruction freshness. This plugin only records
// successful file-tool paths for the next official resource refresh; no inbox,
// message publication, step boundary or Session projection is involved.
const name='night-native-agent-instructions'
const inject=['workingDirectory']
const FILE_TOUCH_TOOL_NAMES=new Set(['read','read_window','write','edit'])
function filePathFromExecution(exec){
 if(!FILE_TOUCH_TOOL_NAMES.has(exec.name)||typeof exec.arguments?.path!=='string')return
 const path=exec.arguments.path.trim();return path||undefined
}
function apply(ctx,config){
 resolveConfig(config)
 let closed=false;const pathsByActor=new WeakMap()
 const assertActor=actor=>{
  if(closed||scopeOf(actor?.ctx)!==actor||actor?.lifecycle?.isLive()!==true)throw new Error('PI_INSTRUCTION_ACTOR_REQUIRED')
  return officialWorkingDirectoryOrigin(actor)
 }
 ctx.provide('nativeAgentInstructions',Object.freeze({owner:name,contextAuthority:'pi-session-manager',officialDiscoveredPaths(actor){assertActor(actor);return [...pathsByActor.get(actor)??[]]}}))
 ctx.effect(()=>()=>{closed=true},'native-agent-instructions official observation disposal')
 ctx.on('tools/result',(exec,result)=>{
  if(result.isError||exec.signal.aborted)return
  const path=filePathFromExecution(exec);if(path===undefined)return
  assertActor(exec.agent)
  const cwd=ctx.workingDirectory.get(exec.agent)
  let paths=pathsByActor.get(exec.agent);if(!paths){paths=new Set();pathsByActor.set(exec.agent,paths)}
  paths.add(resolve(cwd,path))
 })
}
export {Config,apply,discoverBaselineInstructionFiles,inject,loadBaselineInstructions,name,renderAgentInstructions}

/** Authorized file-source bridge for Pi ResourceLoader. No surface publication,
 * inbox reconciliation or historical instruction fold is involved. Budgeted
 * truncation needs an explicit source policy; never pass unbounded originals. */
export async function officialInstructionFiles(options,fileSystem){
 options.signal?.throwIfAborted()
 const loaded=await loadBaselineInstructionSet(options,fileSystem)
 if(!loaded)return []
 if(loaded.rendered.omitted.length||loaded.rendered.truncated.length)throw Object.assign(new Error('Instruction resources exceed the authorized complete-file budget'),{code:'PI_OFFICIAL_INSTRUCTION_BUDGET_EXCEEDED'})
 return loaded.included.map(file=>({path:file.absolutePath,content:file.content}))
}
