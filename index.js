/// License: MIT

"use strict";

var engineLoaders = Object.create(null);

function loadEngine(pathToEngine)
{
    var resolvedPath = require.resolve(pathToEngine);

    if (!Object.prototype.hasOwnProperty.call(engineLoaders, resolvedPath)) {
        /// Generated Emscripten glue can replace its CommonJS export after the
        /// first module is created. Keep the original reusable loader.
        delete require.cache[resolvedPath];
        engineLoaders[resolvedPath] = require(resolvedPath);
    }

    return engineLoaders[resolvedPath];
}

function snapshotProcessListeners()
{
    return ["uncaughtException", "unhandledRejection"].map(function (eventName)
    {
        return {
            eventName: eventName,
            listeners: process.listeners(eventName)
        };
    });
}

function findAddedProcessListeners(before)
{
    var added = [];

    before.forEach(function (event)
    {
        var remaining = event.listeners.slice();

        process.listeners(event.eventName).forEach(function (listener)
        {
            var index = remaining.indexOf(listener);

            if (index > -1) {
                remaining.splice(index, 1);
            } else {
                added.push({
                    eventName: event.eventName,
                    listener: listener
                });
            }
        });
    });

    return added;
}

function removeProcessListeners(listeners)
{
    listeners.splice(0).forEach(function (entry)
    {
        process.removeListener(entry.eventName, entry.listener);
    });
}

