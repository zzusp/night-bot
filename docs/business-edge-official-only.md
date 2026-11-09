# Official-only business runtime edges

Coordination reads `officialBusinessProjection` from an actual SDK AgentSession.
A legacy `session` property is rejected, including on a hybrid actor; an injected
`piAuthority.context` cannot supply or bypass model-context evidence. Pure data
composition objects with no execution context still expose no history. Source
visibility remains separately authenticated by the private business-input port.

Job admission now requires the live official actor and its typed receipt port.
There is no Session append/flush fallback. Both the initial journal barrier and
registered receipt commit still precede producer invocation. Cancellation during
registration persists not-started; uncertain startup or terminal persistence
never proves successful completion or authorizes replay. Owner drain still joins
producer termination and receipt settlement.

Schedule target IDs use a module-local identity after existing string validation;
its default inherited offset is the literal zero, and the existing fold range
checks remain. Calendar, signature, framing and receipt algorithms are unchanged.
No persistence, journal, business-state or permission implementation was changed.

Old Session-based job fixtures map to actual official SDK tests: registration
before producer, rejected append, cancellation barrier, foreign call rejection,
capacity reserved during registration, uncertain terminal commit, uncertain
producer startup, teardown without producer proof, and cold typed receipt checks.
The cold observation reducer remains a no-replay observation helper.

Coordination tests now append native call/results and authenticated custom input
entries through public SessionManager APIs. Public context edits and compaction
revoke visibility while retaining raw evidence. Reopen uses a real SDK session
with retained native entries, not a Session event or surface facade. Pending
latest revisions remain unread until admitted and removed from the private queue.
