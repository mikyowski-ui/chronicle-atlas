# TASK: Chronicle Explorer Beta — Dual-Track Sprint (M1 Remediation & M2 Semantic Contracts)

## Context & Objectives
You are acting as a Senior Systems Architect and Data Engineer on **Chronicle Explorer Beta**. 

Milestone 1 successfully proved our linked, multi-panel workspace concept across UN WUP Mexican urban centers without model hallucinations or mutating the 2,282 protected canonical historical files. However, Milestone 1 failed its combined selection + host-year update latency target ($230.3\text{ ms}$ p95 vs. the $\le 100\text{ ms}$ budget), and several hardware/environmental gates remain untested.

We are executing a **Dual-Track Sprint** to resolve performance debt while scaffolding Milestone 2 semantic contracts in parallel. Do not introduce live model inference, dynamic script generation, or Milestone 3 sandboxed code execution in this sprint.

---

## Track 1: Milestone 1 Engine Optimization & Acceptance Gates

### 1. Host-Year Scrub & DOM Latency Remediation
* **Problem:** Combined entity selection + host-year updates benchmark at $230.3\text{ ms}$ p95 under continuous timeline navigation.
* **Objective:** Reduce combined selection + host-year update latency to $\le 100\text{ ms}$ p95.
* **Constraints:**
  * Do not regress isolated selection latency (must stay $\le 50\text{ ms}$ p95; current benchmark is $37.0\text{ ms}$).
  * Maintain $\ge 58\text{ fps}$ during continuous timeline scrub.
  * Optimize DOM lifecycle, reconciliation, and canvas/WebGL redraw triggers. Decouple high-frequency timeline scrubbing ticks from expensive multi-view repaint cycles.

### 2. Environmental & Hardware Verification Gates
* **Mobile Viewport Gate:** Validate responsive layout integrity on mobile viewports down to $375\text{px}$ width without horizontal overflow or clipped inspector panels.
* **WebGL / Basemap Style Reloads:** Verify zero memory leaks or dangling layer listeners when switching MapLibre styles. Active data overlays must seamlessly restore state post-reload.
* **Accessibility:** Ensure strict compliance with `prefers-reduced-motion` across timeline scrubbing, map tweens, and chart animations.

---

## Track 2: Milestone 2 Semantic Layer & Evidence Schemas

### 1. Bounded Query & Dashboard Contracts
* Formulate deterministic TypeScript and Zod schemas for `QueryIntent`, `QueryPlan`, and `DashboardSpecification`.
* Enforce strict declarative boundaries: no `eval()`, no dynamic function construction, no runtime string-to-code execution.
* Restrict query bounds strictly to verified bounding boxes, epoch ranges, and whitelisted indicator keys.

### 2. Dual-Pilot Validation Model
To ensure the semantic layer is resilient across divergent historical data archetypes, all schemas must validate against two contrasting reference fixtures:
* **Modern Statistical Evidence:** The validated UN WUP Mexican urban center dataset (continuous series, metric population units, documented sampling confidence).
* **Premodern Sparse Evidence:** An authored reference fixture for premodern trade nodes (e.g., Silk Road exchange hubs: discontinuous date intervals, qualitative descriptions, spatial uncertainty ranges, and explicit source attribution).

### 3. Epistemic Classification & Normalization
* Schemas must explicitly differentiate between:
  * `attested` (empirically recorded / primary source citation)
  * `interpolated` (mathematically computed across gap years)
  * `modeled` (inferred from proxy distributions or historical demographic models)
* Enforce semantic barriers that prevent automated joins between incompatible indicator classes without explicit normalizers.

---

## Strict Guardrails & Safety Invariants
1. **Protected Files:** The 2,282 canonical baseline files (`/data/canonical/*`, `/core/baselines/*`) are strictly immutable. Do not stage or modify changes in these paths.
2. **Replayability:** Every workspace state mutation must resolve deterministically to original source data hashes.
3. **Typing Standards:** Zero `any` or loose index signatures. All schemas and runtime props must be strictly typed.

---

## Expected Deliverables
1. **Performance Profiling & Patch:** Concrete code optimizations addressing the host-year scrub bottleneck with benchmark verification.
2. **Verification Suite Execution:** Completed test harnesses for the mobile viewport, MapLibre style reloads, and `prefers-reduced-motion` checks.
3. **Contract Definitions:** Fully documented Zod/TypeScript definitions for `DashboardSpecification`, `QueryPlan`, and indicator epistemic statuses.
4. **Premodern Fixture:** A validated static JSON/TypeScript fixture for the premodern sparse evidence pilot.