///NOTE: If enginePath is not passed in, it will use the default stockfish.js engine.
///      If cb is not passed in, it will return a Promise.
function initEngine(enginePath, options, cb)
{
    if (typeof enginePath === "function") {
        cb = enginePath;
        enginePath = null;
        options = {};
    } else if (enginePath && typeof enginePath === "object" && !Array.isArray(enginePath)) {
        cb = typeof options === "function" ? options : cb;
        options = enginePath;
        enginePath = null;
    } else if (typeof options === "function") {
        cb = options;
        options = {};
    }
    options = options || {};

    if (typeof options !== "object" || Array.isArray(options)) {
        throw new TypeError("Stockfish engine options must be an object.");
    }
    if (options.initializationTimeout !== undefined &&
            (typeof options.initializationTimeout !== "number" ||
             !isFinite(options.initializationTimeout) || options.initializationTimeout <= 0)) {
        throw new TypeError("initializationTimeout must be a positive number.");
    }

    var fs = require("fs");
    var p = require("path");
    var pathToEngine = findDefaultEngine(enginePath);
    var ext = p.extname(pathToEngine);
    var basepath = pathToEngine.slice(0, -ext.length);
    var wasmPath = basepath + ".wasm";
    var basename = p.basename(basepath);
    var engineDir = p.dirname(pathToEngine);
    var buffers = [];
    var INIT_ENGINE = loadEngine(pathToEngine);
    var moduleInstance = null;
    var originalTerminate = null;
    var ownedProcessListeners = [];
    var settled = false;
    var disposed = false;
    var resolveReady;
    var rejectReady;
    var initializationTimer = null;
    var initializationTimeout = options.initializationTimeout || 60000;
    var facadeState = {
        listener: null,
        locateFile: locateFile
    };
    var facade = new Proxy(facadeState, {
        get: function (target, property)
        {
            /// Prevent Promise resolution from treating an Emscripten module
            /// with an accidental `then` property as a thenable facade.
            if (property === "then") {
                return undefined;
            }
            if (property in target) {
                return target[property];
            }
            return moduleInstance ? moduleInstance[property] : undefined;
        },
        set: function (target, property, value)
        {
            if (property in target || !moduleInstance) {
                target[property] = value;
            } else {
                moduleInstance[property] = value;
            }
            return true;
        },
        has: function (target, property)
        {
            return property in target || Boolean(moduleInstance && property in moduleInstance);
        }
    });
    var ready = new Promise(function (resolve, reject)
    {
        resolveReady = resolve;
        rejectReady = reject;
    });
    var moduleOptions = {
        locateFile: locateFile,
        listener: function (line)
        {
            if (typeof facadeState.listener === "function") {
                facadeState.listener(line);
            } else {
                console.log(line);
            }
        }
    };

    facadeState.ready = ready;
    facadeState.sendCommand = sendCommand;
    facadeState.dispose = dispose;
    facadeState.terminate = dispose;
    Object.defineProperty(facadeState, "module", {
        configurable: false,
        enumerable: false,
        get: function ()
        {
            return moduleInstance;
        }
    });

    function locateFile(path)
    {
        if (path.indexOf(".wasm") > -1) {
            if (path.indexOf(".wasm.map") > -1) {
                return wasmPath + ".map";
            }
            return wasmPath;
        }
        return pathToEngine;
    }

    function getVersion()
    {
        return require("./package.json").buildVersion;
    }

    function findDefaultEngine(path)
    {
        var filename = "stockfish.js";

        if (path) {
            switch(path.toLowerCase()) {
                case "full":
                    filename = "stockfish-" + getVersion() + ".js";
                    break;
                case "lite":
                    filename = "stockfish-" + getVersion() + "-lite.js";
                    break;
                case "single":
                    filename = "stockfish-" + getVersion() + "-single.js";
                    break;
                case "lite-single":
                case "single-lite":
                    filename = "stockfish-" + getVersion() + "-lite-single.js";
                    break;
                case "asm":
                    filename = "stockfish-" + getVersion() + "-asm.js";
                    break;
                default:
                    return p.resolve(process.cwd(), path);
            }
        }

        path = p.join(__dirname, "bin", filename);
        if (fs.existsSync(path)) {
            return path;
        }

        path = p.join(__dirname, "src", filename);
        if (fs.existsSync(path)) {
            return path;
        }

        throw new Error("Cannot find " + filename + ". Please provide the path to the engine. You may need to build the engine first.");
    }

    function initializationError(err)
    {
        var detail = err && err.message ? err.message : String(err);
        var wrapped = new Error("Unable to initialize Stockfish engine at " + pathToEngine + ": " + detail);

        wrapped.cause = err;
        return wrapped;
    }

    function finish(err)
    {
        if (settled) {
            return;
        }
        settled = true;
        clearTimeout(initializationTimer);
        initializationTimer = null;

        if (err) {
            disposed = true;
            removeProcessListeners(ownedProcessListeners);
            rejectReady(err);
        } else {
            resolveReady(facade);
        }

        if (typeof cb === "function") {
            setImmediate(function ()
            {
                cb(err || null, facade);
            });
        }
    }

    function adoptModule(instance)
    {
        moduleInstance = instance || moduleOptions;
        originalTerminate = typeof moduleInstance.terminate === "function" ?
            moduleInstance.terminate : null;
    }

    function disposeRuntime(skipQuit)
    {
        var commandError;
        var terminateError;

        if (!moduleInstance) {
            removeProcessListeners(ownedProcessListeners);
            facadeState.listener = null;
            moduleOptions.listener = function () {};
            return;
        }

        try {
            if (!skipQuit && typeof moduleInstance.ccall === "function") {
                moduleInstance.ccall("command", null, ["string"], ["quit"], {async: false});
            }
        } catch (err) {
            commandError = err;
        }

        try {
            if (originalTerminate) {
                originalTerminate.call(moduleInstance);
            }
        } catch (err) {
            terminateError = err;
        } finally {
            var ignoreOutput = function () {};

            originalTerminate = null;
            removeProcessListeners(ownedProcessListeners);
            facadeState.listener = null;
            moduleOptions.listener = ignoreOutput;
            if ("listener" in moduleInstance) {
                moduleInstance.listener = ignoreOutput;
            }
        }

        if (commandError) {
            throw commandError;
        }
        if (terminateError) {
            throw terminateError;
        }
    }

    function failInitialization(err)
    {
        disposed = true;
        try {
            disposeRuntime(true);
        } catch (cleanupError) {}
        finish(initializationError(err));
    }

    function waitUntilReady(instance)
    {
        if (disposed) {
            if (!moduleInstance) {
                adoptModule(instance);
            }
            if (originalTerminate) {
                try {
                    disposeRuntime(true);
                } catch (cleanupError) {}
            }
            return;
        }

        adoptModule(instance);

        if (moduleInstance._isReady && !moduleInstance._isReady()) {
            setTimeout(function ()
            {
                waitUntilReady(moduleInstance);
            }, 10);
            return;
        }

        if (typeof moduleInstance.ccall !== "function") {
            failInitialization(new Error("the module did not export ccall"));
            return;
        }

        finish(null);
    }

    function sendCommand(cmd)
    {
        var command = String(cmd);

        return ready.then(function ()
        {
            return new Promise(function (resolve, reject)
            {
                setImmediate(function ()
                {
                    if (disposed) {
                        reject(new Error("The Stockfish engine has been disposed."));
                        return;
                    }

                    try {
                        Promise.resolve(moduleInstance.ccall("command", null, ["string"], [command],
                            {async: /^go\b/.test(command)})).then(function (result)
                        {
                            try {
                                if (command.trim() === "quit") {
                                    disposed = true;
                                    disposeRuntime(true);
                                }
                                resolve(result);
                            } catch (err) {
                                reject(err);
                            }
                        }, reject);
                    } catch (err) {
                        reject(err);
                    }
                });
            });
        });
    }

    function dispose()
    {
        if (disposed) {
            return;
        }
        disposed = true;

        if (!settled) {
            finish(new Error("Stockfish engine initialization was cancelled."));
            return;
        }

        disposeRuntime(false);
    }

    /// Assemble split WASM parts when a release stores them separately.
    fs.readdirSync(engineDir).sort().forEach(function (path)
    {
        if (path.startsWith(basename + "-part-") && path.endsWith(".wasm")) {
            buffers.push(fs.readFileSync(p.join(engineDir, path)));
        }
    });

    if (buffers.length) {
        moduleOptions.wasmBinary = Buffer.concat(buffers);
    } else if (fs.existsSync(wasmPath)) {
        /// Node 18+ exposes fetch(), but filesystem paths are not valid fetch
        /// URLs. Supplying the bytes also avoids changing process globals.
        moduleOptions.wasmBinary = fs.readFileSync(wasmPath);
    }

    initializationTimer = setTimeout(function ()
    {
        failInitialization(new Error(
            "initialization timed out after " + initializationTimeout + " ms"
        ));
    }, initializationTimeout);

    try {
        var factory = INIT_ENGINE();
        var processListenersBefore;
        var createdEngine;

        if (typeof factory !== "function") {
            throw new Error("Could not create the engine module factory.");
        }

        processListenersBefore = snapshotProcessListeners();
        try {
            createdEngine = factory(moduleOptions);
        } finally {
            ownedProcessListeners = findAddedProcessListeners(processListenersBefore);
        }

        Promise.resolve(createdEngine).then(waitUntilReady, failInitialization);
    } catch (err) {
        failInitialization(err);
    }

    if (typeof cb === "function") {
        /// The callback style returns the same stable facade immediately.
        /// Mark its internal Promise handled when the caller only uses cb.
        ready.catch(function () {});
        return facade;
    }

    return ready;
}

module.exports = initEngine;
