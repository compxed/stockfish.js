#!/usr/bin/env node

"use strict";

var assert = require("assert");
var api = require("../tools/chesscom-analysis-override/main.js");
var extensionBuild = require("../tools/chesscom-analysis-override/build.js");

function EventTargetFake()
{
    this.listeners = Object.create(null);
}

EventTargetFake.prototype.addEventListener = function (type, listener)
{
    (this.listeners[type] || (this.listeners[type] = [])).push(listener);
};

EventTargetFake.prototype.dispatchEvent = function (event)
{
    (this.listeners[event.type] || []).slice().forEach(function (listener)
    {
        listener(event);
    });
    return true;
};

function createEnvironment(pathname)
{
    var workers = [];
    var objectUrls = [];
    var revokedUrls = [];

    function WorkerFake(url, options)
    {
        EventTargetFake.call(this);
        this.url = String(url);
        this.options = options;
        this.messages = [];
        this.terminated = false;
        workers.push(this);
    }

    WorkerFake.prototype = Object.create(EventTargetFake.prototype);
    WorkerFake.prototype.constructor = WorkerFake;
    WorkerFake.prototype.postMessage = function (message)
    {
        this.messages.push(message);
    };
    WorkerFake.prototype.terminate = function ()
    {
        this.terminated = true;
    };
    WorkerFake.prototype.emit = function (type, data)
    {
        var event = {
            type: type,
            data: data,
            defaultPrevented: false,
            preventDefault: function () { this.defaultPrevented = true; },
        };

        this.dispatchEvent(event);
        return event;
    };

    var document = new EventTargetFake();
    var environment = {
        Blob: function BlobFake(parts) { this.parts = parts; },
        CustomEvent: function CustomEventFake(type, options)
        {
            this.type = type;
            this.detail = options.detail;
        },
        URL: {
            createObjectURL: function ()
            {
                var url = "blob:https://www.chess.com/engine-" + objectUrls.length;

                objectUrls.push(url);
                return url;
            },
            revokeObjectURL: function (url) { revokedUrls.push(url); },
        },
        atob: function (value) { return Buffer.from(value, "base64").toString("binary"); },
        Worker: WorkerFake,
        clearTimeout: clearTimeout,
        document: document,
        location: {
            href: "https://www.chess.com" + pathname,
            pathname: pathname,
        },
        setTimeout: setTimeout,
    };

    return {
        environment: environment,
        objectUrls: objectUrls,
        revokedUrls: revokedUrls,
        WorkerFake: WorkerFake,
        workers: workers,
    };
}

function configure(fixture)
{
    fixture.environment.document.dispatchEvent({
        type: api.CONFIG_EVENT,
        detail: JSON.stringify({
            variants: {
                threaded: {
                    engineSource: "/*! Stockfish.js 19 threaded */ engine();",
                    wasmBase64: Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])
                        .toString("base64"),
                },
                single: {
                    engineSource: "/*! Stockfish.js 19 single */ engine();",
                    wasmBase64: Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])
                        .toString("base64"),
                },
            },
            timeoutMs: 5000,
        }),
    });
}

assert.strictEqual(api.isAnalysisLocation({pathname: "/analysis"}), true);
assert.strictEqual(api.isAnalysisLocation({pathname: "/analysis/game/1"}), true);
assert.strictEqual(api.isAnalysisLocation({pathname: "/play/online"}), false);

var locationObject = {
    href: "https://www.chess.com/analysis",
    pathname: "/analysis",
};
assert.strictEqual(api.isChessComStockfishUrl(
    "/r2/assets-chess-engine/Stockfish/stockfish-18-lite-a1b2c3.js", locationObject), true);
assert.strictEqual(api.isChessComStockfishUrl(
    "https://www.chess.com/r2/assets-chess-engine/Stockfish/stockfish-18.js#net,worker",
    locationObject), true);
assert.strictEqual(api.isChessComStockfishUrl(
    "https://www.chess.com/r2/assets-chess-engine/Torch/torch.js", locationObject), false);
assert.strictEqual(api.isChessComStockfishUrl(
    "https://example.com/r2/assets-chess-engine/Stockfish/stockfish-18.js",
    locationObject), false);
assert.strictEqual(api.isChessComLiteStockfishUrl(
    "/r2/assets-chess-engine/Stockfish/stockfish-18-lite-a1b2c3.js",
    locationObject), true);
