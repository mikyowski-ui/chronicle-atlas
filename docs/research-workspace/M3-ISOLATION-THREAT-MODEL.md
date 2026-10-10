# M3 isolation threat model — design only

Date: 2026-10-07. Design revision: `m3-isolation-design-v1`.

**Status: DESIGN ONLY; generated execution remains disabled.** This document satisfies deliverable E of the next execution work order. It proposes a boundary and acceptance criteria; it installs no runtime, enables no sandbox, generates no script, and makes no isolation or performance claim. Every execution test below is **NOT RUN**. A separate M3 work order, permission review, selected enforcing environment and successful adversarial evidence are required before execution can be enabled. M2 live-provider authorization and M4 publication are independent gates.

## Scope and invariants

The first possible M3 capability is one justified deterministic transformation of authorized, host-staged records into bounded structured JSON for existing host views. The declarative M1/M2 path remains the default. Generated programs cannot control the DOM, map, timeline, source loaders, catalogue, provider tools, replay importer or publication pipeline. No interactive generated application is included.

This design follows root `AGENTS.md`, sections 5–6 of `IMPLEMENTATION_PLAN.md`, `SEMANTIC-CONTRACTS.md`, `PREMODERN-PILOT.md`, and the supplied next execution prompt. The current source policy retains `modelProcessing:false` and `republication:false`. Sandbox confinement does not change those permissions. Local inference does not bypass them. Existing preview permission must not be interpreted as permission to expose retained records or derived material to a model or to a new processing capability. Review authorized field use before staging; absent an applicable grant, the request fails closed.

Historical authority stays outside this capability: canonical records, mesh and ledger identities, approved narratives, source policies and publication manifests remain unchanged. Derived values require source-bound lineage and approved operations. No inferred borders, trade edges, missing population values, synthetic confidence intervals or fabricated precise dates may enter an accepted result. Validation is not historical certification.

## Protected assets and adversaries

| Protected asset | Required property |
| --- | --- |
| Canonical history, source registry, permissions and publication manifests | Guest has no read access beyond specifically staged records, and no mutation capability. |
| Restricted passages, questions, local studies and source-derived material | No transmission, persistence or export outside the approved per-field purpose. |
| Provider credentials, cookies, user files, environment, operating-system identity | Never staged, inherited, mounted, logged or exposed through an IPC method. |
| Atlas process, DOM, map/camera, host selection/time and last valid revision | No direct guest access; only trusted atomic activation can affect them. |
| Device availability and other workloads | Independently enforced CPU, memory, process, storage, time and output limits. |
| Results, lineage and replay | Bind exact input, code/runtime/policy versions and revision; reject stale or mismatched output. |

Treat generated code, model output, questions, archive fields, data cells and source passages as adversarial, including plausible content bearing injected instructions. An attacker may submit malformed/deep input, exploit a parser or language runtime, exhaust resources, imitate host messages, forge evidence or attempt exfiltration through network, files, diagnostics or rendered output. A compromised guest must be assumed, not only a cooperative script. Host catalogue/validator/supervisor compromise, malicious kernel/hypervisor and physical attacks require separate platform assurance; this design does not claim to withstand them or eliminate timing/covert channels.

## Trust boundaries and permitted interfaces

1. **Browser to trusted coordinator:** a bounded request names registered operation, scope and parent revision. It cannot supply a path, URL, executable dependency, runtime flag or permission override. Existing schema, reference, policy and renderer-capability checks run before any work is admitted.
2. **Coordinator to staging:** trusted code resolves only host-allowlisted registered dependencies and verifies their exact hashes. It authorizes fields and copies a minimal immutable subset. It does not expose a live database, directory, arbitrary SQL endpoint or original source document.
3. **Supervisor to untrusted guest:** a one-use bounded input channel carries the generated artifact and authorized data with a manifest. The guest receives no host object references or ambient authority. The host owns scheduling and budgets; guest messages cannot increase them.
4. **Guest to quarantine:** one bounded byte stream is collected as untrusted output. A guest-reported success, source hash or revision is insufficient. The supervisor reports independently measured termination and resource status.
5. **Quarantine to host renderer:** trusted validation checks output structure, references, semantics, lineage and renderer support. All views are staged before one revision activation. No guest-origin code, markup, URLs or event messages cross this boundary.

