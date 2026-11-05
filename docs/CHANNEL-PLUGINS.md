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
type when the plugin supports it. DWS namespaces cache/state/workspace directories
by channel ID; account directories are namespaced only in private-account mode.
System-account instances share the external CLI credential context. The first `dingtalkChannel` service is a
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
  is declared in `internal/app/event_listen_im.go`. The broader `all-direct`
  intent exists but is never used by this adapter.
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
the account's own output. Each allowed peer gets a reconnecting server-scoped
`event consume user_im_message_receive_o2o --open-dingtalk-id PEER --flatten
--format ndjson` subscription. This public specific-conversation event is declared
in `internal/event/personal/registry.go`, with target/flatten flags in
`internal/app/event_command.go`. It avoids both all-direct collection and sender
subscriptions (which may cover messages beyond private conversation scope).
Operator replies require `operatorNotifications:true` plus explicit `operatorPeers`
open IDs. The union of enabled direct/operator peers determines the subscriptions;
merely listing peers without enabling their feature does nothing. No peers means
no private subscription, polling or authorization-recall history reads. Events
with unauthenticated or non-allowlisted senders are dropped before normalization,
health updates and application ingestion. Operator history/recovery is also scoped
to configured peers. Group event conversation IDs must match their subscription.
The composite private listener waits for every configured stream to be ready,
stops sibling streams on exit and reconnects the configured set only.
Avoid configuring the same peer as a
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

## Existing system login and optional private-account storage

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

Existing operating-system credentials are a legitimate external CLI dependency.
Night Bot does not need to own or relocate them to use the current user's DWS
login. Central storage rules apply to Night Bot-managed secrets; they do not turn
third-party system credential storage into a prerequisite for independent login.

`config.accountMode` selects the actual behavior:

| Mode | Default | Behavior |
| --- | --- | --- |
| `system` | Windows | Use the current OS user's existing CLI configuration and protected credentials. Preserve HOME, USERPROFILE, APPDATA/LOCALAPPDATA and explicit inherited DWS_CONFIG_DIR/DWS_KEYCHAIN_DIR selections. No credential copy/export, login, registry edit or encryption changes. |
| `private` | Linux/macOS | Set the official config/keychain paths below the plugin's private account directory. Independent token/config files; macOS still uses a system Keychain DEK. No guarantee of separation from other trusted programs running as the same OS user. |

`system` is also available explicitly on Linux/macOS. Windows `system` works
without an extra opt-in or isolation acknowledgment beyond enabling the channel.
Only an explicit Windows request for `private` fails with
`DWS_PRIVATE_ACCOUNT_UNSUPPORTED_ON_WINDOWS`, because that requested capability
cannot be supplied by the examined CLI. This is a mode-specific error, not a ban
on the Windows channel. Disabled plugins still do nothing.

For example, reuse the current user's authenticated CLI account:

```json
{"channelPlugins":[{"type":"dingtalk-dws","enabled":true,"config":{
  "accountMode":"system","profile":"YOUR_PROFILE","writesAuthorized":false,
  "groups":["YOUR_ROOM_ID"]
}}]}
```

The plugin publishes `accountPolicy` in `channels.plugins.get(channelId)` and
`transport.capabilities.account`: system mode reports `credentialScope:'os-user'`,
`sharedAcrossInstances:true`, `independentLogin:false` and external CLI ownership
of configuration. `accountDirectory` is undefined in system mode; no empty private
vault is created that could imply the system credentials were moved there.
Per-channel state/workspace isolation still holds, but channel IDs and profile
names do not prove separate external accounts.

Multiple system-mode instances can share DWS credential slots, account indexes,
refreshes and current-login/config selection. DWS may use identity-scoped token
entries internally, but profiles or separate HOME/config folders do not provide
an independent Windows keychain. Logging in, switching account, resetting auth or
changing CLI config elsewhere under the same OS user can affect running instances.
Use an explicit profile, keep account-changing CLI operations out of the bot's
runtime workflow, and revalidate the account after a deliberate login switch.
`assistantActorId` binds self-message filtering/readback where configured; it is
not a continuous verification of the CLI's current login identity. If genuinely
independent Windows account lifecycles are needed, use separate OS users or wait
for an upstream production-supported credential namespace. This is an optional
multi-account deployment choice, not a single-account startup requirement.

Neither mode injects plaintext `DWS_*` authentication overrides, a test registry
namespace or DWS_DISABLE_KEYCHAIN into children. Both preserve OS protections and
scope the subprocess temp directory. In system mode, DWS-owned config/keychain
state and any CLI diagnostic/cache files may remain outside Night Bot's `data/`;
Night Bot backup does not include those credentials. A restore needs a separately
available CLI login. No actual Windows execution/account was used in this branch;
unit tests cover the Windows environment and policy selection, and fixture tests
cover registration without copying credentials or contacting an account.