assert.strictEqual(api.isChessComLiteStockfishUrl(
    "/r2/assets-chess-engine/Stockfish/STOCKFISH-18-LITE-A1B2C3.JS",
    locationObject), true);
assert.strictEqual(api.isChessComLiteStockfishUrl(
    "/r2/assets-chess-engine/Stockfish/stockfish-18-c3697f2.js",
    locationObject), false);
assert.strictEqual(api.isSingleThreadedUrl(
    "/r2/assets-chess-engine/Stockfish/stockfish-18-lite-single-a7c6773.js",
    locationObject), true);
assert.strictEqual(api.isSingleThreadedUrl(
    "/r2/assets-chess-engine/Stockfish/stockfish-18-lite-6c99585.js",
    locationObject), false);

var threadedSnippet = "new Worker(_n,{workerData:\"em-pthread\",name:\"em-pthread\"})";
assert.strictEqual(extensionBuild.adaptThreadedEngine(threadedSnippet),
    "new Worker(_n+(_n.endsWith(\",worker\")?\"\":\",worker\")," +
    "{workerData:\"em-pthread\",name:\"em-pthread\"})");
assert.throws(function () { extensionBuild.adaptThreadedEngine("new Worker(url)"); },
    /Could not identify/);
assert.throws(function () {
    extensionBuild.adaptThreadedEngine(threadedSnippet + threadedSnippet);
}, /Could not identify/);

var unsafeFixture = createEnvironment("/play/online");
assert.strictEqual(api.install(unsafeFixture.environment), false);
assert.strictEqual(unsafeFixture.environment.Worker, unsafeFixture.WorkerFake);

var movedFixture = createEnvironment("/analysis");
api.install(movedFixture.environment);
configure(movedFixture);
movedFixture.environment.location.pathname = "/play/online";
movedFixture.environment.location.href = "https://www.chess.com/play/online";
var workerAfterNavigation = new movedFixture.environment.Worker(
    "/r2/assets-chess-engine/Stockfish/stockfish-18-lite-abc123.js");
assert.strictEqual(workerAfterNavigation.url,
    "/r2/assets-chess-engine/Stockfish/stockfish-18-lite-abc123.js");

var fixture = createEnvironment("/analysis");
var statuses = [];
fixture.environment.document.addEventListener(api.STATUS_EVENT, function (event)
{
    statuses.push(JSON.parse(event.detail));
});
assert.strictEqual(api.install(fixture.environment), true);
configure(fixture);
configure(fixture);
assert.strictEqual(fixture.objectUrls.length, 2);
assert.deepStrictEqual(fixture.revokedUrls, []);

var ordinary = new fixture.environment.Worker("/assets/ordinary-worker.js");
assert.strictEqual(ordinary.url, "/assets/ordinary-worker.js");
assert.strictEqual(fixture.workers.length, 1);

var fullEngine = new fixture.environment.Worker(
    "/r2/assets-chess-engine/Stockfish/stockfish-18-c3697f2.js");
assert.strictEqual(fullEngine.url,
    "/r2/assets-chess-engine/Stockfish/stockfish-18-c3697f2.js");
assert.strictEqual(fixture.workers.length, 2);