The coordinator retains a manifest containing request/generation/parent IDs, authorization-policy version, source and staged-input hashes, transformation identity/hash, runtime image or module hash, budget-policy version and expected output schema. The guest sees only the nonsecret fields required for computation. Host-side matching uses the coordinator's retained copy. Hashes establish byte consistency, not authenticity or permission.

**Permitted input:** finite JSON primitives and arrays conforming to a versioned operation-specific schema, existing stable record references and approved read-only records. A separately authorized generated artifact is an input only to the future execution boundary, never an executable string in the dashboard contract. No archive controls the loader or runtime. There is no package installation or runtime import resolution.

**Permitted output:** one finite JSON result with registered entity/observation references, approved numeric/string fields, explicit missing values, preserved units/date support and per-result lineage. An approved derived number must reproduce from declared inputs using a host-approved transform; otherwise it is not displayed. Text is inert and cannot create executable links or declare itself scholarly reviewed. Reference-only replay omits code, restricted passages, prompts, credentials and underlying values unless a later explicit export policy authorizes them.

## Isolation requirements

- **Credentials:** launch with a cleared environment and explicit nonsensitive allowlist. Do not inherit secrets, proxy settings, home directories, browser profiles, credential agents, cloud metadata credentials, sockets, file descriptors or host service endpoints. Provider calls, if separately authorized in M2, occur outside the guest and cannot be invoked from its IPC protocol. Any supervisor service credential stays outside the guest boundary.
- **Network:** default-deny all outbound and inbound guest communication except the narrow parent input/result channels. Cover DNS, TCP/UDP, loopback, LAN, IPv4/IPv6, metadata endpoints, Unix sockets, named pipes, service discovery, inherited sockets and guest-to-guest communication. This must be enforced outside generated code; removing `fetch` or using a Worker is insufficient. Host source loading must finish before execution and cannot proxy guest requests.
- **Filesystem:** no host mounts or paths, writable application installation, registry access, device interfaces, `/proc`/`/sys` host views, container engine socket or host IPC filesystem. An immutable minimal runtime may be visible inside the boundary. Staged data is a per-job read-only copy, never writable through another alias. Block symlink, hardlink, traversal and archive extraction escapes. Use a bounded private ephemeral scratch area with no executable loading from it.
- **Processes and privilege:** unprivileged identity, no privilege escalation, no debugging other processes, no device/GPU access and no subprocess or thread creation from guest code. Enforce the whole boundary, not just its initial PID. A shared host process is unacceptable if guest termination cannot be guaranteed without harming Atlas.
- **Data minimization:** use fixed host-owned staging names or a read-only capability channel, never caller paths. Fail before execution on missing rights or hashes. Erase the ephemeral boundary after every job; do not reuse it across studies. Do not log raw input/output, exceptions containing source passages or guest stdout. Host telemetry records bounded error codes, hashes, counters and timings only.

## Proposed first-capability budgets

These are **proposed ceilings**, not existing implementation, benchmarks or hardware capacity. A future reviewed policy may lower them. Raising them requires a versioned policy and acceptance rerun; requests and generated content cannot override them. Existing stricter contract limits always win.

