# Channel protocol and two-tier triage

Night Bot supports two channel-independent conversation types: `chat` for one
person and `chat-room` for a room with multiple senders. DingTalk is an optional
adapter; no DWS executable is required for the core or local protocol tests.

Trusted adapters submit `{type, channelId, conversationId, senderId, messageId,
text}` to `ctx.channels.receive`. The adapter authenticates these identities;
this is a Host API, not an unauthenticated public HTTP endpoint. Stable namespaces
separate channel providers, conversations, private senders and rooms. Private
sessions use personal memory; room sessions use only that room's memory. Every
room message retains its actual sender in durable source metadata and model input.
No private note is injected into a room. Models cannot select another principal.

Register an explicitly configured transport through
`ctx.channels.registerTransport(channelId, {send, readback})`. These functions
receive a typed envelope containing the original channel/conversation, a stable
`deliveryKey`, the exact original `replyToMessageId`, sender and text. `chat`
envelopes have no group mentions; `chat-room` mentions are derived from registered
participants. A missing transport leaves delivery prepared with an explicit
maintenance error; it never falls through to DWS. Transport implementations must
retain idempotency/readback evidence and report uncertainty honestly. No connector
or real account is enabled by initialization.

A standalone Host supports scoped conversational turns. Once the real task service
is attached (the standard managed service composition), it owns the channel
triage ingress. Adapters must start ingress after that composition is ready and
stop it before shutdown. The current SDK supplies this integration boundary;
it does not claim integrations with all messaging platforms or install accounts.
The retained internal transport facade has historical DingTalk field names, while
the public typed protocol and adapter delivery envelopes remain channel-neutral.

## First tier

The first tier receives bounded source messages and Topic summaries. It owns the
initial, tentative feedback through `group_topic_initial_reply`; the second tier
continues Topic decisions and task handling. The first tier cannot execute tasks.
Replies are split by the model's actual matter/topic assessment. Each reply names
one original source, its version, and a uniquely matching quote. A message spanning
several matters may have separate quoted replies. Every source must have a reply
or an explicit silent disposition before classification can commit. Silence is
appropriate for messages that do not call for assistant intervention.

Program rules enforce:

- At most 15 distinct sources in a live first-tier batch. The 16th stays pending
  for the next batch. Concurrent ingress uses the same bounded membership.
- New sources arriving before route submission seals that batch are steered into
  the same running first-tier session. No new/restarted classification session is
  created for those arrivals. Older incomplete model submissions are rejected.
- Source/version/actor/unique-quote validation precedes any preparation. Replies
  cannot cite another conversation or invent the quoted original.
- Each source/version/topic feedback has a deterministic outbox key. Prepared
  intents and unknown sends retain that identity across retries and restart.
- Batch membership, session ID and dispatch generation are durable. A cold
  recovery resumes that same Pi session with a new dispatch generation. It does
  not resend already prepared feedback as a new intent.
- Preliminary feedback is a distinct `triage-reply` ledger kind, with no task or
  final-result authority. The body is labeled tentative; overt certainty patterns
  are refused. Topic confirmations cannot duplicate first-tier confirmations.

Understanding topics, choosing useful wording, knowing when silence is appropriate,
and whether a statement is actually too confident remain model judgments. Phrase
checks are not a semantic proof. Preliminary feedback must never assert execution,
completion or a verified business conclusion. Second-tier sessions process fixed
Topic versions; incremental batch intake belongs to the first tier. A later batch
that changes a Topic supersedes an outdated second-tier snapshot rather than
trapping a stale decision behind its own queued update.

## Recovery and timing evidence

Outbox preparation is separate from transport sends. An uncertain send is read back,
not sent again; definitive rejection/retry still follows the existing receipt
policy. An edited/stale source cannot start a new send. Per-source task status and
final delivery remain independent of initial feedback.

`test/pi-triage.test.js` uses the real default Host, Pi HTTP protocol, authoritative
native domains, SQLite notifications and registered local transport. It covers
active-turn arrivals, concurrent 15/16 admission, two matters with separately quoted
sources, private-chat mention semantics, cold session continuation, lost send
acknowledgment and readback without a second send. It deliberately holds the second
tier and proves initial sends happen first. Reported timing is a controlled local
fixture comparison, not a benchmark for a real model vendor or DWS.

## Plugin discovery

External channel packages are discovered from explicit `channelPluginDirs` and
activated only by enabled `channelPlugins` instances. API, manifest, lifecycle,
capabilities, multi-account isolation and DWS source evidence are specified in
[CHANNEL-PLUGINS](CHANNEL-PLUGINS.md).

## Optional DingTalk DWS plugin

The standard CLI composes `src/application.js`, not the historical DWS resident.
Initialization uses `channelPlugins: []`. Disabled rows do not load the adapter,
register a transport, probe a binary, subscribe or create an account home. To opt in:

```json
{"channelPlugins":[{"type":"dingtalk-dws","enabled":true,"config":{
  "profile":"YOUR_PROFILE","writesAuthorized":false,"groups":["YOUR_ROOM_ID"]
}}]}
```

Windows defaults to `accountMode:"system"`, using the current user's existing DWS
login with its DPAPI/HKCU protection. This does not copy credentials or claim
independent login per plugin. Linux/macOS default to private config/keychain files;
`accountMode:"system"` may also be selected explicitly there. Only an explicit
private-account request is unsupported on Windows. Credential ownership, shared
account effects and configuration examples are in
[CHANNEL-PLUGINS](CHANNEL-PLUGINS.md).
No account, actor ID, group or credential is bundled. Enable writes separately
only after checking authorization. `listen:false` supports explicit SDK ingress
without starting listeners. The plugin retains attributed DWS history, resource,
mention, file, subscription and receipt/readback adapters; typed ingress retains
the real sender and source quote. Night Bot-managed private account files live
in `data/secrets/dingtalk-dws`; system-mode credentials remain owned by DWS/OS.
Optional operator notifications require explicit plugin configuration and actual
operator/account identity validation. General private-chat ingress is separately
opt-in via `directChats`, `directPeers` and `assistantActorId`; it supports native
quoted text replies, not private-chat file delivery or general history catch-up.

`test/pi-channel-plugin.test.js` checks disabled/registered modes and the actual
standard application without any channel installed. Local adapter/domain contracts
exercise vendor protocol behavior with fixtures. A real DWS executable, login,
subscription reconnect, private operator routing and upload/download have not been
accepted against a live account. These remain channel integration checks and do
not block core initialization, tasks or local acceptance.
