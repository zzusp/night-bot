// Derived from DeepSeek dsh-sandbox-windows-acl 0.2.1-alpha.2 (MIT).
// Copyright (c) 2026 DeepSeek. See licenses/dsh-subprocess-local-MIT.txt.
import { existsSync, mkdirSync, realpathSync, statSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep, win32 as windowsPath } from "node:path";
import { ERROR_INSUFFICIENT_BUFFER, Win32Error, allocPtrSlot, allocUint32, closeHandleChecked, decodePtr, decodeUint32, drainPipe, loadWin32ConptyBindings, extendWin32ProcessBindings, isNullPtr, isNullPtr as isNullPtr$1, spawnInheritedJobProcess, spawnPipedProcess, throwLastError, throwLastError as throwLastError$1, throwWin32, waitForProcessExit } from "./win32.js";
import { createHash } from "node:crypto";
import { setTimeout as waitForAclLock } from "node:timers/promises";
import { createLazyRequire, parseWindowsResourceOwnership, parseWindowsResourceProof } from "./contracts.js";
//#region lib/types/win32-abi.js
/** ACL/token-specific Win32 constants. */
/** OpenProcess access required to query the current process token. */
const PROCESS_QUERY_INFORMATION = 1024;
/** Group attribute identifying the token logon SID. */
const SE_GROUP_LOGON_ID = 3221225472;
/**
* Capability-SID access mask granting write, delete, and child deletion.
* WRITE_DAC and WRITE_OWNER stay excluded so a confined child cannot rewrite
* DACLs or take ownership to escape the allowlist.
*/
const GRANT_MASK = 1114454;
/** Full access used in the restricted token default DACL. */
const FILE_ALL_ACCESS = 2032127;
//#endregion
//#region lib/types/ffi.js
/** ACL/token bindings layered on the shared Win32 process owner. */
const requireKoffi = createLazyRequire("koffi", import.meta.url);
let cachedTypes;
function ffiTypes() {
	if (cachedTypes !== void 0) return cachedTypes;
	const koffi = requireKoffi();
	const PVOID = koffi.pointer("void");
	return cachedTypes = {
		PVOID,
		PPVOID: koffi.pointer(PVOID)
	};
}
/**
* Return whether CreateFileW produced INVALID_HANDLE_VALUE.
* @param handle - handle returned by CreateFileW.
* @returns true for null, zero, or the all-bits-one sentinel.
*/
function isInvalidHandle(handle) {
	if (isNullPtr(handle)) return true;
	return handle === 18446744073709551615n || handle === -1n;
}
/**
* Encode a uint32 into an allocated slot.
* @param slot - slot allocated by allocUint32.
* @param value - unsigned value to store.
*/
function encodeUint32(slot, value) {
	requireKoffi().encode(slot, "uint32", value);
}
/**
* Return a Koffi pointer's numeric address for struct packing.
* @param ptr - native pointer.
* @returns pointer address.
*/
function ptrAddress(ptr) {
	return requireKoffi().address(ptr);
}
/**
* Allocate a raw byte block.
* @param length - byte count.
* @returns allocated pointer.
*/
function allocBytes(length) {
	return requireKoffi().alloc("uint8", length);
}
/**
* Allocate one zeroed x64 OVERLAPPED record.
* @returns allocated pointer.
* @remarks Koffi 3.1.1 crashes when LockFileEx or UnlockFileEx receives NULL;
* a zeroed OVERLAPPED is equivalent for the synchronous lock-file handle.
*/
function allocOverlapped() {
	return allocBytes(32);
}
/**
* Decode a pointer value from a Buffer field.
* @param buffer - encoded native record.
* @param offset - pointer field byte offset.
* @returns decoded pointer, or null for address zero.
*/
function decodePtrAt(buffer, offset) {
	const value = requireKoffi().decode(buffer, offset, ffiTypes().PVOID);
	return isNullPtr(value) ? null : value;
}
/**
* Decode a uint8 field at a native pointer offset.
* @param ptr - native record pointer.
* @param offset - field byte offset.
* @returns decoded value.
*/
function decodeUint8At(ptr, offset) {
	return requireKoffi().decode(ptr, offset, "uint8");
}
/**
* Decode a uint16 field at a native pointer offset.
* @param ptr - native record pointer.
* @param offset - field byte offset.
* @returns decoded value.
*/
function decodeUint16At(ptr, offset) {
	return requireKoffi().decode(ptr, offset, "uint16");
}
/**
* Decode a uint32 field at a native pointer offset.
* @param ptr - native record pointer.
* @param offset - field byte offset.
* @returns decoded value.
*/
function decodeUint32At(ptr, offset) {
	return requireKoffi().decode(ptr, offset, "uint32");
}
/**
* Compare two in-memory SID records without allocating strings.
* @param left - first native buffer.
* @param leftOffset - first SID byte offset.
* @param right - second native buffer.
* @param rightOffset - second SID byte offset.
* @returns true when revision, authority, and every sub-authority match.
*/
function sameSidAt(left, leftOffset, right, rightOffset) {
	if (decodeUint8At(left, leftOffset) !== decodeUint8At(right, rightOffset)) return false;
	const leftCount = decodeUint8At(left, leftOffset + 1);
	if (leftCount !== decodeUint8At(right, rightOffset + 1) || leftCount > 15) return false;
	for (let index = 0; index < 6; index += 1) if (decodeUint8At(left, leftOffset + 2 + index) !== decodeUint8At(right, rightOffset + 2 + index)) return false;
	for (let index = 0; index < leftCount; index += 1) if (decodeUint32At(left, leftOffset + 8 + index * 4) !== decodeUint32At(right, rightOffset + 8 + index * 4)) return false;
	return true;
}
let cached;
function bindings() {
	if (cached !== void 0) return cached;
	const koffi = requireKoffi();
	const { PVOID, PPVOID } = ffiTypes();
	cached = extendWin32ProcessBindings(({ kernel32, advapi32, bind }) => ({
		openProcess: bind(kernel32, "OpenProcess", PVOID, [
			"uint32",
			"int",
			"uint32"
		]),
		openProcessToken: bind(advapi32, "OpenProcessToken", "int", [
			PVOID,
			"uint32",
			PPVOID
		]),
		localAlloc: bind(kernel32, "LocalAlloc", PVOID, ["uint32", "size_t"]),
		localFree: bind(kernel32, "LocalFree", PVOID, [PVOID]),
		convertStringSidToSidW: bind(advapi32, "ConvertStringSidToSidW", "int", ["str16", PPVOID]),
		createWellKnownSid: bind(advapi32, "CreateWellKnownSid", "int", [
			"int",
			PVOID,
			PVOID,
			koffi.pointer("uint32")
		]),
		isValidSid: bind(advapi32, "IsValidSid", "int", [PVOID]),
		getLengthSid: bind(advapi32, "GetLengthSid", "uint32", [PVOID]),
		copySid: bind(advapi32, "CopySid", "int", [
			"uint32",
			PVOID,
			PVOID
		]),
		getTokenInformation: bind(advapi32, "GetTokenInformation", "int", [
			PVOID,
			"int",
			PVOID,
			"uint32",
			koffi.pointer("uint32")
		]),
		setTokenInformation: bind(advapi32, "SetTokenInformation", "int", [
			PVOID,
			"int",
			PVOID,
			"uint32"
		]),
		createRestrictedToken: bind(advapi32, "CreateRestrictedToken", "int", [
			PVOID,
			"uint32",
			"uint32",
			PVOID,
			"uint32",
			PVOID,
			"uint32",
			PVOID,
			PPVOID
		]),
		setEntriesInAclW: bind(advapi32, "SetEntriesInAclW", "uint32", [
			"uint32",
			PVOID,
			PVOID,
			PPVOID
		]),
		initializeAcl: bind(advapi32, "InitializeAcl", "int", [
			PVOID,
			"uint32",
			"uint32"
		]),
		addMandatoryAce: bind(advapi32, "AddMandatoryAce", "int", [
			PVOID,
			"uint32",
			"uint32",
			"uint32",
			PVOID
		]),
		setNamedSecurityInfoW: bind(advapi32, "SetNamedSecurityInfoW", "uint32", [
			"str16",
			"int",
			"uint32",
			PVOID,
			PVOID,
			PVOID,
			PVOID
		]),
		getNamedSecurityInfoW: bind(advapi32, "GetNamedSecurityInfoW", "uint32", [
			"str16",
			"int",
			"uint32",
			PPVOID,
			PPVOID,
			PPVOID,
			PPVOID,
			PPVOID
		]),
		getTempPathW: bind(kernel32, "GetTempPathW", "uint32", ["uint32", PVOID]),
		setEnvironmentVariableW: bind(kernel32, "SetEnvironmentVariableW", "int", ["str16", "str16"]),
		setConsoleCtrlHandler: bind(kernel32, "SetConsoleCtrlHandler", "int", [PVOID, "int"]),
		createFileW: bind(kernel32, "CreateFileW", PVOID, [
			"str16",
			"uint32",
			"uint32",
			PVOID,
			"uint32",
			"uint32",
			PVOID
		]),
		lockFileEx: bind(kernel32, "LockFileEx", "int", [
			PVOID,
			"uint32",
			"uint32",
			"uint32",
			"uint32",
			PVOID
		]),
		unlockFileEx: bind(kernel32, "UnlockFileEx", "int", [
			PVOID,
			"uint32",
			"uint32",
			"uint32",
			PVOID
		])
	}));
	return cached;
}
/**
* Resolve the cached ACL/token binding table asynchronously.
* @returns generic process plus ACL/token bindings.
*/
function loadWindowsAclBindings() {
	return Promise.resolve(bindings());
}
let cachedAppContainer;
/** 生产 Profile 生命周期使用同一原生表；导入模块不会创建 Profile 或加载 DLL。 */
function loadWindowsAppContainerBindings() {
 if (cachedAppContainer !== undefined) return cachedAppContainer;
 const koffi = requireKoffi();
 const { PVOID, PPVOID } = ffiTypes();
 const U32 = koffi.pointer("uint32");
 const profile = extendWin32ProcessBindings(({ kernel32, advapi32, bind }) => {
  const getSystemDirectoryW = bind(kernel32, "GetSystemDirectoryW", "uint32", [PVOID, "uint32"]);
  const buffer = Buffer.alloc(32768 * 2);
  const length = getSystemDirectoryW(buffer, buffer.length / 2);
  if (length === 0) throwLastError(bindings(), "GetSystemDirectoryW");
  if (length >= buffer.length / 2) throw new Error("Invalid native system directory length");
  const directory = buffer.subarray(0, length * 2).toString("utf16le");
  if (!isAbsolute(directory) || directory.includes("\0")) throw new Error("Invalid native system directory");
  // 固定系统 DLL 来自内核返回的系统目录，不从任务 cwd 或环境变量装载。
  const userenv = koffi.load(join(directory, "userenv.dll"));
  const shell32 = koffi.load(join(directory, "shell32.dll"));
  const ole32 = koffi.load(join(directory, "ole32.dll"));
  const ntdll = koffi.load(join(directory, "ntdll.dll"));
  return {
   systemDirectory: directory,
   createAppContainerProfile: bind(userenv, "CreateAppContainerProfile", "int32", ["str16", "str16", "str16", PVOID, "uint32", PPVOID]),
   deleteAppContainerProfile: bind(userenv, "DeleteAppContainerProfile", "int32", ["str16"]),
   deriveAppContainerSidFromAppContainerName: bind(userenv, "DeriveAppContainerSidFromAppContainerName", "int32", ["str16", PPVOID]),
   getAppContainerFolderPath: bind(userenv, "GetAppContainerFolderPath", "int32", ["str16", PPVOID]),
   getAppContainerRegistryLocation: bind(userenv, "GetAppContainerRegistryLocation", "int32", ["uint32", PPVOID]),
   getKnownFolderPath: bind(shell32, "SHGetKnownFolderPath", "int32", [PVOID, "uint32", PVOID, PPVOID]),
   coTaskMemFree: bind(ole32, "CoTaskMemFree", "void", [PVOID]),
   freeSid: bind(advapi32, "FreeSid", PVOID, [PVOID]),
   equalSid: bind(advapi32, "EqualSid", "int", [PVOID, PVOID]),
   convertSidToStringSidW: bind(advapi32, "ConvertSidToStringSidW", "int", [PVOID, PPVOID]),
   convertStringSecurityDescriptorToSecurityDescriptorW: bind(advapi32, "ConvertStringSecurityDescriptorToSecurityDescriptorW", "int", ["str16", "uint32", PPVOID, U32]),
   openThreadToken: bind(advapi32, "OpenThreadToken", "int", [PVOID, "uint32", "int", PPVOID]),
   duplicateTokenEx: bind(advapi32, "DuplicateTokenEx", "int", [PVOID, "uint32", PVOID, "int", "int", PPVOID]),
   impersonateLoggedOnUser: bind(advapi32, "ImpersonateLoggedOnUser", "int", [PVOID]),
   revertToSelf: bind(advapi32, "RevertToSelf", "int", []),
   getCurrentThread: bind(kernel32, "GetCurrentThread", PVOID, []),
   getCurrentThreadId: bind(kernel32, "GetCurrentThreadId", "uint32", []),
   getFileAttributesW: bind(kernel32, "GetFileAttributesW", "uint32", ["str16"]),
   createDirectoryW: bind(kernel32, "CreateDirectoryW", "int", ["str16", PVOID]),
   setFileInformationByHandle: bind(kernel32, "SetFileInformationByHandle", "int", [PVOID, "int", PVOID, "uint32"]),
   getFinalPathNameByHandleW: bind(kernel32, "GetFinalPathNameByHandleW", "uint32", [PVOID, PVOID, "uint32", "uint32"]),
   getFileInformationByHandleEx: bind(kernel32, "GetFileInformationByHandleEx", "int", [PVOID, "int", PVOID, "uint32"]),
   getSecurityInfo: bind(advapi32, "GetSecurityInfo", "uint32", [PVOID, "int", "uint32", PPVOID, PPVOID, PPVOID, PPVOID, PPVOID]),
   setSecurityInfo: bind(advapi32, "SetSecurityInfo", "uint32", [PVOID, "int", "uint32", PVOID, PVOID, PVOID, PVOID]),
   getSecurityDescriptorLength: bind(advapi32, "GetSecurityDescriptorLength", "uint32", [PVOID]),
   createPrivateObjectSecurityEx: bind(advapi32, "CreatePrivateObjectSecurityEx", "int", [PVOID, PVOID, PPVOID, PVOID, "int", "uint32", PVOID, PVOID]),
   destroyPrivateObjectSecurity: bind(advapi32, "DestroyPrivateObjectSecurity", "int", [PPVOID]),
   mapGenericMask: bind(advapi32, "MapGenericMask", "void", [U32, PVOID]),
   accessCheck: bind(advapi32, "AccessCheck", "int", [PVOID, PVOID, "uint32", PVOID, PVOID, U32, U32, koffi.pointer("int")]),
   regOpenCurrentUser: bind(advapi32, "RegOpenCurrentUser", "int32", ["uint32", PPVOID]),
   regOpenKeyExW: bind(advapi32, "RegOpenKeyExW", "int32", [PVOID, "str16", "uint32", "uint32", PPVOID]),
   regQueryValueExW: bind(advapi32, "RegQueryValueExW", "int32", [PVOID, "str16", PVOID, U32, PVOID, U32]),
   regEnumKeyExW: bind(advapi32, "RegEnumKeyExW", "int32", [PVOID, "uint32", PVOID, U32, PVOID, PVOID, PVOID, PVOID]),
   regCloseKey: bind(advapi32, "RegCloseKey", "int32", [PVOID]),
   regQueryInfoKeyW: bind(advapi32, "RegQueryInfoKeyW", "int32", [PVOID, PVOID, U32, PVOID, U32, U32, U32, U32, U32, U32, U32, PVOID]),
   getProcessId: bind(kernel32, "GetProcessId", "uint32", [PVOID]),
   isProcessInJob: bind(kernel32, "IsProcessInJob", "int", [PVOID, PVOID, koffi.pointer("int")]),
   exitProcess: bind(kernel32, "ExitProcess", "void", ["uint32"]),
   ntQueryKey: bind(ntdll, "NtQueryKey", "int32", [PVOID, "int", PVOID, "uint32", U32])
  };
 });
 cachedAppContainer = { ...bindings(), ...loadWin32ConptyBindings(), ...profile };
 return cachedAppContainer;
}
/**
* Resolve the cached ACL/token binding table synchronously.
* @returns generic process plus ACL/token bindings.
*/
function win32Sync() {
	return bindings();
}
/**
* Resolve the current Windows temporary directory.
* @param api - active ACL/token binding table.
* @returns UTF-16 path reported by GetTempPathW.
*/
function getTempPath(api) {
	const buffer = Buffer.alloc(261 * 2);
	const length = api.getTempPathW(buffer.length / 2, buffer);
	if (length === 0) throwLastError(api, "GetTempPathW");
	if (length > buffer.length / 2) throw new Win32Error("GetTempPathW", ERROR_INSUFFICIENT_BUFFER, `required ${length} chars exceed the ${buffer.length / 2}-char buffer; nothing was written`);
	return buffer.subarray(0, length * 2).toString("utf16le");
}
//#endregion
//#region lib/types/acl.js
/**
* ACL editing helpers: grant/revoke a capability SID on a directory via
* SetEntriesInAclW + SetNamedSecurityInfoW (the same calls the POC uses, with
* the failure handling the POC lacks). Every API call is checked and every
* failure is reported with the API name, the exact Win32 code, the formatted
* system text, and the affected path.
*
* Each grant applies three edits in ONE SetNamedSecurityInfoW call: the
* capability-SID allow ACE, a Deny ACE that removes the ambient
* `FILE_DELETE_CHILD` right from the world SID, and a Low no-write-up
* mandatory label ({@link buildLowLabelAcl}). The deny is what keeps one
* granted root out of another's reach: Windows also authorizes a delete from
* the parent directory's `FILE_DELETE_CHILD` right, which the token's
* write-restricted intersection does not reach, and every granted root carries
* the Low label that clears the integrity check.
*
* Concurrency: grants are read-merge-write against the directory's CURRENT
* DACL, and the whole get-merge-set sequence runs under a per-path exclusive
* LockFileEx lock (see {@link withPathLock}) so concurrent sandbox instances
* cannot clobber each other's ACEs.
* @module night-bot/process/windows-acl/acl
*/
/**
* Pack one EXPLICIT_ACCESS_W (48 bytes, layout verified by abi-probe.cpp):
* perms@0, mode@4, inheritance@8, Trustee@16 { pMultipleTrustee@16,
* MultipleTrusteeOperation@24, TrusteeForm@28, TrusteeType@32, ptstrName@40 }.
* `permissions` is the access mask; the POC passes 0 for REVOKE_ACCESS, which
* removes every ACE for the trustee. `inheritance` defaults to children of
* both kinds; the ambient-delete deny narrows it to containers because
* FILE_DELETE_CHILD is meaningless on a file and its bit would otherwise
* spread through the file's inherited mask.
* @param sidPtr - the trustee SID the entry names.
* @param mode - the access mode (GRANT_ACCESS, DENY_ACCESS, or REVOKE_ACCESS).
* @param permissions - the access mask to grant or deny (0 for REVOKE_ACCESS).
* @param inheritance - the ACE inheritance flags.
* @returns the packed entry buffer.
*/
function buildExplicitAccess(sidPtr, mode, permissions, inheritance = 3) {
	const entry = Buffer.alloc(48);
	entry.writeUInt32LE(permissions, 0);
	entry.writeUInt32LE(mode, 4);
	entry.writeUInt32LE(inheritance, 8);
	entry.writeUInt32LE(0, 24);
	entry.writeUInt32LE(0, 28);
	entry.writeUInt32LE(0, 32);
	entry.writeBigUInt64LE(ptrAddress(sidPtr), 40);
	return entry;
}
/**
* One lock file per protected path: `<GetTempPathW()>\night-acl-locks\<first 16
* hex of sha256(lowercased path)>.lock`. The lock root derives from
* GetTempPathW (never from runner argv or environment overrides), and the lowercasing
* maps Windows's case-insensitive path spellings onto one lock.
* @param api - the binding table.
* @param path - the protected directory (absolute).
* @returns the lock file path for that directory.
*/
function lockFilePath(api, path) {
	const digest = createHash("sha256").update(path.toLowerCase()).digest("hex").slice(0, 16);
	return join(getTempPath(api), "night-acl-locks", `${digest}.lock`);
}
/**
* Run `action` holding the per-path exclusive lock: CreateFileW
* (OPEN_ALWAYS, shared read/write but NOT delete — a deletable lock file
* could be removed and recreated under the holder, letting two processes
* hold "the same" lock), then a one-byte LockFileEx
* (LOCKFILE_EXCLUSIVE_LOCK, zeroed OVERLAPPED = lock from offset 0 on the
* synchronous handle — see allocOverlapped for why not NULL), then
* UnlockFileEx + CloseHandle. Fail-closed: open/lock/unlock/close failures
* throw like every other Win32 call in this package; an `action` failure
* still unlocks (best-effort) and rethrows the original error.
* @param api - the binding table.
* @param path - the protected directory (absolute).
* @param action - the get-merge-set sequence to serialize.
* @returns the action's result.
*/
function withPathLock(api, path, action) {
	const lockPath = lockFilePath(api, path);
	mkdirSync(dirname(lockPath), { recursive: true });
	const handle = api.createFileW(lockPath, -1073741824, 3, null, 4, 0, null);
	if (isInvalidHandle(handle)) throwLastError$1(api, "CreateFileW", lockPath);
	const overlapped = allocOverlapped();
	if (api.lockFileEx(handle, 2, 0, 1, 0, overlapped) === 0) {
		const win32Code = api.getLastError();
		api.closeHandle(handle);
		throwWin32(api, "LockFileEx", win32Code, lockPath);
	}
	let result;
	try {
		result = action();
	} catch (error) {
		api.unlockFileEx(handle, 0, 1, 0, overlapped);
		api.closeHandle(handle);
		throw error;
	}
	if (api.unlockFileEx(handle, 0, 1, 0, overlapped) === 0) {
		const win32Code = api.getLastError();
		api.closeHandle(handle);
		throwWin32(api, "UnlockFileEx", win32Code, lockPath);
	}
	if (api.closeHandle(handle) === 0) throwLastError$1(api, "CloseHandle", `lock file ${lockPath}`);
	return result;
}
/**
* Read the directory's current explicit DACL and mandatory label via
* GetNamedSecurityInfoW.
* Allocation contract (the POC's RevokeAccess, minus its missing checks): the
* returned ACL pointer sits INSIDE the security descriptor allocation — only
* the descriptor may be LocalFree'd, and it must not be freed before
* SetEntriesInAclW has consumed the ACL. Freeing the ACL pointer itself
* corrupts the heap (verified the hard way).
* @param api - the binding table.
* @param path - the directory whose DACL and label are read.
* @returns the current explicit DACL and label ACL (null when the directory carries none) plus their owning descriptor.
*/
function readCurrentSecurity(api, path) {
	const ownerSlot = allocPtrSlot();
	const groupSlot = allocPtrSlot();
	const daclSlot = allocPtrSlot();
	const saclSlot = allocPtrSlot();
	const descriptorSlot = allocPtrSlot();
	const readResult = api.getNamedSecurityInfoW(path, 1, 20, ownerSlot, groupSlot, daclSlot, saclSlot, descriptorSlot);
	if (readResult !== 0) throwWin32(api, "GetNamedSecurityInfoW", readResult, path);
	return {
		oldAcl: decodePtr(daclSlot),
		labelAcl: decodePtr(saclSlot),
		descriptor: decodePtr(descriptorSlot)
	};
}
/**
* Build the Low mandatory label applied with every write grant: one
* SYSTEM_MANDATORY_LABEL_ACE naming `lowLabelSidPtr` with the no-write-up
* policy, inheriting to subcontainers and objects so later children carry the
* same label. The caller frees the returned ACL with LocalFree
* (SetNamedSecurityInfoW copies it); every Win32 call is checked and a
* half-built ACL is released before the error is thrown.
* @param api - the binding table.
* @param lowLabelSidPtr - the Low integrity SID (S-1-16-4096) the label names.
* @returns the ACL carrying the single inheritable label ACE.
*/
function buildLowLabelAcl(api, lowLabelSidPtr) {
	const sidLength = api.getLengthSid(lowLabelSidPtr);
	if (sidLength === 0) throwLastError$1(api, "GetLengthSid", "Low mandatory label SID");
	const aclLength = 16 + sidLength;
	const acl = api.localAlloc(64, aclLength);
	if (isNullPtr$1(acl)) throwLastError$1(api, "LocalAlloc", "Low mandatory label ACL");
	if (api.initializeAcl(acl, aclLength, 2) === 0) {
		const win32Code = api.getLastError();
		api.localFree(acl);
		throwWin32(api, "InitializeAcl", win32Code, "Low mandatory label ACL");
	}
	if (api.addMandatoryAce(acl, 2, 3, 1, lowLabelSidPtr) === 0) {
		const win32Code = api.getLastError();
		api.localFree(acl);
		throwWin32(api, "AddMandatoryAce", win32Code, "Low mandatory label ACL");
	}
	return acl;
}
/**
* True when the label ACL already carries the EXACT label this module would
* add (mandatory-label ACE, OI|CI inheritance, no-write-up policy, the Low
* SID), so a re-grant can skip the eager full-tree propagation.
* @param labelAcl - the current label ACL pointer (from {@link readCurrentSecurity}).
* @param lowLabelSidPtr - the Low integrity SID to match.
* @returns whether the exact label ACE is already present.
*/
function hasExactLabel(labelAcl, lowLabelSidPtr) {
	return hasExactEntry(labelAcl, 17, 3, 1, lowLabelSidPtr);
}
/**
* Shared tail of grantWrite and revokeWrite: merge `entries` into `oldAcl`
* (null = no explicit DACL yet; SetEntriesInAclW builds one from scratch),
* free the descriptor before applying the merged ACL, apply the merged DACL
* together with the label edit in one SetNamedSecurityInfoW call, then free
* every ACL this call owns — checking each call and reporting with the
* caller's label. The entry count derives from the buffer, so a grant can
* carry its capability ACE and its ambient-delete deny in one merge.
* @param api - the binding table.
* @param path - the directory the DACL and label edits apply to.
* @param entries - packed EXPLICIT_ACCESS_W records to merge (grant, deny, or revoke).
* @param oldAcl - the current explicit DACL (from {@link readCurrentSecurity}).
* @param labelEdit - the label change to apply alongside the DACL.
* @param descriptor - the descriptor allocation owning `oldAcl`.
* @param label - the caller's name for error details.
*/
function mergeAndApply(api, path, entries, oldAcl, labelEdit, descriptor, label) {
	const newAclSlot = allocPtrSlot();
	const mergeResult = api.setEntriesInAclW(entries.length / 48, entries, oldAcl, newAclSlot);
	if (mergeResult !== 0) {
		if (descriptor !== null) api.localFree(descriptor);
		if (labelEdit.kind === "apply") api.localFree(labelEdit.acl);
		throwWin32(api, "SetEntriesInAclW", mergeResult, `${label}(${path})`);
	}
	const newAcl = decodePtr(newAclSlot);
	if (newAcl === null) {
		if (descriptor !== null) api.localFree(descriptor);
		if (labelEdit.kind === "apply") api.localFree(labelEdit.acl);
		throwWin32(api, "SetEntriesInAclW", api.getLastError(), `${label}(${path}): null new ACL`);
	}
	const freedDescriptor = descriptor !== null ? api.localFree(descriptor) : null;
	const applyResult = api.setNamedSecurityInfoW(path, 1, labelEdit.kind === "keep" ? 4 : 20, null, null, newAcl, labelEdit.kind === "apply" ? labelEdit.acl : null);
	const freedNew = api.localFree(newAcl);
	const freedLabel = labelEdit.kind === "apply" ? api.localFree(labelEdit.acl) : null;
	if (applyResult !== 0) throwWin32(api, "SetNamedSecurityInfoW", applyResult, `${label}(${path})`);
	if (freedDescriptor !== null && !isNullPtr$1(freedDescriptor)) throwLastError$1(api, "LocalFree", `${label}(${path}) descriptor`);
	if (!isNullPtr$1(freedNew)) throwLastError$1(api, "LocalFree", `${label}(${path}) new ACL`);
	if (freedLabel !== null && !isNullPtr$1(freedLabel)) throwLastError$1(api, "LocalFree", `${label}(${path}) label ACL`);
}
/**
* True when the explicit DACL already carries the EXACT entry
* `(aceType, inheritance, mask, trustee SID)`. Every field is read through
* koffi.decode at pointer offsets — no memcpy, no pointer arithmetic. The
* ACE's SID is INLINE (embedded in the ACE after the 4-byte mask — there is
* no pointer to read; reading one yields garbage addresses and crashed
* EqualSid, verified by gdb), so it is compared field-by-field against the
* trustee SID through bounded offset reads ({@link sameSidAt}). Allowed and
* denied ACEs share the Mask@4/SID@8 layout. A malformed header reads as "no
* exact entry" so the caller falls back to the merge-apply path, which owns
* the robust failure handling.
* @param acl - the current explicit DACL pointer (from {@link readCurrentSecurity}).
* @param aceType - the ACE type to match.
* @param inheritance - the ACE inheritance flags to match.
* @param mask - the access mask to match.
* @param sidPtr - the trustee SID to match.
* @returns whether the exact entry is already present.
*/
function hasExactEntry(acl, aceType, inheritance, mask, sidPtr) {
	const aclSize = decodeUint16At(acl, 2);
	const aceCount = decodeUint16At(acl, 4);
	if (aclSize < 8 || aclSize > 1048576) return false;
	let offset = 8;
	for (let index = 0; index < aceCount; index++) {
		const aceSize = decodeUint16At(acl, offset + 2);
		if (aceSize < 8 || offset + aceSize > aclSize) return false;
		if (decodeUint8At(acl, offset) === aceType && decodeUint8At(acl, offset + 1) === inheritance && decodeUint32At(acl, offset + 4) === mask && sameSidAt(acl, offset + 8, sidPtr, 0)) return true;
		offset += aceSize;
	}
	return false;
}
/**
* True when the explicit DACL already carries the EXACT write grant this
* module would add: the Allow ACE for {@link abi.GRANT_MASK} naming the
* capability SID.
* @param oldAcl - the current explicit DACL pointer (from {@link readCurrentSecurity}).
* @param sidPtr - the capability SID to match.
* @returns whether the exact grant ACE is already present.
*/
function hasExactGrant(oldAcl, sidPtr) {
	return hasExactEntry(oldAcl, 0, 3, GRANT_MASK, sidPtr);
}
/**
* True when the explicit DACL already carries the EXACT ambient-delete deny:
* the container-inherited Deny ACE for {@link abi.FILE_DELETE_CHILD} naming
* the world SID. It is part of the idempotent skip, so a root granted by an
* earlier build receives the deny on its next provision.
* @param oldAcl - the current explicit DACL pointer (from {@link readCurrentSecurity}).
* @param worldSidPtr - the Everyone SID the deny names.
* @returns whether the exact deny ACE is already present.
*/
function hasExactDeny(oldAcl, worldSidPtr) {
	return hasExactEntry(oldAcl, 1, 2, 64, worldSidPtr);
}
/**
* True when a capability grant for a SID OTHER than `sidPtr` stands on this
* DACL — the condition under which a revoke must leave the shared Low label in
* place, or the remaining grant's child would lose its write authority.
* @param oldAcl - the current explicit DACL pointer (from {@link readCurrentSecurity}).
* @param sidPtr - the capability SID being revoked.
* @returns whether another capability grant remains.
*/
function hasForeignGrant(oldAcl, sidPtr) {
	const aclSize = decodeUint16At(oldAcl, 2);
	const aceCount = decodeUint16At(oldAcl, 4);
	if (aclSize < 8 || aclSize > 1048576) return false;
	let offset = 8;
	for (let index = 0; index < aceCount; index++) {
		const aceSize = decodeUint16At(oldAcl, offset + 2);
		if (aceSize < 8 || offset + aceSize > aclSize) return false;
		if (decodeUint8At(oldAcl, offset) === 0 && decodeUint32At(oldAcl, offset + 4) === 1114454 && !sameSidAt(oldAcl, offset + 8, sidPtr, 0)) return true;
		offset += aceSize;
	}
	return false;
}
/**
* Grant `GRANT_MASK` (Write+Delete, displays as "Modify") to the capability SID
* on `path`, deny the world SID the ambient `FILE_DELETE_CHILD` right, and
* apply the Low mandatory label — one merge. The deny inherits to containers
* only: the right is evaluated on directories, and inheriting its bit onto
* files would deny every `FILE_ALL_ACCESS`/`GENERIC_ALL` open inside the root
* (0x40 is a member of that mask). The capability ACE's DELETE bit is then the
* only delete authority inside the root, so a file whose own DACL grants no
* DELETE is no longer deletable through its parent's rights.
*
* Idempotent: the exact ACE, deny, and label together SKIP the
* SetNamedSecurityInfoW apply, which would otherwise re-propagate the
* identical descriptor across the whole tree (eager inheritance; minutes on
* large workspaces). Otherwise read-merge-write, so pre-existing explicit ACEs
* survive (same shape as {@link revokeWrite}). Runs under the per-path lock.
* The directory must be owned by the caller AND grant WRITE_OWNER (the label
* lives in the SACL; owner-implicit rights cover only READ_CONTROL and
* WRITE_DAC) — a Full-control workspace satisfies both.
* @param api - the binding table.
* @param path - the directory whose DACL and label gain the grant (the workspace or temp root).
* @param sidPtr - the capability SID the ACE names.
* @param lowLabelSidPtr - the Low integrity SID the mandatory label names.
* @param worldSidPtr - the Everyone SID the ambient-delete deny names.
*/
function grantWrite(api, path, sidPtr, lowLabelSidPtr, worldSidPtr) {
	withPathLock(api, path, () => {
		const { oldAcl, labelAcl, descriptor } = readCurrentSecurity(api, path);
		if (oldAcl !== null && labelAcl !== null && hasExactGrant(oldAcl, sidPtr) && hasExactDeny(oldAcl, worldSidPtr) && hasExactLabel(labelAcl, lowLabelSidPtr)) {
			if (descriptor !== null) {
				if (!isNullPtr$1(api.localFree(descriptor))) throwLastError$1(api, "LocalFree", `grantWrite(${path}) descriptor`);
			}
			return;
		}
		let label;
		try {
			label = buildLowLabelAcl(api, lowLabelSidPtr);
		} catch (error) {
			if (descriptor !== null) api.localFree(descriptor);
			throw error;
		}
		mergeAndApply(api, path, Buffer.concat([buildExplicitAccess(worldSidPtr, 3, 64, 2), buildExplicitAccess(sidPtr, 1, GRANT_MASK)]), oldAcl, {
			kind: "apply",
			acl: label
		}, descriptor, "grantWrite");
	});
}
/**
* Remove every ACE for the capability SID from the directory DACL (REVOKE_ACCESS
* merge — other entries are preserved). The shared Low label is cleared only
* when no other capability grant remains on the directory: two grants may
* target one directory, and the surviving one still needs the label for its
* child's writes. Returns whether an ACE removal was attempted (false when the
* directory carries no DACL at all).
*
* Runs under the per-path lock (the whole get-merge-set sequence); the
* descriptor/ACL allocation contract lives on {@link readCurrentSecurity}.
* @param api - the binding table.
* @param path - the directory whose DACL loses the capability-SID ACEs.
* @param sidPtr - the capability SID whose ACEs are removed.
* @returns whether an ACE removal was attempted (false when the directory carries no DACL at all).
*/
function revokeWrite(api, path, sidPtr) {
	return withPathLock(api, path, () => {
		const { oldAcl, descriptor } = readCurrentSecurity(api, path);
		if (oldAcl === null) {
			if (descriptor !== null) {
				if (!isNullPtr$1(api.localFree(descriptor))) throwLastError$1(api, "LocalFree", `revokeWrite(${path}) descriptor`);
			}
			return false;
		}
		mergeAndApply(api, path, buildExplicitAccess(sidPtr, 4, 0), oldAcl, hasForeignGrant(oldAcl, sidPtr) ? { kind: "keep" } : { kind: "clear" }, descriptor, "revokeWrite");
		return true;
	});
}
//#endregion
//#region lib/types/path-boundary.js
/**
* Canonical directory-boundary checks for the Windows ACL workspace and
* private-temp capabilities.
* @module night-bot/process/windows-acl/path-boundary
*/
/** Whether `root` is the same canonical directory as `candidate` or contains it. */
function containsDirectory(root, candidate) {
	const relation = relative(realpathSync.native(root), realpathSync.native(candidate));
	return relation === "" || !isAbsolute(relation) && relation !== ".." && !relation.startsWith(`..${sep}`);
}
/**
* Reject a temp parent that is inside the workspace: every child created
* below it would inherit the standing workspace capability.
* @param workspaceRoot - the canonical workspace root that receives the standing ACE.
* @param tempRoot - the existing parent beneath which a private temp child would be created.
*/
function assertTempRootOutsideWorkspace(workspaceRoot, tempRoot) {
	if (containsDirectory(workspaceRoot, tempRoot)) throw new Error(`Windows ACL temp root must be outside the workspace: workspace=${workspaceRoot}; temp=${tempRoot}`);
}
/**
* Reject overlap between an actual private temp directory and any writable
* directory: either inheritance direction would merge the two capabilities.
* @param writableDirs - directories carrying the standing workspace capability.
* @param tempDir - the existing directory carrying the revocable temp capability.
*/
function assertPrivateTempDisjoint(writableDirs, tempDir) {
	for (const writableDir of writableDirs) if (containsDirectory(writableDir, tempDir) || containsDirectory(tempDir, writableDir)) throw new Error(`AclSandbox private temp directory must be disjoint from writable directories: writable=${writableDir}; temp=${tempDir}`);
}
//#endregion
//#region lib/types/spawn.js
/** Restricted-token adapters over the shared Win32 process owner. */
/**
* Spawn a restricted-token child with piped stdout/stderr.
* @param api - ACL/token binding table.
* @param token - restricted primary token.
* @param options - command, args, and working directory.
* @returns process and caller-owned pipe handles.
*/
function spawnSandboxed(api, token, options) {
	return spawnPipedProcess(api, {
		...options,
		token
	});
}
/**
* Spawn a restricted-token child in a kill-on-close Job with inherited stdio.
* @param api - ACL/token binding table.
* @param token - restricted primary token.
* @param options - command, args, and working directory.
* @returns process and Job handles after assignment and resume.
*/
function spawnSandboxedInherited(api, token, options) {
	return spawnInheritedJobProcess(api, {
		...options,
		token
	});
}
/**
* Wait for a restricted child and close its process handle.
* @param api - ACL/token binding table.
* @param process - caller-owned process handle.
* @returns direct process exit code.
*/
function waitForExit(api, process) {
	return waitForProcessExit(api, process);
}
//#endregion
//#region lib/types/token.js
/**
* Restricted-token construction: open the current process token, extract its
* logon SID, build the well-known SIDs, and call CreateRestrictedToken with
* the POC's restricting-SID allowlist. Every API call is checked; any failure
* throws with the API name and the exact Win32 code — the original POC ignored
* all of these and silently ran children with the FULL, unrestricted token.
* @module night-bot/process/windows-acl/token
*/
/**
* Open the current process's access token with the rights
* CreateRestrictedToken requires (the POC's OpenProcessToken call; the token
* handle is obtained through a real OpenProcess handle because the
* GetCurrentProcess() pseudo-handle is not addressable through koffi).
* @param api - the binding table.
* @returns the opened token handle.
*/
function openCurrentProcessToken(api) {
	const processHandle = api.openProcess(PROCESS_QUERY_INFORMATION, 0, process.pid);
	if (isNullPtr$1(processHandle)) throwLastError$1(api, "OpenProcess", `pid ${process.pid}`);
	const tokenSlot = allocPtrSlot();
	if (api.openProcessToken(processHandle, 139, tokenSlot) === 0) {
		const win32Code = api.getLastError();
		api.closeHandle(processHandle);
		throwWin32(api, "OpenProcessToken", win32Code, `pid ${process.pid}`);
	}
	if (api.closeHandle(processHandle) === 0) throwLastError$1(api, "CloseHandle", "OpenProcess process handle");
	const token = decodePtr(tokenSlot);
	if (token === null) throwWin32(api, "OpenProcessToken", api.getLastError(), "null token handle");
	return token;
}
/**
* Find and copy the token's logon session SID (S-1-5-5-x-y, attribute
* SE_GROUP_LOGON_ID). The restricted token needs it for WinSta0/desktop and
* other per-logon objects; the POC extracts it the same way.
* @param api - the binding table.
* @param token - the token whose groups are scanned.
* @returns a copied logon SID (thrown when the token carries none).
*/
function findLogonSid(api, token) {
	const neededSlot = allocUint32();
	api.getTokenInformation(token, 2, null, 0, neededSlot);
	const needed = decodeUint32(neededSlot);
	if (needed === 0) throwLastError$1(api, "GetTokenInformation", "TokenGroups size query");
	if (needed < 8) throwWin32(api, "GetTokenInformation", api.getLastError(), `implausible TokenGroups size ${needed}`);
	const groups = Buffer.alloc(needed);
	if (api.getTokenInformation(token, 2, groups, groups.length, neededSlot) === 0) throwLastError$1(api, "GetTokenInformation", "TokenGroups");
	const groupCount = groups.readUInt32LE(0);
	for (let index = 0; index < groupCount; index++) {
		const sidPtr = decodePtrAt(groups, 8 + index * 16);
		const isLogonId = (groups.readUInt32LE(8 + index * 16 + 8) & SE_GROUP_LOGON_ID) >>> 0 === SE_GROUP_LOGON_ID >>> 0;
		if (sidPtr === null || !isLogonId) continue;
		const sidLength = api.getLengthSid(sidPtr);
		if (sidLength === 0) throwLastError$1(api, "GetLengthSid", `logon SID group ${index}`);
		const copy = allocBytes(sidLength);
		if (api.copySid(sidLength, copy, sidPtr) === 0) throwLastError$1(api, "CopySid", `logon SID group ${index}`);
		return copy;
	}
	throw new Error(`CreateRestrictedToken prerequisite failed: no logon SID found among ${groupCount} token groups`);
}
/**
* Create one well-known SID (68-byte buffer) and assert its validity.
* @param api - the binding table.
* @param type - the WELL_KNOWN_SID_TYPE to create.
* @returns the created SID pointer.
*/
function makeWellKnownSid(api, type) {
	const sid = allocBytes(68);
	const sizeSlot = allocUint32();
	encodeUint32(sizeSlot, 68);
	if (api.createWellKnownSid(type, null, sid, sizeSlot) === 0) throwLastError$1(api, "CreateWellKnownSid", `type ${type}`);
	if (api.isValidSid(sid) === 0) throwLastError$1(api, "IsValidSid", `CreateWellKnownSid type ${type}`);
	return sid;
}
/**
* Merge one full-access allow ACE for `sidPtr` into the token's DEFAULT DACL
* — the DACL every NEW object the token holder creates (without an explicit
* security descriptor) takes. The restricted token inherits the user's
* default DACL verbatim, which names no restricting SID: a new anonymous pipe
* (child stdio) therefore fails the write pass-2 check at creation
* (ERROR_ACCESS_DENIED; Node surfaces it as spawn EPERM), breaking every
* piped-stdio grandchild spawn. The merged ACE names a RESTRICTING SID (the
* write SID under workspace-write, Everyone under read-only), so each new
* object's own DACL passes pass-2 while object creation itself stays gated by
* the parent container's DACL (files outside the granted trees remain
* uncreatable). Fails closed: any Win32 failure throws before the spawn.
* @param api - the binding table.
* @param token - the restricted token to adjust (requires TOKEN_ADJUST_DEFAULT).
* @param sidPtr - the restricting SID whose full-access ACE joins the default DACL.
*/
function setTokenDefaultDaclGrant(api, token, sidPtr) {
	const neededSlot = allocUint32();
	api.getTokenInformation(token, 6, null, 0, neededSlot);
	const needed = decodeUint32(neededSlot);
	if (needed === 0) throwLastError$1(api, "GetTokenInformation", "TokenDefaultDacl size query");
	const buffer = Buffer.alloc(needed);
	if (api.getTokenInformation(token, 6, buffer, buffer.length, neededSlot) === 0) throwLastError$1(api, "GetTokenInformation", "TokenDefaultDacl");
	const currentDacl = decodePtrAt(buffer, 0);
	if (currentDacl === null) throw new Error("setTokenDefaultDaclGrant: the token carries no default DACL to extend");
	const newDaclSlot = allocPtrSlot();
	const result = api.setEntriesInAclW(1, buildExplicitAccess(sidPtr, 1, FILE_ALL_ACCESS), currentDacl, newDaclSlot);
	if (result !== 0) throwWin32(api, "SetEntriesInAclW", result, "default DACL merge");
	const newDacl = decodePtr(newDaclSlot);
	if (newDacl === null) throwWin32(api, "SetEntriesInAclW", result, "null merged default DACL");
	const info = Buffer.alloc(8);
	info.writeBigUInt64LE(newDacl, 0);
	if (api.setTokenInformation(token, 6, info, info.length) === 0) {
		const win32Code = api.getLastError();
		api.localFree(newDacl);
		throwWin32(api, "SetTokenInformation", win32Code, "TokenDefaultDacl");
	}
	api.localFree(newDacl);
}
/**
* Lower the restricted token's integrity level to Low (S-1-16-4096), the level
* the mandatory labels `grantWrite` applies are matched against; a token left
* at Medium would ignore them. Requires TOKEN_ADJUST_DEFAULT on the token;
* fails closed before any child is spawned.
* @param api - the binding table.
* @param token - the restricted token to lower.
* @param lowLabelSidPtr - the Low integrity SID (S-1-16-4096).
*/
function restrictTokenIntegrity(api, token, lowLabelSidPtr) {
	const sidLength = api.getLengthSid(lowLabelSidPtr);
	if (sidLength === 0) throwLastError$1(api, "GetLengthSid", "Low integrity label SID");
	const info = Buffer.alloc(16 + sidLength);
	info.writeBigUInt64LE(ptrAddress(lowLabelSidPtr), 0);
	info.writeUInt32LE(32, 8);
	if (api.setTokenInformation(token, 25, info, info.length) === 0) throwLastError$1(api, "SetTokenInformation", "TokenIntegrityLevel (Low)");
}
/** Pack `SID_AND_ATTRIBUTES[count]` (16-byte stride; Attributes stay 0). */
function buildRestrictingSids(sids) {
	const buffer = Buffer.alloc(16 * sids.length);
	sids.forEach((sid, index) => {
		buffer.writeBigUInt64LE(ptrAddress(sid), 16 * index);
	});
	return buffer;
}
/**
* Create the write-restricted token with the mode-selected restricting list
* (verified on Win11 26200, see the POC-worktree restrict-variant harness):
*  - read-only:       [logon SID, EVERYONE]
*  - workspace-write: [logon SID, EVERYONE, workspace SID, optional temp SID]
*
* The logon SID + EVERYONE keep-alive group is shared by both modes: early
* DLL init dies with 0xC0000142 and CNG (`\Device\CNG` write trustee —
* pwsh crashes 0xE0434352) fails without them. The write SIDs join ONLY
* workspace-write — read-only carries no write SID, so a standing grant ACE
* from an earlier workspace-write period (a `/permission` mode downgrade, or
* a crash-resumed session) stays INERT under read-only: the WRITE_RESTRICTED
* pass-2 check grants only what the restricting list carries, keeping that
* workspace grant inert under read-only while the unrevoked ACE keeps the
* re-upgrade free (the grant's exact-ACE skip — no re-propagation).
* Everyone's own ambient grants remain the documented partial boundary.
* Authenticated Users is absent from BOTH lists: the WMI
* namespace security check fails (0x80041003), so CIM is unavailable in
* every confined mode, and the C:\-root tree-creation escape (standing
* `AU:(AD)` + `AU:(OI)(CI)(IO)(M)` ACEs) is closed in both — documented in
* README. INTERACTIVE/LOCAL are absent from BOTH lists too — the host's
* Public tree grants write to INTERACTIVE, so removing it closes that
* escape. S-1-2-1 (console logon) is intentionally absent: the package
* README's "Console isolation is unavailable" entry records the verified
* failure modes. FAILS CLOSED: any failure throws — never
* spawn unrestricted.
* @param api - the binding table.
* @param currentToken - the process token to restrict.
* @param logonSid - the copied logon session SID.
* @param writeSids - the distinct write SIDs forming the workspace and
* optional temp allowlists (workspace-write only; empty under read-only).
* @param known - the well-known SIDs entering the restricting list.
* @param mode - selects the restricting list (workspace-write adds the capability SIDs).
* @returns the restricted token handle.
*/
function createRestrictedToken(api, currentToken, logonSid, writeSids, known, mode) {
	const restrictingSids = buildRestrictingSids(mode === "read-only" ? [logonSid, known.world] : writeSids.length === 0 ? (() => {
		throw new Error("createRestrictedToken: workspace-write restricting list requires at least one write SID");
	})() : [
		logonSid,
		known.world,
		...writeSids
	]);
	const tokenSlot = allocPtrSlot();
	if (api.createRestrictedToken(currentToken, 13, 0, null, 0, null, restrictingSids.length / 16, restrictingSids, tokenSlot) === 0) throwLastError$1(api, "CreateRestrictedToken", `restricting SIDs: ${restrictingSids.length / 16}`);
	const token = decodePtr(tokenSlot);
	if (token === null) throwWin32(api, "CreateRestrictedToken", api.getLastError(), "null token handle");
	return token;
}
//#endregion
//#region lib/types/grant.js
/**
* Server-side write-grant materialization. The sandbox seam holds one
* standing workspace grant per workspace and one revocable temp grant per
* live session/workspace pair. Workspace identities survive by deterministic
* derivation and their standing ACE; temp identities derive from random
* private paths and are deliberately new after a restart.
*
* Fail-closed: `add` throws on any grant failure and the caller disposes the
* instance (revoking every path granted so far); `dispose` revokes every
* revocable grant, leaves the standing workspace edits in place, and reports
* every cleanup failure.
* @module night-bot/process/windows-acl/grant
*/
/**
* One write SID's provider-lifetime grant materialization: the parsed SID
* pointer plus every directory whose DACL currently carries its ACE and whose
* label ACL carries the Low mandatory label. Workspace paths are added
* STANDING (their security descriptor edits are the cross-session reuse cache
* and outlive the grant — dispose() skips revoking them, or the next
* provision would re-propagate the whole tree); temp paths are revocable
* (dispose() revokes them — an inheritable ACE must not outlive its
* session's temp directory). Create with {@link AclWriteGrant.create};
* dispose revokes the revocable paths and frees every SID.
*/
var AclWriteGrant = class AclWriteGrant {
	/** The write SID in SDDL string form. */
	writeSid;
	api;
	sidPtr;
	lowLabelSidPtr;
	worldSidPtr;
	revocablePaths = [];
	standingPaths = [];
	constructor(api, sidPtr, lowLabelSidPtr, worldSidPtr, writeSid) {
		this.api = api;
		this.sidPtr = sidPtr;
		this.lowLabelSidPtr = lowLabelSidPtr;
		this.worldSidPtr = worldSidPtr;
		this.writeSid = writeSid;
	}
	/**
	* Parse the SID string, create the Low integrity SID the grants label with
	* and the world SID their ambient-delete deny names, and open the binding
	* table (lazily, once per server). Fail-closed: any failure throws — nothing
	* is granted yet.
	* @param writeSid - the workspace (`S-1-4-x-y`) or temp (`S-1-4-x-y-1`) capability SID string.
	* @param api - optional already-resolved bindings (tests).
	* @returns the ready grant (no ACEs yet).
	*/
	static create(writeSid, api) {
		const bindings = api ?? win32Sync();
		const sidSlot = allocPtrSlot();
		if (bindings.convertStringSidToSidW(writeSid, sidSlot) === 0) throwLastError$1(bindings, "ConvertStringSidToSidW", writeSid);
		const sidPtr = decodePtr(sidSlot);
		if (sidPtr === null) throwLastError$1(bindings, "ConvertStringSidToSidW", `null SID for ${writeSid}`);
		try {
			const lowLabelSidPtr = makeWellKnownSid(bindings, 66);
			try {
				return new AclWriteGrant(bindings, sidPtr, lowLabelSidPtr, makeWellKnownSid(bindings, 1), writeSid);
			} catch (error) {
				bindings.localFree(lowLabelSidPtr);
				throw error;
			}
		} catch (error) {
			bindings.localFree(sidPtr);
			throw error;
		}
	}
	/**
	* Grant the write ACE, the ambient-delete deny, and the Low mandatory label
	* on one directory (idempotent: an already-standing exact ACE, deny, and
	* label skip the eager full-tree re-propagation — see {@link grantWrite})
	* and record the path for {@link dispose} unless it is standing. The path is
	* recorded BEFORE the grant: a post-apply throw (a LocalFree failure after
	* SetNamedSecurityInfoW succeeded) must still revoke it, and revoking an
	* ungranted path is a no-op merge. Callers treat a throw as a failed
	* materialization and dispose the instance to revoke the paths granted so
	* far.
	* @param path - the directory whose DACL and label gain the grant.
	* @param standing - the edits outlive this grant (the workspace reuse
	*   cache; dispose() skips revoking it). Default false (revoked on
	*   dispose — the temp-directory lifecycle).
	*/
	add(path, standing = false) {
		(standing ? this.standingPaths : this.revocablePaths).push(path);
		grantWrite(this.api, path, this.sidPtr, this.lowLabelSidPtr, this.worldSidPtr);
	}
	/** Every directory currently carrying the grant, in grant order. */
	get paths() {
		return [...this.standingPaths, ...this.revocablePaths];
	}
	/** Revoke every revocable grant (standing security descriptor edits stay) and free the SIDs; reports every cleanup failure. */
	dispose() {
		const failures = [];
		for (const path of this.revocablePaths) try {
			revokeWrite(this.api, path, this.sidPtr);
		} catch (error) {
			failures.push(error);
		}
		for (const [label, sidPtr] of [
			["write SID", this.sidPtr],
			["Low label SID", this.lowLabelSidPtr],
			["world SID", this.worldSidPtr]
		]) try {
			if (!isNullPtr$1(this.api.localFree(sidPtr))) throwLastError$1(this.api, "LocalFree", label);
		} catch (error) {
			failures.push(error);
		}
		if (failures.length > 0) throw new AggregateError(failures, `AclWriteGrant dispose completed with ${failures.length} cleanup failure(s)`);
	}
};
//#endregion
//#region lib/types/workspace-sid.js
/**
* The per-workspace write identity: a deterministic `S-1-4-x-y` SID derived
* from the canonical workspace path, whose ACEs form that workspace's write
* allowlist. Every confined execution of the same workspace — across
* sessions, server restarts, and calls — carries the SAME write SID, so the
* workspace-root ACE materializes once per workspace per machine (the
* grant's exact-ACE skip then makes every later provision O(1)) instead of
* once per session. The SID's power is defined solely by the ACEs that name
* it (which exist only on the workspace tree and the session's private temp
* directory), and only tokens minted for that workspace carry it — the SID
* string itself is not a secret. Temporary directories use a separate,
* per-directory identity from {@link tempWriteSid}; sharing the workspace
* identity with temp would let sibling sessions write one another's temp
* trees.
*
* The input MUST be the canonical workspace path (`realpathSync.native` on
* Windows — the sandbox-policy `resolveWorkspaceRoot` already applies it):
* canonicalization converges case/alias spellings, so two spellings of one
* workspace derive one SID; an as-spelled fallback path would mint a second
* identity for the same directory (self-healing, at the cost of one extra
* tree propagation). Renaming the workspace directory derives a new SID —
* the old standing ACEs are inert residue, and the next session re-propagates
* once.
* @module night-bot/process/windows-acl/workspace-sid
*/
/**
* Derive the workspace's write SID (`S-1-4-x-y`; subauthorities 30-bit,
* matching the workspace-capability shape the token and ACE layers carry).
* @param workspaceRoot - the canonical workspace path.
* @returns the SDDL string form.
*/
function workspaceWriteSid(workspaceRoot) {
	const digest = createHash("sha256").update(workspaceRoot, "utf8").digest();
	return `S-1-4-${digest.readUInt32LE(0) % (2 ** 30 - 1) + 1}-${digest.readUInt32LE(4) % (2 ** 30 - 1) + 1}`;
}
/**
* Derive one private temp directory's write SID. The random directory path
* is the capability identity; a fixed third subauthority domain-separates
* the result from every two-subauthority workspace SID.
* @param tempDir - the private temp directory's absolute path.
* @returns the SDDL string form.
*/
function tempWriteSid(tempDir) {
	const digest = createHash("sha256").update("temp\0", "utf8").update(tempDir, "utf8").digest();
	return `S-1-4-${digest.readUInt32LE(0) % (2 ** 30 - 1) + 1}-${digest.readUInt32LE(4) % (2 ** 30 - 1) + 1}-1`;
}
//#endregion
//#region lib/types/index.js
/**
* Windows ACL write-restriction sandbox backend for the DeepSeek Harness
* sandbox seam. Mirrors the mechanism of github.com/huoyaoyuan/
* windows-acl-restrict-poc @ 10e4dfb (the fixed revision): a WRITE_RESTRICTED
* token whose restricting SIDs include distinct workspace and temp write
* SIDs that this sandbox adds to their owning directories' DACLs — the
* intersection check then allows writes exactly where either capability has
* a Write ACE, and nowhere else those SIDs are concerned (the check ALSO
* inherits the ambient write ACEs of the other restricting SIDs — the
* keep-alive group logon SID + Everyone; Authenticated Users, INTERACTIVE,
* and LOCAL are absent from both lists — see the seam's dual-list contract
* in `packages/sandbox/sandbox-local` and the package README's Modes section
* for the complete boundary). The intersection covers only the object's own
* access check, so the token is also lowered to Low integrity and every
* granted directory carries a Low no-write-up label and the ambient-delete
* deny the `acl` module documents. The write SID is the per-WORKSPACE identity
* ({@link workspaceWriteSid}): deterministic from the canonical workspace
* path, so the workspace-root ACE materializes once per workspace per
* machine and every later provision hits the exact-ACE skip — the
* grant-reuse story the per-session random SID paid a full tree propagation
* per session for. Each private temp directory instead receives its own SID,
* so sibling sessions sharing a workspace cannot enter one another's temp
* trees. Unlike the POC, every API failure throws with the API
* name and exact Win32 code; a child is NEVER spawned unrestricted.
*
* Known boundaries (inherent to restricted tokens, not this port):
*  - writes are restricted; reads, network, and process visibility are NOT
*    (WRITE_RESTRICTED intersects only write accesses);
*  - console isolation is unavailable — children share the host console
*    (CREATE_NO_WINDOW / CREATE_NEW_CONSOLE children die with
*    STATUS_DLL_INIT_FAILED under the restriction);
*  - the private temp directory and every writable directory must be owned by the
*    caller (owner-implicit WRITE_DAC);
*  - grants are standing ACE mutations on real directories. WORKSPACE grants
*    are deliberately never revoked — the ACE is the cross-session reuse
*    cache (revoking would force the next session to re-propagate the whole
*    tree). TEMP grants are revocable: dispose() removes them so a standing
*    inheritable ACE never outlives its session's temp directory. The
*    ambient temp root is never granted implicitly. With `manageDacls: false`
*    the CALLER owns the DACLs (the sandbox seam's grant reuse):
*    init()/dispose() skip grant/revoke entirely and the caller must not
*    revoke under live children.
* @module night-bot/process/windows-acl
*/
/** Free one optional SID while retaining a failure for best-effort sibling cleanup. */
function freeSidBestEffort(api, sidPtr, label, failures) {
	if (sidPtr === void 0) return;
	try {
		if (!isNullPtr$1(api.localFree(sidPtr))) throwLastError$1(api, "LocalFree", label);
	} catch (error) {
		failures.push(error);
	}
}
/**
* One write-restricted sandbox instance: token + write-SID grants + spawn.
* `init()` is fail-closed — any Win32 failure revokes the revocable (temp)
* grants and throws; `dispose()` revokes the temp grants, leaves the
* standing workspace ACEs in place (the cross-instance reuse cache), frees
* every allocation, and reports every cleanup failure. With
* `manageDacls: false` the caller owns the grants (the sandbox seam's grant
* reuse): init() applies none and dispose() revokes none.
*/
var AclSandbox = class {
	/** Absolute writable directories (constructor-validated). */
	writableDirs;
	/** The workspace SID string whose ACEs form the workspace allowlist. */
	writeSid;
	/** The private temp directory's write SID (workspace-write with temp only). */
	tempWriteSid;
	/** The file-effect mode — the restricted token's restricting-SID list selection. */
	mode;
	tempDirOption;
	manageDacls;
	tempDirResolved;
	api;
	token;
	writeSidPtr;
	tempWriteSidPtr;
	/** The well-known/logon SID allocations init() makes; freed by dispose() alongside the write SIDs. */
	sidAllocations = [];
	grantedPaths = [];
	constructor(options) {
		this.mode = options.mode;
		this.manageDacls = options.manageDacls ?? true;
		this.writableDirs = options.writableDirs.map((directory) => {
			const absolute = resolve(directory);
			if (!existsSync(absolute) || !statSync(absolute).isDirectory()) throw new Error(`AclSandbox writable dir does not exist or is not a directory: ${absolute}`);
			return absolute;
		});
		this.tempDirOption = options.tempDir;
		this.writeSid = options.writeSid;
		this.tempWriteSid = options.tempWriteSid;
		if (this.mode === "workspace-write" && this.writeSid === void 0) throw new Error("AclSandbox workspace-write requires a write SID — derive it from the workspace via workspaceWriteSid()");
		if (this.mode === "workspace-write" && this.tempDirOption === void 0) throw new Error("AclSandbox workspace-write requires an explicit private temp directory or null");
		if (this.mode === "read-only" && this.tempDirOption !== void 0 && this.tempDirOption !== null) throw new Error("AclSandbox read-only does not accept a temp directory");
		if (this.mode === "read-only" && (this.writeSid !== void 0 || this.tempWriteSid !== void 0)) throw new Error("AclSandbox read-only does not accept write SIDs");
		if (this.mode === "workspace-write" && this.tempDirOption !== null && this.tempWriteSid === void 0) throw new Error("AclSandbox workspace-write with temp requires a temp write SID — derive it via tempWriteSid()");
		if (this.tempDirOption === null && this.tempWriteSid !== void 0) throw new Error("AclSandbox temp write SID requires a temp directory");
		if (this.writeSid !== void 0 && this.tempWriteSid === this.writeSid) throw new Error("AclSandbox workspace and temp write SIDs must be distinct");
	}
	/** Resolved temp directory (available after init; null when temp grants are disabled). */
	get tempDir() {
		return this.tempDirResolved;
	}
	/** Create the restricted token and apply the capability-SID grants. Idempotent-unsafe: once per instance. */
	async init() {
		if (this.api !== void 0) throw new Error("AclSandbox is already initialized");
		const api = await win32();
		const currentToken = openCurrentProcessToken(api);
		let currentTokenOpen = true;
		let restrictedToken;
		try {
			const parseSid = (sid) => {
				const sidSlot = allocPtrSlot();
				if (api.convertStringSidToSidW(sid, sidSlot) === 0) throwLastError$1(api, "ConvertStringSidToSidW", sid);
				const parsedSid = decodePtr(sidSlot);
				if (parsedSid === null) throw new Win32Error("ConvertStringSidToSidW", api.getLastError(), sid);
				return parsedSid;
			};
			this.writeSidPtr = this.writeSid === void 0 ? void 0 : parseSid(this.writeSid);
			this.tempWriteSidPtr = this.tempWriteSid === void 0 ? void 0 : parseSid(this.tempWriteSid);
			const tempDir = this.mode === "read-only" || this.tempDirOption === null ? null : this.tempDirOption;
			/* v8 ignore next -- constructor validation requires workspace-write to supply
			an explicit temp directory or null; the other branches normalize to null. */
			if (tempDir === void 0) throw new Error("AclSandbox workspace-write temp directory was not resolved");
			if (tempDir !== null) {
				if (!existsSync(tempDir) || !statSync(tempDir).isDirectory()) throw new Error(`AclSandbox temp dir does not exist or is not a directory: ${tempDir}`);
				assertPrivateTempDisjoint(this.writableDirs, tempDir);
			}
			this.tempDirResolved = tempDir;
			const lowLabelSid = makeWellKnownSid(api, 66);
			const worldSid = makeWellKnownSid(api, 1);
			this.sidAllocations.push(lowLabelSid, worldSid);
			if (this.manageDacls) {
				if (this.writeSidPtr !== void 0) {
					for (const path of this.writableDirs) grantWrite(api, path, this.writeSidPtr, lowLabelSid, worldSid);
					if (tempDir !== null && this.tempWriteSidPtr !== void 0) {
						this.grantedPaths.push({
							path: tempDir,
							sidPtr: this.tempWriteSidPtr
						});
						grantWrite(api, tempDir, this.tempWriteSidPtr, lowLabelSid, worldSid);
					}
				}
			}
			const logonSid = findLogonSid(api, currentToken);
			this.sidAllocations.push(logonSid);
			restrictedToken = createRestrictedToken(api, currentToken, logonSid, [this.writeSidPtr, this.tempWriteSidPtr].filter((sid) => sid !== void 0), { world: worldSid }, this.mode);
			restrictTokenIntegrity(api, restrictedToken, lowLabelSid);
			this.token = restrictedToken;
			setTokenDefaultDaclGrant(api, restrictedToken, this.tempWriteSidPtr ?? this.writeSidPtr ?? worldSid);
			if (api.closeHandle(currentToken) === 0) throwLastError$1(api, "CloseHandle", "current process token");
			currentTokenOpen = false;
			this.api = api;
		} catch (error) {
			const cleanupFailures = [];
			if (currentTokenOpen && api.closeHandle(currentToken) === 0) cleanupFailures.push(new Win32Error("CloseHandle", api.getLastError(), "current process token after init failure"));
			if (restrictedToken !== void 0 && api.closeHandle(restrictedToken) === 0) cleanupFailures.push(new Win32Error("CloseHandle", api.getLastError(), "restricted token after init failure"));
			for (const grant of this.grantedPaths) try {
				revokeWrite(api, grant.path, grant.sidPtr);
			} catch (cleanupError) {
				cleanupFailures.push(cleanupError);
			}
			for (const [label, sidPtr] of [["workspace write SID", this.writeSidPtr], ["temp write SID", this.tempWriteSidPtr]]) freeSidBestEffort(api, sidPtr, label, cleanupFailures);
			for (const sidPtr of this.sidAllocations.splice(0)) freeSidBestEffort(api, sidPtr, "init SID allocation", cleanupFailures);
			this.token = void 0;
			this.writeSidPtr = void 0;
			this.tempWriteSidPtr = void 0;
			this.tempDirResolved = void 0;
			this.grantedPaths = [];
			if (cleanupFailures.length > 0) throw new AggregateError([error, ...cleanupFailures], `AclSandbox init failed and ${cleanupFailures.length} cleanup operation(s) also failed`);
			throw error;
		}
	}
	/**
	* Spawn a process under the restricted token. Fails closed: throws on every
	* Win32 failure; the child is never created unrestricted. With
	* `stdio: 'inherit'` the child shares the caller's stdio directly and is
	* placed in a kill-on-close job (dies with the caller). Call dispose() only
	* after all children have exited — revoking grants under a live child
	* removes its remaining write allowance.
	* @param options - the program, argv/cwd, and stdio shape.
	* @returns the running child.
	*/
	spawn(options) {
		const api = this.api;
		const token = this.token;
		if (api === void 0 || token === void 0) throw new Error("AclSandbox is not initialized: call init() first");
		if (options.controlFileDescriptor !== void 0 && options.stdio !== "inherit") throw new Error("control pipe requires inherited stdio");
		const args = options.args ?? [];
		const cwd = options.cwd ?? process.cwd();
		if (options.stdio === "inherit") {
			const native = spawnSandboxedInherited(api, token, {
				command: options.command,
				args,
				cwd,
				...options.controlFileDescriptor === void 0 ? {} : { controlFileDescriptor: options.controlFileDescriptor }
			});
			let exitCodePromise;
			return {
				pid: native.pid,
				wait: async () => {
					exitCodePromise ??= Promise.resolve(waitForExit(api, native.process));
					const exitCode = await exitCodePromise;
					if (api.closeHandle(native.job) === 0) throwLastError$1(api, "CloseHandle", "kill-on-close job");
					return {
						stdout: Buffer.alloc(0),
						stderr: Buffer.alloc(0),
						exitCode
					};
				}
			};
		}
		const native = spawnSandboxed(api, token, {
			command: options.command,
			args,
			cwd
		});
		const stdout = drainPipe(api, native.stdoutRead);
		const stderr = drainPipe(api, native.stderrRead);
		let exitCodePromise;
		return {
			pid: native.pid,
			wait: async () => {
				const stdoutBuffer = await stdout;
				const stderrBuffer = await stderr;
				exitCodePromise ??= Promise.resolve(waitForExit(api, native.process));
				return {
					stdout: stdoutBuffer,
					stderr: stderrBuffer,
					exitCode: await exitCodePromise
				};
			}
		};
	}
	/**
	* Revoke the revocable (temp) grants, free the SID, close the token; the
	* standing workspace ACEs stay (the reuse cache). Reports every cleanup
	* failure.
	*/
	dispose() {
		const api = this.api;
		if (api === void 0) return;
		const failures = [];
		if (this.manageDacls) for (const grant of this.grantedPaths) try {
			revokeWrite(api, grant.path, grant.sidPtr);
		} catch (error) {
			failures.push(error);
		}
		for (const [label, sidPtr] of [["workspace write SID", this.writeSidPtr], ["temp write SID", this.tempWriteSidPtr]]) freeSidBestEffort(api, sidPtr, label, failures);
		const token = this.token;
		/* v8 ignore next -- init assigns this.api only after this.token, so an initialized instance always
		has its token; the guard mirrors the write-SID guard. */
		if (token !== void 0) try {
			if (api.closeHandle(token) === 0) throwLastError$1(api, "CloseHandle", "restricted token");
		} catch (error) {
			failures.push(error);
		}
		for (const sidPtr of this.sidAllocations.splice(0)) freeSidBestEffort(api, sidPtr, "init SID allocation", failures);
		this.api = void 0;
		this.token = void 0;
		this.writeSidPtr = void 0;
		this.tempWriteSidPtr = void 0;
		this.grantedPaths = [];
		if (failures.length > 0) throw new AggregateError(failures, `AclSandbox dispose completed with ${failures.length} cleanup failure(s)`);
	}
};
//#endregion
// 同安装的父子范围也须互斥；租约只覆盖 fresh-read/proof-commit/apply，不跨整个 Job。
class AclMutationLock {
 #api
 #path
 #handle=null
 #held=false
 #releaseAttempted=false
 #overlapped=Buffer.alloc(32)
 constructor(api,installRoot){
  if(typeof installRoot!=='string'||!isAbsolute(installRoot)||realpathSync.native(installRoot)!==installRoot)throw new Error('ACL mutation lock requires the physical installation root');
  this.#api=api;this.#path=join(installRoot,'data','temp','windows-acl-mutation.lock');
 }
 get ownership(){return{held:this.#held,retainedHandles:this.#handle===null?0:1,releaseAttempted:this.#releaseAttempted}}
 async acquire(signal){
  if(this.#handle!==null||this.#releaseAttempted)throw new Error('ACL mutation lock acquisition is not repeatable');
  signal.throwIfAborted();
  const parent=dirname(this.#path);mkdirSync(parent,{recursive:true});
  if(realpathSync.native(parent)!==parent)throw new Error('ACL mutation lock parent is redirected');
  const handle=this.#api.createFileW(this.#path,0xc0000000,3,null,4,0x00200000,null);
  if(isInvalidHandle(handle))throwLastError(this.#api,'CreateFileW','installation ACL mutation lock');
  this.#handle=handle;
  try{
   const tag=Buffer.alloc(8),standard=Buffer.alloc(24);
   for(const [kind,bytes]of [[9,tag],[1,standard]])if(this.#api.getFileInformationByHandleEx(handle,kind,bytes,bytes.length)===0)throwLastError(this.#api,'GetFileInformationByHandleEx','ACL mutation lock');
   if(tag.readUInt32LE()&0x410||tag.readUInt32LE(4)!==0||standard[20]!==0||standard[21]!==0||standard.readUInt32LE(16)!==1)throw new Error('ACL mutation lock is redirected, a directory, delete-pending or multilink');
   this.#verifyPath();
   for(;;){
    signal.throwIfAborted();
    if(this.#api.lockFileEx(handle,3,0,1,0,this.#overlapped)!==0){this.#held=true;return}
    const code=this.#api.getLastError();
    if(code!==33)throw new Win32Error('LockFileEx',code,'installation ACL mutation lock');
    await waitForAclLock(10,undefined,{signal});
   }
  }catch(error){
   try{this.release()}catch(cleanup){throw new AggregateError([error,cleanup],'ACL mutation lock acquisition retains ownership')}
   throw error;
  }
 }
 #verifyPath(){
  const bytes=Buffer.alloc(32768*2),length=this.#api.getFinalPathNameByHandleW(this.#handle,bytes,bytes.length/2,0);
  if(length===0)throwLastError(this.#api,'GetFinalPathNameByHandleW','installation ACL mutation lock');
  if(length>=bytes.length/2)throw new Error('ACL mutation lock native name is truncated');
  const native=bytes.subarray(0,length*2).toString('utf16le'),prefix=String.fromCharCode(92,92,63,92);
  const path=native.startsWith(prefix)?native.slice(prefix.length):native;
  if(path.toUpperCase()!==this.#path.toUpperCase())throw new Error('ACL mutation lock native path changed');
 }
 assertHeld(){if(!this.#held||this.#releaseAttempted||this.#handle===null)throw new Error('Installation ACL mutation lock is not held');this.#verifyPath()}
 release(){
  if(this.#releaseAttempted)throw new Error('ACL mutation lock release remains uncertain or was already consumed');
  this.#releaseAttempted=true;
  const errors=[];
  if(this.#held){
   try{if(this.#api.unlockFileEx(this.#handle,0,1,0,this.#overlapped)===0)throwLastError(this.#api,'UnlockFileEx','installation ACL mutation lock');this.#held=false}catch(error){errors.push(error)}
  }
  if(this.#handle!==null){
   try{closeHandleChecked(this.#api,this.#handle,'installation ACL mutation lock');this.#handle=null;this.#held=false}catch(error){errors.push(error)}
  }
  if(errors.length)throw new AggregateError(errors,'Installation ACL mutation lock release is unproven');
 }
}
function createAclMutationLock(api,installRoot){return new AclMutationLock(api,installRoot)}
const OWNER_RIGHTS_SID = Buffer.from('010100000000000304000000', 'hex');
function subtractOwnedPackageWrites(acl, packageSid, kind, mapMask) {
 const writeMask = kind === 1 ? 0xd0156 : kind === 4 ? 0xd0026 : undefined;
 if (writeMask === undefined) throw new Error('Unsupported owned security object kind');
 if (acl.length < 8 || ![2, 4].includes(acl[0]) || acl.readUInt16LE(2) !== acl.length) throw new Error('Invalid owned ACL header');
 const count = acl.readUInt16LE(4);
 const entries = [];
 const deltas = [];
 let at = 8;
 let ownerRightsPresent = false;
 for (let index = 0; index < count; index++) {
  if (at + 8 > acl.length) throw new Error('Owned ACE header outside ACL');
  const type = acl[at];
  const length = acl.readUInt16LE(at + 2);
  if (![0, 1].includes(type) || length < 16 || length % 4 || at + length > acl.length) throw new Error('Unsupported or invalid owned ACE');
  const ace = Buffer.from(acl.subarray(at, at + length));
  const sidLength = 8 + 4 * ace[9];
  if (ace[8] !== 1 || ace[9] > 15 || 8 + sidLength !== length) throw new Error('Invalid inline owned ACE SID');
  const sid = ace.subarray(8);
  if (sid.equals(OWNER_RIGHTS_SID) && ace[1] & 8) throw new Error('INHERIT_ONLY OWNER_RIGHTS requires native qualification; no candidate produced');
  ownerRightsPresent ||= sid.equals(OWNER_RIGHTS_SID);
  if (type === 0 && sid.equals(packageSid)) {
   const before = ace.readUInt32LE(4);
   const mapped = mapMask(before, kind);
   const after = (mapped & ~writeMask) >>> 0;
   ace.writeUInt32LE(after, 4);
   deltas.push({ index, before, mapped, after, flags: ace[1] });
  }
  entries.push(ace);
  at += length;
 }
 if (acl.subarray(at).some(byte => byte !== 0)) throw new Error('Unexpected nonzero owned ACL tail');
 if (!ownerRightsPresent) {
  const owner = Buffer.alloc(8 + OWNER_RIGHTS_SID.length);
  owner[0] = 0;
  owner.writeUInt16LE(owner.length, 2);
  owner.writeUInt32LE(0x20000, 4);
  OWNER_RIGHTS_SID.copy(owner, 8);
  entries.push(owner);
 }
 const header = Buffer.from(acl.subarray(0, 8));
 const length = 8 + entries.reduce((sum, entry) => sum + entry.length, 0);
 if (length > 0xffff || entries.length > 0xffff) throw new Error('Owned ACL exceeds native WORD size');
 header.writeUInt16LE(length, 2);
 header.writeUInt16LE(entries.length, 4);
 return { acl: Buffer.concat([header, ...entries]), deltas, ownerRightsAdded: !ownerRightsPresent };
}

function ownedSecurityDescriptor(bytes) {
 if (!Buffer.isBuffer(bytes) || bytes.length < 20 || bytes[0] !== 1 || !(bytes.readUInt16LE(2) & 0x8000)) throw new Error('Invalid owned self-relative security descriptor');
 const part = (field, acl) => {
  const offset = bytes.readUInt32LE(field);
  if (offset === 0) return null;
  if (offset < 20 || offset % 4 || offset + 8 > bytes.length) throw new Error('Owned security component outside descriptor');
  const length = acl ? bytes.readUInt16LE(offset + 2) : 8 + 4 * bytes[offset + 1];
  if (acl ? length < 8 : bytes[offset] !== 1 || bytes[offset + 1] > 15) throw new Error('Invalid owned security component');
  if (offset + length > bytes.length) throw new Error('Owned security component is truncated');
  return Buffer.from(bytes.subarray(offset, offset + length));
 };
 const result = { revision: bytes[0], reserved: bytes[1], control: bytes.readUInt16LE(2), owner: part(4, false), group: part(8, false), sacl: part(12, true), dacl: part(16, true) };
 if (!(result.control & 4) || !result.owner || !result.group || !result.dacl) throw new Error('Owned descriptor requires owner, group and a nonnull DACL');
 return result;
}
/** 两个真实创建者共用原 Profile SD 算法；资源仍由各调用者的一次性账目认领。 */
function withPrivateResourceSecurity({api,hostSid,groupSid,kind,ownAllocation,releaseAllocation},operation){
 if(!['temporary-root','pipe'].includes(kind)||![hostSid,groupSid].every(value=>typeof value==='string'&&/^S-1-(?:[0-9]+-)*[0-9]+$/.test(value)))throw new Error('Invalid private resource security identity');
 const directory=kind==='temporary-root',flags=directory?'OICI':'',control=directory?'PAI':'P';
 const sddl=`O:${hostSid}G:${groupSid}D:${control}(A;${flags};FA;;;${hostSid})(A;${flags};FA;;;SY)(A;${flags};0x0;;;OW)`+(directory?'S:AI(ML;OICI;NW;;;LW)':'');
 const slot=Buffer.alloc(8),length=Buffer.alloc(4);
 let pointer,result,failure,status,owned=false;
 try{
  try{status=api.convertStringSecurityDescriptorToSecurityDescriptorW(sddl,1,slot,length)}catch(error){failure=error}
  pointer=decodePtr(slot);
  if(!isNullPtr(pointer)){ownAllocation(pointer,'local');owned=true}
  if(failure)throw failure;
  if(status===0)throwLastError(api,'ConvertStringSecurityDescriptorToSecurityDescriptorW','private owned resource');
  if(isNullPtr(pointer))throw new Error('Private resource security descriptor is null');
  const size=api.getSecurityDescriptorLength(pointer);
  if(size<20||size!==length.readUInt32LE())throw new Error('Private resource security descriptor length is inconsistent');
  const expected=ownedSecurityDescriptor(Buffer.from(requireKoffi().decode(pointer,'uint8',size))),label=directory?scopedLabelFacts(expected.sacl):null;
  if(directory&&(expected.revision!==1||expected.reserved!==0||expected.control!==0x9c14||!label||label.level!==4096||label.mask!==1||label.flags!==3))throw new Error('Private temporary request must contain its exact native Low label');
  const attributes=Buffer.alloc(24);attributes.writeUInt32LE(24);attributes.writeBigUInt64LE(typeof pointer==='bigint'?pointer:BigInt(ptrAddress(pointer)),8);
  // 回调同步消费借用 SD；返回后立即释放，不能把 attributes 留到 await 之后。
  result=operation(attributes,expected);
 }catch(error){failure=error}
 if(owned)try{releaseAllocation(pointer)}catch(error){failure=failure?new AggregateError([failure,error],'Private resource creation and descriptor release failed'):error}
 if(failure)throw failure;
 return result;
}

/** 只判创建期完整 SD；本次独占创建、同 ID、空根与一次 Set 由真实创建层证明。 */
function privateResourceInitializationNeeded(created,expected){
 const actual=ownedSecurityDescriptor(created),label=scopedLabelFacts(expected.sacl);
 if(expected.revision!==1||expected.reserved!==0||!label||label.level!==4096||label.mask!==1||label.flags!==3||expected.control!==0x9c14||![expected.control,expected.control&~0x400].includes(actual.control)
   ||actual.revision!==expected.revision||actual.reserved!==expected.reserved||!actual.owner.equals(expected.owner)
   ||!actual.group.equals(expected.group)||!actual.dacl.equals(expected.dacl)||!actual.sacl?.equals(expected.sacl))throw new Error('Private directory creation has an unsupported initial security descriptor');
 return (actual.control&0x150c)!==(expected.control&0x150c);
}

/** 仅供未发布新任务的 work/tmp 使用；不接管已有对象，不清理失败后遗留目录。 */
function createPrivateTaskWorkDirectories({work,tmp}){
 if(process.platform!=='win32'||![work,tmp].every(path=>typeof path==='string'&&isAbsolute(path)&&resolve(path)===path)
   ||dirname(work)!==dirname(tmp)||windowsPath.basename(work)!=='work'||windowsPath.basename(tmp)!=='tmp')throw new Error('Invalid new task work directories');
 const api=loadWindowsAppContainerBindings(),handles=[],allocations=[],folders=new Map(),created=[],taskRoot=dirname(work);
 const fail=message=>Object.assign(new Error(message),{code:'TASK_WORKSPACE_NATIVE_UNVERIFIED'});
 const address=pointer=>typeof pointer==='bigint'?pointer:BigInt(ptrAddress(pointer));
 const ownHandle=handle=>{if(isInvalidHandle(handle))throw fail('Native directory operation returned an invalid handle');handles.push({handle,attempted:false,closed:false});return handle};
 const ownAllocation=(pointer,kind)=>{
  if(kind!=='local'||isNullPtr(pointer)||allocations.some(item=>!item.closed&&address(item.pointer)===address(pointer)))throw fail('Invalid or aliased native directory allocation');
  allocations.push({pointer,attempted:false,closed:false});return pointer;
 };
 const releaseAllocation=pointer=>{
  const item=allocations.find(item=>!item.closed&&address(item.pointer)===address(pointer));
  if(!item||item.attempted)throw fail('Native directory allocation release is not repeatable');
  item.attempted=true;
  if(!isNullPtr(api.localFree(pointer)))throw fail('Native directory allocation release remains unknown');
  item.closed=true;
 };
 const consumeAllocation=(pointer,operation)=>{
  let value,failure;
  try{value=operation()}catch(error){failure=error}
  if(!isNullPtr(pointer))try{releaseAllocation(pointer)}catch(error){failure=failure?new AggregateError([failure,error],'Native observation and allocation release failed'):error}
  if(failure)throw failure;return value;
 };
 const nativeResources=()=>({handles:{acquired:handles.length,closed:handles.filter(item=>item.closed).length,retained:handles.filter(item=>!item.closed).length},local:{acquired:allocations.length,closed:allocations.filter(item=>item.closed).length,retained:allocations.filter(item=>!item.closed).length}});
 const security=handle=>{
  const slots=Array.from({length:5},()=>Buffer.alloc(8));let status,failure;
  try{status=api.getSecurityInfo(handle,1,0x17,...slots)}catch(error){failure=error}
  const memory=decodePtr(slots[4]);if(!isNullPtr(memory))ownAllocation(memory,'local');
  return consumeAllocation(memory,()=>{
   if(failure)throw failure;
   if(status!==0)throw new Win32Error('GetSecurityInfo',status,'new task directory');
   if(isNullPtr(memory))throw fail('New task directory security descriptor is null');
   const length=api.getSecurityDescriptorLength(memory);if(length<20)throw fail('New task directory security descriptor is truncated');
   const bytes=Buffer.from(requireKoffi().decode(memory,'uint8',length));ownedSecurityDescriptor(bytes);return bytes;
  })
 };
 const tokenSid=(token,kind)=>{
  const size=Buffer.alloc(4),sized=api.getTokenInformation(token,kind,null,0,size),error=sized?0:api.getLastError(),capacity=size.readUInt32LE();
  if(sized||error!==122||capacity===0)throw fail('Invalid Host token SID sizing result');
  const bytes=Buffer.alloc(capacity);
  if(api.getTokenInformation(token,kind,bytes,capacity,size)===0)throwLastError(api,'GetTokenInformation','new task directory Host');
  const length=size.readUInt32LE();if(length<8||length>capacity)throw fail('Host token SID field is truncated');
  const sid=decodePtr(bytes),base=address(bytes),at=address(sid);
  if(at<base||at>base+BigInt(length-8))throw fail('Host token SID header is outside its allocation');
  const offset=Number(at-base),count=bytes[offset+1];
  if(bytes[offset]!==1||count>15||offset+8+4*count>length||api.isValidSid(sid)===0)throw fail('Host token SID body is outside its allocation');
  const slot=Buffer.alloc(8);let status,failure;
  try{status=api.convertSidToStringSidW(sid,slot)}catch(error){failure=error}
  const pointer=decodePtr(slot);if(!isNullPtr(pointer))ownAllocation(pointer,'local');
  return consumeAllocation(pointer,()=>{
   if(failure)throw failure;if(status===0)throwLastError(api,'ConvertSidToStringSidW','new task directory Host');
   if(isNullPtr(pointer))throw fail('Host SID string is null');
   const text=requireKoffi().decode.string16(pointer);if(typeof text!=='string'||!/^S-1-(?:[0-9]+-)*[0-9]+$/.test(text))throw fail('Invalid Host SID text');return text;
  })
 };
 const decoder=new TextDecoder('utf-16le',{fatal:true,ignoreBOM:true}),prefix=String.fromCharCode(92,92,63,92);
 const inspect=object=>{
  const id=Buffer.alloc(24),tag=Buffer.alloc(8),standard=Buffer.alloc(24),name=Buffer.alloc(32768*2);
  for(const [kind,bytes]of [[18,id],[9,tag],[1,standard]])if(api.getFileInformationByHandleEx(object.handle,kind,bytes,bytes.length)===0)throwLastError(api,'GetFileInformationByHandleEx','new task directory');
  if(tag.readUInt32LE()&0x400||tag.readUInt32LE(4)!==0||standard[20]!==0||standard[21]!==1||!(tag.readUInt32LE()&16))throw fail('New task directory chain is reparse, delete-pending or not a directory');
  const length=api.getFinalPathNameByHandleW(object.handle,name,name.length/2,0);
  if(!length)throwLastError(api,'GetFinalPathNameByHandleW','new task directory');if(length>=name.length/2)throw fail('New task directory native path is truncated');
  const native=decoder.decode(name.subarray(0,length*2)),plain=native.startsWith(prefix+'UNC'+String.fromCharCode(92))?String.fromCharCode(92,92)+native.slice(8):native.startsWith(prefix)?native.slice(4):native;
  if(resolve(plain).toUpperCase()!==object.path.toUpperCase())throw fail('New task directory native path changed');
  return {id,native,descriptor:security(object.handle)};
 };
 const folder=(path,write=false)=>{
  const handle=api.createFileW(path,0x20080|(write?0x40000:0),3,null,3,0x02200000,null);
  if(isInvalidHandle(handle))throwLastError(api,'CreateFileW','new task directory chain');ownHandle(handle);
  const object={path,handle};return Object.assign(object,inspect(object));
 };
 let result,failure;
 try{
  const thread=Buffer.alloc(8);let present,threadFailure;
  try{present=api.openThreadToken(api.getCurrentThread(),8,1,thread)}catch(error){threadFailure=error}
  const threadError=present?0:api.getLastError(),threadToken=decodePtr(thread);if(!isNullPtr(threadToken))ownHandle(threadToken);
  if(threadFailure)throw threadFailure;if(present||!isNullPtr(threadToken)||threadError!==1008)throw fail('Task directory creation requires the non-impersonated Host');
  const processHandle=api.openProcess(0x1000,0,process.pid);if(isInvalidHandle(processHandle))throwLastError(api,'OpenProcess','new task directory Host');ownHandle(processHandle);
  if(api.getProcessId(processHandle)!==process.pid)throw fail('New task directory Host process identity changed');
  const slot=Buffer.alloc(8);let opened,tokenFailure;
  try{opened=api.openProcessToken(processHandle,8,slot)}catch(error){tokenFailure=error}
  const token=decodePtr(slot);if(!isNullPtr(token))ownHandle(token);if(tokenFailure)throw tokenFailure;
  if(!opened)throwLastError(api,'OpenProcessToken','new task directory Host');if(isNullPtr(token))throw fail('New task directory Host token is null');
  const hostSid=tokenSid(token,1),groupSid=tokenSid(token,5),chain=[];
  for(let path=dirname(taskRoot);;path=dirname(path)){chain.unshift(path);if(dirname(path)===path)break}
  for(const path of chain){const object=folder(path),parent=folders.get(dirname(path));if(parent&&!object.id.subarray(0,8).equals(parent.id.subarray(0,8)))throw fail('New task directory parent chain crossed a volume');folders.set(path,object)}
  if(api.createDirectoryW(taskRoot,null)===0)throwLastError(api,'CreateDirectoryW','unpublished new task root');
  const rootObject=folder(taskRoot),rootParent=folders.get(dirname(taskRoot));
  if(!rootParent||!rootObject.id.subarray(0,8).equals(rootParent.id.subarray(0,8)))throw fail('New task root parent identity changed');
  folders.set(taskRoot,rootObject);
  for(const path of [work,tmp]){
   let expected,creationAttempted=false,createdHere=false;
   withPrivateResourceSecurity({api,hostSid,groupSid,kind:'temporary-root',ownAllocation,releaseAllocation},(attributes,requested)=>{
    expected=requested;creationAttempted=true;
    if(api.createDirectoryW(path,attributes)===0)throwLastError(api,'CreateDirectoryW','unpublished new task work directory');createdHere=true;
   });
   if(!creationAttempted||!createdHere)throw fail('New task work directory was not exclusively created');
   const object=folder(path,true),parent=folders.get(dirname(path));
   if(!parent||!object.id.subarray(0,8).equals(parent.id.subarray(0,8)))throw fail('New task work directory parent identity changed');
   const original=Buffer.from(object.descriptor),initializationNeeded=privateResourceInitializationNeeded(original,expected);
   if(readdirSync(path).length)throw fail('New task work directory was published before initialization');
   if(initializationNeeded){
    const before=inspect(object);if(!before.id.equals(object.id)||before.native!==object.native||!before.descriptor.equals(original))throw fail('New task work directory changed before initialization');
    const actual=ownedSecurityDescriptor(original),status=api.setSecurityInfo(object.handle,1,4,null,null,actual.dacl,null);
    if(status!==0)throw new Win32Error('SetSecurityInfo',status,'new task directory DACL initialization');
    const initialized=inspect(object),bytes=initialized.descriptor;
    if(!initialized.id.equals(object.id)||initialized.native!==object.native||ownedSecurityDescriptor(bytes).control!==(actual.control|0x400)||bytes.length!==original.length||!bytes.subarray(0,2).equals(original.subarray(0,2))||!bytes.subarray(4).equals(original.subarray(4)))throw fail('New task directory initialization changed more than its DACL inheritance state');
    object.descriptor=bytes;
   }
   if(readdirSync(path).length)throw fail('New task work directory was published during initialization');
   created.push({...object,original,initializationNeeded});
  }
  for(const object of [...folders.values(),...created]){const after=inspect(object);if(!after.id.equals(object.id)||after.native!==object.native||!after.descriptor.equals(object.descriptor))throw fail('New task directory forest changed before publication')}
  for(const object of created)if(readdirSync(object.path).length)throw fail('New task work directory is not empty before publication');
  result={rootFileId:rootObject.id.toString('hex'),directories:Object.fromEntries(created.map(object=>[windowsPath.basename(object.path),{fileId:object.id.toString('hex'),createdDescriptorSha256:createHash('sha256').update(object.original).digest('hex'),descriptorSha256:createHash('sha256').update(object.descriptor).digest('hex'),createdControl:ownedSecurityDescriptor(object.original).control,control:ownedSecurityDescriptor(object.descriptor).control,initializationNeeded:object.initializationNeeded}]))};
 }catch(error){failure=error}
 const cleanup=[];
 for(const item of allocations)if(!item.attempted)try{releaseAllocation(item.pointer)}catch(error){cleanup.push(error)}
 for(const item of [...handles].reverse())if(!item.attempted){item.attempted=true;try{closeHandleChecked(api,item.handle,'new task directory creation');item.closed=true}catch(error){cleanup.push(error)}}
 if(cleanup.length)failure=new AggregateError([...(failure?[failure]:[]),...cleanup],'New task directory creation retains native resources');
 if(failure){Object.defineProperty(failure,'nativeOwnership',{value:{handles:handles.filter(item=>!item.closed),allocations:allocations.filter(item=>!item.closed)}});failure.nativeResources=nativeResources();failure.code??='TASK_WORKSPACE_NATIVE_UNVERIFIED';throw failure}
 return {...result,nativeResources:nativeResources()};
}

function encodeOwnedSecurityDescriptor(value) {
 const header = Buffer.alloc(20), parts = [header];
 header[0] = value.revision; header[1] = value.reserved; header.writeUInt16LE(value.control, 2);
 let offset = header.length;
 for (const [field, part] of [[4, value.owner], [8, value.group], [12, value.sacl], [16, value.dacl]]) if (part !== null) {
  header.writeUInt32LE(offset, field); parts.push(part); offset += part.length;
 }
 return Buffer.concat(parts);
}
function ownedAceList(acl) {
 if (acl.length < 8 || ![2, 4].includes(acl[0]) || acl.readUInt16LE(2) !== acl.length) throw new Error('Invalid owned ACL');
 const entries = []; let at = 8;
 for (let n = 0; n < acl.readUInt16LE(4); n++) {
  if (at + 8 > acl.length) throw new Error('Owned ACE outside ACL');
  const size = acl.readUInt16LE(at + 2);
  if (size < 16 || size % 4 || at + size > acl.length || ![0, 1].includes(acl[at]) || acl[at + 8] !== 1 || acl[at + 9] > 15 || 16 + 4 * acl[at + 9] !== size) throw new Error('Unsupported owned ACE');
  entries.push(Buffer.from(acl.subarray(at, at + size))); at += size;
 }
 if (acl.subarray(at).some(byte => byte !== 0)) throw new Error('Nonzero owned ACL padding');
 return entries;
}
function sameOwnedSecurityDescriptor(actual, expected, ownerRightsAdded = false) {
 const a = ownedSecurityDescriptor(actual), b = ownedSecurityDescriptor(expected);
 if (a.revision !== b.revision || a.reserved !== b.reserved || a.control !== b.control || !a.owner.equals(b.owner) || !a.group.equals(b.group) || (a.sacl === null ? b.sacl !== null : b.sacl === null || !a.sacl.equals(b.sacl)) || a.dacl[0] !== b.dacl[0]) return false;
 const normalized = acl => {
  let added = 0;
  const entries = ownedAceList(acl).filter(ace => {
   const owner = ownerRightsAdded && ace[0] === 0 && ace[1] === 0 && ace.readUInt32LE(4) === 0x20000 && ace.subarray(8).equals(OWNER_RIGHTS_SID);
   if (owner) added++;
   return !owner;
  });
  if (ownerRightsAdded && added !== 1) throw new Error('Added OWNER_RIGHTS READ_CONTROL is not unique');
  return entries;
 };
 const left = normalized(a.dacl), right = normalized(b.dacl);
 return left.length === right.length && left.every((ace, index) => ace.equals(right[index]));
}
// SetSecurityInfo 会转换旧继承模型；新建对象的内存继承不能预测或还原该转换。
// 冻结阶段只接受受影响组件已稳定的基线，不修改实际控制位或放宽完整SD比较。
function assertFileSetterBaseline(descriptor,label=false){
 const control=ownedSecurityDescriptor(descriptor).control,automatic=label?0x800:0x400,requested=label?0x200:0x100;
 if((control&(automatic|requested))!==automatic)throw new Error(`Exact file ${label?'label':'DACL'} setter requires a settled auto-inherited baseline`);
}
function scopedAllowAce(sid,mask,flags){
 const ace=Buffer.alloc(8+sid.length);ace[1]=flags;ace.writeUInt16LE(ace.length,2);ace.writeUInt32LE(mask,4);sid.copy(ace,8);return ace;
}
function scopedAcl(acl,entries){
 const header=Buffer.from(acl.subarray(0,8)),size=8+entries.reduce((sum,ace)=>sum+ace.length,0);
 if(size>0xffff||entries.length>0xffff)throw new Error('Exact scope ACL exceeds native WORD size');
 header.writeUInt16LE(size,2);header.writeUInt16LE(entries.length,4);return Buffer.concat([header,...entries]);
}
function scopedHostSid(text){
 if(typeof text!=='string'||!/^S-1-(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*)){0,15}$/.test(text))throw new Error('Invalid exact scope Host SID');
 const parts=text.split('-').slice(2).map(BigInt),authority=parts[0];
 if(authority>0xffffffffffffn||parts.slice(1).some(value=>value>0xffffffffn))throw new Error('Invalid exact scope Host SID');
 const sid=Buffer.alloc(8+4*(parts.length-1));sid[0]=1;sid[1]=parts.length-1;
 let remaining=authority;
 for(let at=7;at>=2;at--){sid[at]=Number(remaining&255n);remaining>>=8n;}
 parts.slice(1).forEach((value,index)=>sid.writeUInt32LE(Number(value),8+4*index));
 if(sid.equals(OWNER_RIGHTS_SID))throw new Error('Invalid exact scope Host SID');
 return sid;
}
function scopedHostMaintenanceAce(ace,hostSid,directory,inherited=false){
 return ace[0]===0&&ace[1]===((directory?3:0)|(inherited?16:0))&&ace.readUInt32LE(4)===0x60000&&ace.subarray(8).equals(hostSid);
}
// 只核已归属模板的继承增减；其它Host ACE与原生同字节副本不能一并忽略。
function assertScopedHostInheritance(parentBefore,parentAfter,childBefore,childAfter,hostSid,directory){
 const copies=(descriptor,container,inherited)=>ownedAceList(ownedSecurityDescriptor(descriptor).dacl).filter(ace=>scopedHostMaintenanceAce(ace,hostSid,container,inherited)).length;
 const inheritedChange=copies(parentAfter,true,false)+copies(parentAfter,true,true)-copies(parentBefore,true,false)-copies(parentBefore,true,true);
 const inheritedMismatch=copies(childAfter,directory,true)!==copies(childBefore,directory,true)+inheritedChange;
 if(inheritedMismatch||copies(childAfter,directory,false)!==copies(childBefore,directory,false)){
  const count=(descriptor,container)=>({explicit:copies(descriptor,container,false),inherited:copies(descriptor,container,true)});
  const counts={parentBefore:count(parentBefore,true),parentAfter:count(parentAfter,true),childBefore:count(childBefore,directory),childAfter:count(childAfter,directory)};
  const explicitMismatch=counts.childAfter.explicit!==counts.childBefore.explicit;
  // 失败上下文仅复制当前内存，不额外查询对象或Native状态。
  throw new Error('Native scope inheritance changed Host maintenance ownership',{cause:{
   kind:'scope-host-inheritance',directory,branch:inheritedMismatch?(explicitMismatch?'both':'inherited'):'explicit',inheritedChange,counts,
   descriptors:{parentBefore:parentBefore.toString('hex'),parentAfter:parentAfter.toString('hex'),childBefore:childBefore.toString('hex'),childAfter:childAfter.toString('hex')}
  }});
 }
}
/** 差量保留原ACE；OW约束owner隐式权，可信Host的独立ACE保持维护权。 */
function addScopedFileAccess(descriptor,packageSid,access,directory,hostSidText){
 if(!Buffer.isBuffer(packageSid)||packageSid.length!==40||packageSid[0]!==1||packageSid[1]!==8||!packageSid.subarray(2,8).equals(Buffer.from([0,0,0,0,0,15]))||packageSid.readUInt32LE(8)!==2||!['read','write'].includes(access)||typeof directory!=='boolean')throw new Error('Invalid exact scope file grant');
 const hostSid=scopedHostSid(hostSidText);if(hostSid.equals(packageSid))throw new Error('Invalid exact scope Host SID');
 const security=ownedSecurityDescriptor(descriptor),entries=ownedAceList(security.dacl),flags=directory?3:0;
 const addedAces=[scopedAllowAce(packageSid,access==='write'?0x1301bf:0x1200a9,flags),scopedAllowAce(OWNER_RIGHTS_SID,0x20000,flags),scopedAllowAce(hostSid,0x60000,flags)];
 const inherited=entries.findIndex(ace=>ace[1]&16),at=inherited<0?entries.length:inherited;
 entries.splice(at,0,...addedAces);
 return {candidate:encodeOwnedSecurityDescriptor({...security,dacl:scopedAcl(security.dacl,entries)}),addedAces:addedAces.map(ace=>Buffer.from(ace))};
}
/** 调用方须在安装锁内用已提交同FileID证明计算每种ACE的最低在用份数。 */
function subtractScopedFileAccess(descriptor,deltas){
 const security=ownedSecurityDescriptor(descriptor),entries=ownedAceList(security.dacl);
 if(!Array.isArray(deltas)||!deltas.length)throw new Error('Exact scope cleanup requires attributed ACE deltas');
 const expected=new Map();
 for(const {ace,copies,minimumCopies}of deltas){
  if(!Buffer.isBuffer(ace)||ace.length<16||ace[0]!==0||ace.readUInt16LE(2)!==ace.length||!Number.isSafeInteger(copies)||copies<1||!Number.isSafeInteger(minimumCopies)||minimumCopies<copies)throw new Error('Invalid exact scope ACE ownership count');
  const key=ace.toString('hex');if(expected.has(key))throw new Error('Duplicate exact scope cleanup delta');
  expected.set(key,{ace,copies,minimumCopies});
 }
 for(const {ace,minimumCopies}of expected.values()){
  if(entries.filter(entry=>entry.equals(ace)).length<minimumCopies)throw new Error('Exact scope ACE ownership is incomplete');
 }
 // 直接grant追加在首个继承ACE前；从右扣本次副本，保原生同字节ACE的相对顺序。
 for(const {ace,copies}of expected.values())for(let count=0;count<copies;count++){
  const inherited=entries.findIndex(entry=>entry[1]&16);
  const at=entries.findLastIndex((entry,index)=>entry.equals(ace)&&((ace[1]&16)||inherited<0||index<inherited));
  if(at<0)throw new Error('Exact scope cleanup delta is outside its grant insertion boundary');
  entries.splice(at,1);
 }
 return encodeOwnedSecurityDescriptor({...security,dacl:scopedAcl(security.dacl,entries)});
}
function scopedLabelFacts(acl){
 if(acl===null)return null;
 if(!Buffer.isBuffer(acl)||acl.length<8||![2,4].includes(acl[0])||acl.readUInt16LE(2)!==acl.length)throw new Error('Invalid exact scope mandatory label ACL');
 const count=acl.readUInt16LE(4);
 if(count===0){if(acl.subarray(8).some(byte=>byte!==0))throw new Error('Nonzero exact scope label padding');return null;}
 if(count!==1||acl.length!==28||acl[8]!==17||acl.readUInt16LE(10)!==20||acl[16]!==1||acl[17]!==1||!acl.subarray(18,24).equals(Buffer.from([0,0,0,0,0,16]))||acl[9]&~0x17||acl.readUInt32LE(12)&~7)throw new Error('Unsupported exact scope mandatory label');
 return {level:acl.readUInt32LE(24),mask:acl.readUInt32LE(12),flags:acl[9]};
}
function withScopedFileLabel(descriptor,labelAcl){
 const security=ownedSecurityDescriptor(descriptor);scopedLabelFacts(labelAcl);
 return encodeOwnedSecurityDescriptor({...security,sacl:labelAcl,control:labelAcl===null?security.control&~0x30:security.control|0x10});
}
function scopedLowLabel(acl,directory){
 const facts=scopedLabelFacts(acl),bytes=Buffer.alloc(28);
 bytes[0]=acl?.[0]??2;bytes.writeUInt16LE(28,2);bytes.writeUInt16LE(1,4);
 bytes[8]=17;bytes[9]=directory?3:0;bytes.writeUInt16LE(20,10);bytes.writeUInt32LE(facts?.mask??1,12);
 Buffer.from('010100000000001000100000','hex').copy(bytes,16);return bytes;
}
/** 来源只沿原Job已提交entry闭包追踪；不把当前Low或一个计数当作原生Low证明。 */
function scopedLabelHistory(entries){
 const anchor=value=>JSON.stringify([value.owner,value.jobId,value.entryId]),proofs=new Map();
 for(const entry of entries){
  if(['owner','jobId','entryId'].some(key=>typeof entry[key]!=='string'||!entry[key]||entry[key].includes(String.fromCharCode(0))))throw new Error('Unbound scope label proof identity');
  const resource=parseWindowsResourceOwnership(entry.resource),proof=parseWindowsResourceProof(entry.privateProof),key=anchor(entry);
  if(proofs.has(key)||['profileName','profileSid','scopeCount'].some(field=>resource[field]!==proof[field]))throw new Error('Scope label proof binding differs');
  const labels=new Map();
  for(const object of proof.objects)if(object.label!==null){
   if(proof.phase!=='scope-frozen')continue;
   if(object.kind!==1||object.role!=='scope'||labels.has(object.fileId))throw new Error('Ambiguous scope label proof object');
   const before=ownedSecurityDescriptor(Buffer.from(object.original,'hex')).sacl,after=ownedSecurityDescriptor(Buffer.from(object.candidate,'hex')).sacl;
   if((before?.toString('hex')??null)!==object.label.before||after===null||after.toString('hex')!==object.label.after)throw new Error('Scope label proof differs from its frozen descriptors');
   scopedLabelFacts(before);const facts=scopedLabelFacts(after);
   if(facts===null||facts.level>4096)throw new Error('Scope label proof does not protect Low access');
   labels.set(object.fileId,object.label);
  }
  proofs.set(key,{...entry,resource,proof,labels});
 }
 const visiting=new Set(),origins=new Map();
 const origin=(entry,fileId)=>{
  const key=anchor(entry),cache=JSON.stringify([key,fileId]);
  if(origins.has(cache))return origins.get(cache);
  if(visiting.has(cache))throw new Error('Cyclic scope label origin');
  const label=entry.labels.get(fileId);if(!label)throw new Error('Missing committed scope label origin');
  visiting.add(cache);let result;
  if(label.borrowedFrom!==null){
   const ref=label.borrowedFrom,source=proofs.get(anchor(ref));
   if(ref.fileId!==fileId||!source||label.before!==label.after||source.labels.get(fileId)?.after!==label.before)throw new Error('Borrowed scope label does not bind its source');
   result=origin(source,fileId);
  }else result={key:label.before===label.after?'native:'+label.before:cache,before:label.before};
  visiting.delete(cache);origins.set(cache,result);return result;
 };
 return {proofs,origin};
}
function planScopedFileLabels(objects,entries,profileName){
 const {proofs,origin}=scopedLabelHistory(entries);
 return objects.map(object=>{
  const before=ownedSecurityDescriptor(object.descriptor).sacl,facts=scopedLabelFacts(before);
  // read授权包含execute；NRU/NXU下也须保留已借用的Low来源，不能影响其他Job。
  if(object.access!=='write'&&!(facts!==null&&facts.level<=4096&&(facts.mask&6)))return {...object,label:null,labelAcl:before,candidate:Buffer.from(object.descriptor)};
  const fileId=object.id.toString('hex'),current=before?.toString('hex')??null;
  const claims=[...proofs.values()].filter(entry=>entry.labels.has(fileId));
  if(claims.some(entry=>entry.proof.profileName===profileName))throw new Error('Scope label preparation cannot be replayed');
  const active=claims.filter(entry=>entry.resource.status!=='released'&&!entry.resource.scopeReleased);
  if(active.some(entry=>entry.labels.get(fileId).after!==current))throw new Error('Active scope label differs from the observed FileID label');
  let borrowedFrom=null,labelAcl;
  if(active.length){
   const first=origin(active[0],fileId);
   if(active.some(entry=>origin(entry,fileId).key!==first.key))throw new Error('Conflicting committed scope label origins');
   borrowedFrom={owner:active[0].owner,jobId:active[0].jobId,entryId:active[0].entryId,fileId};labelAcl=Buffer.from(before);
  }else labelAcl=facts!==null&&facts.level<=4096?Buffer.from(before):scopedLowLabel(before,object.directory);
  const label={before:current,after:labelAcl.toString('hex'),borrowedFrom},labelChanged=label.before!==label.after;
  // 新FileID上的继承Low不能借另一个FileID的证明冒充原生Low。
  if(!claims.length&&facts!==null&&facts.level<=4096&&(facts.flags&16))for(const entry of proofs.values())if(entry.resource.status!=='released'&&!entry.resource.scopeReleased)for(const source of entry.proof.objects){
   if(!entry.labels.has(source.fileId)||!object.name.toUpperCase().startsWith(source.name.toUpperCase()+String.fromCharCode(92)))continue;
   if(origin(entry,source.fileId).key.startsWith('native:'))continue;
   throw new Error('Inherited Low label lacks an exact same-FileID origin');
  }
  return {...object,label,labelAcl,labelChanged,candidate:labelChanged?withScopedFileLabel(object.descriptor,labelAcl):Buffer.from(object.descriptor)};
 });
}
/** 最后借用者沿历史源恢复label；来源Job已released也不丢其原label锚点。 */
function planScopedFileLabelRelease(objects,entries,profileName,untouchedFileIds=new Set()){
 if(!(untouchedFileIds instanceof Set))throw new Error('Scope label release requires owned untouched FileIDs');
 const {proofs,origin}=scopedLabelHistory(entries);
 return objects.map(object=>{
  const fileId=object.id.toString('hex'),own=[...proofs.values()].filter(entry=>entry.proof.profileName===profileName&&entry.labels.has(fileId));
  if(own.length>1)throw new Error('Ambiguous scope label release ownership');
  const observed=ownedSecurityDescriptor(object.descriptor).sacl,current=observed?.toString('hex')??null,facts=scopedLabelFacts(observed);
  const live=[...proofs.values()].filter(entry=>entry.proof.profileName!==profileName&&entry.labels.has(fileId)&&entry.resource.status!=='released'&&!entry.resource.scopeReleased);
  const coveredByLiveScope=[...proofs.values()].some(entry=>entry.proof.profileName!==profileName&&entry.resource.status!=='released'&&!entry.resource.scopeReleased&&entry.proof.roots.some(root=>{
   if(root.access!=='write'&&!(root.access==='read'&&facts!==null&&facts.level<=4096&&(facts.mask&6)))return false;
   const rel=windowsPath.relative(root.path,object.name);return rel===''||rel!=='..'&&!rel.startsWith('..'+windowsPath.sep)&&!windowsPath.isAbsolute(rel);
  }));
  if(!own.length){
   if(live.some(entry=>entry.labels.get(fileId).after!==current))throw new Error('Live descendant label differs from its committed protection');
   const native=[...proofs.values()].some(entry=>entry.labels.has(fileId)&&entry.labels.get(fileId).after===current&&origin(entry,fileId).key.startsWith('native:'));
   return {...object,label:null,labelAcl:observed,labelChanged:false,allowInheritedLabelPropagation:!live.length&&!native&&!coveredByLiveScope&&facts!==null&&Boolean(facts.flags&16),candidate:Buffer.from(object.descriptor)};
  }
  const source=own[0],label=source.labels.get(fileId),before=origin(source,fileId);
  if(source.resource.status==='released'||source.resource.scopeReleased)throw new Error('Scope label release cannot be replayed');
  const untouched=untouchedFileIds.has(fileId)&&label.borrowedFrom===null&&current===label.before&&label.before!==label.after&&!live.length;
  if(current!==label.after&&!untouched)throw new Error('Scope label changed outside its committed release ownership');
  if(live.some(entry=>entry.labels.get(fileId).after!==current||origin(entry,fileId).key!==before.key))throw new Error('Live scope label protection has a conflicting origin');
  const target=live.length?current:before.before,labelChanged=target!==current,labelAcl=target===null?null:Buffer.from(target,'hex');
  if(labelChanged&&coveredByLiveScope)throw new Error('Active descendant scope lacks exact FileID label protection');
  return {...object,label:null,labelAcl,labelChanged,candidate:labelChanged?withScopedFileLabel(object.descriptor,labelAcl):Buffer.from(object.descriptor)};
 });
}
/** 只向内存继承API提供DACL；owner/group保真，label另走已归属的差量。 */
function scopedFileInheritanceInputs(parentDescriptor,childDescriptor){
 const parent=ownedSecurityDescriptor(parentDescriptor),child=ownedSecurityDescriptor(childDescriptor);
 ownedAceList(parent.dacl);const entries=ownedAceList(child.dacl);
 if(child.control&0x1000)throw new Error('Protected scope DACL must not inherit');
 const withoutSacl=value=>({...value,sacl:null,control:value.control&~0x2a30});
 return {parent:encodeOwnedSecurityDescriptor(withoutSacl(parent)),creator:encodeOwnedSecurityDescriptor({...withoutSacl(child),control:withoutSacl(child).control&~0x500,dacl:scopedAcl(child.dacl,entries.filter(ace=>!(ace[1]&16)))})};
}
function mergeScopedFileInheritance(originalDescriptor,nativeDescriptor){
 const original=ownedSecurityDescriptor(originalDescriptor),native=ownedSecurityDescriptor(nativeDescriptor);
 if(!original.owner.equals(native.owner)||!original.group.equals(native.group))throw new Error('Native scope inheritance changed owner/group');
 ownedAceList(native.dacl);
 return encodeOwnedSecurityDescriptor({...original,control:(original.control&~0x1500)|(native.control&0x1500),dacl:native.dacl});
}
function scopedFileDaclClaims(entries,hostSid){
 const {proofs}=scopedLabelHistory(entries),claims=new Map();
 for(const entry of proofs.values())if(entry.proof.phase==='scope-frozen')for(const object of entry.proof.objects){
  if(object.kind!==1||object.role!=='scope'||!object.addedAces.length)continue;
  const sid=Buffer.alloc(40);sid.set([1,8,0,0,0,0,0,15]);
  entry.proof.profileSid.split('-').slice(3).forEach((part,index)=>sid.writeUInt32LE(Number(part),8+4*index));
  const original=ownedAceList(ownedSecurityDescriptor(Buffer.from(object.original,'hex')).dacl),remaining=ownedAceList(ownedSecurityDescriptor(Buffer.from(object.candidate,'hex')).dacl);
  if(hostSid.equals(sid))throw new Error('Invalid exact scope Host SID');
  const added=object.addedAces.map(hex=>Buffer.from(hex,'hex'));
  const maintenance=ace=>scopedHostMaintenanceAce(ace,hostSid,object.directory,Boolean(ace[1]&16));
  for(const ace of [...original,...added]){const at=remaining.findIndex(value=>value.equals(ace));if(at<0)throw new Error('Committed scope DACL delta does not reconstruct its candidate');remaining.splice(at,1);}
  if(remaining.length||added.some(ace=>ace.length<16||ace[0]!==0||ace.readUInt16LE(2)!==ace.length||!ace.subarray(8).equals(sid)&&!ace.subarray(8).equals(OWNER_RIGHTS_SID)&&!maintenance(ace)))throw new Error('Committed scope DACL delta includes an unattributed ACE');
  const direct=added.filter(ace=>!(ace[1]&16)),packageAces=direct.filter(ace=>ace.subarray(8).equals(sid)),owners=direct.filter(ace=>ace.subarray(8).equals(OWNER_RIGHTS_SID)),hosts=direct.filter(maintenance);
  const flags=object.directory?3:0;
  if(packageAces.length!==1||owners.length!==1||packageAces[0][1]!==flags||owners[0][1]!==flags||![0x1200a9,0x1301bf].includes(packageAces[0].readUInt32LE(4))||owners[0].readUInt32LE(4)!==0x20000||hosts.length>1||!hosts.length&&added.some(maintenance)||original.some(ace=>ace.subarray(8).equals(sid)))throw new Error('Scope DACL direct ownership is not a unique original grant');
  const key=entry.proof.profileName+':'+object.fileId;
  if(claims.has(key))throw new Error('Ambiguous committed scope DACL ownership');
  claims.set(key,{entry,object,sid,original,packageAce:packageAces[0],ownerAce:owners[0],hostAce:hosts[0]??null});
 }
 return [...claims.values()];
}
function scopedFileLabelInheritanceInputs(parentDescriptor,childDescriptor){
 const parent=ownedSecurityDescriptor(parentDescriptor),child=ownedSecurityDescriptor(childDescriptor);
 scopedLabelFacts(parent.sacl);const facts=scopedLabelFacts(child.sacl);
 if(child.control&0x2000)throw new Error('Protected scope label must not inherit');
 const creator={...child,control:child.control&~0xa00};
 if(facts!==null&&(facts.flags&16)){creator.sacl=null;creator.control&=~0x30;}
 return {parent:encodeOwnedSecurityDescriptor(parent),creator:encodeOwnedSecurityDescriptor(creator)};
}
function mergeScopedFileLabelInheritance(originalDescriptor,nativeDescriptor){
 const original=ownedSecurityDescriptor(originalDescriptor),native=ownedSecurityDescriptor(nativeDescriptor);
 if(!original.owner.equals(native.owner)||!original.group.equals(native.group))throw new Error('Native label inheritance changed owner/group');
 scopedLabelFacts(native.sacl);
 return encodeOwnedSecurityDescriptor({...original,control:(original.control&~0x2a30)|(native.control&0x2a30),sacl:native.sacl});
}
function scopedFileForest(objects){
 if(!Array.isArray(objects)||!objects.length)throw new Error('Exact scope requires a complete native file forest');
 const key=object=>object.name.toUpperCase(),byKey=new Map();
 const targets=objects.map(object=>{
  if(object.kind!==1||typeof object.name!=='string'||!object.name||!['read','write'].includes(object.access)||typeof object.directory!=='boolean'||object.parent!==null&&typeof object.parent!=='string')throw new Error('Invalid exact scope file target');
  const target={...object,original:Buffer.from(object.descriptor)};ownedSecurityDescriptor(target.original);
  if(byKey.has(key(target)))throw new Error('Duplicate exact scope file target');
  byKey.set(key(target),target);return target;
 });
 const depth=target=>{let count=0,at=target;const seen=new Set();while(at.parent!==null){
  if(seen.has(key(at)))throw new Error('Cyclic exact scope parents');seen.add(key(at));
  const parent=byKey.get(at.parent.toUpperCase());
  if(!parent?.directory||windowsPath.dirname(at.name).toUpperCase()!==key(parent))throw new Error('Exact scope immediate parent is not captured');
  at=parent;count++;
 }return count;};
 targets.sort((a,b)=>depth(a)-depth(b)||(a.name<b.name?-1:a.name>b.name?1:0));
 return {targets,key,byKey};
}
/** 只按Native计算的完整阶段改label，DACL/owner/group不随label写入回灌。 */
function freezeScopedFileLabelStages(objects,inherit){
 if(typeof inherit!=='function')throw new Error('Exact scope label requires native inheritance');
 const {targets,key,byKey}=scopedFileForest(objects),affected=new Set();
 for(const target of targets)if(target.labelChanged||target.parent!==null&&affected.has(target.parent.toUpperCase())&&!(ownedSecurityDescriptor(target.original).control&0x2000))affected.add(key(target));
 for(const target of targets)if(affected.has(key(target)))assertFileSetterBaseline(target.original,true);
 for(const child of targets)if(child.parent!==null&&affected.has(child.parent.toUpperCase())&&!(ownedSecurityDescriptor(child.original).control&0x2000)){
  const baseline=inherit(byKey.get(child.parent.toUpperCase()).original,child.original,child.directory);
  if(!sameOwnedSecurityDescriptor(baseline,child.original))throw new Error('Native inheritance cannot reproduce the original exact scope label');
 }
 const current=new Map(targets.map(target=>[key(target),target.original])),stages=[];
 for(const target of targets)if(target.labelChanged){
  const before=new Map(current),changed=new Set([key(target)]);
  current.set(key(target),withScopedFileLabel(current.get(key(target)),target.labelAcl));
  for(const child of targets)if(child.parent!==null&&changed.has(child.parent.toUpperCase())&&!(ownedSecurityDescriptor(current.get(key(child))).control&0x2000)){
   const next=inherit(current.get(child.parent.toUpperCase()),current.get(key(child)),child.directory);
   if(!sameOwnedSecurityDescriptor(next,current.get(key(child)))){current.set(key(child),next);changed.add(key(child));}
  }
  // 当前 LABEL setter 未证明 NULL SACL 可逆；只阻断真实阶段中的缺失态变化。
  for(const objectKey of changed){
   const previous=ownedSecurityDescriptor(before.get(objectKey)),next=ownedSecurityDescriptor(current.get(objectKey));
   if((previous.sacl===null||next.sacl===null)&&(previous.sacl!==next.sacl||((previous.control^next.control)&0x2a30)))throw new Error('Exact file label setter cannot restore an absent SACL baseline');
  }
  stages.push({target,before,after:new Map(current),component:'label'});
 }
 for(const target of targets){
  target.candidate=current.get(key(target));
  const before=ownedSecurityDescriptor(target.original),after=ownedSecurityDescriptor(target.candidate);
  const expected=target.labelAcl?.toString('hex')??null,actual=after.sacl?.toString('hex')??null;
  if(!target.allowInheritedLabelPropagation&&actual!==expected)throw new Error('Native label propagation differs from its committed source plan');
  const untouched=encodeOwnedSecurityDescriptor({...after,sacl:before.sacl,control:(after.control&~0x2a30)|(before.control&0x2a30)});
  if(!sameOwnedSecurityDescriptor(untouched,target.original))throw new Error('Native label propagation changed non-label security');
 }
 return {targets,stages,key};
}
/** 只撤同FileID已提交的直接授权；继承份数交给原Native计算，不对子对象重复扣减。 */
function freezeScopedFileReleaseStages(objects,entries,profileName,inherit,hostSidText){
 if(typeof inherit!=='function')throw new Error('Exact scope release requires native inheritance');
 const hostSid=scopedHostSid(hostSidText),claims=scopedFileDaclClaims(entries,hostSid),own=claims.filter(claim=>claim.entry.proof.profileName===profileName);
 if(!own.length||own.some(claim=>claim.entry.resource.status==='released'||claim.entry.resource.scopeReleased)||new Set(own.map(claim=>claim.sid.toString('hex'))).size!==1)throw new Error('Scope DACL release has no unique active committed ownership');
 const {targets,key,byKey}=scopedFileForest(objects),identities=new Map();
 for(const target of targets){if(!Buffer.isBuffer(target.id)||target.id.length!==24||identities.has(target.id.toString('hex')))throw new Error('Scope release requires unique native FileIDs');identities.set(target.id.toString('hex'),target);}
 for(const claim of own)if(!identities.has(claim.object.fileId)||identities.get(claim.object.fileId).directory!==claim.object.directory)throw new Error('An original scope identity is missing or changed kind');
 const direct=new Map(),count=(aces,ace)=>aces.filter(value=>value.equals(ace)).length;
 for(const target of targets){
  const fileId=target.id.toString('hex'),source=own.find(claim=>claim.object.fileId===fileId);
  if(!source)continue;
  const shared=claims.filter(claim=>claim.object.fileId===fileId),original=ownedAceList(ownedSecurityDescriptor(target.original).dacl);
  const copies=count(original,source.packageAce),deltas=copies?[{ace:source.packageAce,copies:1,minimumCopies:1}]:[];
  const attributed=(ace,owns,label)=>{
   const baselines=shared.map(claim=>count(claim.original,ace)-shared.filter(other=>other!==claim&&owns(other)&&count(claim.original,other.packageAce)>0).length);
   if(baselines.some(value=>value<0||value!==baselines[0]))throw new Error(`Shared ${label} has no consistent original FileID baseline`);
   const peers=shared.filter(claim=>claim!==source&&owns(claim)&&claim.entry.resource.status!=='released'&&!claim.entry.resource.scopeReleased&&count(original,claim.packageAce)>0).length;
   const ownCopies=copies&&owns(source)?1:0,minimum=baselines[0]+peers+ownCopies;
   if(count(original,ace)!==minimum)throw new Error(`Scope ${label} ownership cannot be reconstructed`);
   if(ownCopies)deltas.push({ace,copies:1,minimumCopies:minimum});
  };
  attributed(source.ownerAce,()=>true,'OWNER_RIGHTS');
  const hostAce=scopedAllowAce(hostSid,0x60000,target.directory?3:0);
  attributed(hostAce,claim=>claim.hostAce!==null&&claim.hostAce.equals(hostAce),'Host maintenance');
  direct.set(fileId,deltas);
 }
 const affected=new Set();
 for(const target of targets)if(direct.get(target.id.toString('hex'))?.length||target.parent!==null&&affected.has(target.parent.toUpperCase())&&!(ownedSecurityDescriptor(target.original).control&0x1000)){
  assertFileSetterBaseline(target.original);affected.add(key(target));
 }
 for(const child of targets)if(child.parent!==null&&affected.has(child.parent.toUpperCase())&&!(ownedSecurityDescriptor(child.original).control&0x1000)){
  const baseline=inherit(byKey.get(child.parent.toUpperCase()).original,child.original,child.directory);
  if(!sameOwnedSecurityDescriptor(baseline,child.original))throw new Error('Native inheritance cannot reproduce the current scope release baseline');
 }
 const current=new Map(targets.map(target=>[key(target),target.original])),stages=[];
 for(const target of targets){
  const deltas=direct.get(target.id.toString('hex'));if(!deltas?.length)continue;
  const before=new Map(current),changed=new Set([key(target)]);
  current.set(key(target),subtractScopedFileAccess(current.get(key(target)),deltas));
  for(const child of targets)if(child.parent!==null&&changed.has(child.parent.toUpperCase())&&!(ownedSecurityDescriptor(current.get(key(child))).control&0x1000)){
   const next=inherit(current.get(child.parent.toUpperCase()),current.get(key(child)),child.directory);
   assertScopedHostInheritance(before.get(child.parent.toUpperCase()),current.get(child.parent.toUpperCase()),current.get(key(child)),next,hostSid,child.directory);
   if(!sameOwnedSecurityDescriptor(next,current.get(key(child)))){current.set(key(child),next);changed.add(key(child));}
  }
  stages.push({target,before,after:new Map(current),component:'dacl'});
 }
 const sid=own[0].sid;
 for(const target of targets){
  target.candidate=current.get(key(target));target.addedAces=[];
  const before=ownedSecurityDescriptor(target.original),after=ownedSecurityDescriptor(target.candidate),expected=ownedAceList(before.dacl).filter(ace=>!(ace[1]&16));
  for(const {ace,copies}of direct.get(target.id.toString('hex'))??[])for(let n=0;n<copies;n++)expected.splice(expected.findIndex(value=>value.equals(ace)),1);
  const actual=ownedAceList(after.dacl).filter(ace=>!(ace[1]&16));
  for(const ace of expected){const at=actual.findIndex(value=>value.equals(ace));if(at<0)throw new Error('Scope release removed an unrelated explicit ACE');actual.splice(at,1);}
  if(actual.length)throw new Error('Scope release introduced an explicit ACE');
  const unrelated=aces=>aces.filter(ace=>!ace.subarray(8).equals(sid)&&!ace.subarray(8).equals(OWNER_RIGHTS_SID)&&!scopedHostMaintenanceAce(ace,hostSid,target.directory,Boolean(ace[1]&16))).map(ace=>ace.toString('hex')).sort();
  if(JSON.stringify(unrelated(ownedAceList(before.dacl)))!==JSON.stringify(unrelated(ownedAceList(after.dacl))))throw new Error('Scope release changed an unrelated inherited ACE');
  const untouched=encodeOwnedSecurityDescriptor({...after,dacl:before.dacl,control:(after.control&~0x1500)|(before.control&0x1500)});
  if(!sameOwnedSecurityDescriptor(untouched,target.original))throw new Error('Scope DACL release changed non-DACL security');
 }
 return {targets,stages,key};
}
/** 每次父DACL更新都由Native重算后代；受影响基线必须已稳定且重建恒等。 */
function freezeScopedFileAccessStages(objects,packageSid,inherit,hostSidText){
 if(typeof inherit!=='function')throw new Error('Exact scope requires native inheritance');
 const hostSid=scopedHostSid(hostSidText),{targets,key,byKey}=scopedFileForest(objects);
 for(const target of targets)assertFileSetterBaseline(target.original);
 for(const child of targets)if(child.parent!==null&&!(ownedSecurityDescriptor(child.original).control&0x1000)){
  const baseline=inherit(byKey.get(child.parent.toUpperCase()).original,child.original,child.directory);
  if(!sameOwnedSecurityDescriptor(baseline,child.original))throw new Error('Native inheritance cannot reproduce the original exact scope DACL');
 }
 const current=new Map(targets.map(target=>[key(target),target.original])),stages=[];
 for(const target of targets){
  const before=new Map(current),changed=new Set([key(target)]);
  current.set(key(target),addScopedFileAccess(current.get(key(target)),packageSid,target.access,target.directory,hostSidText).candidate);
  for(const child of targets)if(child.parent!==null&&changed.has(child.parent.toUpperCase())&&!(ownedSecurityDescriptor(current.get(key(child))).control&0x1000)){
   const next=inherit(current.get(child.parent.toUpperCase()),current.get(key(child)),child.directory);
   assertScopedHostInheritance(before.get(child.parent.toUpperCase()),current.get(child.parent.toUpperCase()),current.get(key(child)),next,hostSid,child.directory);
   if(!sameOwnedSecurityDescriptor(next,current.get(key(child)))){current.set(key(child),next);changed.add(key(child));}
  }
  stages.push({target,before,after:new Map(current)});
 }
 for(const target of targets){
  target.candidate=current.get(key(target));
  const remaining=ownedAceList(ownedSecurityDescriptor(target.original).dacl),added=[];
  for(const ace of ownedAceList(ownedSecurityDescriptor(target.candidate).dacl)){
   const at=remaining.findIndex(original=>original.equals(ace));
   if(at>=0)remaining.splice(at,1);else{
    if(ace[0]!==0||!ace.subarray(8).equals(packageSid)&&!ace.subarray(8).equals(OWNER_RIGHTS_SID)&&!scopedHostMaintenanceAce(ace,hostSid,target.directory,Boolean(ace[1]&16)))throw new Error('Exact scope propagation changed an unrelated ACE');
    added.push(Buffer.from(ace));
   }
  }
  if(remaining.length)throw new Error('Exact scope propagation removed an original ACE');
  target.addedAces=added;
 }
 return {targets,stages,key};
}
/** 首次写入前固定原始描述符、完整候选及每阶段继承传播，不用实际读回重新定基线。 */
function freezeOwnedPackageWriteStages(objects, packageSid, mapMask) {
 if (!objects.length) throw new Error('Owned stage plan cannot be empty');
 const key = object => object.kind + ':' + object.name.toUpperCase();
 const byKey = new Map(), targets = objects.map(object => {
  if (![1, 4].includes(object.kind) || typeof object.name !== 'string' || !object.name || typeof object.directory !== 'boolean') throw new Error('Invalid owned stage target');
  const original = Buffer.from(object.descriptor), security = ownedSecurityDescriptor(original);
  if(object.kind===1)assertFileSetterBaseline(original);
  const candidate = subtractOwnedPackageWrites(security.dacl, packageSid, object.kind, mapMask);
  const target = { ...object, original, candidate: encodeOwnedSecurityDescriptor({ ...security, dacl: candidate.acl }), ownerRightsAdded: candidate.ownerRightsAdded };
  if (byKey.has(key(target))) throw new Error('Duplicate owned stage target');
  byKey.set(key(target), target); return target;
 });
 const roots = new Set();
 for (const target of targets) {
  if (target.parent === null) { if (roots.has(target.kind)) throw new Error('Ambiguous owned root'); roots.add(target.kind); continue; }
  const parent = byKey.get(target.kind + ':' + target.parent.toUpperCase());
  const immediate = target.name.slice(0, target.name.lastIndexOf('\\'));
  if (!parent || target.kind === 1 && !parent.directory || immediate.toUpperCase() !== parent.name.toUpperCase()) throw new Error('Owned immediate parent is not captured');
 }
 const depth = target => { let n = 0, at = target; const seen = new Set(); while (at.parent !== null) { if (seen.has(key(at))) throw new Error('Cyclic owned parents'); seen.add(key(at)); at = byKey.get(at.kind + ':' + at.parent.toUpperCase()); n++; } return n; };
 targets.sort((a, b) => b.kind - a.kind || depth(a) - depth(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
 const packageAllow = ace => ace[0] === 0 && ace.subarray(8).equals(packageSid), edges = [];
 for (const child of targets) {
  const security = ownedSecurityDescriptor(child.original), entries = ownedAceList(security.dacl);
  for (let ci = 0; ci < entries.length; ci++) {
   const ace = entries[ci]; if (!packageAllow(ace) || !(ace[1] & 16)) continue;
   if (child.parent === null || security.control & 0x1000 || ace.readUInt32LE(4) & 0xf0000000) throw new Error('External or unsupported inherited package source');
   const parent = byKey.get(child.kind + ':' + child.parent.toUpperCase()), candidates = ownedAceList(ownedSecurityDescriptor(parent.original).dacl);
   let source;
   for (let pi = 0; pi < candidates.length; pi++) {
    const candidate = candidates[pi]; if (!packageAllow(candidate)) continue;
    const flags = candidate[1];
    if ((flags & 3) !== 3 || flags & ~0x33) throw new Error('Unsupported package inheritance flags');
    const inherited = (flags & 0x20) | 16 | (child.kind === 4 || child.directory ? 3 : 0);
    if (inherited !== ace[1] || mapMask(candidate.readUInt32LE(4), child.kind) !== ace.readUInt32LE(4)) continue;
    if (source !== undefined) throw new Error('Ambiguous inherited package source'); source = pi;
   }
   if (source === undefined) throw new Error('Inherited package source does not match the captured parent');
   edges.push({ parent, child, parentAce: source, childAce: ci });
  }
 }
 const current = new Map(targets.map(target => [key(target), target.original])), completed = new Set(), stages = [];
 for (const target of targets) {
  const before = new Map(current); current.set(key(target), target.candidate); completed.add(key(target));
  for (const edge of edges) {
   const parent = ownedSecurityDescriptor(current.get(key(edge.parent))), child = ownedSecurityDescriptor(current.get(key(edge.child)));
   const parentAces = ownedAceList(parent.dacl), childAces = ownedAceList(child.dacl), ace = childAces[edge.childAce];
   const mask = mapMask(parentAces[edge.parentAce].readUInt32LE(4), edge.child.kind), old = ace.readUInt32LE(4), writes = edge.child.kind === 1 ? 0xd0156 : 0xd0026;
   if ((mask & ~old) !== 0 || ((mask ^ old) & ~writes) !== 0) throw new Error('Stage propagation is not exact package write subtraction');
   if (mask !== old) {
    let offset = 8; for (let index = 0; index < edge.childAce; index++) offset += childAces[index].length;
    child.dacl.writeUInt32LE(mask >>> 0, offset + 4); current.set(key(edge.child), encodeOwnedSecurityDescriptor(child));
   }
  }
  stages.push({ target, before, after: new Map(current), completed: new Set(completed) });
 }
 for (const target of targets) if (!sameOwnedSecurityDescriptor(current.get(key(target)), target.candidate)) throw new Error('Final frozen stage differs from the original complete candidate');
 return { targets, stages, key };
}

export { createPrivateTaskWorkDirectories, withPrivateResourceSecurity, privateResourceInitializationNeeded, freezeScopedFileReleaseStages, scopedLabelFacts, withScopedFileLabel, planScopedFileLabels, planScopedFileLabelRelease, scopedFileLabelInheritanceInputs, mergeScopedFileLabelInheritance, freezeScopedFileLabelStages, scopedFileInheritanceInputs, mergeScopedFileInheritance, freezeScopedFileAccessStages, addScopedFileAccess, subtractScopedFileAccess, createAclMutationLock, ownedSecurityDescriptor, sameOwnedSecurityDescriptor, freezeOwnedPackageWriteStages, subtractOwnedPackageWrites, loadWindowsAppContainerBindings, AclWriteGrant, workspaceWriteSid, tempWriteSid, assertTempRootOutsideWorkspace, AclSandbox, loadWindowsAclBindings };