| Resource | Proposed hard ceiling / accounting rule |
| --- | --- |
| Request envelope | 64 KiB encoded UTF-8, checked before parse. |
| Generated artifact | 64 KiB encoded UTF-8 or binary module; exactly one artifact, no imports/dependency downloads. |
| Staged records | 10 MiB decoded in aggregate; at most 20,000 observations and 2,000 entities. Count decompressed bytes; accept no compressed guest input. |
| JSON complexity | Depth 14 and 250,000 nodes; finite numbers only; reject duplicate/unsafe keys and cycles before staging. |
| Concurrency and queue | One executing job and at most one waiting job per workspace session; latest input cancels prior work. |
| CPU | 5 CPU-seconds total for the complete guest process tree; no reset on repair, fork or retry. |
| Execution wall time | 10 seconds from supervisor launch request, including guest boot and execution. |
| Application processes/threads | One application process and one application thread; zero guest-spawned children or threads. Trusted runtime helpers, if unavoidable, must have a reviewed fixed count before selection; no unspecified allowance. |
| Guest memory | 256 MiB aggregate guest workload memory, including runtime and staged/output buffers; no swap. If a VM is selected, total guest RAM is at most 512 MiB and the workload's 256 MiB limit still applies. Supervisor accounting is separately bounded and measured. |
| Scratch storage | 16 MiB aggregate private ephemeral storage, at most 64 entries and 1 MiB per file; no persistent guest volume. |
| Output | One JSON result, at most 1 MiB encoded UTF-8 and 2 MiB decoded; at most 20,000 rows, 2,000 entities and five supported views; same depth/node ceilings as input. |
| Diagnostics | 8 KiB aggregate guest diagnostic stream counted independently; never persisted/displayed raw; overflow terminates the job. |
| Host output validation | 2 seconds wall time and 64 MiB additional memory budget; oversize is rejected before parse. Parser/validator execution must itself be bounded outside the UI thread. |
| Termination | Hard termination and resource reclamation within 1 second of cancellation, limit breach or revocation; otherwise the environment fails acceptance. |
| Retention | No guest files/results survive job teardown. An activated host workspace uses existing authorized memory caches; replay remains reference-only, at most 64 KiB and 32 revisions unless its separately versioned stricter contract says otherwise. |

CPU and wall timers belong to the supervisor, use monotonic accounting, and cover the entire job. Guest clock manipulation, a blocked event loop or a promise that never resolves cannot disable termination. Independent host-side byte counters stop output floods without retaining the excess. Boot failure, failed limit installation or unknown helper/resource accounting yields `ISOLATION_UNAVAILABLE`, never a degraded execution path.

## Completion, cancellation and stale results

Admission captures the current parent revision and generation. Cancellation, supersession, navigation/disposal, source-policy revocation and budget breach mark the job nonactivatable before signaling termination. Revoke channels and discard partial output. Kill and reap the entire boundary, remove scratch, and verify owned resources return to baseline. A failed cleanup disables further M3 jobs for that session and reports a structured failure; Atlas keeps its previous usable workspace.

Before activation, recheck generation, parent revision, source/descriptor/policy hashes and current permissions. Then validate every view and source binding and stage the whole result. Activate once, atomically. Empty output, validation failure, a late successful result or a cancelled job must never replace the current workspace or pair new claims with old evidence. Selecting an observation does not implicitly seek to a precise date. Host cursor and analytical window remain separate.

No automatic retry occurs after confinement or resource failure. Any future repair is a new bounded request linked to the failed attempt, with aggregate attempt limits and fresh permissions. It cannot reuse an uncertain boundary or silently relax policy.

## Output validation and rendering

Decode with explicit UTF-8 handling and strict versioned schemas. Reject unknown properties, duplicate keys, nonfinite values, unsupported views/operations, invalid references, embedded code, executable expressions, resource URLs, file/data URLs, callback bodies and binary/markup payloads. Resolve citations only from the host source registry. Check values, units, evidence class, event/composition intervals and lineage against the staged records and approved transforms. Unsupported claims fail or remain explicitly unreviewed according to the operation contract; a successful program exit is not sufficient evidence.

The first capability accepts **no raw HTML or SVG**. If a later work order requires static diagrams, prefer a bounded diagram JSON vocabulary rendered by trusted host code. Raw SVG would require a separately reviewed parser and allowlist: strip/reject scripts, event handlers, `foreignObject`, CSS/imports, animation, links, external/image/font resources and URL-bearing attributes; bound nodes, paths, text and dimensions; reject unsupported features; render the sanitized result in a noninteractive isolated static channel. A sanitizer's existence does not authorize interactive generated code or establish isolation. This optional SVG path remains disabled.

