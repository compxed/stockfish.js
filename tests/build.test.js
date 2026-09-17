#!/usr/bin/env node

"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var p = require("path");
var vm = require("vm");
var spawnSync = require("child_process").spawnSync;
var root = p.join(__dirname, "..");
var source = fs.readFileSync(p.join(root, "build.js"), "utf8");
var networkSelector = source.slice(source.indexOf("function getNetPaths()"),
    source.indexOf("function alreadyEmbedded("));
var context = {fs: fs, p: p, srcPath: p.join(root, "src"), params: {}, console: console};
vm.runInNewContext(networkSelector, context);
assert.strictEqual(context.getNetPaths()[0].path, "nn-1a298aa575a0.nnue");
context.params.lite = true;
assert.strictEqual(context.getNetPaths()[0].path, "nn-61e7af4bb97d.nnue");

var unsupported = spawnSync(process.execPath, ["build.js", "--ultra-lite"],
    {cwd: root, encoding: "utf8"});
assert.strictEqual(unsupported.status, 1);
assert.match(unsupported.stderr, /--ultra-lite is not available for Stockfish 19/);

var failureRoot = fs.mkdtempSync(p.join(os.tmpdir(), "stockfish-build-failure-test-"));
try {
    fs.mkdirSync(p.join(failureRoot, "src"));
    fs.copyFileSync(p.join(root, "build.js"), p.join(failureRoot, "build.js"));
    fs.copyFileSync(p.join(root, "package.json"), p.join(failureRoot, "package.json"));
    var result = spawnSync(process.execPath, ["build.js", "--all", "--only-standard",
        "--skip-em-check", "--silent"], {cwd: failureRoot, encoding: "utf8"});
    assert.strictEqual(result.status, 1, "--all must propagate a child build failure");
} finally {
    fs.rmSync(failureRoot, {recursive: true, force: true});
}

console.log("Stockfish 19 build tests passed.");
