#!/usr/bin/env node

"use strict";

var assert = require("assert");
var createEngineFileMatcher = require("../scripts/engine-file-matcher");
var matcher = createEngineFileMatcher("19");

[
    "stockfish-19.js",
    "stockfish-19.wasm",
    "stockfish-19-asm.js",
    "stockfish-19-lite.js",
    "stockfish-19-lite.wasm",
    "stockfish-19-lite-single-relaxed.js",
    "stockfish-19-lite-single-relaxed.wasm",
    "stockfish-19-lite-relaxed-deadbee-part-3.wasm",
    "stockfish-19-single.js",
    "stockfish-19-relaxed.wasm"
].forEach(function (filename)
{
    assert(matcher.test(filename), "Expected package artifact: " + filename);
});

[
    "stockfish-18-lite.js",
    "stockfish-19-asm-relaxed.js",
    "stockfish-19-lite.worker.js",
    "stockfish-19-lite.wasm.map",
    "stockfish-19-lite-notahash.js"
].forEach(function (filename)
{
    assert(!matcher.test(filename), "Unexpected package artifact: " + filename);
});

console.log("package artifact tests passed");
