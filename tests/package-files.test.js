#!/usr/bin/env node

"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var p = require("path");
var packageFiles = require("../scripts/package-files");
var expected = [
    "stockfish-19.js",
    "stockfish-19.wasm",
    "stockfish-19-single.js",
    "stockfish-19-single.wasm",
    "stockfish-19-lite.js",
    "stockfish-19-lite.wasm",
    "stockfish-19-lite-single.js",
    "stockfish-19-lite-single.wasm",
    "stockfish-19-lite-relaxed.js",
    "stockfish-19-lite-relaxed.wasm",
    "stockfish-19-lite-single-relaxed.js",
    "stockfish-19-lite-single-relaxed.wasm",
    "stockfish-19-asm.js"
];
var temporaryRoot = fs.mkdtempSync(p.join(os.tmpdir(), "stockfish-package-test-"));
var sourceDirectory = p.join(temporaryRoot, "src");
var destinationDirectory = p.join(temporaryRoot, "bin");

try {
    assert.deepStrictEqual(packageFiles.forVersion("19"), expected);

    fs.mkdirSync(sourceDirectory);
    fs.mkdirSync(destinationDirectory);
    expected.forEach(function (filename)
    {
        fs.writeFileSync(p.join(sourceDirectory, filename), filename);
    });
    fs.writeFileSync(p.join(sourceDirectory, "stockfish-19-relaxed.wasm"), "stale");
    fs.writeFileSync(p.join(destinationDirectory, "old-package-file"), "stale");

    packageFiles.copy(sourceDirectory, destinationDirectory, expected);
    assert.deepStrictEqual(fs.readdirSync(destinationDirectory).sort(), expected.slice().sort());

    fs.unlinkSync(p.join(sourceDirectory, expected[0]));
    assert.throws(function ()
    {
        packageFiles.copy(sourceDirectory, destinationDirectory, expected);
    }, /Missing package artifact: stockfish-19\.js/);
    assert.deepStrictEqual(fs.readdirSync(destinationDirectory).sort(), expected.slice().sort(),
        "validation must finish before replacing an existing package");
} finally {
    fs.rmSync(temporaryRoot, {recursive: true, force: true});
}

console.log("package artifact tests passed");
