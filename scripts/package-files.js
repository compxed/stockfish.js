#!/usr/bin/env node

/// License: MIT

"use strict";

var fs = require("fs");
var p = require("path");

function forVersion(version)
{
    var stem = "stockfish-" + String(version);

    return [
        stem + ".js",
        stem + ".wasm",
        stem + "-single.js",
        stem + "-single.wasm",
        stem + "-lite.js",
        stem + "-lite.wasm",
        stem + "-lite-single.js",
        stem + "-lite-single.wasm",
        stem + "-lite-relaxed.js",
        stem + "-lite-relaxed.wasm",
        stem + "-lite-single-relaxed.js",
        stem + "-lite-single-relaxed.wasm",
        stem + "-asm.js"
    ];
}

function copy(sourceDirectory, destinationDirectory, filenames)
{
    filenames.forEach(function (filename)
    {
        var sourcePath = p.join(sourceDirectory, filename);

        if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
            throw new Error("Missing package artifact: " + filename);
        }
    });

    fs.mkdirSync(destinationDirectory, {recursive: true});
    fs.readdirSync(destinationDirectory).forEach(function (filename)
    {
        fs.unlinkSync(p.join(destinationDirectory, filename));
    });

    filenames.forEach(function (filename)
    {
        fs.copyFileSync(p.join(sourceDirectory, filename),
            p.join(destinationDirectory, filename));
    });
}

module.exports = {
    copy: copy,
    forVersion: forVersion
};
