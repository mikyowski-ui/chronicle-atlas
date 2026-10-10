# M3 runtime implementation and revised application acceptance

Date: 2026-10-07. The user explicitly authorized an application-level fallback after this environment denied the stronger native runtime's bootstrap operations. The accepted application profile is `m3-application-fixed-v1`. It executes reviewed, fixed synthetic fixtures and a registered synthetic sum operation only. Arbitrary generated code, real source-data execution, live providers and `modelProcessing` remain disabled.

The original `M3-ISOLATION-THREAT-MODEL.md` remains unchanged as the stronger native design. Application acceptance below does not assert that its kernel isolation, aggregate memory/no-swap or independent native-validator requirements passed. The optional implementation of that stronger profile remains fail closed.

## Application profile

`runtime-isolation/application-engine.ts` owns admission, one executing Worker, one latest-wins pending request, termination, quarantine, validation and final authority checks. `application-worker.mjs` owns the fixed operation registry. There is no executable-source argument, import path, caller environment, host callback or budget override in either interface.

Each job gets a fresh Worker and a fresh `node:vm` context built from a null-prototype object. No host objects or functions are injected into that context. The trusted worker serializes already-validated finite numbers into JSON numeric literals for the fixed sum snippet. Code generation from strings and WebAssembly is disabled. The VM removes DOM, Node, network and process APIs and removes ArrayBuffer, DataView, all typed-array globals, shared-memory features and clocks/randomness. Relevant intrinsic prototypes are frozen. Only a primitive string may leave the VM; thrown VM objects are never inspected by trusted code.

This is an application capability guard for a fixed reviewed language, not a security mechanism for arbitrary hostile JavaScript. Node's documentation explicitly cautions that `node:vm` is not a security mechanism, and Worker resource limits apply to V8 allocations rather than all process memory. See the pinned [Node 24.19 VM documentation](https://nodejs.org/download/release/v24.19.0/docs/api/vm.html) and [Worker documentation](https://nodejs.org/download/release/v24.19.0/docs/api/worker_threads.html).

| Control | Selected application limit |
| --- | --- |
| Request | 64 KiB UTF-8 before parsing; depth 14; 8,000 nodes; duplicate/prototype keys rejected |
| Input | At most 2,000 registered synthetic rows; finite values bounded to absolute 10^12 |
| VM execution | 100 ms timeout; microtasks drained under `afterEvaluate` |
| Worker lifecycle | 2,000 ms parent deadline including startup; termination/reap deadline 1,000 ms |
| Worker V8 memory | 32 MiB old generation; 8 MiB young generation; 2 MiB stack |
| Output/diagnostics | 4,096/1,024 bytes; floods rejected; raw diagnostics discarded |
| Concurrency | One active Worker and at most one waiting job; latest wins |
| Retention | Fresh context per job; Worker terminated/reaped before result acceptance; no guest files |

These V8 settings do not bound total process RSS, code/native allocations or arbitrary external memory, and do not claim no-swap enforcement. Exposed external-allocation constructors are removed as an application guard. Actual heap exhaustion is tested with a fixed heap-backed array fixture; no caller can supply its code or allocation size.

Admission binds every row's ID, entity, value, unit and source hash to an authoritative host snapshot. It also requires a current explicit per-field local-transform grant, current parent revision and current policy hash. The authority must identify synthetic isolation fixtures, and row IDs must use the `synthetic-` namespace. Source records with existing restrictive policies are not staged. The JSON contract rejects executable code, URLs, markup, unknown calls and caller-defined budgets.

After the Worker has been reclaimed, the host rechecks generation, disposal, authority, source bindings and permissions, then independently recomputes the numeric sum and count. No failure returns an accepted result. No Atlas/controller activation is wired; the result is a preparatory typed value. Receipts retain runtime/input/result hashes, generation, policy/revision identifiers, counters, times and cleanup status. They omit staged values, source passages, questions, credentials and executable code. The application parser bounds work by bytes/depth/nodes; this profile does not claim the original design's separate 64 MiB native validation enforcement.

