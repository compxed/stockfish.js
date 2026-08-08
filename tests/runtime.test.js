#!/usr/bin/env node

"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");
var initEngine = require("../index.js");
var fixtures = path.join(__dirname, "fixtures");
var modernEnginePath = path.join(fixtures, "runtime-engine-modern.js");
var legacyEnginePath = path.join(fixtures, "runtime-engine-legacy.js");
var errorEnginePath = path.join(fixtures, "runtime-engine-error.js");
var pendingEnginePath = path.join(fixtures, "runtime-engine-pending.js");

function processListenerCounts()
{
    return {
        uncaughtException: process.listenerCount("uncaughtException"),
        unhandledRejection: process.listenerCount("unhandledRejection")
    };
}

function assertProcessListenerCounts(expected, message)
{
    assert.strictEqual(process.listenerCount("uncaughtException"), expected.uncaughtException,
        message + " (uncaughtException)");
    assert.strictEqual(process.listenerCount("unhandledRejection"), expected.unhandledRejection,
        message + " (unhandledRejection)");
}

async function testPromiseApi()
{
    var listenersBefore = processListenerCounts();
    var originalFetch = globalThis.fetch;
    var originalXMLHttpRequest = globalThis.XMLHttpRequest;
    var engine = await initEngine(modernEnginePath);

    try {
        assert.strictEqual(globalThis.fetch, originalFetch, "initialization must preserve global fetch");
        assert.strictEqual(globalThis.XMLHttpRequest, originalXMLHttpRequest,
            "initialization must preserve global XMLHttpRequest");
        assert.strictEqual(engine.module === engine, false, "the public facade must not be replaced");
        assert.strictEqual(engine.receivedWasmBinary.toString(), "test wasm modern fixture\n");
        assertProcessListenerCounts({
            uncaughtException: listenersBefore.uncaughtException + 1,
            unhandledRejection: listenersBefore.unhandledRejection + 1
        }, "a live module should own its Emscripten process listeners");

        assert.strictEqual(await engine.sendCommand("uci"), "uci");
        assert.deepStrictEqual(engine.commands[0].argumentsList, ["uci"]);
        await assert.rejects(engine.sendCommand("throw"), /fixture command failed/);
        await assert.rejects(engine.sendCommand("reject"), /fixture command rejected/);
        assert.strictEqual(await engine.sendCommand("isready"), "isready",
            "a command error must not poison later commands");
    } finally {
        engine.dispose();
    }

    var lateMessages = [];
    engine.listener = function (line) { lateMessages.push(line); };
    assert.doesNotThrow(function () { engine.emit("late output"); },
        "late module output after dispose must be ignored safely");
    assert.deepStrictEqual(lateMessages, []);

    assert.strictEqual(engine.terminateCalls, 1);
    assert.deepStrictEqual(engine.commands[engine.commands.length - 1].argumentsList, ["quit"]);
    assertProcessListenerCounts(listenersBefore, "dispose must release only this module's listeners");
    await assert.rejects(engine.sendCommand("isready"), /has been disposed/);
    engine.dispose();
    assert.strictEqual(engine.terminateCalls, 1, "dispose must be idempotent");
}

function testInvalidInitializationOptions()
{
    assert.throws(function ()
    {
        initEngine(modernEnginePath, {initializationTimeout: 0});
    }, /must be a positive number/);
    assert.throws(function ()
    {
        initEngine(modernEnginePath, []);
    }, /options must be an object/);
}

async function testStableCallbackFacade()
{
    var listenersBefore = processListenerCounts();
    var returned;
    var pendingCommand;
    var messages = [];
    var callbackEnginePromise = new Promise(function (resolve, reject)
    {
        returned = initEngine(modernEnginePath, function (err, engine)
        {
            if (err) {
                reject(err);
            } else {
                resolve(engine);
            }
        });
        returned.listener = function (line)
        {
            messages.push(line);
        };
        pendingCommand = returned.sendCommand("uci");
    });
    var callbackEngine = await callbackEnginePromise;

    assert.strictEqual(returned, callbackEngine,
        "the callback and immediate return value must be the same object");
    assert.strictEqual(await pendingCommand, "uci", "commands issued before ready must wait");
    callbackEngine.emit("fixture output");
    assert.deepStrictEqual(messages, ["fixture output"],
        "a listener installed before ready must receive module output");
    await callbackEngine.sendCommand("quit");
    assert.strictEqual(callbackEngine.terminateCalls, 1);
    assertProcessListenerCounts(listenersBefore, "quit must release module listeners");
    await assert.rejects(callbackEngine.sendCommand("isready"), /has been disposed/);
}

async function testLegacyFactory()
{
    var engine = await initEngine(legacyEnginePath);
    var messages = [];

    engine.listener = function (line)
    {
        messages.push(line);
    };
    engine.emit("legacy output");
    assert.deepStrictEqual(messages, ["legacy output"]);
    assert.strictEqual(engine.receivedWasmBinary.toString(), "test wasm legacy fixture\n");
    assert.strictEqual(await engine.sendCommand("uci"), "uci");
    engine.dispose();
    assert.strictEqual(engine.terminateCalls, 1);
}

