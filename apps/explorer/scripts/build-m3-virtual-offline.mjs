#!/usr/bin/env node
// Create a self-contained, Node-only virtual acceptance kit. No fetch/install.
console.error('Virtual-DOM bundles are retired. Use corepack pnpm --dir verification-tools run test:e2e after building the application and installing Chromium. Archived M3 mock receipts are historical evidence only.');
process.exitCode = 2;
