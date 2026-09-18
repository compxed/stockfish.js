#!/usr/bin/env node
/* License: GPL-3.0 */
"use strict";

var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var execFileSync = require("child_process").execFileSync;
var buildExtension = require("../build.js");

function build(argv) {
    var index = argv.indexOf("--engine-revision");
    var engineRevision = index < 0 ? null : argv[index + 1];
    if (!engineRevision || !/^[0-9a-f]{40}$/.test(engineRevision)) {
        throw new Error("Pass --engine-revision with the full commit used to build the engines.");
    }
    var repository = path.resolve(__dirname, "../../..");
    var sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {cwd: repository, encoding: "utf8"}).trim();
    var upstreamRevision = execFileSync("git", ["merge-base", "HEAD", "upstream/master"],
        {cwd: repository, encoding: "utf8"}).trim();
    execFileSync("git", ["diff", "--quiet", "HEAD"], {cwd: repository});
    var original = buildExtension(argv);
    var output = path.join(__dirname, "dist");
    fs.rmSync(output, {recursive: true, force: true});
    fs.cpSync(original, output, {recursive: true});
    var manifest = JSON.parse(fs.readFileSync(path.join(output, "manifest.json"), "utf8"));
    manifest.name += " — manual release test";
    manifest.content_scripts[0].js.unshift("test-recorder.js");
    manifest.content_scripts[1].js.unshift("test-panel.js");
    manifest.web_accessible_resources[0].resources.push("TEST-BUILD.json");
    fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    ["main.js", "bridge.js"].forEach(function (file) {
        var target = path.join(output, file);
        fs.writeFileSync(target, "if (!window.__compxedStockfishTestNative) {\n" +
            fs.readFileSync(target, "utf8") + "\n}\n");
    });
    fs.copyFileSync(path.join(__dirname, "recorder.js"), path.join(output, "test-recorder.js"));
    fs.copyFileSync(path.join(__dirname, "panel.js"), path.join(output, "test-panel.js"));
    var artifacts = fs.readdirSync(path.join(output, "engine")).map(function (file) {
        var bytes = fs.readFileSync(path.join(output, "engine", file));
        return {file: file, bytes: bytes.length,
            sha256: crypto.createHash("sha256").update(bytes).digest("hex")};
    });
    fs.writeFileSync(path.join(output, "TEST-BUILD.json"), JSON.stringify({
        sourceRevision: sourceRevision,
        engineRevision: engineRevision,
        upstreamRevision: upstreamRevision,
        artifacts: artifacts,
        note: "Threaded JavaScript has the same self-Worker URL adaptation as the release extension.",
    }, null, 2) + "\n");
    fs.copyFileSync(path.join(__dirname, "README.md"), path.join(output, "TEST-INSTRUCTIONS.md"));
    execFileSync("git", ["archive", "--format=tar.gz", "--output=" + path.join(output, "SOURCE.tar.gz"), "HEAD"],
        {cwd: repository});
    fs.writeFileSync(path.join(output, "SOURCE.txt"),
        "Manual release test for Stockfish 19 for Chess.com Analysis\n\n" +
        "Distributed under GNU GPL version 3; see Copying.txt.\n" +
        "The complete corresponding source for this test package is included in SOURCE.tar.gz.\n" +
        "Source revision: " + sourceRevision + "\n" +
        "Engine artifact build revision: " + engineRevision + "\n" +
        "https://github.com/compxed/stockfish.js/tree/" + engineRevision + "\n\n" +
        "The diagnostics do not change engine source or compilation flags.\n" +
        "Not affiliated with or endorsed by Chess.com.\n");
    return output;
}

if (require.main === module) {
    try { console.log(build(process.argv.slice(2))); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = build;
