#!/usr/bin/env node

"use strict";

var assert = require("assert");
var StockfishLoader = require("../loader.js");

function features(overrides)
{
    var result = {
        wasm: true,
        simd: true,
        relaxedSimd: false,
        threads: false,
        hardwareConcurrency: 4,
    };

    Object.keys(overrides || {}).forEach(function (key) { result[key] = overrides[key]; });
    return result;
}

async function testDefaultSelection()
{
    var fast = await StockfishLoader.select({
        baseUrl: "https://example.test/engines",
        features: features({threads: true, relaxedSimd: true}),
    });
    var portable = await StockfishLoader.select({features: features()});

    assert.strictEqual(fast.id, "lite-threaded-relaxed");
    assert.strictEqual(fast.js,
        "https://example.test/engines/stockfish-18-lite-relaxed.js");
    assert.strictEqual(fast.wasm,
        "https://example.test/engines/stockfish-18-lite-relaxed.wasm");
    assert.strictEqual(portable.id, "lite-single");
}

async function testRelativeBaseUrl()
{
    var selected = await StockfishLoader.select({
        baseUrl: "./engines",
        features: features(),
    });

    assert.strictEqual(selected.js, "./engines/stockfish-18-lite-single.js");
    assert.strictEqual(selected.wasm, "./engines/stockfish-18-lite-single.wasm");
}

async function testExactRelaxedInstructionProbe()
{
    var previousWebAssembly = global.WebAssembly;
    var validated = [];

    global.WebAssembly = {
        validate: function (bytes)
        {
            validated.push(Array.prototype.slice.call(bytes));
            return true;
        },
    };
    try {
        assert.strictEqual((await StockfishLoader.detectFeatures()).relaxedSimd, true);
    } finally {
        global.WebAssembly = previousWebAssembly;
    }

    assert(validated.some(function (bytes)
    {
        return bytes.some(function (byte, index)
        {
            return byte === 253 && bytes[index + 1] === 147 && bytes[index + 2] === 2;
        });
    }), "feature detection must probe the NNUE relaxed dot-product opcode");
}

async function testConfigurationFailsBeforeStartingWorker()
{
    var workerCount = 0;

    function UnexpectedWorker() { workerCount += 1; }

    await assert.rejects(StockfishLoader.load({
        Worker: UnexpectedWorker,
        features: features(),
        variants: [
            {id: "duplicate", js: "one.js"},
            {id: "duplicate", js: "two.js"},
        ],
    }), /unique/);
    assert.strictEqual(workerCount, 0);

    await assert.rejects(StockfishLoader.load({
        Worker: UnexpectedWorker,
        features: features(),
        variants: [{id: "fragment", js: "engine.js", wasm: "engine.wasm#other"}],
    }), /invalid WebAssembly path/);
    assert.strictEqual(workerCount, 0);
}

async function testUnusualConfigurationKeysCannotChangeObjectPrototypes()
{
    var polluted = JSON.parse('{"__proto__":{"polluted":true}}');
    var selected = await StockfishLoader.select({
        features: polluted,
        variants: [{id: "constructor", js: "safe.js"}],
    });

    assert.strictEqual(selected.id, "constructor");
    assert.strictEqual(Object.getPrototypeOf(selected.features), Object.prototype);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(selected.features, "__proto__"), true);
    assert.strictEqual({}.polluted, undefined);
    assert.strictEqual(Object.prototype.polluted, undefined);
}

async function testTimedOutWorkerIsCleanedUp()
{
    var instance;

    function SilentWorker(url)
    {
        this.url = url;
        this.listeners = {};
        instance = this;
    }
    SilentWorker.prototype.addEventListener = function (name, listener)
    {
        (this.listeners[name] || (this.listeners[name] = [])).push(listener);
    };
    SilentWorker.prototype.removeEventListener = function (name, listener)
    {
        this.listeners[name] = (this.listeners[name] || []).filter(function (candidate)
        {
            return candidate !== listener;
        });
    };
    SilentWorker.prototype.emit = function (name, event)
    {
        (this.listeners[name] || []).slice().forEach(function (listener)
        {
            listener(event);
        });
    };
    SilentWorker.prototype.postMessage = function () {};
    SilentWorker.prototype.terminate = function () { this.terminated = true; };

    await assert.rejects(StockfishLoader.load({
        Worker: SilentWorker,
        features: features(),
        timeout: 5,
        variants: [{id: "silent", js: "silent.js"}],
    }), function (error)
    {
        assert.strictEqual(error.selectionReport.attempts.length, 1);
        assert.match(error.selectionReport.attempts[0].error.message, /Timed out/);
        return true;
    });

    assert.strictEqual(instance.terminated, true);
    assert.deepStrictEqual(instance.listeners.message, []);
    assert.deepStrictEqual(instance.listeners.error, []);
    assert.deepStrictEqual(instance.listeners.messageerror, []);
    instance.emit("message", {data: "uciok"});
    assert.strictEqual(instance.terminated, true,
        "a late worker message must not revive a timed-out attempt");
}