## Required adversarial acceptance evidence

All rows below are **NOT RUN** design requirements. Execute against the exact proposed runtime/build and policy using clearly synthetic fixtures; do not use restricted source content to probe exfiltration. A mocked rejection proves coordinator behavior only. Enforcement tests must run malicious code inside the real proposed boundary and collect outside observations.

| ID | Negative test | Required evidence / outcome |
| --- | --- | --- |
| M3-01 | DNS, public TCP/UDP, IPv4/IPv6, localhost, LAN and metadata access | Independent network capture and test endpoint counters show no guest traffic or response; job fails closed. |
| M3-02 | Unix socket/named-pipe, inherited descriptor and host-service access | Canary host endpoints remain unread/unmodified; descriptor and mount inventory matches allowlist. |
| M3-03 | Read credential env, browser profile, home, host `/proc`, devices and secret files | Synthetic canaries cannot be observed in guest output; guest launch inventory contains no secrets. |
| M3-04 | Write staged input, canonical files, traversal, symlink/hardlink escape | Outside hashes unchanged; writes denied; staging remains immutable even through aliases. |
| M3-05 | Infinite loop, sleep/block, recursive calls and nonterminating native operation | Supervisor CPU/wall limits fire, whole boundary dies within the termination ceiling, Atlas remains responsive. |
| M3-06 | Heap exhaustion, decompression expansion, fork/thread storm and file flood | Hard memory/process/storage limits hold, no host spill/swap or surviving children; no partial activation. |
| M3-07 | Output/log flood, deep JSON, huge strings, duplicate keys and malformed encoding | Byte/complexity checks bound host work and memory; no raw restricted diagnostic retained. |
| M3-08 | HTML/SVG, scripts, external loaders, URL attributes, malicious citation and diagram payload | Rejected before rendering; no resource load, script execution or DOM privilege. Optional SVG tests required only before its distinct gate. |
| M3-09 | Source text saying “ignore policy”; forged IPC/tool calls and budget overrides | Text remains data; no new capability, source-policy change or provider/tool call. |
| M3-10 | Forged source/result hashes, changed units, invented rows, unsupported arithmetic and uncertain-date precision | Independent host validation rejects mismatches and preserves original semantics/lineage. |
| M3-11 | Cancel during staging/execution/validation; A-B-A out-of-order completion | Only the current generation may activate, once; no mixed chart/evidence revision; previous valid state retained. |
| M3-12 | Permission/hash change, expired parent and replay through a changed runtime | Revalidation fails visibly; no silent substitution, execution or new model call. |
| M3-13 | Boundary crash, supervisor timeout, partial output and cleanup failure | Explicit error, no activation; all owned resources reclaimed or M3 disabled for session. |
| M3-14 | Twenty execute/cancel/dispose cycles and cross-study canary reads | No stale channel/file/result survives; owned processes/resources return to measured baseline. Heap trends alone are not a proof. |
| M3-15 | Archive tries to include code, secret, restricted passage or arbitrary loader path | Export/import schema and privacy checks reject it; references-only authorized replay remains usable. |

Record exact test artifact hashes, supervisor/runtime/kernel or hypervisor versions, effective isolation configuration, policy version, raw resource/timing samples, independent network/filesystem canary results and failures. Repeat required tests after runtime, enforcement or policy changes. Functional correctness, historical support, isolation and responsiveness are separate gates; none substitutes for another.

## Unresolved environment decisions and approval evidence

No environment has been selected or provisioned. Candidate labels are options for evaluation, not claims that they satisfy this design.

