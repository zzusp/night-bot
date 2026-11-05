# Channel plugins (API version 1)

The default Host starts with no channels and never probes DWS. Channel code is
trusted executable Host code, installed by the operator, with service-account
permissions; it is not a model sandbox or an untrusted marketplace installation.

## Discovery and activation

Configure `channelPluginDirs` with installation-relative (or explicit absolute)
directories. Each immediate package subdirectory may contain `night-channel.json`:

```json
{"apiVersion":1,"type":"example-chat","entry":"index.mjs"}
```

Entry paths must resolve inside that package. Discovery reads manifests only;
it does not execute their modules. Duplicate types, including overrides of built-in
types, fail startup. A directory listing alone never enables a plugin. Enable
instances explicitly:

```json
{
  "channelPluginDirs": ["plugins/channels"],
  "channelPlugins": [
    {"type":"example-chat","channelId":"personal-account","enabled":true,"config":{}},
    {"type":"dingtalk-dws","enabled":false}
  ]
}
```

Enabled instance IDs must be unique. Disabled instances do not import or invoke
code, create account directories, register transports or probe executables.
`dingtalk-dws` remains a built-in optional type for compatibility; the Host has no
vendor-specific composition logic. Multiple enabled instances may use the same
type when the plugin supports it. DWS namespaces private account/cache/state and
workspace directories by channel ID. The first `dingtalkChannel` service is a
compatibility alias; all instances are available in `channels.plugins`.

## Lifecycle and capabilities

An ESM plugin exports `inject=['channels','runtimePaths']` and `apply(ctx,config)`
(the standard Cordis plugin contract). `config.enabled` and `config.channelId` are
Host-selected. In `apply`, register its transport and optional observers; attach
listeners to `night/ready`, after the application and durable services exist.
Register an idempotent stop via both `night/stopping` and `ctx.effect(()=>stop)`.
Stop ingress, terminate/await subscriptions, then invoke every unregister callback.
Host shutdown drains admitted channel work. Exceptions during loading fail Host
startup and dispose loaded plugins; no partial-success startup is claimed.

`channels.registerTransport(channelId,transport)` requires `send` and `readback`.
Optional methods are `sendFile`, `readbackFile`, `readMessage`, `readResource`,
`readMentioned` and `canSend`. Optional `capabilities.conversationTypes`, `files`
and `quotedReplies` list the supported `chat`/`chat-room` kinds. File and
conversation admission use these declarations; a plugin must reject unsupported
operations itself too. Quote support describes actual delivery, not an inference
from a successful plain-text send. `registerPlugin` can publish health/controls
without adding a global vendor-specific Host service.

Ingress is `channels.receive({type,channelId,conversationId,senderId,messageId,text,
sentAt?,resourceRefs?,quotedMessage?,mentionedAgent?,mentions?,platformFlags?})`.
The adapter must authenticate conversation and sender IDs. `quotedMessage` has
`messageId`, optional `senderId` and `text`. `mentions` contains platform-authenticated
sender IDs, not display names. `platformFlags` is scalar metadata; the reserved
neutral boolean `automated` marks platform-proven automated output. Missing flags
are unknown; adapters must not infer them from display names or prose.

Room participants share a room scope; a `chat` includes its sender in the scope.
Channel ID separates accounts and plugins. Principal IDs are namespaced by channel.
Message deduplication includes metadata; conflicting reuse of an ID fails.

Outbound methods receive a neutral envelope with type/channel/conversation,
`deliveryKey`, text, reply source message ID, recipient sender ID and mentions,
followed by the durable notification. Preserve its idempotency identity. If a send
may have happened, use readback; missing evidence never authorizes a fresh send.
Readers return a matching `messageId` and `conversationId`, `senderId`, text and
optional quote with neutral `senderId`/text. The core boundary translates into
historical attributed Topic field names. Those internal names and old sourceKind
values remain readable; new unified ingress uses `sourceKind: 'channel'` and
persists channel type/ID, quote author, mentions and platform flags through restart.

## DWS interfaces verified and remaining limits

Checked the official CLI tag **v1.0.63**, commit
`4cd5d05393a8748e89d9265eb9f7ec85745a0331` (source inspection, not a locally
installed binary or a live account):

