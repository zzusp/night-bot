// Derived from dsh-win32-process 0.2.1-alpha.2, Copyright (c) 2026 DeepSeek.
// MIT: licenses/dsh-subprocess-local-MIT.txt.
import { createLazyRequire } from "./contracts.js";
import { isAsyncFunction, isGeneratorFunction } from "node:util/types";
/** Win32 code reporting a caller-provided buffer is too small. */
const ERROR_INSUFFICIENT_BUFFER = 122;
/** Job limit that terminates every member when the final Job handle closes. */
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 8192;
//#endregion
//#region lib/types/errors.js
/** Win32 call failure with the exact API name and error code. */
var Win32Error = class extends Error {
	/** Win32 function whose checked result failed. */
	api;
	/** Exact GetLastError value or direct Win32 API error code. */
	win32Code;
	constructor(api, win32Code, detail) {
		super(`${api} failed (Win32 ${win32Code})${detail === void 0 ? "" : `: ${detail}`}`);
		this.name = "Win32Error";
		this.api = api;
		this.win32Code = win32Code;
	}
};
//#endregion
//#region lib/types/koffi.js
/** Process-realm lazy access to Koffi's CommonJS entry. */
/** Load Koffi on the first Win32 native operation. */
const requireKoffi = createLazyRequire("koffi", import.meta.url);
//#endregion
//#region lib/types/ffi.js
/** Lazy Koffi bindings for generic Win32 process, stdio, and Job operations. */
/**
* Return whether a Koffi pointer represents NULL.
* @param value - pointer value returned by Koffi or a Win32 call.
* @returns true for null, undefined, or address zero.
*/
function isNullPtr(value) {
	return value === null || value === void 0 || value === 0n;
}
let cachedTypes;
/** Resolve Koffi pointer and process layouts on the first native operation. */
function win32Types() {
	if (cachedTypes !== void 0) return cachedTypes;
	const koffi = requireKoffi();
	const PVOID = koffi.pointer("void");
	const PPVOID = koffi.pointer(PVOID);
	const STARTUPINFOW = koffi.struct("NightBot_STARTUPINFOW", {
		cb: "uint32",
		lpReserved: "str16",
		lpDesktop: "str16",
		lpTitle: "str16",
		dwX: "uint32",
		dwY: "uint32",
		dwXSize: "uint32",
		dwYSize: "uint32",
		dwXCountChars: "uint32",
		dwYCountChars: "uint32",
		dwFillAttribute: "uint32",
		dwFlags: "uint32",
		wShowWindow: "uint16",
		cbReserved2: "uint16",
		lpReserved2: koffi.pointer("uint8"),
		hStdInput: PVOID,
		hStdOutput: PVOID,
		hStdError: PVOID
	});
	const COORD = koffi.struct("NightBot_COORD", { X: "int16", Y: "int16" });
	const STARTUPINFOEXW = koffi.struct("NightBot_STARTUPINFOEXW", { StartupInfo: STARTUPINFOW, lpAttributeList: PVOID });
	const PROCESS_INFORMATION = koffi.struct("NightBot_PROCESS_INFORMATION", {
		hProcess: PVOID,
		hThread: PVOID,
		dwProcessId: "uint32",
		dwThreadId: "uint32"
	});
	/* v8 ignore start -- ABI guards are pinned by native header probes. */
	if (COORD.size !== 4) throw new Error(`COORD layout mismatch: ${COORD.size}`);
	if (STARTUPINFOEXW.size !== 112) throw new Error(`STARTUPINFOEXW layout mismatch: ${STARTUPINFOEXW.size}`);
	if (STARTUPINFOW.size !== 104) throw new Error(`STARTUPINFOW layout mismatch: koffi computed ${STARTUPINFOW.size}, expected 104`);
	if (PROCESS_INFORMATION.size !== 24) throw new Error(`PROCESS_INFORMATION layout mismatch: koffi computed ${PROCESS_INFORMATION.size}, expected 24`);
	/* v8 ignore stop */
	return cachedTypes = {
		PVOID,
		PPVOID,
		STARTUPINFOW,
		STARTUPINFOEXW,
		COORD,
		PROCESS_INFORMATION
	};
}
/**
* Allocate a pointer-sized out-parameter slot.
* @returns allocated native slot.
*/
function allocPtrSlot() {
	const { PVOID } = win32Types();
	return requireKoffi().alloc(PVOID, 1);
}
/**
* Allocate a uint32 out-parameter slot.
* @returns allocated native slot.
*/
function allocUint32() {
	return requireKoffi().alloc("uint32", 1);
}
/**
* Decode a pointer out-parameter.
* @param slot - pointer-sized slot filled by Win32.
* @returns decoded pointer, or null for address zero.
*/
function decodePtr(slot) {
	const value = requireKoffi().decode(slot, win32Types().PVOID);
	return isNullPtr(value) ? null : value;
}
/**
* Decode a uint32 out-parameter.
* @param slot - uint32 slot filled by Win32.
* @returns decoded unsigned value.
*/
function decodeUint32(slot) {
	return requireKoffi().decode(slot, "uint32");
}
/**
* Allocate a zeroed STARTUPINFOW.
* @returns allocated struct pointer.
*/
function allocStartupInfo() {
	return requireKoffi().alloc(win32Types().STARTUPINFOW, 1);
}
/**
* Encode the stdio-bearing STARTUPINFOW fields.
* @param startupInfo - allocated STARTUPINFOW pointer.
* @param fields - fields required for inherited stdio.
*/
function encodeStartupInfo(startupInfo, fields) {
	requireKoffi().encode(startupInfo, win32Types().STARTUPINFOW, fields);
}
/**
* Allocate a zeroed PROCESS_INFORMATION.
* @returns allocated struct pointer.
*/
function allocProcessInfo() {
	return requireKoffi().alloc(win32Types().PROCESS_INFORMATION, 1);
}
/**
* Decode PROCESS_INFORMATION.
* @param processInfo - struct pointer filled by CreateProcess.
* @returns process/thread handles and ids.
*/
function decodeProcessInfo(processInfo) {
	return requireKoffi().decode(processInfo, win32Types().PROCESS_INFORMATION);
}
let cachedContext;
let cached;
/* v8 ignore start -- exercised by native Windows ABI and sandbox jobs. */
function bindingContext() {
	if (cachedContext !== void 0) return cachedContext;
	const koffi = requireKoffi();
	const kernel32 = koffi.load("kernel32.dll");
	const advapi32 = koffi.load("advapi32.dll");
	const bind = (lib, name, result, args) => lib.func("__stdcall", name, result, args);
	cachedContext = {
		kernel32,
		advapi32,
		bind
	};
	return cachedContext;
}
function bindings() {
	if (cached !== void 0) return cached;
	const koffi = requireKoffi();
	const { PVOID, PPVOID, STARTUPINFOW, PROCESS_INFORMATION } = win32Types();
	const { kernel32, advapi32, bind } = bindingContext();
	const node = koffi.load(null);
	cached = {
		closeHandle: bind(kernel32, "CloseHandle", "int", [PVOID]),
		isProcessInJob: bind(kernel32, "IsProcessInJob", "int", [PVOID, PVOID, koffi.pointer("int")]),
		getLastError: bind(kernel32, "GetLastError", "uint32", []),
		getFileType: bind(kernel32, "GetFileType", "uint32", [PVOID]),
		formatMessageW: bind(kernel32, "FormatMessageW", "uint32", [
			"uint32",
			PVOID,
			"uint32",
			"uint32",
			PVOID,
			"uint32",
			PVOID
		]),
		createPipe: bind(kernel32, "CreatePipe", "int", [
			PPVOID,
			PPVOID,
			PVOID,
			"uint32"
		]),
		setHandleInformation: bind(kernel32, "SetHandleInformation", "int", [
			PVOID,
			"uint32",
			"uint32"
		]),
		createProcessAsUserW: bind(advapi32, "CreateProcessAsUserW", "int", [
			PVOID,
			"str16",
			"str16",
			PVOID,
			PVOID,
			"int",
			"uint32",
			PVOID,
			"str16",
			koffi.pointer(STARTUPINFOW),
			koffi.pointer(PROCESS_INFORMATION)
		]),
		createProcessW: bind(kernel32, "CreateProcessW", "int", [
			"str16",
			"str16",
			PVOID,
			PVOID,
			"int",
			"uint32",
			PVOID,
			"str16",
			koffi.pointer(STARTUPINFOW),
			koffi.pointer(PROCESS_INFORMATION)
		]),
		getHandleInformation: bind(kernel32, "GetHandleInformation", "int", [PVOID, koffi.pointer("uint32")]),
		initializeProcThreadAttributeList: bind(kernel32, "InitializeProcThreadAttributeList", "int", [PVOID, "uint32", "uint32", koffi.pointer("size_t")]),
		updateProcThreadAttribute: bind(kernel32, "UpdateProcThreadAttribute", "int", [PVOID, "uint32", "size_t", PVOID, "size_t", PVOID, PVOID]),
		deleteProcThreadAttributeList: bind(kernel32, "DeleteProcThreadAttributeList", "void", [PVOID]),
		createProcessExtendedW: bind(kernel32, "CreateProcessW", "int", ["str16", "str16", PVOID, PVOID, "int", "uint32", PVOID, "str16", PVOID, koffi.pointer(PROCESS_INFORMATION)]),
		readFile: bind(kernel32, "ReadFile", "int", [
			PVOID,
			PVOID,
			"uint32",
			koffi.pointer("uint32"),
			PVOID
		]),
		peekNamedPipe: bind(kernel32, "PeekNamedPipe", "int", [
			PVOID,
			PVOID,
			"uint32",
			koffi.pointer("uint32"),
			koffi.pointer("uint32"),
			koffi.pointer("uint32")
		]),
		waitForSingleObject: bind(kernel32, "WaitForSingleObject", "uint32", [PVOID, "uint32"]),
		getExitCodeProcess: bind(kernel32, "GetExitCodeProcess", "int", [PVOID, koffi.pointer("uint32")]),
		createJobObjectW: bind(kernel32, "CreateJobObjectW", PVOID, [PVOID, "str16"]),
		setInformationJobObject: bind(kernel32, "SetInformationJobObject", "int", [
			PVOID,
			"int",
			PVOID,
			"uint32"
		]),
		queryInformationJobObject: bind(kernel32, "QueryInformationJobObject", "int", [
			PVOID,
			"int",
			PVOID,
			"uint32",
			PVOID
		]),
		assignProcessToJobObject: bind(kernel32, "AssignProcessToJobObject", "int", [PVOID, PVOID]),
		resumeThread: bind(kernel32, "ResumeThread", "uint32", [PVOID]),
		terminateProcess: bind(kernel32, "TerminateProcess", "int", [PVOID, "uint32"]),
		terminateJobObject: bind(kernel32, "TerminateJobObject", "int", [PVOID, "uint32"]),
		getStdHandle: bind(kernel32, "GetStdHandle", PVOID, ["int"]),
		uvGetOsfhandle: node.func("uv_get_osfhandle", PVOID, ["int"])
	};
	return cached;
}
/**
* Extend the shared process table with caller-owned Win32 API families.
* @param create - binds only the caller-specific operations from the shared libraries.
* @returns generic process bindings combined with the caller-specific operations.
*/
function extendWin32ProcessBindings(create) {
	return {
		...bindings(),
		...create(bindingContext())
	};
}
/**
* Load the generic process binding table without policy-specific extensions.
* @returns shared Win32 process, stdio, and Job operations.
*/
function loadWin32ProcessBindings() {
	return bindings();
}
let cachedConpty;
function loadWin32ConptyBindings() {
 if (cachedConpty !== undefined) return cachedConpty;
 const { PVOID, PPVOID, COORD } = win32Types();
 return cachedConpty = extendWin32ProcessBindings(({ kernel32, bind }) => ({
  createPseudoConsole: bind(kernel32, "CreatePseudoConsole", "int32", [COORD, PVOID, PVOID, "uint32", PPVOID]),
  resizePseudoConsole: bind(kernel32, "ResizePseudoConsole", "int32", [PVOID, COORD]),
  closePseudoConsole: bind(kernel32, "ClosePseudoConsole", "void", [PVOID]),
  createNamedPipeW: bind(kernel32, "CreateNamedPipeW", PVOID, ["str16", "uint32", "uint32", "uint32", "uint32", "uint32", "uint32", PVOID]),
  connectNamedPipe: bind(kernel32, "ConnectNamedPipe", "int", [PVOID, PVOID]),
  getNamedPipeClientProcessId: bind(kernel32, "GetNamedPipeClientProcessId", "int", [PVOID, PVOID])
 }));
}
function pseudoConsoleSize(cols, rows) {
 if (![cols, rows].every(value => Number.isInteger(value) && value > 0 && value <= 32767)) throw new TypeError('ConPTY dimensions must be positive signed SHORT integers');
 return { X: cols, Y: rows };
}
function pseudoConsoleError(name, hresult) {
 const error = new Error(`${name} failed (HRESULT 0x${(hresult >>> 0).toString(16).padStart(8, '0')})`);
 error.api = name;
 error.hresult = hresult >>> 0;
 return error;
}
/** Native resource only: Close returning is not output EOF, Job0 or range completion. */
function createPseudoConsole(api, { input, output, cols, rows, asynchronous = false }) {
 const size = pseudoConsoleSize(cols, rows);
 if (isNullPtr(input) || isNullPtr(output)) throw new TypeError('ConPTY requires explicit synchronous pipe endpoints');
 const slot = Buffer.alloc(8);
 const adopt = hresult => {
  const handle = decodePtr(slot);
  if (hresult !== 0 || isNullPtr(handle)) {
   const error = hresult !== 0 ? pseudoConsoleError('CreatePseudoConsole', hresult) : new Error('CreatePseudoConsole succeeded without HPCON');
   if (!isNullPtr(handle)) error.pseudoConsoleOwnership = { handle, state: 'unknown' };
   throw error;
  }
  return ownPseudoConsole(api, handle);
 };
 if (!asynchronous) return adopt(api.createPseudoConsole(size, input, output, 0, slot));
 // Native 创建/resize/close 可阻塞；Node reader 在整个调用窗持续排空输出。
 return new Promise((resolve, reject) => {
  const failed = error => {
   const handle = decodePtr(slot);
   if (!isNullPtr(handle)) error.pseudoConsoleOwnership = { handle, state: 'unknown' };
   reject(error);
  };
  try {
   api.createPseudoConsole.async(size, input, output, 0, slot, (error, result) => {
    if (error) { failed(error); return; }
    try { resolve(adopt(result)); } catch (error) { failed(error); }
   });
  } catch (error) { failed(error); }
 });
}
function ownPseudoConsole(api, initialHandle) {
 let handle = initialHandle, state = 'open', closing, resizing;
 return {
  get handle() { return handle; },
  get state() { return state; },
  resize(cols, rows) {
   const size = pseudoConsoleSize(cols, rows);
   if (state !== 'open' || resizing !== undefined) throw new Error('ConPTY resize requires an idle open pseudoconsole');
   const hresult = api.resizePseudoConsole(handle, size);
   if (hresult !== 0) throw pseudoConsoleError('ResizePseudoConsole', hresult);
  },
  resizeAsync(cols, rows) {
   const size = pseudoConsoleSize(cols, rows);
   if (state !== 'open' || resizing !== undefined) throw new Error('ConPTY resize requires an idle open pseudoconsole');
   resizing = new Promise((resolve, reject) => {
    try {
     api.resizePseudoConsole.async(handle, size, (error, result) => {
      if (error) { reject(error); return; }
      if (result !== 0) { reject(pseudoConsoleError('ResizePseudoConsole', result)); return; }
      resolve();
     });
    } catch (error) { reject(error); }
   });
   const pending = resizing;
   return pending.finally(() => { resizing = undefined; });
  },
  close() {
   if (closing !== undefined) return closing;
   state = 'closing';
   const pendingResize = resizing;
   closing = (async () => {
    // Join 失败的 resize 也必须完成，原调用者保留其错误；之后仍须回收 HPCON。
    if (pendingResize !== undefined) await pendingResize.then(() => {}, () => {});
    await new Promise((resolve, reject) => {
     const failed = error => { state = 'unknown'; reject(error); };
     try {
      api.closePseudoConsole.async(handle, error => {
       if (error) { failed(error); return; }
       handle = null; state = 'close-returned'; resolve();
      });
     } catch (error) { failed(error); }
    });
   })();
   return closing;
  }
 };
}
/* v8 ignore stop */
/**
* Format a Win32 error code through FormatMessageW.
* @param api - active binding table.
* @param win32Code - captured GetLastError value.
* @returns trimmed system message, or an empty string when unavailable.
*/
function errorText(api, win32Code) {
	const buffer = Buffer.alloc(1024);
	const length = api.formatMessageW(4608, null, win32Code, 0, buffer, buffer.length / 2, null);
	return length === 0 ? "" : buffer.subarray(0, length * 2).toString("utf16le").trim();
}
/**
* Throw the current GetLastError value.
* @param api - active binding table.
* @param name - failing Win32 operation.
* @param detail - optional operation context.
* @returns never; always throws Win32Error.
*/
function throwLastError(api, name, detail) {
	const win32Code = api.getLastError();
	throw new Win32Error(name, win32Code, detail ?? errorText(api, win32Code));
}
/**
* Throw an explicitly captured Win32 error code.
* @param api - active binding table.
* @param name - failing Win32 operation.
* @param win32Code - error captured before cleanup.
* @param detail - optional operation context.
* @returns never; always throws Win32Error.
*/
function throwWin32(api, name, win32Code, detail) {
	throw new Win32Error(name, win32Code, detail ?? errorText(api, win32Code));
}
//#endregion
//#region lib/types/control-stdio.js
/** Windows CRT startup descriptors for a Node payload with one inherited control pipe. */
const HANDLE_BYTES = 8;
const INVALID_HANDLE = 18446744073709551615n;
const FOPEN = 1;
const FPIPE = 8;
const FDEV = 64;
const FILE_TYPE_CHAR = 2;
const FILE_TYPE_PIPE = 3;
/**
* Encode the CRT's descriptor table before the child runtime allocates descriptors.
* Supported Windows targets use 64-bit handles. Empty slots remain closed, and the
* backing Buffer must remain alive until CreateProcess returns.
* @param api - native file-type inspection for inherited handles.
* @param stdio - standard handles and the provider-owned fd-7 control pipe.
* @returns descriptor count, flag bytes, and handle values for STARTUPINFO's reserved CRT fields.
*/
function inheritedControlStdio(api, stdio) {
	const count = stdio.control.fileDescriptor + 1;
	const handleOffset = 4 + count;
	const bytes = Buffer.alloc(handleOffset + count * HANDLE_BYTES);
	bytes.writeUInt32LE(count, 0);
	for (let index = 0; index < count; index++) bytes.writeBigUInt64LE(INVALID_HANDLE, handleOffset + index * HANDLE_BYTES);
	const entries = [
		[0, stdio.stdin],
		[1, stdio.stdout],
		[2, stdio.stderr],
		[stdio.control.fileDescriptor, stdio.control.handle]
	];
	for (const [fd, handle] of entries) {
		const kind = api.getFileType(handle);
		if (fd === stdio.control.fileDescriptor && kind !== FILE_TYPE_PIPE) throw new Error("subprocess control descriptor is not a Windows pipe");
		bytes[4 + fd] = FOPEN | (kind === FILE_TYPE_PIPE ? FPIPE : kind === FILE_TYPE_CHAR ? FDEV : 0);
		bytes.writeBigUInt64LE(handle, handleOffset + fd * HANDLE_BYTES);
	}
	return bytes;
}
//#endregion
//#region lib/types/process.js
/** Typed Win32 process operations over the shared binding table. */
/**
* Quote one argument according to CommandLineToArgvW parsing.
* @param argument - one argv entry.
* @returns bare or quoted command-line segment.
*/
function quoteArg(argument) {
	if (argument === "") return "\"\"";
	if (!/[\s"]/u.test(argument)) return argument;
	let quoted = "\"";
	for (let index = 0; index < argument.length; index++) {
		let backslashes = 0;
		while (index < argument.length && argument.charAt(index) === "\\") {
			backslashes += 1;
			index += 1;
		}
		if (index === argument.length) quoted += "\\".repeat(backslashes * 2);
		else if (argument.charAt(index) === "\"") quoted += "\\".repeat(backslashes * 2 + 1) + "\"";
		else quoted += "\\".repeat(backslashes) + argument.charAt(index);
	}
	return quoted + "\"";
}
/**
* Build the mutable command line accepted by CreateProcessAsUserW.
* @param program - executable argv entry.
* @param args - remaining argv entries.
* @returns joined Win32 command line.
*/
function buildCommandLine(program, args) {
	return [program, ...args].map(quoteArg).join(" ");
}
function compareWindowsEnvironmentKeys([left], [right]) {
	const foldedLeft = left.toUpperCase();
	const foldedRight = right.toUpperCase();
	return foldedLeft < foldedRight ? -1 : foldedLeft > foldedRight ? 1 : 0;
}
function encodeWindowsEnvironment(env) {
	const strings = Object.entries(env).sort(compareWindowsEnvironmentKeys).map(([key, value]) => `${key}=${value}`);
	return Buffer.from(`${strings.join("\0")}\0\0`, "utf16le");
}
function freeNative(pointer) {
	if (pointer !== void 0) requireKoffi().free(pointer);
}
function closeBestEffort(api, handle) {
	if (!isNullPtr(handle)) api.closeHandle(handle);
}
function createPipe(api, owned) {
	const readSlot = allocPtrSlot();
	let writeSlot;
	try {
		writeSlot = allocPtrSlot();
		if (api.createPipe(readSlot, writeSlot, null, 0) === 0) throwLastError(api, "CreatePipe");
		const read = decodePtr(readSlot);
		const write = decodePtr(writeSlot);
		if (read === null || write === null) {
			closeBestEffort(api, read);
			closeBestEffort(api, write);
			throwLastError(api, "CreatePipe", "null pipe handle");
		}
		owned.add(read);
		owned.add(write);
		return {
			read,
			write
		};
	} finally {
		freeNative(writeSlot);
		requireKoffi().free(readSlot);
	}
}
function closeOwned(api, owned, handle) {
	/* v8 ignore next -- each successfully decoded pipe end is uniquely owned. */
	if (!owned.delete(handle)) return;
	api.closeHandle(handle);
}
function closeAllOwned(api, owned) {
	for (const handle of owned) api.closeHandle(handle);
	owned.clear();
}
function createRestrictedProcess(api, options, commandLine, creationFlags, startupInfo, processInfo) {
	return api.createProcessAsUserW(options.token, null, commandLine, null, null, 1, creationFlags, null, options.cwd, startupInfo, processInfo);
}
/**
* Spawn a process with anonymous-pipe stdout/stderr and immediate stdin EOF.
* New console windows start hidden without changing console inheritance.
* @param api - active binding table.
* @param options - command, cwd, args, and restricted primary token.
* @returns caller-owned process and pipe read handles.
*/
function spawnPipedProcess(api, options) {
	const owned = /* @__PURE__ */ new Set();
	let startupInfo;
	let processInfo;
	try {
		const stdIn = createPipe(api, owned);
		const stdOut = createPipe(api, owned);
		const stdErr = createPipe(api, owned);
		for (const [handle, label] of [
			[stdIn.read, "stdin read end"],
			[stdOut.write, "stdout write end"],
			[stdErr.write, "stderr write end"]
		]) if (api.setHandleInformation(handle, 1, 1) === 0) throwLastError(api, "SetHandleInformation", label);
		startupInfo = allocStartupInfo();
		encodeStartupInfo(startupInfo, {
			cb: 104,
			dwFlags: 257,
			wShowWindow: 0,
			hStdInput: stdIn.read,
			hStdOutput: stdOut.write,
			hStdError: stdErr.write
		});
		processInfo = allocProcessInfo();
		if (createRestrictedProcess(api, options, buildCommandLine(options.command, options.args), 0, startupInfo, processInfo) === 0) throwWin32(api, "CreateProcessAsUserW", api.getLastError(), `command: ${options.command}, cwd: ${options.cwd}`);
		const info = decodeProcessInfo(processInfo);
		if (info.hProcess === null || info.hThread === null) {
			if (info.hProcess !== null) api.terminateProcess(info.hProcess, 1);
			closeBestEffort(api, info.hThread);
			closeBestEffort(api, info.hProcess);
			throw new Error(`CreateProcessAsUserW succeeded but returned null process/thread handles (pid ${info.dwProcessId})`);
		}
		closeOwned(api, owned, stdIn.read);
		closeOwned(api, owned, stdIn.write);
		closeOwned(api, owned, stdOut.write);
		closeOwned(api, owned, stdErr.write);
		closeBestEffort(api, info.hThread);
		owned.delete(stdOut.read);
		owned.delete(stdErr.read);
		return {
			pid: info.dwProcessId,
			process: info.hProcess,
			stdoutRead: stdOut.read,
			stderrRead: stdErr.read
		};
	} catch (error) {
		closeAllOwned(api, owned);
		throw error;
	} finally {
		freeNative(processInfo);
		freeNative(startupInfo);
	}
}
/**
* Drain one anonymous pipe until the writer closes it.
* @param api - active binding table.
* @param handle - caller-owned pipe read end.
* @returns complete bytes read before EOF; the handle is always closed.
* @throws when a Win32 pipe operation fails.
*/
async function drainPipe(api, handle) {
	const chunks = [];
	let countSlot;
	try {
		countSlot = allocUint32();
		for (;;) {
			if (api.peekNamedPipe(handle, null, 0, null, countSlot, null) === 0) {
				const win32Code = api.getLastError();
				if (win32Code === 109 || win32Code === 232) break;
				throwLastError(api, "PeekNamedPipe", `drain failure after ${chunks.length} chunk(s)`);
			}
			const available = decodeUint32(countSlot);
			if (available > 0) {
				const chunk = Buffer.alloc(available);
				if (api.readFile(handle, chunk, chunk.length, countSlot, null) === 0) throwLastError(api, "ReadFile", `drain failure after ${chunks.length} chunk(s)`);
				chunks.push(chunk.subarray(0, decodeUint32(countSlot)));
			}
			await new Promise((resolve) => setTimeout(resolve, 1));
		}
		return Buffer.concat(chunks);
	} finally {
		freeNative(countSlot);
		api.closeHandle(handle);
	}
}
/**
* Wait for a process and always close its handle.
* @param api - active binding table.
* @param process - caller-owned process handle.
* @returns direct process exit code.
*/
function waitForProcessExit(api, process) {
	let exitCodeSlot;
	try {
		if (api.waitForSingleObject(process, 4294967295) === 4294967295) throwLastError(api, "WaitForSingleObject");
		exitCodeSlot = allocUint32();
		if (api.getExitCodeProcess(process, exitCodeSlot) === 0) throwLastError(api, "GetExitCodeProcess");
		return decodeUint32(exitCodeSlot);
	} finally {
		freeNative(exitCodeSlot);
		api.closeHandle(process);
	}
}
function allocateJobHandle(api) {
	const job = api.createJobObjectW(null, null);
	if (isNullPtr(job)) throwLastError(api, "CreateJobObjectW");
	return job;
}
function configureKillOnCloseJob(api, job) {
	const information = Buffer.alloc(144);
	information.writeUInt32LE(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, 16);
	return api.setInformationJobObject(job, 9, information, information.length);
}
function createKillOnCloseJob(api) {
	const job = allocateJobHandle(api);
	if (configureKillOnCloseJob(api, job) === 0) {
		const win32Code = api.getLastError();
		api.closeHandle(job);
		throwWin32(api, "SetInformationJobObject", win32Code);
	}
	return job;
}
const UV_INVALID_OS_FILE_HANDLE = 18446744073709551615n;
const UV_INVALID_FILE_DESCRIPTOR = 18446744073709551614n;
function inheritedStandardHandles(api, controlFileDescriptor) {
	const get = (selector, label) => {
		const handle = api.getStdHandle(selector);
		if (!isNullPtr(handle)) return handle;
		throwLastError(api, "GetStdHandle", `null ${label} handle`);
	};
	return {
		stdin: get(-10, "stdin"),
		stdout: get(-11, "stdout"),
		stderr: get(-12, "stderr"),
		...controlFileDescriptor === void 0 ? {} : { control: {
			fileDescriptor: controlFileDescriptor,
			handle: descriptorHandle(api, controlFileDescriptor, "control")
		} }
	};
}
function descriptorHandle(api, fileDescriptor, label) {
	const handle = api.uvGetOsfhandle(fileDescriptor);
	if (isNullPtr(handle) || handle === UV_INVALID_OS_FILE_HANDLE || handle === UV_INVALID_FILE_DESCRIPTOR) throw new Error(`uv_get_osfhandle returned an invalid handle for target ${label} fd ${String(fileDescriptor)}`);
	return handle;
}
function targetCarrierHandles(api, descriptors) {
	return {
		stdin: descriptorHandle(api, descriptors.stdin, "stdin"),
		stdout: descriptorHandle(api, descriptors.stdout, "stdout"),
		stderr: descriptorHandle(api, descriptors.stderr, "stderr"),
		...descriptors.control === void 0 ? {} : { control: {
			fileDescriptor: descriptors.control,
			handle: descriptorHandle(api, descriptors.control, "control")
		} }
	};
}
function prepareLpacAttributes(api, packageSid, stdioHandles, pseudoConsole, job) {
 const koffi = requireKoffi();
 if (isNullPtr(packageSid)) throw new Error('LPAC requires an owned nonnull package SID');
 if (isNullPtr(job)) throw new Error('LPAC requires the original owned Job at creation');
 if (pseudoConsole !== undefined && stdioHandles.length) throw new Error('ConPTY must not inherit ordinary stdio handles');
 const allocations = [];
 let list;
 let initialized = false;
 let disposed = false;
 let releaseFailure;
 let attributeListState = 'uninitialized';
 const ownership = () => ({ attributeListState, allocations: allocations.filter(item => item.state !== 'released').map(item => ({ ...item })) });
 const allocate = (bytes) => {
  const pointer = koffi.alloc('uint8', bytes.length);
  allocations.push({ pointer, state: 'live' });
  koffi.encode(pointer, 'uint8', bytes, bytes.length);
  return pointer;
 };
 const dispose = () => {
  if (disposed) { if (releaseFailure) throw releaseFailure; return; }
  disposed = true;
  const failures = [];
  if (initialized) {
   try { api.deleteProcThreadAttributeList(list); initialized = false; attributeListState = 'deleted'; }
   catch (error) { attributeListState = 'unknown'; failures.push(error); }
  }
  // An unknown Delete call may still own pointers; do not free its backing data.
  if (attributeListState !== 'unknown') for (const item of [...allocations].reverse()) {
   try { freeNative(item.pointer); item.pointer = null; item.state = 'released'; }
   catch (error) { item.state = 'unknown'; failures.push(error); }
  }
  if (failures.length) {
   releaseFailure = new AggregateError(failures, 'LPAC startup attribute release failed');
   releaseFailure.attributeOwnership = ownership();
   throw releaseFailure;
  }
 };
 try {
  const capabilities = Buffer.alloc(24);
  capabilities.writeBigUInt64LE(koffi.address(packageSid), 0);
  const policy = Buffer.alloc(4);
  policy.writeUInt32LE(1);
  const jobs = Buffer.alloc(8);
  jobs.writeBigUInt64LE(typeof job === 'bigint' ? job : koffi.address(job));
  const attributes = [
   [0x20009, allocate(capabilities), capabilities.length],
   [0x2000f, allocate(policy), policy.length],
   // JOB_LIST 将子进程在创建时纳入原 Job，消除 Create 与事后 Assign 间的崩溃孤儿窗口。
   [0x2000d, allocate(jobs), jobs.length]
  ];
  if (stdioHandles.length) {
   const addresses = [...new Set(stdioHandles.map(handle => {
    if (isNullPtr(handle)) throw new Error('Null inherited LPAC endpoint');
    const address = typeof handle === 'bigint' ? handle : koffi.address(handle);
    if (address <= 0n || address === 0xffffffffffffffffn) throw new Error('Invalid inherited LPAC endpoint');
    return address;
   }))];
   const handles = Buffer.alloc(addresses.length * 8);
   addresses.forEach((address, index) => handles.writeBigUInt64LE(address, index * 8));
   attributes.push([0x20002, allocate(handles), handles.length]);
  }
  if (pseudoConsole !== undefined) {
   if (isNullPtr(pseudoConsole)) throw new Error('Null ConPTY handle');
   // PSEUDOCONSOLE 传 HPCON 本身；SECURITY_CAPABILITIES/HANDLE_LIST 则传缓冲区。
   attributes.push([0x20016, pseudoConsole, 8]);
  }
  const size = allocate(Buffer.alloc(8));
  const measured = api.initializeProcThreadAttributeList(null, attributes.length, 0, size);
  const error = measured === 0 ? api.getLastError() : 0;
  if (measured !== 0 || error !== 122) throw new Error(`InitializeProcThreadAttributeList size query returned ${measured}/${error}`);
  const required = Number(koffi.decode(size, 'size_t'));
  if (!Number.isSafeInteger(required) || required <= 0) throw new Error('Invalid LPAC attribute allocation length');
  list = allocate(Buffer.alloc(required));
  if (api.initializeProcThreadAttributeList(list, attributes.length, 0, size) === 0) throwLastError(api, 'InitializeProcThreadAttributeList');
  initialized = true;
  attributeListState = 'initialized';
  for (const [attribute, pointer, length] of attributes) {
   if (api.updateProcThreadAttribute(list, 0, attribute, pointer, length, null, null) === 0) throwLastError(api, 'UpdateProcThreadAttribute');
  }
  return { pointer: list, dispose, ownership };
 } catch (error) {
  try { dispose(); } catch (cleanup) { const failure = new AggregateError([error, cleanup], 'LPAC attribute preparation and release failed'); failure.attributeOwnership = ownership(); throw failure; }
  throw error;
 }
}

const lpacLaunches = new WeakMap();
const failedLpacLaunches = new WeakMap();
/** 原 owner 接回挂起目标，在同步身份窗口之外提交证明，再一次 Resume。 */
function createSuspendedLpacJobProcess(api, options) {
 const extended = options.pseudoConsole !== undefined;
 let job = null;
 const inherited = [];
 const preparationMemory = {};
 let attributes, startup, processRecord, control, info;
 let jobConfigured = false, assigned = false, childCreated = false, preparationReleased = false, preparationReleaseAttempted = false;
 const releasePreparation = () => {
  if (preparationReleaseAttempted) return;
  preparationReleaseAttempted = true;
  const failures = [];
  for (const item of inherited) {
   try {
    if (api.setHandleInformation(item.handle, 1, item.flags & 1) === 0) throwLastError(api, 'SetHandleInformation', 'restore exact LPAC endpoint inheritability');
    item.restored = true;
   } catch (error) { failures.push(error); }
  }
  try { attributes?.dispose(); attributes = undefined; } catch (error) { failures.push(error); }
  for (const item of Object.values(preparationMemory)) {
   try { freeNative(item.pointer); item.pointer = null; item.state = 'released'; }
   catch (error) { item.state = 'unknown'; failures.push(error); }
  }
  startup = processRecord = control = undefined;
  if (failures.length) throw new AggregateError(failures, 'LPAC startup release failed before Resume');
  preparationReleased = true;
 };
 try {
  // 配置失败也保留已分配的准确句柄，交原 runner；此处没有 best-effort close。
  job = allocateJobHandle(api);
  if (configureKillOnCloseJob(api, job) === 0) throwLastError(api, 'SetInformationJobObject');
  jobConfigured = true;
  const stdio = extended ? undefined : targetCarrierHandles(api, options.stdio);
  const handles = stdio === undefined ? [] : [...new Set([stdio.stdin, stdio.stdout, stdio.stderr, ...stdio.control === undefined ? [] : [stdio.control.handle]])];
  for (const handle of handles) {
   const flags = allocUint32();
   try {
    if (api.getHandleInformation(handle, flags) === 0) throwLastError(api, 'GetHandleInformation');
    inherited.push({ handle, flags: decodeUint32(flags), restored: false });
    if (api.setHandleInformation(handle, 1, 1) === 0) throwLastError(api, 'SetHandleInformation', 'enable allowlisted LPAC endpoint');
   } finally { freeNative(flags); }
  }
  const crt = stdio?.control === undefined ? undefined : inheritedControlStdio(api, stdio);
  if (crt !== undefined) { control = requireKoffi().alloc('uint8', crt.length); preparationMemory.control = { pointer: control, state: 'live' }; requireKoffi().encode(control, 'uint8', crt, crt.length); }
  attributes = prepareLpacAttributes(api, options.packageSid, handles, options.pseudoConsole, job);
  startup = requireKoffi().alloc(win32Types().STARTUPINFOEXW, 1);
  preparationMemory.startup = { pointer: startup, state: 'live' };
  requireKoffi().encode(startup, win32Types().STARTUPINFOEXW, {
   StartupInfo: { cb: 112, dwFlags: extended ? 0 : 257, wShowWindow: 0,
    hStdInput: stdio?.stdin ?? null, hStdOutput: stdio?.stdout ?? null, hStdError: stdio?.stderr ?? null,
    ...crt === undefined ? {} : { cbReserved2: crt.length, lpReserved2: control } },
   lpAttributeList: attributes.pointer
  });
  processRecord = allocProcessInfo();
  preparationMemory.processRecord = { pointer: processRecord, state: 'live' };
  const flags = 0x80000 | 0x400 | 4 | (extended ? 0 : 0x08000000);
  const created = api.createProcessExtendedW(options.applicationName, buildCommandLine(options.command, options.args), null, null, extended ? 0 : 1, flags, encodeWindowsEnvironment(options.env), options.cwd, startup, processRecord);
  const error = created === 0 ? api.getLastError() : 0;
  if (created === 0) throwWin32(api, 'CreateProcessW', error, 'LPAC suspended target');
  childCreated = assigned = true;
  info = decodeProcessInfo(processRecord);
  if (isNullPtr(info.hProcess) || isNullPtr(info.hThread)) throw new Error('LPAC CreateProcessW returned null process/thread handles');
  const inJob = Buffer.alloc(4);
  if (api.isProcessInJob(info.hProcess, job, inJob) === 0) throwLastError(api, 'IsProcessInJob', 'LPAC suspended target');
  if (inJob.readUInt32LE() !== 1) throw new Error('LPAC target is not in the original creation Job');
  // No reentrant preparation runs while an endpoint remains inheritable.
  releasePreparation();
  const frame = Object.freeze({pid:info.dwProcessId, process:info.hProcess, job, initialThread:info.hThread});
  lpacLaunches.set(frame, {api, pid:frame.pid, process:frame.process, job, initialThread:frame.initialThread, pseudoConsole:options.pseudoConsole ?? null,
   jobConfigured:true, assigned:true, childCreated:true, preparationReleased:true,
   payloadResumed:false, resumeAttempted:false, initialThreadCloseAttempted:false,
   processCloseAttempted:false, jobCloseAttempted:false});
  return frame;
 } catch (error) {
  const failures = [error];
  let childSettled = !childCreated, jobEmpty = !assigned;
  if (childCreated) {
   try { terminateJob(api, job, 1); } catch (cleanup) { failures.push(cleanup); }
   if (info && !isNullPtr(info.hProcess)) try {
    const wait = api.waitForSingleObject(info.hProcess, 0);
    if (wait === 0) childSettled = true;
    else if (wait === 0xffffffff) throwLastError(api, 'WaitForSingleObject', 'LPAC failed launch');
    else if (wait !== 258) throw new Error(`Unexpected LPAC process wait result ${wait}`);
   } catch (cleanup) { failures.push(cleanup); }
   try { jobEmpty = isJobEmpty(api, job); } catch (cleanup) { failures.push(cleanup); }
  }
  if ((!childCreated || info !== undefined) && !preparationReleaseAttempted) {
   try { releasePreparation(); } catch (cleanup) { failures.push(cleanup); }
  }
  // 原 runner 必须先用这些原句柄独立核排空并处理 Profile；底层不抢先关闭证明句柄。
  const attributeOwnership = attributes?.ownership() ?? error.attributeOwnership;
  const attributesRetained = attributeOwnership && (attributeOwnership.attributeListState === 'unknown' || attributeOwnership.allocations.length > 0);
  const preparationComplete = preparationReleased && !attributesRetained;
  const failure = new AggregateError(failures, 'LPAC launch failed; retain exact profile and grants');
  failure.payloadResumed = false;
  // 即使 CreateProcess 从未成功，原 owner 也要接回准备/Job 结果，不能凭普通异常推定可删。
  failure.code = 'WINDOWS_LPAC_OWNERSHIP_RETAINED';
  failure.nativeOwnership = {
    pid: info?.dwProcessId ?? null, process: info?.hProcess ?? null,
    initialThread: info?.hThread ?? null, initialThreadCloseAttempted:false,
    job, jobConfigured, assigned, childCreated, childSettled,
    jobEmpty, payloadResumed:false, preparationReleased:preparationComplete, pendingPreparation:undefined,
    ...!preparationComplete ? { preparationResources: {
     inherited: inherited.filter(item => !item.restored).map(item => ({ ...item })),
     attributes: attributeOwnership,
     allocations: Object.fromEntries(Object.entries(preparationMemory).filter(([, item]) => item.state !== 'released').map(([key, item]) => [key, { ...item }]))
    } } : {}
  };
  failedLpacLaunches.set(failure,{api,packageSid:options.packageSid,...failure.nativeOwnership,processCloseAttempted:false,jobCloseAttempted:false});
  throw failure;
 }
}

function failedLpacState(api, failure) {
 const state = failedLpacLaunches.get(failure);
 if (state === undefined || state.api !== api) throw new Error('LPAC failure is not the original native launch attempt');
 return state;
}
/** 失败归属只能取自原抛出对象，不信任可复制的 nativeOwnership 摘要。 */
function inspectFailedLpacJobProcess(api, failure) {
 const {api:unused,...state} = failedLpacState(api,failure);
 return {...state};
}
function closeFailedLpacJobProcessHandles(api, failure) {
 const state = failedLpacState(api,failure);
 if (!state.preparationReleased || state.pendingPreparation !== undefined) throw new Error('Failed LPAC preparation has not joined and released');
 if (state.childCreated && (state.process === null || pollProcessExit(api,state.process) === undefined)) throw new Error('Failed LPAC child settlement remains unproven');
 if (state.job !== null && !isJobEmpty(api,state.job)) throw new Error('Failed LPAC original Job is not empty');
 if (!state.childCreated && (state.process !== null || state.initialThread !== null)) throw new Error('Failed LPAC ownership contradicts child creation');
 state.childSettled = true;state.jobEmpty = true;
 const failures = [];
 for (const [key,attempted,label] of [['initialThread','initialThreadCloseAttempted','failed LPAC initial thread'],['process','processCloseAttempted','failed LPAC direct process'],['job','jobCloseAttempted','failed LPAC original Job']]) {
  if (state[key] === null) continue;
  if (state[attempted]) { failures.push(new Error(label+' closure remains unknown')); continue; }
  state[attempted] = true;
  try { closeHandleChecked(api,state[key],label);state[key] = null; } catch (error) { failures.push(error); }
 }
 if (failures.length) throw new AggregateError(failures,'Failed LPAC native ownership remains unknown');
}
function lpacState(api, frame) {
 const state = lpacLaunches.get(frame);
 if (state === undefined || state.api !== api) throw new Error('LPAC native ownership does not match the original launch');
 return state;
}
function inspectLpacJobProcess(api, frame) {
 const {api:unused, ...state} = lpacState(api, frame);
 return {...state};
}
function retainLpacLaunchFailure(api, frame, error) {
 const state = lpacState(api, frame), failures = [error];
 let childSettled = false, jobEmpty = false;
 if (state.pendingPreparation === undefined || state.pendingPreparation.settled) {
  try { terminateJob(api, state.job, 1); } catch (cleanup) { failures.push(cleanup); }
  try { childSettled = pollProcessExit(api, state.process) !== undefined; } catch (cleanup) { failures.push(cleanup); }
  try { jobEmpty = isJobEmpty(api, state.job); } catch (cleanup) { failures.push(cleanup); }
 }
 const failure = new AggregateError(failures, 'LPAC launch failed; original owner retains the suspended launch');
 failure.code = 'WINDOWS_LPAC_OWNERSHIP_RETAINED';
 failure.payloadResumed = state.payloadResumed;
 failure.nativeOwnership = {...inspectLpacJobProcess(api, frame), childSettled, jobEmpty};
 return failure;
}
/** 只消费原生 frame 一次；资格与耐久证明由原 WindowsJobRunner 在调用前完成。 */
function resumeLpacJobProcess(api, frame) {
 const state = lpacState(api, frame);
 if (state.resumeAttempted || state.initialThreadCloseAttempted || state.processCloseAttempted || state.jobCloseAttempted || state.pendingPreparation !== undefined || !state.preparationReleased) throw new Error('LPAC launch cannot Resume from its current ownership state');
 try {
  if (pollProcessExit(api, state.process) !== undefined || isJobEmpty(api, state.job)) throw new Error('LPAC suspended target is no longer active');
  const inJob = Buffer.alloc(4);
  if (api.isProcessInJob(state.process, state.job, inJob) === 0) throwLastError(api, 'IsProcessInJob');
  if (inJob.readUInt32LE() !== 1) throw new Error('LPAC target left the original Job');
  state.resumeAttempted = true;
  const previous = api.resumeThread(state.initialThread);
  if (previous === 0xffffffff) throwLastError(api, 'ResumeThread', 'verified LPAC target');
  state.payloadResumed = previous <= 1;
  if (previous !== 1) throw new Error('LPAC target suspend count was not exactly one');
  state.initialThreadCloseAttempted = true;
  closeHandleChecked(api, state.initialThread, 'LPAC initial thread');
  state.initialThread = null;
  return {pid:state.pid, process:state.process, job:state.job};
 } catch (error) { throw retainLpacLaunchFailure(api, frame, error); }
}
/** 排空以后一次关闭原句柄；关闭结果未知不重试、不伪造已释放。 */
function closeLpacJobProcessHandles(api, frame) {
 const state = lpacState(api, frame);
 if (state.pendingPreparation !== undefined && !state.pendingPreparation.settled || !state.preparationReleased || state.process === null || state.job === null || pollProcessExit(api, state.process) === undefined || !isJobEmpty(api, state.job)) throw new Error('LPAC handle closure requires joined preparation, a settled target and an empty original Job');
 const failures = [];
 for (const [key,attempted,label] of [['initialThread','initialThreadCloseAttempted','LPAC initial thread'],['process','processCloseAttempted','LPAC direct process'],['job','jobCloseAttempted','LPAC original Job']]) {
  if (state[key] === null) continue;
  if (state[attempted]) { failures.push(new Error(label+' closure remains unknown')); continue; }
  state[attempted] = true;
  try { closeHandleChecked(api, state[key], label); state[key] = null; } catch (error) { failures.push(error); }
 }
 if (failures.length) throw new AggregateError(failures, 'LPAC native handle ownership remains unknown');
}
/** 同步调用方也使用同一挂起 frame；异步/生成器不能进入原生分配。 */
function spawnLpacJobProcess(api, options) {
 if (typeof options.prepareBeforeResume !== 'function' || isAsyncFunction(options.prepareBeforeResume) || isGeneratorFunction(options.prepareBeforeResume)) throw new Error('LPAC requires a synchronous non-generator owned-profile/token preparation before Resume');
 const frame = createSuspendedLpacJobProcess(api, options), state = lpacState(api, frame);
 try {
  const prepared = options.prepareBeforeResume(frame);
  if (prepared && typeof prepared.then === 'function') {
   const pending = {settled:false};
   state.pendingPreparation = pending;
   pending.join = Promise.resolve(prepared).then(
    () => {pending.settled=true;}, error => {pending.settled=true;pending.error=error;}
   );
   throw new Error('LPAC preparation returned a thenable; identity and resource ownership remain unknown, no Resume');
  }
 } catch (error) { throw retainLpacLaunchFailure(api, frame, error); }
 return resumeLpacJobProcess(api, frame);
}

/** Shared suspended-create, Job-assignment, and resume lifecycle. */
function spawnJobProcess(api, options, resolveStdio, createName, create) {
	const job = createKillOnCloseJob(api);
	const enabled = [];
	let startupInfo;
	let processInfo;
	let controlDescriptorBlock;
	let created = 0;
	let createFailureCode = 0;
	try {
		const stdio = resolveStdio();
		const inherited = [
			[stdio.stdin, "stdin"],
			[stdio.stdout, "stdout"],
			[stdio.stderr, "stderr"]
		];
		if (stdio.control !== void 0) inherited.push([stdio.control.handle, "control"]);
		for (const [handle, label] of inherited) {
			if (api.setHandleInformation(handle, 1, 1) === 0) throwLastError(api, "SetHandleInformation", `${label} (enable inherit)`);
			enabled.push(handle);
		}
		const controlBytes = stdio.control === void 0 ? void 0 : inheritedControlStdio(api, {
			...stdio,
			control: stdio.control
		});
		if (controlBytes !== void 0) {
			const koffi = requireKoffi();
			controlDescriptorBlock = {
				pointer: koffi.alloc("uint8", controlBytes.length),
				length: controlBytes.length
			};
			koffi.encode(controlDescriptorBlock.pointer, "uint8", controlBytes, controlBytes.length);
		}
		startupInfo = allocStartupInfo();
		encodeStartupInfo(startupInfo, {
			cb: 104,
			dwFlags: 257,
			wShowWindow: 0,
			hStdInput: stdio.stdin,
			hStdOutput: stdio.stdout,
			hStdError: stdio.stderr,
			...controlDescriptorBlock === void 0 ? {} : {
				cbReserved2: controlDescriptorBlock.length,
				lpReserved2: controlDescriptorBlock.pointer
			}
		});
		processInfo = allocProcessInfo();
		created = create(startupInfo, processInfo);
		if (created === 0) createFailureCode = api.getLastError();
	} catch (error) {
		freeNative(processInfo);
		api.closeHandle(job);
		throw error;
	} finally {
		freeNative(startupInfo);
		freeNative(controlDescriptorBlock?.pointer);
		for (const handle of enabled) api.setHandleInformation(handle, 1, 0);
	}
	if (created === 0) {
		freeNative(processInfo);
		api.closeHandle(job);
		throwWin32(api, createName, createFailureCode, `command: ${options.command}, cwd: ${options.cwd}`);
	}
	let info;
	try {
		info = decodeProcessInfo(processInfo);
	} finally {
		freeNative(processInfo);
	}
	if (info.hProcess === null || info.hThread === null) {
		if (info.hProcess !== null) api.terminateProcess(info.hProcess, 1);
		api.closeHandle(job);
		closeBestEffort(api, info.hThread);
		closeBestEffort(api, info.hProcess);
		throw new Error(`${createName} succeeded but returned null process/thread handles (pid ${info.dwProcessId})`);
	}
	if (api.assignProcessToJobObject(job, info.hProcess) === 0) {
		const win32Code = api.getLastError();
		api.terminateProcess(info.hProcess, 1);
		closeBestEffort(api, info.hThread);
		closeBestEffort(api, info.hProcess);
		api.closeHandle(job);
		throwWin32(api, "AssignProcessToJobObject", win32Code, `pid ${info.dwProcessId}`);
	}
	if (api.resumeThread(info.hThread) === 4294967295) {
		const win32Code = api.getLastError();
		closeBestEffort(api, info.hThread);
		closeBestEffort(api, info.hProcess);
		api.closeHandle(job);
		throwWin32(api, "ResumeThread", win32Code, `pid ${info.dwProcessId}`);
	}
	closeBestEffort(api, info.hThread);
	return {
		pid: info.dwProcessId,
		process: info.hProcess,
		job
	};
}
/**
* Spawn a restricted-token process suspended with hidden initial windows, assign its Job, then resume it.
* @param api - active binding table.
* @param options - command, cwd, args, and restricted primary token.
* @returns caller-owned process and Job handles after successful resume.
* @remarks Node clears stdio handle inheritability at startup through
* uv_disable_stdio_inheritance. This operation temporarily restores the bits
* required by STARTF_USESTDHANDLES. Restoring them afterward is best-effort:
* failure must not replace the already-created child's outcome.
*/
function spawnInheritedJobProcess(api, options) {
	const commandLine = buildCommandLine(options.command, options.args);
	return spawnJobProcess(api, options, () => inheritedStandardHandles(api, options.controlFileDescriptor), "CreateProcessAsUserW", (startupInfo, processInfo) => createRestrictedProcess(api, options, commandLine, 4, startupInfo, processInfo));
}
/**
* Spawn an ordinary process suspended with hidden initial windows, assign its Job, then resume it.
* @param api - active binding table.
* @param options - command, cwd, argv, and target carrier descriptors.
* @returns caller-owned process and Job handles after successful resume.
*/
function spawnCurrentTokenJobProcess(api, options) {
	const commandLine = buildCommandLine(options.command, options.args);
	const environment = encodeWindowsEnvironment(options.env);
	return spawnJobProcess(api, options, () => targetCarrierHandles(api, options.stdio), "CreateProcessW", (startupInfo, processInfo) => api.createProcessW(options.applicationName, commandLine, null, null, 1, 1028, environment, options.cwd, startupInfo, processInfo));
}
/**
* Verify that an unnamed kill-on-close Job can be created and released now.
* @param api - active binding table.
*/
function probeCurrentTokenJobSupport(api) {
	closeHandleChecked(api, createKillOnCloseJob(api), "current-token Job capability probe");
}
/**
* Poll one process handle without blocking the runner event loop.
* @param api - active binding table.
* @param process - caller-owned process handle.
* @returns the direct exit code when signalled, or undefined while running.
*/
function pollProcessExit(api, process) {
	const waitResult = api.waitForSingleObject(process, 0);
	if (waitResult === 258) return void 0;
	if (waitResult === 4294967295) throwLastError(api, "WaitForSingleObject");
	const exitCodeSlot = allocUint32();
	try {
		if (api.getExitCodeProcess(process, exitCodeSlot) === 0) throwLastError(api, "GetExitCodeProcess");
		return decodeUint32(exitCodeSlot);
	} finally {
		requireKoffi().free(exitCodeSlot);
	}
}
/**
* Return whether a Job has no active processes.
* @param api - active binding table.
* @param job - caller-owned Job handle.
* @returns true once the Job reports zero active processes.
*/
function isJobEmpty(api, job) {
	const information = Buffer.alloc(48);
	if (api.queryInformationJobObject(job, 1, information, information.length, null) === 0) throwLastError(api, "QueryInformationJobObject", "active process count");
	return information.readUInt32LE(40) === 0;
}
/**
* Terminate every process in a Job.
* @param api - active binding table.
* @param job - caller-owned Job handle.
* @param exitCode - direct Windows exit code assigned to members.
*/
function terminateJob(api, job, exitCode) {
	if (api.terminateJobObject(job, exitCode) === 0) throwLastError(api, "TerminateJobObject");
}
/**
* Close a caller-owned handle and report a labelled Win32 failure.
* @param api - active binding table.
* @param handle - handle to close.
* @param detail - lifecycle label for diagnostics.
*/
function closeHandleChecked(api, handle, detail) {
	if (api.closeHandle(handle) === 0) throwLastError(api, "CloseHandle", detail);
}
//#endregion
export { ERROR_INSUFFICIENT_BUFFER, Win32Error, allocPtrSlot, allocUint32, closeHandleChecked, decodePtr, decodeUint32, drainPipe, extendWin32ProcessBindings, isJobEmpty, isNullPtr, loadWin32ProcessBindings, loadWin32ConptyBindings, createPseudoConsole, createSuspendedLpacJobProcess, inspectFailedLpacJobProcess, closeFailedLpacJobProcessHandles, resumeLpacJobProcess, inspectLpacJobProcess, closeLpacJobProcessHandles, pollProcessExit, probeCurrentTokenJobSupport, spawnCurrentTokenJobProcess, spawnLpacJobProcess, spawnInheritedJobProcess, spawnPipedProcess, terminateJob, throwLastError, throwWin32, waitForProcessExit };