| Decision | Candidates / constraint | Evidence required before selection |
| --- | --- | --- |
| Execution boundary | Capability-limited interpreter or WebAssembly runtime in an isolated process; hardened OS process/container; dedicated VM/microVM | Demonstrate every denied capability and resource limit with the actual platform. A Worker, language namespace or unrestricted container alone is insufficient. |
| Language and imports | One minimal deterministic transform language/runtime; no dynamic packages | Pin artifact/runtime hashes, audit exposed host calls, define compilation location/budget and prove absence of import/loader escape. Compilation must also be isolated and budgeted if accepting source rather than a module. |
| Host platform | Windows desktop, managed Linux and browser-only deployments have different enforcing facilities | Choose a supported target, prove whole-job hard termination, filesystem/network denial, helper accounting and memory enforcement there. Unsupported targets keep M3 disabled; Linux evidence does not certify Windows/mobile. |
| Supervisor and parser | Trusted isolated supervisor with bounded channels; bounded output validator | Review launch API, input/parser attacks, inherited handles, cleanup and failure recovery; pin dependencies and test supervisor memory/time under hostile output. |
| Data rights | Per-source, per-field local transformation/model transmission/export purposes | Explicit applicable permission review, denied fields omitted, current restrictive flags preserved. Authorization cannot be inferred from a cached file or local model. |
| Generated artifact origin | Separately authorized provider or explicitly supplied artifact | Approved provider, credentials environment and aggregate cost/budget if model generation is used; no credentials in chat/bundle/guest. Offline artifacts prove isolation only, not live generation. |
| Diagrams | Structured host-rendered output preferred; optional sanitized static SVG | Define a finite vocabulary, test parser/renderer/resource limits and citation provenance. Interactive code requires a new threat model. |
| Determinism and replay | Pinned runtime/transformation/input/policy with no time/random/network access | Repeated outputs agree under the declared platform; record any permitted numeric tolerance. Do not promise cross-GPU pixel equality. |

The approval packet must name one justified capability, selected runtime/enforcement configuration, exact permissions and budgets, test receipts, remaining failure modes and rollback/disable behavior. If any hard boundary cannot be demonstrated, M3 stays disabled while independent declarative workspace work continues. This design document closes the missing documentation item only; it does not close M3 implementation, security review, live-generation evaluation or publication gates.

## Separately authorized Phase 5 WASM preview profile

The user adopted the five-phase roadmap and subsequently authorized **Wikidata-only** model processing. This addendum describes the later, distinct `bounded-evidence-svg-1` capability. It does not rewrite the original process/OS design above, certify native OS confinement on Windows, enable the older fixed-operation sandbox for arbitrary code, or expand historical/file model-processing rights. Browser/OS, trusted supervisor, dependency or renderer compromise and timing/covert-channel elimination remain outside this profile's claim.

### Admission and authority

- The capability is an explicitly requested **local record-layout preview**, not a numerical analysis, simulation, inferred route or causal model. A prepared local program is labeled prepared; an imported program remains untrusted. Reading a specification or reopening evidence does not execute it. The user must choose a preview execution control.
- `SandboxedRenderSpecification` is separate from the declarative dashboard vocabulary. Runtime/policy versions, full bundle hash, exact staged-projection hash, program hash, stable record IDs, dimensions and literal resource ceilings are validated before launch. A mismatched source snapshot or modified budget fails closed. Protected historical/mechanism records are not added to the normal preview input path.
- The guest receives a JSON-only, deeply frozen projection of at most 100 records: id, label, variable, value, unit, temporal support and geometry. No provenance document, credential, environment, cookie, host object, live loader or original file handle is staged. Input is bounded to 64 KiB and program source to 16 KiB.
- The model generation path remains Node-only, uses the Phase 4 public-source authorization barrier and bounded token/HTTP budgets, and only proposes code as data. It cannot execute the proposal, change evidence, choose a resource URL or raise the guest limits. Local file contents are not transmitted to Gemini.

### Enforcing boundary and accounting

