#!/usr/bin/env node

"use strict";

var assert = require("assert");
var fs = require("fs");
var p = require("path");
var spawnSync = require("child_process").spawnSync;

var root = p.join(__dirname, "..");
var patchPath = p.join(root, "patches", "stockfish-19-smallnet.patch");
var patch = fs.readFileSync(patchPath, "utf8");
var result = spawnSync("git", ["apply", "--check", patchPath], {
    cwd: root,
    encoding: "utf8"
});

assert.strictEqual(result.status, 0, result.stderr || result.stdout);
assert.match(patch, /EvalFileDefaultName "nn-61e7af4bb97d\.nnue"/);
assert.match(patch, /Bench: 2793281/);

result = spawnSync(process.execPath, ["build.js", "--ultra-lite", "--skip-em-check"], {
    cwd: root,
    encoding: "utf8"
});
assert.strictEqual(result.status, 1);
assert.match(result.stderr, /--ultra-lite is not available.*use --lite instead/);

console.log("Stockfish 19 smallnet build tests passed.");
