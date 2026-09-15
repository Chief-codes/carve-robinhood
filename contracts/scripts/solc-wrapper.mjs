#!/usr/bin/env node
// Foundry-compatible standard JSON driver. Prefer this package's pinned compiler;
// CARVE_SOLC_PACKAGE can point at an already installed copy for offline work.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let solc;
try { solc = require('solc'); }
catch {
  if (!process.env.CARVE_SOLC_PACKAGE) throw new Error('Run npm install or set CARVE_SOLC_PACKAGE to solc 0.8.37.');
  solc = require(process.env.CARVE_SOLC_PACKAGE);
}
if (!solc.version().startsWith('0.8.37+')) throw new Error('Compiler must be solc 0.8.37.');
if (process.argv.includes('--version')) process.stdout.write(`solc, the solidity compiler commandline interface\nVersion: ${solc.version()}\n`);
else {
  let input = '';
  for await (const part of process.stdin) input += part;
  process.stdout.write(solc.compile(input));
}
