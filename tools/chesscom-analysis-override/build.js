#!/usr/bin/env node

/* License: GPL-3.0 */

"use strict";

var fs = require("fs");
var path = require("path");
var execFileSync = require("child_process").execFileSync;

function argumentValue(argv, name)
{
    var index = argv.indexOf(name);

    return index < 0 ? null : argv[index + 1];
}

function adaptThreadedEngine(source)
{
    var pthreadWorker = /new Worker\(([A-Za-z_$][\w$]*),\{workerData:"em-pthread",name:"em-pthread"\}\)/g;
    var matches = source.match(pthreadWorker);

    if (!matches || matches.length !== 1) {
        throw new Error("Could not identify the Emscripten PThread Worker.");
    }
    return source.replace(pthreadWorker,
        "new Worker($1+($1.endsWith(\",worker\")?\"\":\",worker\")," +
        "{workerData:\"em-pthread\",name:\"em-pthread\"})");
}

function sourceNotice(revision)
{
    if (!/^[0-9a-f]{40}$/.test(revision)) {
        throw new Error("Source revision must be a full Git commit hash.");
    }
    return fs.readFileSync(path.join(__dirname, "SOURCE.txt"), "utf8")
        .replace("@SOURCE_REVISION@", revision);
}

function build(argv)
{
    var toolDir = __dirname;
    var repositoryRoot = path.resolve(toolDir, "../..");
    var engineDir = path.resolve(repositoryRoot,
        argumentValue(argv, "--engine-dir") || process.env.STOCKFISH_ENGINE_DIR || "src");
    var outputDir = path.join(toolDir, "dist");
    var engineOutputDir = path.join(outputDir, "engine");
    var engineFiles = [
        "stockfish-19-lite.js",
        "stockfish-19-lite.wasm",
        "stockfish-19-lite-single.js",
        "stockfish-19-lite-single.wasm",
    ];
    var sourceFiles = ["manifest.json", "main.js", "bridge.js"];

    engineFiles.forEach(function (file)
    {
        var source = path.join(engineDir, file);

        if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
            throw new Error("Missing engine artifact: " + source +
                "\nBuild them with: npm run build-lite && npm run build-single-lite");
        }
    });
    var revision = argumentValue(argv, "--source-revision") ||
        execFileSync("git", ["rev-parse", "HEAD"],
            {cwd: repositoryRoot, encoding: "utf8"}).trim();
    var notice = sourceNotice(revision);
    fs.rmSync(outputDir, {recursive: true, force: true});
    fs.mkdirSync(engineOutputDir, {recursive: true});
    sourceFiles.forEach(function (file)
    {
        fs.copyFileSync(path.join(toolDir, file), path.join(outputDir, file));
    });
    fs.writeFileSync(path.join(outputDir, "SOURCE.txt"), notice);
    fs.copyFileSync(path.join(repositoryRoot, "Copying.txt"),
        path.join(outputDir, "Copying.txt"));
    engineFiles.forEach(function (file)
    {
        var source = path.join(engineDir, file);
        var destination = path.join(engineOutputDir, file);

        if (file === "stockfish-19-lite.js") {
            fs.writeFileSync(destination,
                adaptThreadedEngine(fs.readFileSync(source, "utf8")));
        } else {
            fs.copyFileSync(source, destination);
        }
    });
    return outputDir;
}

if (require.main === module) {
    try {
        process.stdout.write("Extension built in " + build(process.argv.slice(2)) + "\n");
    } catch (error) {
        process.stderr.write(error.message + "\n");
        process.exitCode = 1;
    }
}

build.adaptThreadedEngine = adaptThreadedEngine;
build.sourceNotice = sourceNotice;
module.exports = build;
