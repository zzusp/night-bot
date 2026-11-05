// MIT source-derived capability error vocabulary; see licenses/dsh-{web,authorization,workspace,session-title}-MIT.txt.
import {HarnessError} from '@deepseek-ai/dsh-llm';
var WebError = class extends HarnessError {};
var AuthorizationError = class extends HarnessError {
	constructor(message, code, options) {
		super(message, code, options);
		this.name = "AuthorizationError";
	}
};
var AuthorizationDeclinedError = class extends AuthorizationError {
	constructor(message = "the authorization prompt was declined") {
		super(message, "DECLINED");
		this.name = "AuthorizationDeclinedError";
	}
};
var WorkspaceMoveInvalidError = class extends Error {
	/**
	* @param message - Which id was unaccounted and where.
	*/
	constructor(message) {
		super(message);
		this.name = "WorkspaceMoveInvalidError";
	}
};
var WorkspaceUnknownSessionError = class extends Error {
	sessionId;
	/**
	* @param sessionId - The unknown session id.
	* @param verb - The registry operation that named the session.
	*/
	constructor(sessionId, verb) {
		super(`cannot ${verb} session '${sessionId}': live sessions and session persistence hold no such session`);
		this.sessionId = sessionId;
		this.name = "WorkspaceUnknownSessionError";
	}
};
var WorkspaceActiveSessionError = class extends Error {
	sessionId;
	activity;
	/**
	* @param sessionId - The active session id.
	* @param activity - The reported activity, in listener order.
	*/
	constructor(sessionId, activity) {
		super(`cannot archive session '${sessionId}': the session is active (${activity.map((entry) => entry.kind).join(", ")})`);
		this.sessionId = sessionId;
		this.activity = activity;
		this.name = "WorkspaceActiveSessionError";
	}
};
var WorkspaceArchivedSessionPinError = class extends Error {
	sessionId;
	/**
	* @param sessionId - The archived session id.
	*/
	constructor(sessionId) {
		super(`cannot pin session '${sessionId}': the session is archived`);
		this.sessionId = sessionId;
		this.name = "WorkspaceArchivedSessionPinError";
	}
};
var WorkspaceOrderInvalidError = class extends Error {
	workspaceId;
	/**
	* @param workspaceId - Missing source or anchor id.
	*/
	constructor(workspaceId) {
		super(`cannot reorder unknown workspace '${workspaceId}'`);
		this.workspaceId = workspaceId;
		this.name = "WorkspaceOrderInvalidError";
	}
};
var SessionTitleInvalidError = class extends Error {
	name = "SessionTitleInvalidError";
};

export { WebError, AuthorizationError, AuthorizationDeclinedError, WorkspaceMoveInvalidError, WorkspaceUnknownSessionError, WorkspaceActiveSessionError, WorkspaceArchivedSessionPinError, WorkspaceOrderInvalidError, SessionTitleInvalidError };
