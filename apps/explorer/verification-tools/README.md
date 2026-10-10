# Offline verification dependencies

This isolated package pins `happy-dom` 20.14.5 for deterministic virtual DOM acceptance checks. It is not imported by the production application. The application package and lockfile remain unchanged.

Install from this directory with the pinned package manager:

```sh
corepack pnpm install --frozen-lockfile --ignore-scripts
```

After the pinned dependencies are cached, the same installation works without network access:

```sh
corepack pnpm install --frozen-lockfile --ignore-scripts --offline
```

The isolated workspace preserves the application's seven-day minimum release age, untrusted-lockfile policy checks, strict dependency build policy, and local package-store configuration. No install scripts are required. `pnpm-lock.yaml` pins all nine packages and their integrity hashes. Node 20 or newer is required by `happy-dom`; Chronicle's existing Node requirement is stricter.

Virtual DOM checks exercise actual host DOM event wiring and structured state transitions. They do not provide browser layout, paint, font, accessibility-tree, GPU, physical-device, or wall-clock performance evidence. The acceptance runner and report identify those limitations separately.