- Untrusted JavaScript runs inside **QuickJS 0.32.0 compiled to WebAssembly**, with a fresh runtime/context per job. A Worker is used for scheduling and termination, not treated as sufficient isolation by itself. No host functions are registered with QuickJS; module loading always rejects. Browser/Node/network/storage globals are absent, Date and randomness are disabled, and the staged projection is immutable. Host intrinsics are not passed by reference.
- The QuickJS allocator enforces **8 MiB of guest heap** and a 256 KiB guest stack limit. This is not an 8 MiB aggregate browser RSS claim: trusted WebAssembly module, worker transport, XML validation and rendering overhead are distinct. Acceptance must show a small allocation succeeds and a 9 MiB allocation fails even when its hypothetical output would otherwise be valid SVG.
- Guest compilation/evaluation and worker-side quarantine share a **50 ms** monotonic deadline and QuickJS interrupt handler. After the trusted module-ready handshake, the parent starts an independent 50 ms watchdog before posting the job; late replies are rejected and the worker is terminated. Module initialization has a separate 5-second admission deadline. Browser/OS scheduling or background timer throttling can delay reclamation; no over-deadline artifact may be accepted. This is not hard-real-time or OS scheduler certification.
- One worker is owned per client operation. Supersession, cancellation, source change and disposal revoke activation before termination. No guest callback controls the host clock, timeout, heap limit, loader or provider. Cleanup failure disables the affected interpreter; the application never falls back to host `eval`, `Function`, an unrestricted Worker, or permissive CSP.

### Static output quarantine

Only a bounded SVG string is accepted. `@xmldom/xmldom` 0.9.12 parses it after byte/token preflight; DTDs, entities requiring declarations, processing instructions, comments, unsupported namespaces and malformed/recovered XML are rejected. The finite tag/attribute vocabulary excludes scripts, event handlers, foreignObject, CSS/style/class/id hooks, animation, links, images, fonts and resource-bearing attributes. Dimensions, nodes, nesting, paths and numeric attributes are bounded. Mixed text/tspan content that could reorder source text during canonicalization is rejected.

Every painted record group resolves to a staged record ID, and text must match that record's provided fields or explicit unknown-value labels. Arbitrary narrative, invented dates and unsupported quantitative interpretation are not accepted. The SVG is rebuilt into a canonical safe tree and revalidated at the parent boundary; the UI constructs native SVG elements/text rather than inserting raw markup. Only trusted host handlers may translate a validated record mark into the existing revision-checked selection action. No generated event handler or general IPC/tool method is admitted. The evidence table/inspector remains the accessible static alternative on any failure.

### Verification status and pinned dependencies

The actual Node-hosted WASM tests exercise immutable data, constructor/global escape attempts, import denial, loops, stack/heap pressure, output flooding, source/hash/budget mismatches and hostile SVG. Supervisor unit fixtures test orchestration only; they are not isolation proof. Acceptance additionally requires the actual built Chromium worker, outside network canary counters, no script/resource activation, explicit-run behavior, latest-wins/cancellation, 20 complete teardown cycles, source-linked selection and a real opted-in Wikidata-to-Gemini program rendered through the normal controls. Final receipts and limitations must be recorded before marking Phase 5 complete.

Dependencies are exact-pinned: QuickJS bindings 0.32.0 (published 2026-02-16) and XML parser 0.9.12 (published 2026-08-21), both older than the seven-day release-age floor. The Windows manifest-rename EPERM cleared after the user's authorized identical retry; no permissions, release-age settings or build-approval policies were changed.

**Final scoped acceptance: PASS.** `apps/explorer/verification/m5/acceptance.json` links the final build, 541 tests, actual MapLibre/Canvas browser-worker adversarial runs, zero outside guest network-canary requests, and 20 teardown cycles per renderer. Accepted live code from the explicitly authorized Wikidata/Gemini path rendered in 27.1 ms, then 24.1 ms without another model call. Rejected background/font output and a timed-out provider attempt remain recorded; no sanitizer or deadline was weakened. The final loop receipts show fallback/termination notifications around 51 ms due to host scheduling, not accepted late output. The 8 MiB limit is specifically the guest heap; native OS confinement, aggregate RSS, physical GPU/mobile and covert-channel certification remain outside this result.
