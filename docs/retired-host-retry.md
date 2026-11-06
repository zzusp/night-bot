# Host retry retirement

`src/native-llm-retry.js` and its old Host ABI tests are removed. Production and
fixture searches found no imports except that deleted test. The default Host
already constructs official Pi AgentSession/SettingsManager retry settings;
there is no second request-error waterfall recovery owner.

The locked Pi 1.5.0 public SettingsManager, AgentSession, classifier and retry-delay
helper own classification, bounded agent retries and provider retry settings.
Night rejects legacy mode/code/jitter policies rather than translating them.
Unbounded `always`, custom downstream recovery, provider/policy-key chains and
`llm/retry[-started]` projection records are retired ABI, not preserved promises.

| Retired test purpose | Current independent proof |
| --- | --- |
| Finite budget and capped delay | `pi-official-retry-settings`: finite budget, SDK delay helper, per-prompt reset and independent sessions |
| Two legacy scheduled/started flush records | Those records no longer exist. `pi-llm-retry-wire`: the real Host reads the durable tool result before the retried HTTP request; official SessionManager owns retry history |
| Journal/authority rejection before more effects | `pi-official-tools`: receipt failure fences later same-batch effects; `pi-official-session`: durable delivery/cold reopen never replays a tool; no synthetic legacy journal proof is accepted |
| Cancellation and unload drain | `pi-official-retry-settings`: public abort ends backoff, prevents another attempt and permits a fresh prompt; ordinary Host/session lifecycle owns teardown |
| Always-mode/downstream callbacks | Intentionally unsupported; native settings tests reject legacy configuration, including always mode |
| Provider/policy budgets and permanent failures | Official permanent-error classification, finite settings and independent sessions; profile settings are supplied to each official session |
| Reentrant downstream owner close | The downstream retry callback API is gone; no Host recovery handler remains to await itself |

Completed tool effects and unknown outcomes remain separate application contracts:
`pi-official-retry-settings` checks a real file write occurs once, preserves its
receipt and tool result, and fences an unknown effect across retries and later
prompts. Retries never authorize replay or reconcile an unknown outcome.

No dependency or notice removal is inferred from removing a filename. The parent
integration owns the remaining source manifest, audit descriptions and notice
cleanup after checking all remaining runtime and test sources.