async function testWorkerFallbackAndReport()
{
    var attempts = [];
    var fallbacks = [];
    var featureTestCalls = 0;

    function FakeWorker(url)
    {
        this.url = url;
        this.listeners = {};
        attempts.push(this);
    }
    FakeWorker.prototype.addEventListener = function (name, listener)
    {
        (this.listeners[name] || (this.listeners[name] = [])).push(listener);
    };
    FakeWorker.prototype.removeEventListener = function (name, listener)
    {
        this.listeners[name] = (this.listeners[name] || []).filter(function (candidate)
        {
            return candidate !== listener;
        });
    };
    FakeWorker.prototype.emit = function (name, event)
    {
        (this.listeners[name] || []).slice().forEach(function (listener)
        {
            listener(event);
        });
    };
    FakeWorker.prototype.postMessage = function (message)
    {
        var worker = this;

        if (message === "uci") {
            setTimeout(function ()
            {
                if (worker.url.indexOf("fast.js") > -1) {
                    worker.emit("error", {message: "bad wasm"});
                } else {
                    worker.emit("message", {data: "id name Stockfish\nuciok"});
                }
            }, 0);
        }
    };
    FakeWorker.prototype.terminate = function () { this.terminated = true; };

    var worker = await StockfishLoader.load({
        Worker: FakeWorker,
        baseUrl: "./engines",
        features: features({relaxedSimd: true}),
        timeout: 100,
        onFallback: function (error, variant)
        {
            fallbacks.push({message: error.message, variant: variant.id});
        },
        variants: [
            {
                id: "fast",
                js: "fast.js",
                wasm: "fast.wasm",
                requires: ["relaxedSimd"],
                priority: 20,
                test: function ()
                {
                    featureTestCalls += 1;
                    return true;
                },
            },
            {id: "safe", js: "safe.js", wasm: "safe.wasm", priority: 10},
        ],
    });

    assert.strictEqual(attempts.length, 2);
    assert.strictEqual(attempts[0].url, "./engines/fast.js#.%2Fengines%2Ffast.wasm");
    assert.strictEqual(attempts[0].terminated, true);
    assert.strictEqual(worker.stockfishVariant.id, "safe");
    assert.deepStrictEqual(fallbacks, [{message: "bad wasm", variant: "fast"}]);
    assert.strictEqual(featureTestCalls, 1,
        "feature and configuration checks should not repeat during fallback");
    assert.deepStrictEqual(worker.stockfishSelection.attempts.map(function (attempt)
    {
        return {variant: attempt.variant, status: attempt.status};
    }), [
        {variant: "fast", status: "failed"},
        {variant: "safe", status: "selected"},
    ]);
}

async function testUnsupportedReport()
{
    await assert.rejects(StockfishLoader.select({
        features: features(),
        variants: [{
            id: "threads-only",
            js: "threaded.js",
            wasm: "threaded.wasm",
            requires: ["threads"],
        }],
    }), function (error)
    {
        assert.deepStrictEqual(error.skipped, [{
            variant: "threads-only",
            reasons: ["missing threads"],
        }]);
        return true;
    });
}

async function main()
{
    await testDefaultSelection();
    await testRelativeBaseUrl();
    await testExactRelaxedInstructionProbe();
    await testConfigurationFailsBeforeStartingWorker();
    await testUnusualConfigurationKeysCannotChangeObjectPrototypes();
    await testTimedOutWorkerIsCleanedUp();
    await testWorkerFallbackAndReport();
    await testUnsupportedReport();
    console.log("loader tests passed");
}

main().catch(function (error)
{
    console.error(error);
    process.exitCode = 1;
});