var originalUrl = "/r2/assets-chess-engine/Stockfish/stockfish-18-lite-abc123.js";
var custom = new fixture.environment.Worker(originalUrl);
var received = [];
assert.strictEqual(custom instanceof fixture.environment.Worker, true);
custom.onmessage = function (event) { received.push(event.data); };
custom.postMessage("uci");
assert.strictEqual(fixture.workers.length, 3);
assert.match(fixture.workers[2].url,
    /^blob:https:\/\/www\.chess\.com\/engine-2#blob%3Ahttps%3A[^,]+$/);
fixture.workers[2].emit("message", "info WillOutputEngineDownloadProgress");
assert.strictEqual(statuses.some(function (status) { return status.state === "active"; }),
    false);
fixture.workers[2].emit("message", "id name Stockfish 19");
assert.strictEqual(statuses.some(function (status) { return status.state === "active"; }),
    false);
fixture.workers[2].emit("message", "uciok");
assert.strictEqual(statuses.some(function (status) { return status.state === "active"; }),
    true);
custom.postMessage("setoption name Threads value 2");
custom.postMessage("isready");
fixture.workers[2].emit("message", "readyok");
assert.deepStrictEqual(received,
    ["info WillOutputEngineDownloadProgress", "id name Stockfish 19", "uciok", "readyok"]);
assert.strictEqual(statuses.some(function (status) { return status.state === "active"; }),
    true);
var runtimeError = fixture.workers[2].emit("error");
assert.strictEqual(runtimeError.defaultPrevented, false);
assert.strictEqual(fixture.workers.length, 3);
custom.terminate();
assert.strictEqual(fixture.workers[2].terminated, true);
assert.deepStrictEqual(fixture.revokedUrls,
    ["blob:https://www.chess.com/engine-2"]);

var fallbackFixture = createEnvironment("/analysis/game/live/1/analysis");
api.install(fallbackFixture.environment);
configure(fallbackFixture);
var fallbackProxy = new fallbackFixture.environment.Worker(originalUrl);
fallbackProxy.postMessage("uci");
fallbackProxy.postMessage("isready");
var errorEvent = fallbackFixture.workers[0].emit("error");
assert.strictEqual(errorEvent.defaultPrevented, true);
assert.strictEqual(fallbackFixture.workers.length, 2);
assert.strictEqual(fallbackFixture.workers[0].terminated, true);
assert.strictEqual(fallbackFixture.workers[1].url, originalUrl);
assert.deepStrictEqual(fallbackFixture.workers[1].messages, ["uci", "isready"]);

var setupFallbackFixture = createEnvironment("/analysis");
api.install(setupFallbackFixture.environment);
configure(setupFallbackFixture);
var setupFallbackProxy = new setupFallbackFixture.environment.Worker(originalUrl);
setupFallbackProxy.postMessage("uci");
setupFallbackFixture.workers[0].emit("message", "uciok");
setupFallbackFixture.workers[0].emit("message",
    "info WillOutputEngineDownloadProgress");
setupFallbackProxy.postMessage("setoption name Threads value 2");
setupFallbackProxy.postMessage("isready");
var setupError = setupFallbackFixture.workers[0].emit("error");
assert.strictEqual(setupError.defaultPrevented, true);
assert.strictEqual(setupFallbackFixture.workers.length, 2);
assert.deepStrictEqual(setupFallbackFixture.workers[1].messages,
    ["uci", "setoption name Threads value 2", "isready"]);

var synchronousFallbackFixture = createEnvironment("/analysis");
var WorkingWorker = synchronousFallbackFixture.WorkerFake;
function FailingBlobWorker(url, options)
{
    if (String(url).indexOf("blob:") === 0) {
        throw new Error("blocked blob Worker");
    }
    return new WorkingWorker(url, options);
}
FailingBlobWorker.prototype = WorkingWorker.prototype;
synchronousFallbackFixture.environment.Worker = FailingBlobWorker;
var synchronousStatuses = [];
synchronousFallbackFixture.environment.document.addEventListener(api.STATUS_EVENT,
    function (event) { synchronousStatuses.push(JSON.parse(event.detail)); });
api.install(synchronousFallbackFixture.environment);
configure(synchronousFallbackFixture);
var synchronousFallback = new synchronousFallbackFixture.environment.Worker(originalUrl);
assert.strictEqual(synchronousFallback.url, originalUrl);
assert.strictEqual(synchronousFallbackFixture.revokedUrls.slice(-1)[0],
    "blob:https://www.chess.com/engine-2");
assert.strictEqual(synchronousStatuses.some(function (status)
{
    return status.state === "fallback";
}), true);

var invalidFixture = createEnvironment("/analysis");
api.install(invalidFixture.environment);
invalidFixture.environment.document.dispatchEvent({
    type: api.CONFIG_EVENT,
    detail: JSON.stringify({
        variants: {
            threaded: {
                engineSource: "/*! Stockfish.js 19 threaded */ engine();",
                wasmBase64: Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])
                    .toString("base64"),
            },
            single: {
                engineSource: "/*! Stockfish.js 19 single */ engine();",
                wasmBase64: Buffer.from("not wasm").toString("base64"),
            },
        },
    }),
});
assert.deepStrictEqual(invalidFixture.revokedUrls,
    ["blob:https://www.chess.com/engine-0"]);
var afterInvalidConfig = new invalidFixture.environment.Worker(originalUrl);
assert.strictEqual(afterInvalidConfig.url, originalUrl);

process.stdout.write("Chess.com analysis override tests passed.\n");
