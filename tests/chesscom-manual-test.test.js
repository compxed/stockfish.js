#!/usr/bin/env node
"use strict";

var assert = require("assert");
var install = require("../tools/chesscom-analysis-override/manual-test/recorder.js").install;

async function test(mode) {
    var listeners = {};
    var storage = {};
    storage["compxed-stockfish-manual-test:mode"] = mode;
    function Worker(url, options) {
        this.url = url;
        this.options = options;
        this.listeners = {};
        this.sent = [];
    }
    Worker.prototype.addEventListener = function (type, listener) { this.listeners[type] = listener; };
    Worker.prototype.postMessage = function () { this.sent.push(Array.from(arguments)); return 42; };
    Worker.prototype.terminate = function () { this.stopped = true; };
    var root = {
        Worker: Worker,
        performance: {now: function () { return 100; }},
        sessionStorage: {getItem: function (key) { return storage[key]; }},
        location: {href: "https://www.chess.com/analysis/game/private?token=secret"},
        navigator: {userAgent: "Test browser", hardwareConcurrency: 2},
        document: {
            addEventListener: function (type, listener) { listeners[type] = listener; },
            dispatchEvent: function (event) { this.report = JSON.parse(event.detail); },
        },
        CustomEvent: function (type, options) { this.type = type; this.detail = options.detail; },
        fetch: async function () { throw new Error("offline"); },
        AbortSignal: AbortSignal,
    };
    var recorder = install(root);
    assert.strictEqual(root.__compxedStockfishTestNative, mode === "native");
    assert.throws(function () { root.Worker("engine.js"); }, /new/);
    var worker = new root.Worker("/r2/assets-chess-engine/Stockfish/stockfish-19-lite.js?token=secret#worker", {name: "test"});
    assert.ok(worker instanceof Worker);
    assert.deepStrictEqual(worker.options, {name: "test"});
    var transfer = [];
    assert.strictEqual(worker.postMessage("position startpos moves e2e4", transfer), 42);
    assert.strictEqual(worker.sent[0][1], transfer);
    worker.postMessage("setoption name Threads value 2");
    worker.postMessage("go infinite");
    worker.listeners.message({data: "id name Stockfish 19\nuciok\nreadyok"});
    worker.listeners.message({data: "info depth 12 score cp 30 pv e7e5\nbestmove e7e5 ponder g1f3"});
    worker.listeners.error({message: "test failure"});
    var report = recorder.snapshot();
    assert.strictEqual(report.workers[0].commands.position, 1);
    assert.strictEqual(report.workers[0].requestedThreads, 2);
    assert.strictEqual(report.workers[0].engineName, "Stockfish 19");
    assert.strictEqual(report.workers[0].lastInfo.depth, 12);
    assert.strictEqual(report.workers[0].lastBestmove.move, "e7e5");
    assert.strictEqual(report.workers[0].errors.length, 1);
    assert.ok(!JSON.stringify(report).includes("secret"));
    assert.ok(!JSON.stringify(report).includes("e2e4"));
    assert.ok(!JSON.stringify(report).includes("ponder"));
    await listeners["compxed-stockfish-manual-test:export"]();
    assert.strictEqual(root.document.report.assets[0].error, "offline");
    worker.terminate();
    assert.strictEqual(worker.stopped, true);
    assert.strictEqual(recorder.snapshot().workers[0].terminated, true);
    new root.Worker("/ordinary-worker.js");
    assert.strictEqual(recorder.snapshot().workers.length, 1);
    var failed = new root.Worker("blob:https://www.chess.com/startup-failure");
    failed.listeners.error({message: "engine failed before UCI"});
    assert.strictEqual(recorder.snapshot().workers.length, 2,
        "startup failures must be retained even without an engine name");
}

Promise.all([test("native"), test("override")]).then(function () {
    console.log("Chess.com manual test recorder passed.");
}).catch(function (error) { console.error(error); process.exitCode = 1; });
