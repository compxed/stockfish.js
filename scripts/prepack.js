#!/usr/bin/env node

/// License: MIT

/// Creates the bin dir for packaging.

"use strict";

var fs = require("fs");
var p = require("path");

var srcDir = p.join(__dirname, "..", "src");
var binDir = p.join(__dirname, "..", "bin");

var version = require("../package.json").buildVersion;
var engineMatch = require("./engine-file-matcher")(version);
var buildScript = p.join(__dirname, "..", "build.js");

try {
    fs.mkdirSync(binDir)
} catch (e) {}

console.log(" *");
console.log(" * Building engines...");
console.log(" *");
require("child_process").execFileSync(buildScript,
    ["--all", "--strict-em-check"], {stdio: "inherit"});
require("child_process").execFileSync(buildScript,
    ["--all", "--strict-em-check", "--relaxed-simd", "--only-lite", "--only-lite-single"],
    {stdio: "inherit"});
console.log(" *");
console.log(" * Finished building engines successfully.");
console.log(" *");

/// Remove anything there already.
fs.readdirSync(binDir).forEach(function (filename)
{
    fs.unlinkSync(p.join(binDir, filename));
});

fs.readdirSync(srcDir).forEach(function (filename)
{
    if (engineMatch.test(filename)) {
        fs.cpSync(p.join(srcDir, filename), p.join(binDir, filename));
    }
});
