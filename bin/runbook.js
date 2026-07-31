#!/usr/bin/env node
'use strict';

// Thin launcher for the Runbook CLI. The implementation lives in
// out/src/cli/index.js so it can share every module with the VS Code extension.
const { main } = require('../out/src/cli/index.js');

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`runbook: ${error && error.message ? error.message : error}\n`);
    process.exitCode = 1;
  });
