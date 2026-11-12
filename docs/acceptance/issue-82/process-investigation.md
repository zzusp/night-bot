# Task process temporary directory and lifecycle evidence

The authorized direct process branch previously returned before the restricted
launch path's task temporary-directory mapping. It could therefore retain a host
TEMP/TMP setting unsuitable for this task. Bound task processes now set TMP, TEMP
and TMPDIR to the task archive's existing tmp directory at the direct launch
boundary, after authorization. Other environment entries and credential binding
remain unchanged. An exclusive create/remove probe checks availability; missing,
non-directory, redirected or unwritable locations fail before spawn. No silent
fallback, directory creation, permission change or credential change is performed.
Windows path spelling case is tolerated, while symlinks/junctions are rejected.

This is an availability preflight, not isolation against an unrestricted process
concurrently changing paths. Full mode retains documented OS-account access.

Compiler fatal output alone is neither direct-process exit nor owned-process-range
exit proof. The lifecycle regression retains separate output, direct result,
range drain and cleanup phases; it never kills a process based on fatal text.

Historical Windows root cause is **not proven**. The earlier desktop readonly
command was rejected before launch by the execution environment's Windows sandbox
backend, so no historical job/process metadata was inspected. No Computer Use,
Windows command, real-message send or deployment was used for this reconstruction.
To attribute that incident requires its launch mode/build, direct exit timestamp,
original Job membership, pipe EOF, cancellation/drain and terminal receipt evidence.
The cloud scripted tests establish code behavior, not historical Windows causality.
