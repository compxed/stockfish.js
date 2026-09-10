#!/usr/bin/env node

"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
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

var failureRoot = fs.mkdtempSync(p.join(os.tmpdir(), "stockfish-build-failure-test-"));
try {
    fs.mkdirSync(p.join(failureRoot, "src"));
    fs.copyFileSync(p.join(root, "build.js"), p.join(failureRoot, "build.js"));
    fs.copyFileSync(p.join(root, "package.json"), p.join(failureRoot, "package.json"));

    result = spawnSync(process.execPath, ["build.js", "--all", "--only-standard",
        "--skip-em-check", "--silent"], {
        cwd: failureRoot,
        encoding: "utf8"
    });
    assert.strictEqual(result.status, 1,
        "--all must propagate the child build's exit status");
} finally {
    fs.rmSync(failureRoot, {recursive: true, force: true});
}

console.log("Stockfish 19 smallnet build tests passed.");
