# Current content and latest change

Implemented on top of `a9db763` (system audit fixes). This feature follows the final request: show memory and Skills content and only the latest content versus the previous content. It does not add a version list, a version archive or an editing action.

## Data and authorization

- Memory updates retain one previous body inside the existing Markdown transaction/redo journal. Repeated updates replace it. Current model read/search/write results omit that body. Forgetting removes current and previous together. Existing entries are not assigned invented older content.
- Automatic reflection retains one previous rendered skill in its existing atomic state file. Active skill reads verify that the actual derived file still matches the authoritative state and current support. Forgetting a supporting record removes the skill and its comparison. Existing task-review evidence remains unchanged; this is not a new task-audit retention policy.
- Installed skills have only a current and last observed snapshot. Startup, filesystem notifications and authorized Host edit/write boundaries collect them. Offline/coalesced intermediate file edits cannot be reconstructed and the UI says so. Deletion, unsafe files and directory removals purge retained bodies. Watcher bursts are coalesced and shutdown drains accepted work.
- Each skill file is bounded at 64 KiB, the retained installed-file snapshot set at 128 entries and the inventory traversal at 10,000 nodes. Excess safe files can still be viewed, without a fabricated prior snapshot. Sensitive credential patterns and non-text/control content are refused before copying. Metadata and usage inspection does not count as model use.
- Body requests are separately authenticated and bound to the list revision. Callers supply an opaque item ID, never a filesystem path. Secrets/path redaction is reapplied at the Web boundary before recomputing the displayed diff. Responses retain the existing no-store policy.
- Linux reads pin every directory with held no-follow descriptors and verify identities before reading and after reading. Windows uses conservative directory/file identity checks; this change does not claim Linux-equivalent hostile concurrent-directory replacement protection on Windows.

## Interface

Explicit 查看内容 opens the read-only panel; 当前内容 and 最近差异 switch views. There is no version selector. Plain text, line signs, change counts, missing-prior states, stale-version recovery, canceled reads and focus restoration use the existing shared controls/tokens. Directory snapshots disclose their observation boundary. Light/dark and 390px cases are represented in the new browser tests.

## Verification

The PR contains the final command results. Feature regressions cover repeated writes, cold reopen, concurrent CAS, interrupted redo recovery, forgotten/deleted content, actual Host writes, automatic reflection, authenticated HTTP, redaction, unsafe paths and deterministic directory swaps before any content read.

Browser launch could not complete in this cloud executor: the installed Chromium fails at its process-singleton socket with `EPERM`, including the approved executor launch. The separate cloud browser cannot reach the loopback test server. Consequently the new Playwright/axe assertions and visual screenshots are **not** claimed as executed. `designmd` is not installed. Production build retains the existing >500 kB bundle-size warning. No live channel, remote model, deployment or CI dispatch was performed.
