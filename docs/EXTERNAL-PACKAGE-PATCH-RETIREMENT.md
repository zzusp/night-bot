# External package patch retirement

The removed `sandbox-artifact-policy.mjs` and `pty-package-upgrade.mjs`
commands patched external DSH packages and rewrote a supplied profile's package
manifest/overrides. Their dedicated tests checked tarball identity, package
hashes and manifest compare-and-swap. Neither command had a current Night start,
init, deployment or backup caller. They are retired, without an equivalent
package-patching command.

Current business permission and task artifact boundary contracts remain covered
by `pi-native-policy.test.js`, `pi-official-business-policy.test.js` and the task
artifact tests. Process PTY observation remains covered by
`pi-native-process-pty-observation.test.js`. This retirement does not remove or
claim equivalence to Windows kernel/PTY safety checks. Night's own
`native-maintenance-backup.test.js`, backup/restore implementation and Windows
release/deployment tests remain unchanged.

The old `test/fixtures/native-profile` DSH base bundle is not loaded by the
current Night start/init CLI. It still has explicit repository references:
`verifyNativeProfile()` in `scripts/verify-native-test-profile.mjs` validates
that bundle when the verifier is run directly, and `release-artifacts.mjs`
hashes its manifest as release evidence. The former branch can be retired while
retaining `verifyOfficialPi()`; removing the fixture also requires an explicit
release evidence schema/test update. This patch does neither. Package, lockfile,
suite inventory and provenance manifest changes are coordinated separately.