- `event +listen-im --kind group --chat-id ... --events message --format ndjson`
  and `--kind all-direct` are declared in `internal/app/event_listen_im.go`.
- `internal/event/personal/output.go` publishes `quoted_message` with
  `sender_open_dingtalk_id`, message/conversation IDs, content and create time.
  The event schema does not promise @ or automation metadata. When present in
  compatible output/history, those fields are preserved; absence stays unknown.
- `chat +messages-send --as user --open-dingtalk-id ... --text ...
  --idempotency-key ... --yes --format json` is supported by
  `internal/shortcut/chat/unified_send.go`. Open IDs are not passed as `--user`,
  which performs a different identity resolution. Group quoted sends retain the
  existing native reply path and native mention flags.

Private chat ingress is opt-in: `config.directChats:true` requires an explicit
`directPeers` allowlist of authenticated open IDs and `assistantActorId` to exclude
the account's own output. It reuses the bridge's reconnecting all-direct stream;
operator reply handling remains active. Avoid configuring the same peer as a
business-chat participant and an operator unless both processing paths are desired.
Private quoted replies use `chat +messages-reply --open-dingtalk-id ...
--conversation-id ... --message-id ... --ref-sender ... --content ...
--idempotency-key ... --yes`, verified in `chat/lark_alignment.go` and
`chat/reply_extensions.go`. The CLI verifies both source identity and the peer's
conversation before sending. Plain text sends without a source use `+messages-send`.
Both paths retain idempotency and exact SUCCESS status readback
bound to the original conversation. They do **not** claim private-chat
mentions or file delivery. Missing send acknowledgment stays unresolved without
resending. Group/history/media/file and operator capabilities retain their prior
adapter paths. Private-chat history catch-up is not implemented for general chat;
only live subscribed messages and the retained operator recovery path are covered.

No CLI binary/account was configured here; no real DingTalk messages were sent.
Login, profile compatibility on the deployed CLI version, actual group/private
send/receive, reconnect delivery and upload/download remain live acceptance work.
The separate Baibu task owns “Night Bot Test” live testing; this branch does not
connect, deploy or send messages there.

## Credential isolation: Windows blocks activation

The official v1.0.63 `pkg/config/constants.go` selects `DWS_CONFIG_DIR` over
`~/.dws`. Configuration location is separate from credentials:

- Linux `internal/keychain/keychain_linux.go` stores encrypted token files and DEK
  below `DWS_KEYCHAIN_DIR/dws-cli` (otherwise `~/.local/share/dws-cli`).
- macOS `keychain_darwin.go` uses ciphertext below `DWS_KEYCHAIN_DIR/dws-cli`
  (otherwise `~/Library/Application Support/dws-cli`) and a system Keychain DEK.
  The system Keychain dependency remains; no claim of an independent OS security
  principal or validated macOS runtime is made.
- Windows `keychain_windows.go` stores DPAPI-protected values in
  `HKCU\Software\DwsCli\keychain\dws-cli`. `DWS_KEYCHAIN_DIR` only affects portable
  auth-bundle placement there, **not** the credential backend. HOME, USERPROFILE,
  XDG, APPDATA and DWS_CONFIG_DIR cannot partition these registry credentials.
  `DWS_KEYCHAIN_TEST_NAMESPACE` changes the registry namespace, but its declaration
  in `keychain.go` explicitly says production must not set it.

The plugin now explicitly sets both official config/keychain directories below
its private account directory on supported platforms, and removes inherited
`DWS_*` account/override environment variables. It never sets the test namespace,
never disables Keychain/DPAPI, and never copies or exports existing credentials.
Operators must log in independently using the plugin's two directory settings.

Real Windows activation fails with `DWS_WINDOWS_ACCOUNT_ISOLATION_UNAVAILABLE`
before creating account directories, launching the executable or registering a
transport. Disabled DWS and the channel-neutral application still start normally.
There is no config override to silently reuse the Windows user's existing account.
A dedicated Windows OS account with independently verified login, or an upstream
production-supported keychain namespace, is needed before designing and validating
a Windows enablement path. That OS provisioning/upstream change is not performed
by this branch. Linux environment/path tests and source inspection are evidence;
real account isolation on all platforms still needs target-system acceptance.
