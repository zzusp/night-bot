# Web session query regression

## Evidence boundary

The local Windows execution backend rejected the read-only diagnostic command before it ran. No production version, process sample or private journal was retrieved. The following is a cloud reproduction using synthetic content, not a claim about the sole cause of a particular installation's latency.

At main `935785f`, an active execution view polls every 250 ms (previously 2500 ms). Every poll reads and validates the whole native journal, builds the Pi projection, redacts/projects the whole public history, and hashes its authorized prefix. The live path additionally projected the whole history again before discarding all non-live rows. This synchronous work shares the HTTP server's event loop: another API need not query history to be delayed by it. Common HTTP authentication is a bounded in-memory session map; the investigated changes did not add a disk operation there.

## First-stage correction

- Project committed rows once, carrying the exact pending-tool-call pairing map into the bounded live suffix. Duplicate native tool IDs remain ambiguous; unknown/orphan results do not gain public output authority.
- Yield between groups of 32 committed entries so unrelated HTTP work can proceed. All rows are still validated; nothing is silently dropped or treated as authorized from a cached last-entry ID.

A synthetic 5000-entry snapshot with roughly 1000 text characters per entry and one live response, excluding filesystem/native journal decode, measured in an independent three-run comparison:

| Measurement | Previous main | After projection correction |
| --- | --- | --- |
| Whole projection | 680–906 ms | 306–371 ms |
| Maximum 1 ms timer gap | 680–907 ms | 66–78 ms |

These are non-gating cloud observations, not portable timing assertions. The first timer callback firing after about 2 ms is **not** the maximum event-loop delay. Native decode, a single very large text/entry, and full-prefix checkpoint serialization still have costs. Reducing high-frequency full-history reads is a separate necessary step.

## Safety checks

The public session tests cover identity, committed-tail barriers, redaction, source validation, pagination/checkpoint changes, repeated sources and original message preservation. A fairness regression asserts that an unrelated event-loop turn runs before a long projection finishes without losing any row. Live tests cover exact official call pairing, live invalidation, cross-block secret filtering and native SDK phase updates.

## Actual HTTP + native journal load

`node scripts/benchmark-web-http.mjs 5000 4 5000` creates an isolated, synthetic native Pi journal (14.45 MB), runs the real Web HTTP server and real strict native decoder, and simulates four execution-view pollers. The live buffer is synthetic; no real model is called. An unrelated authenticated `/api/session` probe runs alongside the history reads.

| Measurement | main `935785f` | Projection correction only |
| --- | --- | --- |
| Ordinary API p50 | 10.5 ms | 6.9 ms |
| Ordinary API p95 | 894 ms | 222 ms |
| Maximum event-loop timer gap | 1072 ms | 455 ms |
| Ordinary API samples during 5-second probe window | 8 | 48 |
| Poll failures | 0 | 0 |

This small synthetic sample demonstrates cross-endpoint interference, not a production percentile guarantee. It also shows why yielding public projection alone is insufficient: the native decoder and checkpoint serialization remain synchronous. Repeat several times in a quiet environment for capacity planning.

## Separate light lane

Active views now poll a bounded live response every 250 ms; a full committed-history refresh is scheduled every 2500 ms. A changed journal or ended native output triggers immediate history catch-up. Concurrent reads stay single-flight in the view. Visibility changes stop polling; identity/secret failures clear displayed data rather than retaining it as current.

A full strict read issues a short-lived random proof scoped to the browser session, endpoint, exact native identity and current secret set. It holds only bounded pending-call pairing metadata (not cached public history). Light reads verify the journal's actual bytes and file identity using a streamed SHA-256 with descriptor/path checks; only simultaneous digest reads are coalesced. A completed digest is never reused. Changed/replaced/torn files cause a full refresh. Authorization and secret state are checked again before return; expired/evicted proofs cannot return live text.

This deliberately remains O(journal bytes) I/O. It avoids native decode, Pi context reconstruction, historical public projection and checkpoint serialization on every 250 ms poll. It is not an O(1) cache, and the periodic full decode can still delay the event loop.

The same 14.45 MB/4-client HTTP fixture with `node scripts/benchmark-web-http.mjs 5000 4 5000 live` measured p50 **1.03 ms**, p95 **8.96 ms**, 133 ordinary API probes, 46 polling requests and zero failures. Maximum timer gap remained **333 ms**, including full refreshes. Production Windows timings still require onsite measurement; these are synthetic cloud observations.
