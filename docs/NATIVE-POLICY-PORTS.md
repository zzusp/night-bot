# Native policy capabilities without Session fallbacks

Working directory, sandbox policy, approval and permission presets now require
privately bound actor ports. They register no Session projections, inspect no
`eventAt` or `seq`, and never recover authority from `agent.session`, an equal id,
request-supplied mode/audit or model options. Existing official runtime preparation
binds these same ports before exposing the actor. Pi remains the sole owner of
conversation, inference, messages and model context.

| Service | Retired path | Current authority and preserved behavior |
| --- | --- | --- |
| Working directory | workingDirectory projection, session header fallback, old assemble hook and injected user notice | Immutable bound initial directory plus actual native `directory/changed` facts and reliable `admitNotice`. Operations serialize per actor, resolve through the caller's scoped filesystem, check cancellation/live ownership after IO, recover only to the original directory, and publish notices after durable change. A failed notice does not roll back committed cwd. |
| Sandbox policy | sandboxMode/artifactRoot projections, session append/override, `{session}` requests | Privately bound policy snapshot/append port. Official actor requests cannot elevate using `mode`; the separate pure selector still models an explicitly trusted one-call grant. Immutable initial scope, artifact identity/layout and fresh ancestor/symlink validation remain. No-argument `resolve()` is retained only as the deployment-default descriptor for trusted backend calls. |
| Approval | old turn event scan, sessions lookup/flush, piAuthority event-count proof and injected policy-change message | Bound audit supplies live/turn state and typed asked/decided/policy facts. Asked commits before prompting, decided commits before grant; cancellation, late answer revocation, foreign audits, scoped answerers and self-close/close drain remain. `setPolicy(actor, policy)` now returns its native audit commit promise; Host callers should await it. Legacy `setApprovalPolicy(session, ...)` is removed. |
| Presets | permissions projection, legacy creation/fork listener and separate knob event writes | One durable `permission/selected` composite fact via the existing private permission port, retaining custom/tied preset identity, current-only Auto admission and stable initialized/seeded native knobs. Unknown/prototype names, revoked/asynchronous Auto gates and inconsistent snapshots remain rejected before granting. The command awaits the composite commit and returns its visible reply. |

The retired injected policy user messages are not rebuilt as synthetic Pi input.
Policy remains visible through the actual official context and trusted command
reply. Likewise, the obsolete downstream legacy prompt-assembly race fixture is
replaced by current official context sampling after durable cwd changes. No
second message/projection engine is created to preserve that old hook ABI.

The former child/fork preset cases now use existing **Night native business
facts**, persisted in an actual journal before binding/recovery. They preserve
initialized permission state without restoring a cancelled child-agent service
or importing DSH data. Unit fixtures use real PiPersistence native stores and
`createNativeBusinessState` production ports; they do not manufacture a Session,
shadow history or generic event list. Full SDK/wire and actual kernel tests
separately verify these capabilities in the installed Host.

This slice does not change native journal codecs, storage ownership, business
state schemas or portable path bindings. The storage worker's native audit path
sidecar can wrap the same typed ports without policy changes. Attribution and
public source manifests require the integration owner's normal remaining-code
review; package, lockfile and notice changes are outside this slice.

Targeted evidence:

- `/tmp/night-policy-native-combined-final.tap`: 66/66 native policy contracts,
  actual official SDK/approval/preset ports, real approval wire cancellation and
  file preflight/one-call escalation. No skips.
- `/tmp/night-policy-native-single-kernel.tap`: 3/3 actual Linux Single cold
  continuation, readonly restore, explicit reopen and held own-archive restore.
  Approved outer execution; application bubblewrap retained. Windows unverified.

These results are targeted evidence, not a new full default/runtime acceptance.
