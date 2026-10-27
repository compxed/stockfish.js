#!/usr/bin/env node

"use strict";

var assert = require("assert");
var childProcess = require("child_process");
var fs = require("fs");
var path = require("path");

var enginePath = path.resolve(process.argv[2] ||
    path.join(__dirname, "..", "bin", "stockfish-19-lite-single.js"));
var fen = "3r3k/pbq1rpp1/1p2pNnp/2p1P2Q/2BP2R1/2P4R/P4PPP/6K1 b - - 3 24";

assert(fs.existsSync(enginePath),
    "Engine not found: " + enginePath + " (build lite-single or pass its path)");

function runSearch(name, goCommand, stopAfterMs)
{
    return new Promise(function (resolve, reject)
    {
        var engine = childProcess.spawn(process.execPath, [enginePath], {
            stdio: ["pipe", "pipe", "pipe"]
        });
        var output = "";
        var startedAt;
        var stopTimer;
        var timeout = setTimeout(function ()
        {
            finish(new Error(name + " timed out\n" + output));
        }, 10000);

        function finish(error, result)
        {
            clearTimeout(timeout);
            clearTimeout(stopTimer);
            engine.kill();
            if (error) {
                reject(error);
            } else {
                resolve(result);
            }
        }

        function send(command)
        {
            engine.stdin.write(command + "\n");
        }

        engine.on("error", finish);
        engine.stderr.on("data", function (data)
        {
            output += data.toString();
        });
        engine.stdout.on("data", function (data)
        {
            var chunk = data.toString();
            output += chunk;

            if (chunk.indexOf("uciok") !== -1) {
                send("isready");
            }
            if (chunk.indexOf("readyok") !== -1 && !startedAt) {
                send("position fen " + fen);
                startedAt = Date.now();
                send(goCommand);
                if (stopAfterMs) {
                    stopTimer = setTimeout(function ()
                    {
                        send("stop");
                    }, stopAfterMs);
                }
            }
            if (/^bestmove /m.test(output)) {
                finish(null, Date.now() - startedAt);
            }
        });
        engine.on("exit", function (code, signal)
        {
            if (!/^bestmove /m.test(output)) {
                finish(new Error(name + " exited before bestmove (" +
                    (signal || code) + ")\n" + output));
            }
        });

        send("uci");
    });
}

async function main()
{
    var results = [];

    results.push(["movetime", await runSearch("movetime", "go movetime 500")]);
    results.push(["nodes", await runSearch("nodes", "go nodes 250000")]);
    results.push(["stop", await runSearch("stop", "go depth 16", 250)]);

    results.forEach(function (result)
    {
        console.log(result[0] + " returned bestmove in " + result[1] + " ms");
    });
}

main().catch(function (error)
{
    console.error(error.stack || error);
    process.exitCode = 1;
});
