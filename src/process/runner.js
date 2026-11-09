import { runLinuxBootstrap } from "./linux-bootstrap.js";
// Derived from DeepSeek dsh-subprocess-local 0.2.1-alpha.2 (MIT).
// Copyright (c) 2026 DeepSeek. See licenses/dsh-subprocess-local-MIT.txt.
import { S as loadLinuxExecve, a as resolveWindowsExecutable, b as serializeRunnerError, g as linuxLaunchFilesFromLocator, h as isWindowsTerminateRequest, i as parseRunnerTargetArgv, r as consumeRunnerSelection, t as SUBPROCESS_RUNNER_ENV, v as parseWindowsStartRequest, x as writeLinuxStartupError } from "./runner-launch-B2zsQ1Dz.js";
import { closeSync } from "node:fs";
import { _ as parseWindowsRunnerResult, parseWindowsTerminalResizeRequest, parseWindowsResourceAcknowledgement, parseWindowsScopeProofResult } from "./runner-launch-B2zsQ1Dz.js";
import { parseWindowsResourceOwnership, parseWindowsResourceProof } from "./contracts.js";
import { loadWindowsAppContainerBindings } from "./windows-acl.js";
import { createOwnedAppContainerProfile } from "./windows-profile.js";
import { SUBPROCESS_CONTROL_FD } from "./control.js";
import { Win32Error, closeHandleChecked, closeLpacJobProcessHandles, createSuspendedLpacJobProcess, inspectFailedLpacJobProcess, inspectLpacJobProcess, isJobEmpty, loadWin32ProcessBindings, pollProcessExit, resumeLpacJobProcess, spawnCurrentTokenJobProcess, terminateJob } from "./win32.js";
//#region lib/types/spawn-runner.js
/** One-shot Linux exec bootstrap and Windows Job-owning subprocess runner. */
const defaultInternals = {
	/* v8 ignore next -- source/built/packaged subprocess smoke executes this only in a replaceable child process. */
	execve: (file, argv, env, control) => loadLinuxExecve()(file, argv, env, control),
	loadWin32ProcessBindings,
	loadWindowsAppContainerBindings,
	createOwnedAppContainerProfile,
	createSuspendedLpacJobProcess,
	inspectFailedLpacJobProcess,
	inspectLpacJobProcess,
	resumeLpacJobProcess,
	closeLpacJobProcessHandles,
	spawnCurrentTokenJobProcess,
	closeFileDescriptor: closeSync,
	resolveWindowsExecutable,
	pollProcessExit,
	isJobEmpty,
	terminateJob,
	closeHandleChecked
};
const NODE_SPAWN_DETAIL_CODES = new Set(["EACCES", "ENOENT"]);
const WINDOWS_SPAWN_ERROR_CODES = new Map([
	[2, "ENOENT"],
	[3, "ENOENT"],
	[267, "ENOENT"],
	[5, "EPERM"],
	[193, "EFTYPE"],
	[740, "EACCES"]
]);
function nodeSpawnError(syscall, code, path) {
	return {
		name: "Error",
		message: `${syscall} ${code}`,
		code,
		syscall,
		...path === void 0 ? {} : { path }
	};
}
function asSpawnError(error, program) {
	const serialized = serializeRunnerError(error);
	if (!(error instanceof Win32Error)) return serialized.code === void 0 ? serialized : nodeSpawnError(`spawn ${program}`, serialized.code, program);
	const code = WINDOWS_SPAWN_ERROR_CODES.get(error.win32Code) ?? "UNKNOWN";
	if (NODE_SPAWN_DETAIL_CODES.has(code)) return nodeSpawnError(`spawn ${program}`, code, program);
	return nodeSpawnError("spawn", code);
}
function windowsPathNotFoundError(program) {
	return nodeSpawnError(`spawn ${program}`, "ENOENT", program);
}
function windowsStartCancelledError() {
	return {
		name: "Error",
		message: "subprocess target start was cancelled"
	};
}
function sendMessage(host, result) {
	return new Promise((resolve, reject) => {
		if (!host.connected || host.send === void 0) {
			reject(/* @__PURE__ */ new Error("subprocess runner IPC is not connected"));
			return;
		}
		try {
			host.send(result, (error) => {
				if (error === null) resolve();
				else reject(error);
			});
		} catch (error) {
			reject(error instanceof Error ? error : new Error(String(error)));
		}
	});
}
var WindowsJobRunner = class {
	argv;
	host;
	internals;
	api;
	processHandle;
	jobHandle;
	pollTimer;
	startSeen = false;
	terminateRequested = false;
	resultStarted = false;
	resultDelivered = false;
	finished = false;
	completion = Promise.withResolvers();
	resourceProtocol;
	resourceSequence = 0;
	resourcePending;
	resourceFailure;
	resourceLast;
	scopeProofSequence = 0;
	scopeProofPending;
	preparationAbort = new AbortController();
	preparationOperation;
	failureOperation;
	lpacProfile;
	lpacFrame;
	lpacLaunchFailure;
	lpacPreparing = false;
	lpacChildSettled = true;
	lpacJobEmpty = true;
	lpacScopeReleased = true;
	lpacTerminationAttempted = false;
	lpacCleanupAttempted = false;
	lpacReleased = false;
	lpacExitCode;
	lpacCompletion;
 terminalRequested;
 terminalReady = false;
 terminalResizeSequence = 0;
 terminalResizePending = false;
 terminalOperations = new Set();
	constructor(argv, host, internals) {
		this.argv = argv;
		this.host = host;
		this.internals = internals;
	}
	run() {
		if (!this.host.connected || this.host.send === void 0) {
			this.finish(127);
			return this.completion.promise;
		}
		this.host.on("message", this.onMessage);
		this.host.once("disconnect", this.onDisconnect);
		return this.completion.promise;
	}
	onMessage = (value) => {
		if (this.finished) return;
		if (isWindowsTerminateRequest(value)) {
			this.requestTermination();
			return;
		}
		if (value?.type === 'scope-proof-result' || value?.type === 'scope-proof-error') {
   try {
    const result=parseWindowsScopeProofResult(value), pending=this.scopeProofPending;
    if (this.resourceProtocol !== 1 || pending === void 0 || pending.sequence !== result.sequence || pending.received) throw new Error('Windows scope proof response is unbound or out of sequence');
    pending.received=true;
    if (result.type === 'scope-proof-error') { pending.lookupFailure=new Error('Windows committed scope proof lookup failed');pending.done.reject(pending.lookupFailure); }
    else pending.done.resolve(result.proofs);
   } catch (error) {this.rejectPendingResource(error);void this.runnerFailure(error);}
   return;
  }
		if (value?.type === "resource-ack" || value?.type === "resource-error") {
			try {
				const ack = parseWindowsResourceAcknowledgement(value), pending = this.resourcePending;
				if (this.resourceProtocol !== 1 || pending === void 0 || pending.acknowledged || ack.sequence !== pending.sequence) throw new Error("Windows resource acknowledgement is unbound or out of sequence");
				pending.acknowledged = true;
				if (ack.type === "resource-error") this.rejectPendingResource(new Error("Windows resource journal commit failed or is unknown"));
				else pending.done.resolve(ack.entryId);
			} catch (error) {
				this.rejectPendingResource(error);
				void this.runnerFailure(error);
			}
			return;
		}
  if (value?.type === 'terminal-resize') {
   try {
    const request=parseWindowsTerminalResizeRequest(value);
    if (!this.terminalReady || this.terminateRequested || this.lpacCleanupAttempted || this.resultStarted || this.terminalResizePending || request.sequence !== this.terminalResizeSequence+1) throw new Error('Windows terminal resize is unbound or out of sequence');
    this.terminalResizePending=true;
    const operation=Promise.resolve().then(async()=>{
     await this.lpacProfile.resizeTerminal(request.cols,request.rows);
     this.terminalResizeSequence=request.sequence;
     this.terminalResizePending=false;
     await sendMessage(this.host,{type:'terminal-resized',sequence:request.sequence});
    });
    this.terminalOperations.add(operation);
    void operation.then(()=>this.terminalOperations.delete(operation),error=>{
     this.terminalOperations.delete(operation);this.terminalResizePending=false;void this.runnerFailure(error);
    });
   } catch(error) {void this.runnerFailure(error);}
   return;
  }
		if (this.startSeen) {
			const error = new Error("subprocess runner received more than one Windows start request");
			this.rejectPendingResource(error);
			void this.runnerFailure(error);
			return;
		}
		let request;
		try {
			request = parseWindowsStartRequest(value);
		} catch (error) {
			this.rejectPendingResource(error);
			void this.runnerFailure(error);
			return;
		}
		this.startSeen = true;
		this.resourceProtocol = request.resourceProtocol;
  this.terminalRequested = request.terminal;
		this.preparationOperation = this.start(request);
		void this.preparationOperation.catch(error => this.runnerFailure(error));
	};
	onDisconnect = () => {
		if (this.finished) return;
		const error = new Error("Windows runner IPC disconnected");
		this.preparationAbort.abort(error);
		this.rejectPendingResource(error);
		void this.runnerFailure(error, false);
	};
	async recordResource(value, privateProof) {
		if (this.finished || this.resourceFailure !== void 0 || this.resourceProtocol !== 1 || this.resourcePending !== void 0 || this.scopeProofPending !== void 0 || this.resourceLast?.status === "released") throw new Error("Windows resource recording is not active");
		const descriptor = parseWindowsResourceOwnership(value), proof = privateProof === void 0 ? undefined : parseWindowsResourceProof(privateProof);
		const pending = {sequence:this.resourceSequence + 1, descriptor, done:Promise.withResolvers(), acknowledged:false};
		this.resourcePending = pending;
		try {
			// send 完成不代表耐久；只有父 Host 提交原 Job 后的精确 ACK 才解锁。
			const [,entryId] = await Promise.all([sendMessage(this.host, {type:"resource-ownership", sequence:pending.sequence, descriptor, ...proof === void 0 ? {} : {privateProof:proof}}), pending.done.promise]);
			this.resourceSequence = pending.sequence;
			this.resourceLast = descriptor;
			return entryId;
		} catch (error) {
			this.rejectPendingResource(error);
			throw error;
		} finally {
			if (this.resourcePending === pending) this.resourcePending = void 0;
		}
	}
 async readScopeProofs(fileIds) {
  if (this.finished || this.resourceFailure !== void 0 || this.resourceProtocol !== 1 || this.resourcePending !== void 0 || this.scopeProofPending !== void 0) throw new Error('Windows scope proof lookup is not active');
  const query=parseWindowsRunnerResult({type:'scope-proof-query',sequence:this.scopeProofSequence+1,fileIds});
  const pending={sequence:query.sequence,done:Promise.withResolvers(),received:false};
  this.scopeProofSequence=query.sequence;
  this.scopeProofPending=pending;
  try {
   const [,proofs]=await Promise.all([sendMessage(this.host,query),pending.done.promise]);
   return proofs;
  } catch (error) {if(error!==pending.lookupFailure)this.rejectPendingResource(error);throw error;}
  finally {if(this.scopeProofPending===pending)this.scopeProofPending=void 0;}
 }
	rejectPendingResource(error) {
		this.resourceFailure ??= error;
		this.resourcePending?.done.reject(error);
  this.scopeProofPending?.done.reject(error);
	}
	async start(request) {
		if (this.terminateRequested) {
			if (this.failureOperation !== void 0) return;
			await this.publishTerminalResult({
				type: "error",
				error: windowsStartCancelledError()
			}, 0);
			return;
		}
		await new Promise((resolveImmediate) => {
			setImmediate(resolveImmediate);
		});
		if (this.finished) return;
		if (this.terminateRequested) {
			if (this.failureOperation !== void 0) return;
			await this.publishTerminalResult({
				type: "error",
				error: windowsStartCancelledError()
			}, 0);
			return;
		}
		try {
			if (request.lpac !== void 0 && this.resourceProtocol !== 1) throw new Error("LPAC requires the original durable Job resource protocol");
			const [command, ...args] = this.argv;
			const applicationName = this.internals.resolveWindowsExecutable(command, request.cwd, request.env, void 0, { ...this.host.env });
			if (applicationName === void 0) {
				await this.publishTerminalResult({
					type: "error",
					error: windowsPathNotFoundError(command)
				}, 0);
				return;
			}
			if (request.lpac !== void 0) {
				await this.startLpac(request, { command, applicationName, args });
				return;
			}
			this.api = this.internals.loadWin32ProcessBindings();
			const spawned = this.internals.spawnCurrentTokenJobProcess(this.api, {
				command,
				applicationName,
				args,
				cwd: request.cwd,
				env: request.env,
				stdio: {
					stdin: 4,
					stdout: 5,
					stderr: 6,
					...request.control === "pipe" ? { control: SUBPROCESS_CONTROL_FD } : {}
				}
			});
			this.processHandle = spawned.process;
			this.jobHandle = spawned.job;
			for (const fileDescriptor of request.control === "pipe" ? [
				4,
				5,
				6,
				SUBPROCESS_CONTROL_FD
			] : [
				4,
				5,
				6
			]) this.internals.closeFileDescriptor(fileDescriptor);
			this.pollTimer = setInterval(() => {
				this.poll();
			}, 10);
		} catch (error) {
			if (request.lpac === void 0 && this.jobHandle === void 0 && error instanceof Win32Error && error.api === "CreateProcessW") {
				await this.publishTerminalResult({
					type: "error",
					error: asSpawnError(error, this.argv[0])
				}, 0);
				return;
			}
			throw error;
		}
	}
	lpacNativeState() {
		if (this.lpacFrame !== void 0) return this.internals.inspectLpacJobProcess(this.api, this.lpacFrame);
		if (this.lpacLaunchFailure !== void 0) return this.internals.inspectFailedLpacJobProcess(this.api, this.lpacLaunchFailure);
	}
	lpacOwnership() {
		const native = this.lpacNativeState(), preparation = native?.preparationResources;
		const handles = native === void 0 ? 0 : [native.process, native.job, native.initialThread].filter(value => value !== null && value !== void 0).length;
		const allocations = (preparation?.attributes?.allocations.length ?? 0) + Object.keys(preparation?.allocations ?? {}).length;
		return {
			status: "unknown-retained", nativeHandles: handles + (preparation?.inherited.length ?? 0), nativeAllocations: allocations,
			preparationPending: this.lpacPreparing || native !== void 0 && (!native.preparationReleased || native.pendingPreparation !== void 0),
			childSettled: this.lpacChildSettled, jobEmpty: this.lpacJobEmpty,
			nativeHandlesClosed: handles === 0 && preparation === void 0, scopeReleased: this.lpacScopeReleased
		};
	}
	async startLpac(request, target) {
		this.lpacPreparing = true;
		const recordResource = value => this.recordResource(value);
		// 两个非枚举私有端口必须显式投影，不能用函数spread丢掉耐久证明来源。
		Object.defineProperties(recordResource, {
			withProof: { value: (value, proof) => this.recordResource(value, proof) },
			readScopeProofs: { value: fileIds => this.readScopeProofs(fileIds) }
		});
		try {
			this.preparationAbort.signal.throwIfAborted();
			this.api = this.internals.loadWindowsAppContainerBindings();
			try {
				this.lpacProfile = await this.internals.createOwnedAppContainerProfile({ recordResource, policy: request.lpac, signal: this.preparationAbort.signal });
			} catch (error) {
				if (error.profileResource !== void 0) this.lpacProfile = error.profileResource;
				throw error;
			}
			this.preparationAbort.signal.throwIfAborted();
			this.lpacProfile.prepareScopeRoots();
			await this.lpacProfile.commitOwnedProof(this.lpacOwnership());
			this.preparationAbort.signal.throwIfAborted();
			this.lpacProfile.revalidate();
			const env = this.lpacProfile.launchEnvironment(request.env);
   const pseudoConsole = request.terminal === undefined ? undefined : await this.lpacProfile.createTerminal({
    ...request.terminal,input:this.host.stdin,output:this.host.stdout,onFailure:error=>{void this.runnerFailure(error);}
   });
   this.preparationAbort.signal.throwIfAborted();
			this.lpacProfile.markLaunchAttempted();
			try {
				this.lpacFrame = this.internals.createSuspendedLpacJobProcess(this.api, {
					...target, cwd: request.cwd, env, packageSid: this.lpacProfile.packageSid,
					...pseudoConsole === undefined ? {stdio: { stdin: 4, stdout: 5, stderr: 6, ...request.control === "pipe" ? { control: SUBPROCESS_CONTROL_FD } : {} }} : {pseudoConsole}
				});
			} catch (error) {
				// 只接原Native抛出对象的WeakMap归属，不消费可复制的nativeOwnership摘要。
				const native = this.internals.inspectFailedLpacJobProcess(this.api, error);
				this.lpacLaunchFailure = error;
				this.processHandle = native.process ?? void 0; this.jobHandle = native.job ?? void 0;
				this.lpacChildSettled = !native.childCreated; this.lpacJobEmpty = native.job === null;
				this.lpacTerminationAttempted = native.childCreated;
				throw error;
			}
			this.processHandle = this.lpacFrame.process; this.jobHandle = this.lpacFrame.job;
			this.lpacChildSettled = this.lpacJobEmpty = false;
			this.lpacProfile.bindSuspended(this.lpacFrame);
			if (request.terminal === undefined) for (const fd of request.control === "pipe" ? [4, 5, 6, SUBPROCESS_CONTROL_FD] : [4, 5, 6]) this.internals.closeFileDescriptor(fd);
			await this.lpacProfile.sealSuspendedLaunch(this.lpacFrame, { ownership: this.lpacOwnership() });
			this.lpacScopeReleased = false;
			const prepared = await this.lpacProfile.prepareSuspendedScopes(this.lpacFrame, { ownership: this.lpacOwnership() });
			// 组件尚未通过Native与mandatory回收验收；false必须继续阻止唯一Resume。
			if (prepared.scopeReady !== true) throw new Error("Windows LPAC scope admission is not ready; current-token fallback is forbidden");
			this.preparationAbort.signal.throwIfAborted();
			this.lpacProfile.assertReadyToResume(this.lpacFrame);
			this.internals.resumeLpacJobProcess(this.api, this.lpacFrame);
			this.pollTimer = setInterval(() => this.poll(), 10);
   if (request.terminal !== undefined) {
    this.terminalReady=true;
    await sendMessage(this.host,{type:'terminal-ready',pid:this.lpacFrame.pid});
   }
		} finally { this.lpacPreparing = false; }
	}
	async waitLpacDrain() {
		const native = this.lpacNativeState();
		if (native === void 0) return;
		if (!native.preparationReleased || native.pendingPreparation !== void 0) throw new Error("LPAC native preparation remains unjoined or unreleased");
		if (native.childCreated && native.process === null) throw new Error("LPAC child has no original settlement handle");
		for (;;) {
			this.lpacChildSettled = !native.childCreated || this.internals.pollProcessExit(this.api, native.process) !== void 0;
			this.lpacJobEmpty = native.job === null || this.internals.isJobEmpty(this.api, native.job);
			if (this.lpacChildSettled && this.lpacJobEmpty) return;
			await new Promise(resolve => setTimeout(resolve, 10));
		}
	}
	async releaseLpac() {
		if (this.lpacCleanupAttempted) throw new Error("LPAC mandatory cleanup cannot be repeated");
		this.lpacCleanupAttempted = true;
		try {
			await this.waitLpacDrain();
   const operations=await Promise.allSettled([...this.terminalOperations]);
   if (this.terminalRequested !== undefined) await this.lpacProfile.closeTerminalAfterDrain({frame:this.lpacFrame,failure:this.lpacLaunchFailure});
   // resize失败已由原runnerFailure保留；全部操作join后仍须继续撤权与SDK回收。
   if (operations.some(result=>result.status==='rejected')) this.terminalReady=false;
			if (this.lpacFrame !== void 0) {
				await this.lpacProfile.releaseScopesAfterNativeDrain(this.lpacFrame, { ownership: this.lpacOwnership() });
				this.lpacScopeReleased = true;
				this.lpacProfile.deleteAfterNativeDrain({ process: this.lpacFrame.process, job: this.lpacFrame.job, closeLaunchHandles: () => this.internals.closeLpacJobProcessHandles(this.api, this.lpacFrame) });
			} else if (this.lpacLaunchFailure !== void 0) this.lpacProfile.deleteAfterFailedLaunch(this.lpacLaunchFailure);
			else this.lpacProfile.deleteUnlaunched();
			this.processHandle = this.jobHandle = void 0;
			await this.recordResource(this.lpacProfile.describeOwnership({ ...this.lpacOwnership(), status: "released" }));
			this.lpacReleased = true;
		} catch (error) {
			try { await this.recordResource(this.lpacProfile.describeOwnership(this.lpacOwnership())); }
			catch (recording) { throw new AggregateError([error, recording], "LPAC cleanup and durable unknown ownership recording failed"); }
			throw error;
		}
	}
	pollLpac() {
		if (this.failureOperation !== void 0 || this.lpacCompletion !== void 0) return;
		if (this.lpacExitCode === void 0) {
			const exitCode = this.internals.pollProcessExit(this.api, this.processHandle);
			if (exitCode !== void 0) { this.lpacExitCode = exitCode; this.lpacChildSettled = true; }
		}
		if (this.lpacExitCode !== void 0 && this.internals.isJobEmpty(this.api, this.jobHandle)) {
			this.lpacJobEmpty = true;
			// direct退出不关证明句柄；只有同Job归零且回收耐久后才交业务终态。
			this.lpacCompletion = this.completeLpac();
			void this.lpacCompletion.catch(error => this.runnerFailure(error));
		}
	}
	async completeLpac() {
		await this.preparationOperation;
		await this.releaseLpac();
		await this.publishTerminalResult({ type: "target-exit", exitCode: this.lpacExitCode }, 0);
	}
	requestTermination() {
		if (this.terminateRequested) return;
		this.terminateRequested = true;
		this.preparationAbort.abort(new Error("Windows target preparation cancelled"));
		try {
			this.terminateOwnedJob();
		} catch (error) {
			this.runnerFailure(error);
		}
	}
	terminateOwnedJob() {
		// SDK回收可能已关闭原Job；不能在后续错误中使用runner留下的旧数值句柄。
		const native = this.lpacProfile === void 0 ? void 0 : this.lpacNativeState();
		if (native?.jobCloseAttempted && native.job !== null) throw new Error("LPAC Job closure is unknown; its numeric handle cannot be reused");
		const job = this.lpacProfile === void 0 ? this.jobHandle : native?.job;
		if (job === void 0 || job === null) return;
		/* v8 ignore next -- a Job handle is assigned only after the bindings are loaded;
		* the guard above is the only reachable empty-owner state. */
		if (this.api === void 0) return;
		if (this.lpacProfile !== void 0) {
			if (this.lpacTerminationAttempted) return;
			this.lpacTerminationAttempted = true;
		}
		this.internals.terminateJob(this.api, job, 1);
	}
	poll() {
		if (this.finished) return;
		/* v8 ignore next -- poll is installed only after start() stores the bindings; retained as a defensive invariant guard. */
		if (this.api === void 0) return;
		try {
			if (this.lpacProfile !== void 0) { this.pollLpac(); return; }
			if (this.processHandle !== void 0) {
				const exitCode = this.internals.pollProcessExit(this.api, this.processHandle);
				if (exitCode !== void 0) {
					this.internals.closeHandleChecked(this.api, this.processHandle, "ordinary direct process");
					this.processHandle = void 0;
					this.publishTerminalResult({
						type: "target-exit",
						exitCode
					});
				}
			}
			if (this.jobHandle !== void 0 && this.internals.isJobEmpty(this.api, this.jobHandle)) {
				this.internals.closeHandleChecked(this.api, this.jobHandle, "ordinary process Job");
				this.jobHandle = void 0;
				if (this.resultDelivered) this.finish(0);
			}
		} catch (error) {
			this.runnerFailure(error);
		}
	}
	async publishTerminalResult(result, exitCode) {
		/* v8 ignore next -- each state transition has a single result call site; the guard contains only re-entrant internal defects. */
		if (this.finished || this.resultStarted) return;
		this.resultStarted = true;
		try {
			await sendMessage(this.host, result);
			this.resultDelivered = true;
		} catch (error) {
			if (this.lpacProfile !== void 0) { void this.runnerFailure(error, false); return; }
			this.releaseOwnedJob();
			this.finish(127, false);
			return;
		}
		if (exitCode !== void 0) {
			this.finish(exitCode);
			return;
		}
		if (this.jobHandle === void 0) this.finish(0);
	}
	runnerFailure(error, disconnect = true) {
		if (this.finished) return Promise.resolve();
		this.preparationAbort.abort(error);
		this.terminateRequested = true;
		if (this.failureOperation !== void 0) return this.failureOperation;
		// 完整start操作先join；不能在其await空档关闭随后才会取得的句柄。
		this.failureOperation = Promise.resolve().then(() => this.failAfterPreparation(error, disconnect));
		return this.failureOperation;
	}
	async failAfterPreparation(error, disconnect) {
		try { this.terminateOwnedJob(); } catch (termination) { error = new AggregateError([error, termination], "Windows runner failure and Job termination failed"); }
		try { await this.preparationOperation; } catch (preparation) { if(preparation!==error)error=new AggregateError([error,preparation],"Windows runner failure and preparation failed"); }
		if (this.finished) return;
		if (this.lpacProfile !== void 0) {
			if (this.pollTimer !== void 0) clearInterval(this.pollTimer);
			this.pollTimer = void 0;
			try {
				if (this.lpacCompletion !== void 0) await this.lpacCompletion;
				else await this.releaseLpac();
			} catch (cleanup) { if (cleanup !== error) error = new AggregateError([error, cleanup], "Windows LPAC failure and mandatory cleanup failed"); }
		}
		if (!this.resultStarted) {
			this.resultStarted = true;
			try {
				await sendMessage(this.host, {
					type: "error",
					error: serializeRunnerError(error)
				});
				this.resultDelivered = true;
			} catch {}
		}
		if (this.lpacProfile === void 0) this.releaseOwnedJob();
		this.finish(this.lpacReleased ? 0 : 127, disconnect);
	}
	releaseOwnedJob() {
		if (this.lpacProfile !== void 0) throw new Error("LPAC resources cannot use ordinary best-effort cleanup");
		if (this.pollTimer !== void 0) clearInterval(this.pollTimer);
		this.pollTimer = void 0;
		const api = this.api;
		if (api === void 0) return;
		if (this.jobHandle !== void 0) {
			try {
				this.internals.terminateJob(api, this.jobHandle, 1);
			} catch {}
			try {
				this.internals.closeHandleChecked(api, this.jobHandle, "ordinary process Job cleanup");
			} catch {}
			this.jobHandle = void 0;
		}
		if (this.processHandle !== void 0) {
			try {
				this.internals.closeHandleChecked(api, this.processHandle, "ordinary direct process cleanup");
			} catch {}
			this.processHandle = void 0;
		}
	}
	finish(exitCode, disconnect = true) {
		if (this.finished) return;
		this.finished = true;
		if (this.resourcePending !== void 0 || this.scopeProofPending !== void 0) this.rejectPendingResource(new Error("Windows runner finished before resource acknowledgement"));
		if (this.pollTimer !== void 0) clearInterval(this.pollTimer);
		this.pollTimer = void 0;
		this.host.off("message", this.onMessage);
		this.host.off("disconnect", this.onDisconnect);
		this.host.exitCode = exitCode;
		if (disconnect && this.host.connected) this.host.disconnect();
		this.completion.resolve();
	}
};
/**
* Execute the selected Linux bootstrap or Windows Job runner.
* @param selection - Windows sentinel or Linux launch-request locator.
* @param argv - private runner arguments beginning with the target delimiter.
* @param host - process transport and lifecycle host.
* @param internals - native and filesystem operations used by the runner.
*/
async function runSpawnRunner(selection, argv, host = process, internals = defaultInternals) {
	Reflect.deleteProperty(host.env, SUBPROCESS_RUNNER_ENV);
	const targetArgv = parseRunnerTargetArgv(argv);
	if (selection === "windows") {
		await new WindowsJobRunner(targetArgv, host, internals).run();
		return;
	}
	runLinuxBootstrap(selection, targetArgv, host, internals.execve);
}
/**
* Best-effort reporting for failures before the selected runner established its owner.
* @param selection - Windows sentinel, Linux launch-request locator, or no selection.
* @param error - failure raised before normal runner settlement.
* @param host - process transport and lifecycle host.
*/
async function reportSpawnRunnerFailure(selection, error, host = process) {
	if (selection === "windows") {
		try {
			await sendMessage(host, {
				type: "error",
				error: serializeRunnerError(error)
			});
		} catch {}
		host.exitCode = 127;
		if (host.connected) host.disconnect();
		return;
	}
	if (selection !== void 0) try {
		writeLinuxStartupError(linuxLaunchFilesFromLocator(selection), {
			type: "error",
			error: serializeRunnerError(error)
		});
	} catch {}
	host.exitCode = 127;
}
//#endregion
//#region lib/types/bin.js
/** Thin executable/importable entry for the provider-private runner core. */
/**
* Run a selector already removed by a packaging bootstrap.
* @param selection - private runner selector or Linux launch-request locator.
*/
async function runSelectedSubprocessRunner(selection) {
	try {
		await runSpawnRunner(selection, process.argv.slice(2));
	} catch (error) {
		await reportSpawnRunnerFailure(selection, error);
	}
}
if (import.meta.main) {
	const selection = consumeRunnerSelection();
	if (selection === void 0) process.exitCode = 127;
	else runSelectedSubprocessRunner(selection);
}
//#endregion
export { runSelectedSubprocessRunner };
