#!/usr/bin/env node

"use strict";

var assert = require("assert");
var path = require("path");
var spawnSync = require("child_process").spawnSync;
var root = path.join(__dirname, "..");
var buildScript = path.join(root, "build.js");

var help = spawnSync(process.execPath, [buildScript, "--help", "--no-colors"], {
    encoding: "utf8",
    cwd: root,
});
var incompatible = spawnSync(process.execPath, [
    buildScript,
    "--asm-js",
    "--relaxed-simd",
    "--skip-em-check",
], {
    encoding: "utf8",
    cwd: root,
});

assert.strictEqual(help.status, 0, help.stderr);
assert(help.stdout.indexOf("--relaxed-simd") > -1,
    "build help should document relaxed SIMD");
assert.strictEqual(incompatible.status, 1,
    "relaxed SIMD must reject ASM.js builds before compilation");
assert(incompatible.stderr.indexOf("only available for WebAssembly") > -1,
    "the rejected build should explain the compatibility requirement");

console.log("relaxed SIMD option tests passed");
