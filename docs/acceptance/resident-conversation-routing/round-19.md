# 第 19 轮：Host 关闭失败保权与真实 Job 排空

## 范围与版本

原 worktree/分支/PR，HEAD `6d79b0a0279d3f94f2d72d21f51ab1d654b0f509`，实际受验为未提交协作源码，SG11/SG12仍ACTIVE。本会话仅写既有测试及验收材料；Host/Application/NativeJobs窄修由原Core负责。没有Git写入、CI、合并、部署、真实模型API或渠道、Native ACL/LPAC/Profile操作。全部模型请求仅本机loopback脚本服务，producer为本测试进程内Promise，不冒充真实OS进程或Windows生产链。

证据相对本报告，位于`round-19/`。初批14pin、后续15pin均naturalExit=true/sourceChanged=[]，不是仅以HEAD标识验证。Host始终`2f7b8047eb35e5b49bec789df98f3a849c7e1fb39e675c9204dca08d90164289`，Application始终`72e476414e10db57445d357b20d3cdfedf27c43537298cad6bcdba83e20189fd`。

## 实际批次

| 前缀 | 自然退出；实际注册 | NativeJobs | result SHA256 | stdout SHA256 |
| --- | --- | --- | --- | --- |
| host-application-close | 1；3PASS/1FAIL | b8d4e375 | d8c938bee2e0f17eddee104c482b6f7ad19c3b672851b059e1c9bc173eae658c | 970782d578d5b4b9354d7760186a36979baa575f053de10fae1c638c98eda52b |
| host-durable-job-close | 1；0PASS/1FAIL | b8d4e375 | 50860f94f95adcb0c341eefc4d26bb1a6fdbcc975a9eb4434f3326b5bed1e9f2 | 739bf049b95fafa8e2a71a145510adda9a552ff8f58f4637578a5ceaaf8de797 |
| host-durable-job-inject-fixed | 1；0PASS/1FAIL | b8d4e375 | 1dacb16f73b59eb300ba4a6b1397abde82460943910f4fd7f3649e2627a9084c | 52e4f48c8eeff5514d4386cca112340aa0b24c8a0e78d500bfc76a55826fb087 |
| host-durable-job-final | 0；1PASS/0FAIL | b8d4e375 | 52a6b09a3a9c8075af121d7c59833be7493b855267bb3e2742eacfac98cf32c0 | 4a63df51ef38b8b03ca65b3f366f107417de22f6189615858778c337b19e2bd4 |
| host-ephemeral-drain-fixed | 1；1PASS/1FAIL | 22afd788 | 0c071b0133e2c22e5a16bf2c20898f90d0e2f68ebcc0bd9ab9606230cb471903 | bfc0d51606dbeb34b36b654b2a16457ed2c5c92e4f809ded0c8f19f378b99241 |
| ephemeral-drain-final | 0；1PASS/0FAIL | 22afd788 | 22ee76644ba3671947776802db692ae43e7315e1c2179a6227c825df5c81c7fb | 1a0b6ad4fc677d7021cfbe54f9ce2c5aa9112bc845642c17688dc9648dc0813d |
| host-ephemeral-remove-final | 0；2PASS/0FAIL | deee4fd4 | e43b27d2bac7e4afa57e0c7854d1d8cf56f1b6af9775e94219fa8a731c707333 | 0dcb82475531c709425b38d33572223a2b3ffad93cf37183b9fae7f6e9cbef2c |

每个前缀原对应`-result.json`、`.log`和空`.stderr.log`。本轮最终必要证据保留初批（承载三项准确PASS及原FAIL）与`host-ephemeral-remove-final`；中间五个前缀在最终归档后按SHA精确清理，原结果与失败摘要保留在本报告，不再当作现存附件读取。清单与执行状态见`round-19/host-close-owned-cleanup.json`。

## 已验行为与失败历史

