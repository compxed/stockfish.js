#!/usr/bin/env node

/// License: MIT

/// Creates the bin dir for packaging.

"use strict";

var p = require("path");

var srcDir = p.join(__dirname, "..", "src");
var binDir = p.join(__dirname, "..", "bin");

var version = require("../package.json").buildVersion;
var packageFiles = require("./package-files");
var buildScript = p.join(__dirname, "..", "build.js");

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

packageFiles.copy(srcDir, binDir, packageFiles.forVersion(version));
