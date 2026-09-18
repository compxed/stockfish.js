#!/usr/bin/env node
/* License: GPL-3.0 */
"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var chromium = require("playwright").chromium;

function controlledPage() {
    window.manualTestResult = {variants: [], statuses: []};
    var result = window.manualTestResult;
    var nativeMode = window.__compxedStockfishTestNative;
    document.addEventListener("compxed-stockfish-override:status", function (event) {
        var status = JSON.parse(event.detail);
        result.statuses.push(status.state);
        if (status.state === "ready") start();
    });
    function start() {
        if (result.started) return;
        result.started = true;
        next();
    }
    function next() {
        var index = result.variants.length;
        if (index === 2) { result.done = true; return; }
        var variant = {name: index ? "single" : "threaded", burst: false};
        result.variants.push(variant);
        var worker = new Worker("/r2/assets-chess-engine/Stockfish/stockfish-19-lite" +
            (index ? "-single" : "") + "-test.js");
        worker.onerror = function (event) { variant.error = event.message || "Worker error"; result.done = true; };
        worker.onmessage = function (event) {
            var line = event.data;
            if (line === "uciok") {
                worker.postMessage("setoption name Threads value " + (index ? 1 : 2));
                worker.postMessage("isready");
            } else if (line === "readyok") {
                worker.postMessage("position startpos");
                worker.postMessage("go depth 4");
            } else if (typeof line === "string" && /^bestmove /.test(line)) {
                if (!variant.burst) {
                    variant.burst = true;
                    worker.postMessage("go infinite");
                    for (var move = 0; move < 20; move++) {
                        worker.postMessage("position startpos moves " + (move % 2 ? "e2e4" : "d2d4"));
                        worker.postMessage("go depth 8");
                    }
                    worker.postMessage("position fen 7k/8/5KQ1/8/8/8/8/8 w - - 0 1");
                    worker.postMessage("go depth 4");
                } else if (nativeMode || /^bestmove g6g7(?:\s|$)/.test(line)) {
                    variant.bestmove = line;
                    worker.terminate();
                    next();
                }
            }
        };
        worker.postMessage("uci");
    }
    if (nativeMode) start();
    else setTimeout(start, 1000);
}

async function verify() {
    if (!process.env.CHROME_PATH) throw new Error("Set CHROME_PATH.");
    var profile = fs.mkdtempSync(path.join(os.tmpdir(), "sf19-manual-test-"));
    var extension = path.join(__dirname, "dist");
    var context;
    var nativeScript = "onmessage=function(e){if(e.data==='uci'){postMessage('id name Stockfish 19 test fixture');" +
        "postMessage('uciok')}else if(e.data==='isready'){postMessage('readyok')}else if(/^go /.test(e.data)){" +
        "postMessage('info depth 4 score cp 20 pv e2e4');postMessage('bestmove e2e4')}}";
    try {
        context = await chromium.launchPersistentContext(profile, {
            executablePath: process.env.CHROME_PATH,
            headless: true,
            acceptDownloads: true,
            args: ["--disable-extensions-except=" + extension, "--load-extension=" + extension],
        });
        var page = context.pages()[0] || await context.newPage();
        page.on("pageerror", function (error) { console.error(error.message); });
        await page.route("https://www.chess.com/analysis", function (route) {
            return route.fulfill({
                headers: {"Content-Type": "text/html", "Cross-Origin-Embedder-Policy": "require-corp",
                    "Cross-Origin-Opener-Policy": "same-origin"},
                body: "<!doctype html><title>Controlled manual test</title><script>(" +
                    controlledPage.toString() + ")();</script>",
            });
        });
        await page.route(/\/Stockfish\/stockfish-19-lite(?:-single)?-test\.js$/, function (route) {
            return route.fulfill({contentType: "text/javascript", body: nativeScript,
                headers: {"Cross-Origin-Embedder-Policy": "require-corp"}});
        });
        await page.goto("https://www.chess.com/analysis");
        for (var stage = 0; stage < 3; stage++) {
            var mode = stage === 1 ? "native" : "override";
            await page.waitForFunction(function () {
                return window.manualTestResult && window.manualTestResult.done;
            }, null, {timeout: 30000});
            var result = await page.evaluate(function () { return window.manualTestResult; });
            if (result.variants.some(function (variant) { return variant.error; })) {
                console.error("Controlled page state: " + JSON.stringify(result));
            }
            assert.strictEqual(result.variants.length, 2);
            result.variants.forEach(function (variant) {
                assert.ok(!variant.error, variant.error);
                assert.ok(variant.bestmove);
            });
            var panel = page.locator("#compxed-stockfish-manual-test");
            await panel.locator("input").first().check();
            var downloadPromise = page.waitForEvent("download");
            await panel.getByRole("button", {name: "Eksportuj JSON"}).click();
            var download = await downloadPromise;
            var report = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
            assert.strictEqual(report.mode, mode);
            assert.strictEqual(report.workers.length, 2);
            assert.strictEqual(report.manualChecks[0], true);
            assert.strictEqual(report.manualChecks[1], false);
            assert.strictEqual(report.workers[0].requestedThreads, 2);
            assert.strictEqual(report.workers[1].requestedThreads, 1);
            report.workers.forEach(function (worker) {
                assert.ok(/^Stockfish 19/.test(worker.engineName));
                assert.strictEqual(/test fixture/.test(worker.engineName), mode === "native");
                assert.ok(worker.uciok && worker.readyok && worker.infoCount);
                assert.ok(worker.commands.position >= 22);
                assert.deepStrictEqual(worker.errors, []);
            });
            assert.strictEqual(report.build.artifacts.length, 4);
            if (mode === "native") {
                assert.strictEqual(await page.evaluate(function () {
                    return Boolean(window.__compxedStockfishOverrideInstalled);
                }), false);
                assert.strictEqual(report.assets.length, 2);
                report.assets.forEach(function (asset) { assert.match(asset.sha256, /^[a-f0-9]{64}$/); });
                assert.deepStrictEqual(report.statuses, []);
            } else {
                assert.ok(report.statuses.some(function (status) { return status.state === "active"; }));
                assert.ok(!report.statuses.some(function (status) {
                    return status.state === "fallback" || status.state === "error";
                }));
                report.workers.forEach(function (worker) {
                    assert.strictEqual(worker.lastBestmove.move, "g6g7");
                });
            }
            console.log("Controlled manual package: " + mode + " searches, burst, panel, JSON passed.");
            if (stage < 2) {
                await Promise.all([
                    page.waitForEvent("domcontentloaded"),
                    panel.getByRole("button", {name: mode === "native" ?
                        "Przełącz na nasz silnik" : "Przełącz na Chess.com"}).click(),
                ]);
            }
        }
    } finally {
        if (context) await context.close();
        fs.rmSync(profile, {recursive: true, force: true});
    }
}
verify().catch(function (error) { console.error(error); process.exitCode = 1; });
