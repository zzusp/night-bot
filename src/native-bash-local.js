import {runManagedShell} from './runtime/managed-shell-execution.js';
// MIT source-derived shell execution/control compatibility algorithms; see licenses/dsh-bash-local-MIT.txt. Application process/sandbox/jobs/policy services own effects.
import z from "@deepseek-ai/schemastery";
import { ShellExecutor } from "./native-shell.js";
import { MAX_TIMER_DELAY_MS, clampTimeout } from "./runtime/deadlines.js";
//#region lib/types/index.js
/**
* Local Service Provider for the bash capability seam over the subprocess
* capability seam. Public commands run as `bash -c` in a provider-managed range
* through `ctx.subprocess`; subclasses may reuse the same mechanics with an
* explicit argv. This executor owns command defaulting, deadlines and cause
* classification, the model-friendly terminal environment, and the model-facing
* stdout/stderr merge for background reads. Execution policy belongs in
* `tools/pre-execute` or a sandboxing executor.
* @module @deepseek-ai/dsh-bash-local
*/
/**
* Model-friendly environment overrides: disable colors, pagers, and
* interactive terminal features that would garble tool output (the same set
* Codex hardcodes; Claude Code achieves it via TERM=dumb). Bash-tool policy —
* merged first into the spawn's explicit env, so a trusted caller's own entry
* still wins; the subprocess service applies its credential scrub independently.
*/
const ENV_OVERRIDES = {
	NO_COLOR: "1",
	TERM: "dumb",
	PAGER: "cat",
	GIT_PAGER: "cat"
};
/** Default SIGTERM→SIGKILL grace period (the `graceMs` config; matches OpenCode's 3s). */
const DEFAULT_GRACE_MS = 3e3;
/** Default per-stream spill cap (the `maxSpillBytes` config). */
const DEFAULT_MAX_SPILL_BYTES = 64 * 1024 * 1024;
/** Project a settled collect-mode reader into the final CollectedOutput shape. */

