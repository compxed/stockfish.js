#!/usr/bin/env node

/* License: GPL-3.0 */

"use strict";

var fs = require("fs");
var os = require("os");
var path = require("path");
var chromium = require("playwright").chromium;

async function verify()
{
    var extensionDir = path.join(__dirname, "dist");
    var chromePath = process.env.CHROME_PATH;
    var profileDir;
    var context;

    if (!chromePath) {
        throw new Error("Set CHROME_PATH to a Chromium-compatible executable.");
    }
    if (!fs.existsSync(path.join(extensionDir, "manifest.json"))) {
        throw new Error("Build the extension before running the browser check.");
    }
    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf19-chesscom-extension-"));
    try {
        context = await chromium.launchPersistentContext(profileDir, {
            executablePath: chromePath,
            headless: process.env.HEADED !== "1",
            args: [
                "--disable-extensions-except=" + extensionDir,
                "--load-extension=" + extensionDir,
            ],
        });
        context.on("requestfailed", function (request)
        {
            if (request.url().indexOf("chrome-extension://") === 0 ||
                    request.url().indexOf("blob:") === 0) {
                process.stderr.write("Browser request failed: " + request.url() + " " +
                    JSON.stringify(request.failure()) + "\n");
            }
        });
        var page = context.pages()[0] || await context.newPage();
        page.on("console", function (message)
        {
            process.stderr.write("Browser console: " + message.text() + "\n");
        });
        page.on("pageerror", function (error)
        {
            process.stderr.write("Browser page error: " + error.message + "\n");
        });
        await page.route("https://www.chess.com/analysis", function (route)
        {
            return route.fulfill({
                headers: {
                    "Content-Type": "text/html; charset=utf-8",
                    "Cross-Origin-Embedder-Policy": "require-corp",
                    "Cross-Origin-Opener-Policy": "same-origin",
                },
                body: "<!doctype html><meta charset=utf-8><title>Override test</title>" +
                    "<script>" +
                    "window.testResult={results:[],states:[]};" +
                    "var variants=[" +
                    "{name:'threaded',url:'/r2/assets-chess-engine/Stockfish/" +
                        "stockfish-18-lite-test.js',threads:2}," +
                    "{name:'single',url:'/r2/assets-chess-engine/Stockfish/" +
                        "stockfish-18-lite-single-test.js',threads:1}];" +
                    "function runNext(){var variant=variants[testResult.results.length];" +
                    "if(!variant){testResult.done=true;return}" +
                    "var result={name:variant.name,messages:[]};" +
                    "testResult.results.push(result);var w=new Worker(variant.url);" +
                    "w.onmessage=function(e){var m=e.data;result.messages.push(m);" +
                    "if(m==='uciok'){if(variant.threads>1){w.postMessage(" +
                        "'setoption name Threads value '+variant.threads)}" +
                    "w.postMessage('isready')}else if(m==='readyok'&&!result.searched){" +
                    "result.searched=true;w.postMessage('position startpos');" +
                    "w.postMessage('go depth 8')}else if(typeof m==='string'&&" +
                    "m.indexOf('bestmove ')===0){result.bestmove=m;w.terminate();" +
                    "runNext()}};w.onerror=function(){result.error=true;testResult.done=true};" +
                    "w.postMessage('uci')}" +
                    "function start(){if(testResult.started)return;testResult.started=true;" +
                    "runNext()}" +
                    "document.addEventListener('compxed-stockfish-override:status',function(e){" +
                    "var s=JSON.parse(e.detail);testResult.states.push(s);" +
                    "if(s.state==='ready')start()});setTimeout(start,1000);" +
                    "</script>",
            });
        });
        await page.route(/\/Stockfish\/stockfish-18-lite(?:-single)?-test\.js$/,
            function (route)
            {
                return route.fulfill({
                    contentType: "text/javascript",
                    body: "onmessage=function(){postMessage('original engine')}",
                });
            });
        await page.goto("https://www.chess.com/analysis");
        try {
            await page.waitForFunction(function ()
            {
                return window.testResult && window.testResult.done;
            }, null, {timeout: 30000});
        } catch (error) {
            process.stderr.write("Browser state: " + JSON.stringify(await page.evaluate(function ()
            {
                return {
                    badge: Boolean(document.getElementById(
                        "compxed-stockfish-override-status")),
                    installed: Boolean(window.__compxedStockfishOverrideInstalled),
                    isolated: window.crossOriginIsolated,
                    sharedArrayBuffer: typeof SharedArrayBuffer,
                    result: window.testResult,
                };
            })) + "\n");
            throw error;
        }
        var result = await page.evaluate(function () { return window.testResult; });

        if (result.results.length !== 2) {
            throw new Error("The extension did not test both engine variants.");
        }
        result.results.forEach(function (variant)
        {
            if (variant.messages.indexOf("original engine") >= 0 || variant.error) {
                throw new Error(variant.name + " used the original engine.");
            }
            if (!variant.messages.some(function (line)
            {
                return typeof line === "string" &&
                    line.indexOf("id name Stockfish 19") === 0;
            }) || !variant.bestmove) {
                throw new Error(variant.name + " did not complete a Stockfish 19 search.");
            }
            process.stdout.write("Browser override " + variant.name + " search passed: " +
                variant.bestmove + "\n");
        });
        process.stdout.write("States: " + result.states.map(function (status)
        {
            return status.state;
        }).join(" -> ") + "\n");
    } finally {
        if (context) {
            await context.close();
        }
        fs.rmSync(profileDir, {recursive: true, force: true});
    }
}

verify().catch(function (error)
{
    process.stderr.write(error.stack + "\n");
    process.exitCode = 1;
});
