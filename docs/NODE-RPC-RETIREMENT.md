# Node RPC test plugin retirement

The optional `@deepseek-ai/dsh-ptc-runtime-node` plugin ABI is retired. It was
loaded only by the old `native-tools-runtime` tests, never the default Host.
Its `run_code`, Node module imports, empty `process.env`, direct filesystem
execution and legacy dispatch-event contracts are not retained APIs.

The replacement tests use the locked Pi 1.5 public `createAgentSession`,
`SessionManager`, `ModelRuntime` and `createCodemodeExtension` with a real QuickJS
worker and pure fixture tools. They verify union argument rejection before the
host body, unavailable Node globals, unmodified parent-call/signature metadata,
physical official journal/cold reads, generated nested IDs and bounded evidence.
The scripted opaque signature marker tests byte preservation, not cryptographic
signature validity. No external effect or vendor model is invoked.

This is not a production codemode enablement. Default tools still expose neither
`codemode` nor `run_code`, and DSH plugin preflight blocks module evaluation.
The official extension records nested calls only on the parent's tool result.
Arguments beyond 8 KiB per call or 32 KiB total are omitted, calls beyond 256 are
dropped, and `complete` becomes false. These post-execution records cannot satisfy
Night's current effect-intent v2 requirement for a committed original assistant
call with the exact nested tool name and arguments.

Official `abort()` and `waitForIdle()` can finish while an uncooperative nested
host tool is still active. The tests preserve this negative contract and explicitly
join the fixture host tool before cleanup. `CodemodeSandbox` publicly exposes
`onWorkerStarted(exited)` and worker admission callbacks, but the extension factory
options do not expose them; its result/close is not an actual worker-exit proof.
Effectful enablement remains blocked pending explicit typed pre-execution nested
invocation receipts bound to the unchanged official parent, actual host-tool drain,
and actual worker-exit accounting through supported official hooks. No assistant
message, result, signature or success receipt may be fabricated to fill that gap.