1. 正常Host关闭：真实NativeJobs临时producer已进入cancel但done仍pending时，同一close Promise不提前完成，第二Host被真实安装锁拒绝；done实际结束后close完成，再通过正式Host关闭/重取原安装目录。模型请求为零。
2. stopping/tasks两种实际故障：挂载正式Application/真实loopback HTTP。stopping hook抛出的同一原错误进入聚合链，但HTTP仍停收，tasks/runtime/factory/jobs/process均按顺序尝试；tasks.close抛错时runtime.close不调用，原store与recovery读取仍可用。Host root/sessionPersistence与原owner锁继续保留，二Host被拒绝且owner全文不变。
3. startup：经正式额外插件入口，在最终preset.resolve注入startup原错，factory真实关闭后抛另一个原错。createHost聚合链包含两个准确原对象，继续尝试jobs/process，root/原安装锁保留。不是用旧正常关闭抵扣异常关闭。
4. 原失败注册首批使用ephemeral start却要求durable drainUncertain，finally访问已被dispose的服务又覆盖原断言，日志直接呈现TypeError；该批原样保FAIL，不据被覆盖断言独自推产品结论。随后正式本地SDK调用`shutdown_launch`→真实`startDurable`→typed registered commit，准确绑定`shutdown-durable-call`/jobId；取消抛错后真实settled receipt为producerReported=false，原factory/jobs错误都在Host聚合链中，后续process仍尝试，HTTP拒连、root/锁保留。两次中间FAIL分别来自夹具setup直接取未inject服务，以及finalizer重复等待已失败的memoized factory关闭；只修夹具访问/清理，不降低业务断言。b8d4定点1PASS仅属于该旧源码。
5. Lead/Review从同一现状找出独立真实缺陷：受支持ephemeral producer取消抛错，done仍pending时，旧NativeJobs的!journal早返会跳过drainUncertain，disposeAll可成功/drop，Host可能误放锁；原Jobs注册甚至固定成功预期。此问题与durable刺激不符分开，不能总括为“仅fixture问题”。Core只把非producer证明的不确定标记移到早返前，形成22af。22af下Host的factory/durable/ephemeral场景PASS；原Jobs注册在after钩子因旧fixture logger没有error方法FAIL，仅给本注册补限定已观测uncertain的logger.error断言后，定点1PASS。
6. Review继续核出公开remove绕过：start.run内reentrant kill→真实cancel抛错→failed+uncertain；原remove只验terminal会删除记录，使Host下一快照为空。Core仅在remove保原journalError对象，或以`NIGHT_JOB_PRODUCER_DRAIN_UNCERTAIN`拒绝drainUncertain，形成deee。最终同版2PASS：原Jobs注册实测pending done、drain拒绝/保记录、迟到done不清unknown、不重启；reentrant remove准确拒绝并保记录，真实completed producer仍正常可移除。原Host注册的factory/durable/ephemeral/early-remove四子进程均自然0，实际HTTP拒连、后续process尝试、root/原锁保留、二Host拒绝，子进程退出后父进程通过正式createHost回收死owner锁并正常释放。

错误关闭后的测试卸载只在本进程合成producer真实结束后进行，不重试失败Host.close、不手删live锁、不改数据库或把unknown追认为完成。实际错误仍由断言及原日志保留；仅卸载本测试子进程的fixture。process清理方法的真实调用和子进程自然退出不等于已测任意外部OS producer的join，更不抵Windows LPAC/原Job持久ACK/Resume/ordinary/ConPTY。

## 精确源码与库存

- 初批test`16364e718013a99c560f211109d3878828ee870e5ec0ab6bc2935b07a0a50981`，三项PASS只绑该版。b8d4 durable定点test`166c6ce26ec5c9bc1612c5de5552fd04dec384e98de5a0cd33164587c488b0c4`。
- 最终Host test`3b7e4a08c9704acfd6cdf2050d79d3b353b735e3a74cd8020212b205f54f50f2`；Jobs test`20bc8163cba4bfc1d437f69286bd63f5d5f71c8a44fa4adabd0de20d51a9ab89`；NativeJobs`deee4fd455a7caa5129800cfa745bd3929130fa80d6d08c1f803a6bad2fd7bf5`。完整15pin在最终result，起止无漂移且独立核匹配后已交回Core。归档时发现Python在Windows写入CRLF，随后仅转LF以通过diff检查；真实受验test SHA不改，当前Host/Jobs test SHA分别为25726f302512d20e5a0d37e3febb996cb73de290d02dcea00b2dc7cf760cb899/4c05a97e6036d2a917b11978c1a7bb1239860f9ecaf0a50517d7a510bea92c82。转换计数/前后SHA见test-newline-normalization.json，语法检查0；不为换行重复行为测试，库存current_source与evidence_test分开。
- 只在原`test/pi-official-host-runtime.test.js`新增四注册，迁接原`test/pi-native-jobs.test.js`一注册，不新建测试文件/框架。库存5462→5466，逐完整名称映射五条PASS：初批三条+最终两条，不称五注册在同一最终版本整批全跑。保原(file,case_name,occurrence)与registration_sha256，旧FAIL与中间失败不抹。
- AST520文件/5208注册/未解析0/未登记0仅证明静态登记完整，不等于全量执行通过。库存SHA`b0e7f1e4b14d761b3cdce12641ce05fef85be7d516707cce69e70290ec57a9ba`；matrix277行、增加round_19，SHA`240f3dfd2426db415eb4b05c57075fec14c1e12f80c413b075f5100836d8a07e`。未动作旧项为NOT_RERUN_ROUND_19。

## 清理与剩余边界

本轮风险清理仅精确三个已退出失败子进程的自有临时目录及上述五组已替代附件，先--check零副作用，再--run；保初批与最后两注册最终证据、历史报告及matrix旧列。清理脚本--check实际effects=0，随后--run仅删除这3目录/15附件；独立access逐项核18个精确目标均ENOENT，初批及最终两注册的result/log/stderr与清理记录仍在。未删live锁、未终止进程或清共享Temp。

Native NULL label/SACL控制位qualifier仍待同一最小probe前审，未声称已执行；默认CMD/tini/PID1 docker stop链、可选渠道fake自动接入、Windows生产链及最终同版guards继续按唯一goal推进。Host/App新源结果不追认旧be1镜像，旧容器结果也不追认这些新源。没有全绿report.md，不结束长期目标。