## Executed application evidence

Run from `apps/explorer`:

```sh
node --import tsx --test tests/application-isolation.test.ts tests/runtime-isolation.test.ts
node --experimental-transform-types runtime-isolation/application-acceptance.ts
```

The standalone acceptance command requires only Node's built-in modules. It writes `verification/m3/runtime/application-acceptance.json`; runnable packages include the worker, supervisor, parser and contracts at the same relative paths.

The application tests contain 23 passing cases, in addition to 16 strict-contract/native-fail-closed cases. The acceptance report records 19 passing fixture/transform/revocation checks, an A–B–A latest-wins check, and 20 execute/cancel/dispose cycles. Every completed Worker was reaped before acceptance. The report contains individual hashes and raw timing/counter samples; packaged runs are authoritative for final timings.

| Negative case | Executed application result |
| --- | --- |
| Network, DOM, filesystem, environment and process capability probes | Unavailable in the VM; approved negative fixture returns `denied:true` |
| Constructor/eval escape attempts | Rejected by disabled code generation and missing host references |
| Prototype mutations and prototype replacement | Rejected; host prototype unchanged |
| Host/provider/catalogue/publication/map/require/fetch calls | Missing capabilities; reviewed call attempts rejected |
| Infinite loop | `EXECUTION_TIMEOUT`; Worker reclaimed |
| Heap-backed allocation flood | `MEMORY_LIMIT` from actual Worker V8 exhaustion; Worker reclaimed |
| Output/diagnostic flood | `OUTPUT_LIMIT` / `DIAGNOSTIC_LIMIT`; no raw payload persisted |
| Duplicate keys, malformed JSON, markup, invented output | Strict schema/parser or result checks reject output |
| Forged source row/value/hash/unit | Authoritative staging rejects before execution |
| Changed grant, source binding or parent | Revalidation rejects completed result |
| Cancellation, A–B–A completion and disposal | Only latest valid generation returns an accepted result |
| Twenty repeated cycles | Every observed Worker reclaimed; disposed engines reject new work |

These are executed checks against the real application Worker/VM. They are not packet-capture proof or kernel syscall-denial evidence. The original M3-01 through M3-15 matrix contains stronger platform claims; those claims are not substituted with application tests.

## Optional stronger native profile

`worker.c`, `engine.ts` and `build.py` implement the optional Linux x86_64 profile. Its reviewed fixed C worker requires an empty chroot, cleared environment/descriptors, unprivileged identity, `no_new_privs`, locked memory, hard resource limits and a seccomp allowlist restricted to stdin reads, stdout/stderr writes and exit. It has no dynamic imports or generated-code API. File/network/process/allocator syscalls are denied after successful bootstrap. A second sequential, equally confined native validator independently compares canonical output against recomputation from retained staged values.

The selected native limits are stricter than the original proposal: 16 MiB address space per process with locked pages, one CPU-second per process/two in aggregate, zero scratch files, 1.5-second execution plus one-second validation, and the same bounded channels. Native binaries are built locally without downloads; compiler/source/binary hashes are recorded.

```sh
python3 runtime-isolation/build.py
node --experimental-transform-types runtime-isolation/acceptance.ts
```

This environment returns `ISOLATION_UNAVAILABLE:empty-root:1` (operation not permitted), exit 78, before any native fixture executes. The coordinator verifies cleanup and never substitutes a weakened native configuration. Optional native acceptance is **BLOCKED**; all downstream native fixture and native-validator rows remain blocked. The native acceptance report records canary hashes/counters but explicitly states that zero counters when bootstrap is blocked are not confinement proof. No packet capture is claimed. Building or shipping the native implementation does not certify it on another platform.

## Activation and continuation

The revised user-authorized application gates are satisfied by the executable reports. Production `modelProcessing:false`, no live inference, no arbitrary generated-code input, and no historical data staging remain enforced. A future change to any of those invariants requires its own scope, permissions and acceptance. The original stronger native controls can be evaluated independently on a suitable host; they are not prerequisites for the user-authorized fixed-fixture application fallback.