function assertPositiveFinite(name, value) {
	if (!Number.isFinite(value) || value <= 0) throw new Error(`bash-local: ${name} must be a positive finite number`);
}
/**
* Reject a resolved section this executor could not run with. The schema
* expresses neither "positive and finite" nor the timer bound `graceMs` has to
* fit, so a stored value that cannot be used fails at the next command.
* @param config - the live configuration, schema-valid by construction.
* @throws Error naming the field that cannot be used.
*/
function assertServiceableBashConfig(config) {
	assertPositiveFinite("timeoutMs", config.timeoutMs.get());
	assertPositiveFinite("maxTimeoutMs", config.maxTimeoutMs.get());
	assertPositiveFinite("maxOutputBytes", config.maxOutputBytes.get());
	assertPositiveFinite("maxSpillBytes", config.maxSpillBytes.get());
	assertPositiveFinite("graceMs", config.graceMs.get());
	if (config.graceMs.get() > MAX_TIMER_DELAY_MS) throw new Error(`bash-local: graceMs must be no greater than ${MAX_TIMER_DELAY_MS}`);
}
/**
* Local bash executor over `ctx.subprocess`. Bounded output, spill files,
* managed-range SIGTERM→SIGKILL escalation, and quiescence are the subprocess
* service's mechanics; this executor supplies their configured budgets per spawn, so a
* still-running background process stays managed (killed and joined at
* composition teardown) even across an executor reload.
*/
var LocalBashExecutor = class NativeLocalBashExecutor extends ShellExecutor {
	config;
	static inject = ["subprocess"];
	static Config = z.object({
		cwd: z.string().volatile(),
		timeoutMs: z.number().default(12e4).volatile(),
		maxTimeoutMs: z.number().default(6e5).volatile(),
		maxOutputBytes: z.number().default(64e3).volatile(),
		maxSpillBytes: z.number().default(DEFAULT_MAX_SPILL_BYTES).volatile(),
		graceMs: z.number().default(DEFAULT_GRACE_MS).volatile()
	});
	constructor(ctx, config) {
		super(ctx);
		this.config = config;
	}
	/**
	* Resolve a request into a fully-specified spec: fill `workdir` from
	* `config.cwd` (else `process.cwd()`), and `timeoutMs` from
	* `config.timeoutMs`, capped at `config.maxTimeoutMs`. The tool layer calls
	* this before {@link execute}, so it receives explicit values and never
	* re-defaults.
	*/
	resolve(request) {
		assertServiceableBashConfig(this.config);
		const timeoutMs = clampTimeout(request.timeoutMs, this.config.timeoutMs.get(), this.config.maxTimeoutMs.get(), "bash-local: request.timeoutMs");
		const stdoutMaxBytes = request.stdoutMaxBytes ?? this.config.maxOutputBytes.get();
		assertPositiveFinite("request.stdoutMaxBytes", stdoutMaxBytes);
		return {
			command: request.command,
			workdir: request.workdir ?? this.config.cwd.get() ?? process.cwd(),
			timeoutMs,
			onExpiry: request.onExpiry ?? "kill",
			stdoutMaxBytes,
			...request.signal ? { signal: request.signal } : {},
			...request.stdin !== void 0 ? { stdin: request.stdin } : {},
			...request.env !== void 0 ? { env: request.env } : {},
			...request.executionEnv !== void 0 ? { executionEnv: request.executionEnv } : {},
			sandboxPolicy: request.sandboxPolicy
		};
	}
	/** Map one resolved bash spec and explicit argv onto a fully-specified subprocess spawn. */
	spawnSpec(spec, argv, stdoutMaxBytes, signal) {
		const collect = (maxBytes) => ({
			maxBytes,
			spill: { maxBytes: this.config.maxSpillBytes.get() }
		});
		return {
			argv,
			cwd: spec.workdir,
			stdio: {
				stdin: spec.stdin !== void 0 ? { data: spec.stdin } : "ignore",
				stdout: collect(stdoutMaxBytes),
				stderr: collect(this.config.maxOutputBytes.get())
			},
			graceMs: this.config.graceMs.get(),
			signal,
			env: {
				...ENV_OVERRIDES,
				...spec.env,
				...spec.executionEnv
			}
		};
	}
	/** The collect-mode readers the executor itself requested (present by construction). */
	static collected(handle) {
		const { stdout, stderr } = handle.collected;
		/* v8 ignore start -- collect dispositions expose both readers by the seam contract; defensive. */
		if (stdout === void 0 || stderr === void 0) throw new Error("bash-local: subprocess implementation dropped a requested collect stream");
		/* v8 ignore stop */
		return {
			stdout,
			stderr
		};
	}
	async execute(spec) {
		return this.executeArgv(spec, [
			"bash",
			"-c",
			spec.command
		]);
	}
	/**
	* Execute an explicit argv with the lifecycle, environment, output,
	* deadline, and cancellation semantics of this executor. Subclasses use this
	* after replacing the public command's shell argv at an execution boundary.
	* @param spec - resolved execution settings and caller-owned command metadata.
	* @param argvOrPrepare - exact argv, or preparation using the execution cancellation signal.
	* @param onStarted - installs provider facts synchronously before the handle can settle.
	* @returns the live execution handle; spawn rejection settles the handle as
	*   killed while `result()` carries the same failure as its rejection.
	*/
	async executeArgv(spec, argvOrPrepare, onStarted) {
		return runManagedShell({spec,prepare:argvOrPrepare,spawn:(argv,signal)=>this.ctx.subprocess.spawn(this.spawnSpec(spec, argv, spec.stdoutMaxBytes, signal)),onStarted,onSettled:(...args)=>this.onProcessDone(...args)});
	}

	/**
	* Settlement hook for subclasses that attach execution facts to a process.
	* Called after exit facts or provider-failure output are stamped and before
	* {@link ShellProcess.done} resolves. The base implementation is intentionally
	* empty.
	* @param _proc - the settled process handle.
	* @param _stderr - the process's retained stderr tail used by subclasses for settlement classification.
	* @param _providerRejected - whether the subprocess promise rejected without a direct outcome.
	* @param _providerError - the provider rejection reason, which may itself be undefined.
	*/
	onProcessDone(_proc, _stderr, _providerRejected, _providerError) {}
};
//#endregion
export { ENV_OVERRIDES, LocalBashExecutor, LocalBashExecutor as default, assertServiceableBashConfig };