async function testRejectedInitialization()
{
    var listenersBefore = processListenerCounts();

    await assert.rejects(initEngine(errorEnginePath), function (err)
    {
        return err instanceof Error &&
            err.message.indexOf(errorEnginePath) > -1 &&
            err.message.indexOf("fixture initialization failed") > -1;
    });
    assertProcessListenerCounts(listenersBefore, "a rejected factory must release its listeners");

    await new Promise(function (resolve, reject)
    {
        var returned = initEngine(errorEnginePath, function (err, engine)
        {
            try {
                assert(err instanceof Error);
                assert.strictEqual(engine, returned);
                assert(err.message.indexOf("fixture initialization failed") > -1);
                resolve();
            } catch (assertionError) {
                reject(assertionError);
            }
        });

        assert(returned && typeof returned.dispose === "function");
    });
    assertProcessListenerCounts(listenersBefore,
        "a rejected callback initialization must release its listeners");
}

async function testInitializationTimeout()
{
    var listenersBefore = processListenerCounts();
    var lateMessages = [];
    var returned;

    await new Promise(function (resolve, reject)
    {
        returned = initEngine(pendingEnginePath, {initializationTimeout: 20},
            function (err, engine)
            {
                try {
                    assert.strictEqual(engine, returned);
                    assert(err instanceof Error);
                    assert(err.message.indexOf("initialization timed out after 20 ms") > -1);
                    resolve();
                } catch (assertionError) {
                    reject(assertionError);
                }
            });
        returned.listener = function (line) { lateMessages.push(line); };
    });

    await new Promise(function (resolve) { setTimeout(resolve, 50); });
    assert.strictEqual(returned.module.terminateCalls, 1,
        "a timed-out module must be terminated");
    assert.deepStrictEqual(lateMessages, [],
        "a factory that resolves after timeout must not reach the public listener");
    assertProcessListenerCounts(listenersBefore,
        "an initialization timeout must release process listeners");
    assert.doesNotThrow(function () { returned.module.emit("late output"); },
        "late output after an initialization timeout must be ignored");
    await assert.rejects(returned.sendCommand("uci"), /timed out/);
}

async function testRepeatedAndConcurrentInitialization()
{
    var listenersBefore = processListenerCounts();
    var first = await initEngine(modernEnginePath);

    first.dispose();
    assertProcessListenerCounts(listenersBefore,
        "the first initialization must clean up before the loader is reused");

    var engines = await Promise.all([
        initEngine(modernEnginePath),
        initEngine(modernEnginePath)
    ]);

    assert.notStrictEqual(engines[0].module, engines[1].module,
        "each call must create a fresh Emscripten module");
    assertProcessListenerCounts({
        uncaughtException: listenersBefore.uncaughtException + 2,
        unhandledRejection: listenersBefore.unhandledRejection + 2
    }, "concurrent modules must own independent listeners");

    engines[0].dispose();
    assertProcessListenerCounts({
        uncaughtException: listenersBefore.uncaughtException + 1,
        unhandledRejection: listenersBefore.unhandledRejection + 1
    }, "disposing one module must preserve the other module's listeners");
    assert.strictEqual(await engines[1].sendCommand("isready"), "isready");
    engines[1].dispose();
    assertProcessListenerCounts(listenersBefore, "all concurrent listeners must be released");
}

function testPreJsDoesNotMutateGlobals()
{
    var sentinelFetch = function sentinelFetch() {};
    var sentinelXMLHttpRequest = function sentinelXMLHttpRequest() {};
    var source = fs.readFileSync(path.join(__dirname, "..", "src", "emscripten", "pre.js"), "utf8");
    var context = {
        Module: {
            locateFile: function ()
            {
                return path.join(fixtures, "runtime-engine-modern.wasm");
            }
        },
        PThread: undefined,
        console: console,
        fetch: sentinelFetch,
        XMLHttpRequest: sentinelXMLHttpRequest,
        process: process,
        require: require,
        __filename: modernEnginePath
    };

    context.global = context;
    vm.runInNewContext(source, context, {filename: "pre.js"});
    assert.strictEqual(context.fetch, sentinelFetch);
    assert.strictEqual(context.XMLHttpRequest, sentinelXMLHttpRequest);
    assert.strictEqual(context.Module.wasmBinary.toString(), "test wasm modern fixture\n");
}

Promise.resolve().then(testInvalidInitializationOptions)
    .then(testPromiseApi)
    .then(testStableCallbackFacade)
    .then(testLegacyFactory)
    .then(testRejectedInitialization)
    .then(testInitializationTimeout)
    .then(testRepeatedAndConcurrentInitialization)
    .then(testPreJsDoesNotMutateGlobals)
    .then(function ()
    {
        console.log("runtime tests passed");
    })
    .catch(function (err)
    {
        console.error(err);
        process.exitCode = 1;
    });
