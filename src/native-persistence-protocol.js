// Attributed MIT persistence error vocabulary. Native Pi storage has no Session-event API.
import {snapshotJsonValue} from './native-values.js'
var SessionPersistenceNotFoundError = class extends Error {
	sessionId;
	/** @param sessionId - absent durable Session identity. */
	constructor(sessionId) {
		super(`session "${sessionId}" not found`);
		this.sessionId = sessionId;
		this.name = "SessionPersistenceNotFoundError";
	}
};
var SessionAlreadyExistsError = class extends Error {
	sessionId;
	/** @param sessionId - the occupied durable Session identity. */
	constructor(sessionId) {
		super(`session "${sessionId}" already exists`);
		this.sessionId = sessionId;
		this.name = "SessionAlreadyExistsError";
	}
};
var SessionAlreadyOwnedError = class extends Error {
	sessionId;
	/** @param sessionId - the session whose write ownership is taken. */
	constructor(sessionId) {
		super(`session "${sessionId}" is already owned by an active write handle`);
		this.sessionId = sessionId;
		this.name = "SessionAlreadyOwnedError";
	}
};
var SessionReadOnlyError = class extends Error {
	sessionId;
	/**
	* @param sessionId - the session the read handle observes.
	* @param operation - the refused mutating operation name.
	*/
	constructor(sessionId, operation) {
		super(`session "${sessionId}": ${operation} is not available on a read handle`);
		this.sessionId = sessionId;
		this.name = "SessionReadOnlyError";
	}
};
var SessionOwnershipLostError = class extends Error {
	sessionId;
	/** @param sessionId - the session whose write ownership this handle lost. */
	constructor(sessionId) {
		super(`session "${sessionId}": write ownership was lost; close this handle and reopen`);
		this.sessionId = sessionId;
		this.name = "SessionOwnershipLostError";
	}
};
var SessionHandleClosedError = class extends Error {
	sessionId;
	/**
	* @param sessionId - the session the closed handle addressed.
	* @param operation - the refused operation name.
	*/
	constructor(sessionId, operation) {
		super(`session "${sessionId}": ${operation} on a closed handle`);
		this.sessionId = sessionId;
		this.name = "SessionHandleClosedError";
	}
};
var SessionPersistenceCorruptionError = class extends Error {
	/**
	* @param message - stable corruption context.
	* @param options - original validation failure.
	*/
	constructor(message, options) {
		super(message, options);
		this.name = "SessionPersistenceCorruptionError";
	}
};
var SessionFormatUnsupportedError = class extends Error {
	location;
	/**
	* @param message - stable reason the log cannot be interpreted, already
	*   including the raw-log path when one exists.
	* @param location - the backend's artifact location, when one exists.
	*/
	constructor(message, location) {
		super(message);
		this.location = location;
		this.name = "SessionFormatUnsupportedError";
	}
};
function materializeCreateHeader(header) {
	const snapshot = snapshotJsonValue(header);
	if (snapshot === void 0) throw new TypeError("session metadata must be losslessly JSON-serializable");
	if (!Number.isSafeInteger(snapshot.createdAt) || snapshot.createdAt < 0) throw new TypeError("session metadata createdAt must be a non-negative safe integer");
	return snapshot;
}
export {SessionPersistenceNotFoundError,SessionAlreadyExistsError,SessionAlreadyOwnedError,SessionReadOnlyError,SessionOwnershipLostError,SessionHandleClosedError,SessionPersistenceCorruptionError,SessionFormatUnsupportedError,materializeCreateHeader}
