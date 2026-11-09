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

当前 `test/fixtures/native-profile/package.json` 是 `night-bot-official-pi-test-profile`，声明 `private:true`，依赖仅为三个固定 `1.5.0` 官方 Pi 包；它不是旧 DSH bundle，不能因目录名而删除。当前 Night start/init 不以该测试 fixture 作为运行配置。

`scripts/verify-native-test-profile.mjs` 提供 `verifyOfficialPi()`，核固定版本与公开 API；直接 CLI 也只调用这一官方 Pi 核验入口，不存在 `verifyNativeProfile()`。同文件的 `collectSourceEvidence()` 保留锁文件、纯 Pi profile 的 SHA256 与官方 Pi 版本证据。旧三包 publisher 与这些有效核验职责分开处置，不通过删除测试 profile 或证据 helper 隐藏依赖。当前清理和实际验证结果以[唯一验收入口](acceptance/resident-conversation-routing/goal.md)为准，静态来源核对不等于本轮全量测试通过。

The old DSH browser registry test and `scripts/build-web-client.mjs` are also retired: the initial generic core migration explicitly excluded `client.js` and `web-client.js`, and neither current start/init nor package scripts invoke that builder. Those three historical UI/build assertions already referenced absent source artifacts; they are not counted as passing browser validation. No current application UI or HTTP API is removed by this retirement.
