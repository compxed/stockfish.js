/*
 * Stockfish 19 for Chess.com Analysis
 * License: GPL-3.0
 */

(function exposeOverride(root, factory)
{
    "use strict";

    var api = factory();

    if (typeof module === "object" && module.exports) {
        module.exports = api;
    } else {
        api.install(root);
    }
}(typeof window === "object" ? window : this, function createOverride()
{
    "use strict";

    var CONFIG_EVENT = "compxed-stockfish-override:config";
    var STATUS_EVENT = "compxed-stockfish-override:status";
    var INSTALL_MARKER = "__compxedStockfishOverrideInstalled";
    var STOCKFISH_ASSET = /^\/r2\/assets-chess-engine\/Stockfish\/stockfish-[^/]+\.js$/i;
    var LEGACY_ASSET = /^\/bundles\/app\/js\/engine\/stockfish-[^/]+\.js$/i;

    function isAnalysisLocation(locationObject)
    {
        var pathname = locationObject && locationObject.pathname || "";

        return pathname === "/analysis" || pathname.indexOf("/analysis/") === 0;
    }

    function isChessComStockfishUrl(value, locationObject)
    {
        var url;

        try {
            url = new URL(String(value), locationObject.href);
        } catch (error) {
            return false;
        }
        return url.protocol === "https:" &&
            url.hostname === "www.chess.com" &&
            (STOCKFISH_ASSET.test(url.pathname) || LEGACY_ASSET.test(url.pathname));
    }

    function isChessComLiteStockfishUrl(value, locationObject)
    {
        var url;

        if (!isChessComStockfishUrl(value, locationObject)) {
            return false;
        }
        url = new URL(String(value), locationObject.href);
        return /stockfish-(?:[A-Za-z0-9.]+-)?lite(?:-single)?(?:-[A-Za-z0-9]+)?\.js$/i
            .test(url.pathname.split("/").pop());
    }

    function isSingleThreadedUrl(value, locationObject)
    {
        var url;

        if (!isChessComLiteStockfishUrl(value, locationObject)) {
            return false;
        }
        url = new URL(String(value), locationObject.href);
        return /-single(?:-[A-Za-z0-9]+)?\.js$/i.test(url.pathname);
    }

    function constructWorker(WorkerConstructor, scriptUrl, options, hasOptions)
    {
        return hasOptions ? new WorkerConstructor(scriptUrl, options) :
            new WorkerConstructor(scriptUrl);
    }

    function createWasmObjectUrl(environment, base64)
    {
        var binary = environment.atob(base64);
        var bytes = new Uint8Array(binary.length);
        var index;

        for (index = 0; index < binary.length; index++) {
            bytes[index] = binary.charCodeAt(index);
        }
        if (bytes.length < 8 || bytes[0] !== 0 || bytes[1] !== 97 ||
                bytes[2] !== 115 || bytes[3] !== 109) {
            throw new Error("The engine file is not WebAssembly.");
        }
        return environment.URL.createObjectURL(new environment.Blob([bytes], {
            type: "application/wasm",
        }));
    }

    function createWorkerFacade(environment, NativeWorker, originalUrl, options,
                                hasOptions, config, reportStatus)
    {
        var objectUrl = environment.URL.createObjectURL(new environment.Blob([
            config.engineSource,
            "\n//# sourceURL=stockfish-19-lite" +
                (config.name === "threaded" ? "" : "-single") + ".js\n",
        ], {type: "text/javascript"}));
        var workerUrl = objectUrl + "#" + encodeURIComponent(config.wasmUrl);
        var activeWorker;
        var activeKind = "custom";
        var proxy;
        var terminated = false;
        var firstCommandTimer = null;
        var commands = [];
        var handlers = {
            message: null,
            error: null,
            messageerror: null,
        };
        var listeners = {
            message: [],
            error: [],
            messageerror: [],
        };

        try {
            activeWorker = constructWorker(NativeWorker, workerUrl, options, hasOptions);
        } catch (error) {
            try {
                environment.URL.revokeObjectURL(objectUrl);
            } catch (ignore) {}
            throw error;
        }

        function clearStartupTimer()
        {
            if (firstCommandTimer !== null) {
                environment.clearTimeout(firstCommandTimer);
                firstCommandTimer = null;
            }
        }

        function callListener(listener, event)
        {
            if (typeof listener === "function") {
                listener.call(proxy, event);
            } else if (listener && typeof listener.handleEvent === "function") {
                listener.handleEvent(event);
            }
        }

        function emit(type, event)
        {
            var records = listeners[type].slice();
            var handler = handlers[type];

            if (handler) {
                callListener(handler, event);
            }
            records.forEach(function (record)
            {
                callListener(record.listener, event);
                if (record.once) {
                    removeListener(type, record.listener);
                }
            });
        }

        function addListener(type, listener, listenerOptions)
        {
            var once = Boolean(listenerOptions && typeof listenerOptions === "object" &&
                listenerOptions.once);

            if (!listeners[type] || !listener) {
                return;
            }
            if (!listeners[type].some(function (record)
            {
                return record.listener === listener;
            })) {
                listeners[type].push({listener: listener, once: once});
            }
        }

        function removeListener(type, listener)
        {
            if (!listeners[type]) {
                return;
            }
            listeners[type] = listeners[type].filter(function (record)
            {
                return record.listener !== listener;
            });
        }

        function attach(worker)
        {
            worker.addEventListener("message", function (event)
            {
                var isUciMessage = typeof event.data === "string" &&
                    /(^|\n)uciok(?:\n|$)/.test(event.data);
                var isOperationalMessage = typeof event.data === "string" &&
                    /(^|\n)(?:readyok|bestmove\b|info depth\b)/.test(event.data);

                if (worker !== activeWorker || terminated) {
                    return;
                }
                if (activeKind === "custom" && isUciMessage) {
                    clearStartupTimer();
                    activeKind = "custom-uci";
                    reportStatus("active", "Stockfish 19 is answering UCI commands.");
                }
                if (activeKind === "custom-uci" && isOperationalMessage) {
                    clearStartupTimer();
                    activeKind = "custom-ready";
                    commands = [];
                }
                emit("message", event);
            });
            worker.addEventListener("messageerror", function (event)
            {
                if (worker === activeWorker && !terminated) {
                    emit("messageerror", event);
                }
            });
            worker.addEventListener("error", function (event)
            {
                if (worker !== activeWorker || terminated) {
                    return;
                }
                if (activeKind === "custom" || activeKind === "custom-uci") {
                    if (typeof event.preventDefault === "function") {
                        event.preventDefault();
                    }
                    startFallback("Stockfish 19 failed to start" +
                        (event.message ? ": " + event.message : "."), event);
                    return;
                }
                if (activeKind === "custom-ready") {
                    reportStatus("error", "Stockfish 19 stopped after initialization.");
                }
                emit("error", event);
            });
        }

        function startFallback(reason, originalError)
        {
            var fallback;

            if (terminated || activeKind === "fallback" || activeKind === "failed") {
                return;
            }
            clearStartupTimer();
            try {
                activeWorker.terminate();
            } catch (ignore) {}
            try {
                environment.URL.revokeObjectURL(objectUrl);
            } catch (ignore) {}
            try {
                fallback = constructWorker(NativeWorker, originalUrl, options, hasOptions);
                activeWorker = fallback;
                activeKind = "fallback";
                attach(fallback);
                commands.forEach(function (command)
                {
                    fallback.postMessage(command);
                });
                reportStatus("fallback", reason + " Using the Chess.com engine.");
            } catch (error) {
                activeKind = "failed";
                reportStatus("error", "Neither engine could be started.");
                emit("error", originalError || error);
            }
        }

        function postMessage()
        {
            var message = arguments[0];

            if (terminated) {
                throw new Error("Cannot send a message to a terminated Worker.");
            }
            if ((activeKind === "custom" || activeKind === "custom-uci") &&
                    typeof message === "string") {
                commands.push(message);
                if (commands.length > 256) {
                    commands.shift();
                }
            }
            if (activeKind === "custom" && firstCommandTimer === null) {
                firstCommandTimer = environment.setTimeout(function ()
                {
                    startFallback("Stockfish 19 did not answer in time.");
                }, config.timeoutMs);
            } else if (activeKind === "custom-uci" && typeof message === "string" &&
                    (message === "isready" || /^go(?:\s|$)/.test(message)) &&
                    firstCommandTimer === null) {
                firstCommandTimer = environment.setTimeout(function ()
                {
                    startFallback("Stockfish 19 did not become ready in time.");
                }, config.timeoutMs);
            }
            return activeWorker.postMessage.apply(activeWorker, arguments);
        }

        function terminate()
        {
            if (terminated) {
                return;
            }
            terminated = true;
            clearStartupTimer();
            activeWorker.terminate();
            try {
                environment.URL.revokeObjectURL(objectUrl);
            } catch (ignore) {}
        }

        attach(activeWorker);
        reportStatus("starting", "Starting Stockfish 19 " + config.name +
            " for " + String(originalUrl) + ".");

        proxy = new Proxy(activeWorker, {
            get: function (target, property)
            {
                if (property === "postMessage") {
                    return postMessage;
                }
                if (property === "terminate") {
                    return terminate;
                }
                if (property === "addEventListener") {
                    return addListener;
                }
                if (property === "removeEventListener") {
                    return removeListener;
                }
                if (property === "onmessage" || property === "onerror" ||
                        property === "onmessageerror") {
                    return handlers[property.slice(2)];
                }
                var value = Reflect.get(activeWorker, property, activeWorker);

                return typeof value === "function" ? value.bind(activeWorker) : value;
            },
            set: function (target, property, value)
            {
                if (property === "onmessage" || property === "onerror" ||
                        property === "onmessageerror") {
                    handlers[property.slice(2)] = typeof value === "function" ||
                        value === null ? value : null;
                    return true;
                }
                return Reflect.set(activeWorker, property, value, activeWorker);
            },
        });
        return proxy;
    }

    function install(environment)
    {
        var NativeWorker;
        var config = null;

        if (!environment || !isAnalysisLocation(environment.location) ||
                environment[INSTALL_MARKER]) {
            return false;
        }
        NativeWorker = environment.Worker;
        if (typeof NativeWorker !== "function" || !environment.document) {
            return false;
        }
        environment[INSTALL_MARKER] = true;

        function reportStatus(state, message)
        {
            var detail = JSON.stringify({state: state, message: message});

            environment.document.dispatchEvent(new environment.CustomEvent(STATUS_EVENT, {
                detail: detail,
            }));
        }

        environment.document.addEventListener(CONFIG_EVENT, function (event)
        {
            var candidate;
            var createdUrls = [];
            var nextConfig;
            var single;
            var threaded;

            function validateVariant(value, name)
            {
                if (!value || typeof value.engineSource !== "string" ||
                        value.engineSource.indexOf("Stockfish.js 19") < 0 ||
                        typeof value.wasmBase64 !== "string" ||
                        value.wasmBase64.length > 16 * 1024 * 1024) {
                    throw new Error("The " + name + " engine files are invalid.");
                }
                return value;
            }

            if (config) {
                return;
            }
            try {
                candidate = JSON.parse(event.detail);
            } catch (error) {
                reportStatus("error", "The extension configuration is invalid.");
                return;
            }
            try {
                if (!candidate || !candidate.variants) {
                    throw new Error("The extension engine files are invalid.");
                }
                threaded = validateVariant(candidate.variants.threaded, "threaded");
                single = validateVariant(candidate.variants.single, "single-threaded");
                createdUrls.push(createWasmObjectUrl(environment, threaded.wasmBase64));
                createdUrls.push(createWasmObjectUrl(environment, single.wasmBase64));
                nextConfig = {
                    threaded: {
                        engineSource: threaded.engineSource,
                        wasmUrl: createdUrls[0],
                        name: "threaded",
                    },
                    single: {
                        engineSource: single.engineSource,
                        wasmUrl: createdUrls[1],
                        name: "single-threaded",
                    },
                    timeoutMs: Number(candidate.timeoutMs) > 0 ?
                        Number(candidate.timeoutMs) : 30000,
                };
            } catch (error) {
                createdUrls.forEach(function (url)
                {
                    try {
                        environment.URL.revokeObjectURL(url);
                    } catch (ignore) {}
                });
                reportStatus("error", error.message);
                return;
            }
            config = nextConfig;
            reportStatus("ready", "Stockfish 19 is ready for the next analysis.");
        });

        function OverrideWorker(scriptUrl, options)
        {
            var hasOptions = arguments.length > 1;

            if (!(this instanceof OverrideWorker)) {
                throw new TypeError("Failed to construct 'Worker': Please use the 'new' operator.");
            }
            if (!config || !isAnalysisLocation(environment.location)) {
                return constructWorker(NativeWorker, scriptUrl, options, hasOptions);
            }
            if (isChessComStockfishUrl(scriptUrl, environment.location) &&
                    !isChessComLiteStockfishUrl(scriptUrl, environment.location)) {
                reportStatus("native", "The selected Chess.com engine is not a lite build.");
                return constructWorker(NativeWorker, scriptUrl, options, hasOptions);
            }
            if (!isChessComLiteStockfishUrl(scriptUrl, environment.location)) {
                return constructWorker(NativeWorker, scriptUrl, options, hasOptions);
            }
            var variant = isSingleThreadedUrl(scriptUrl, environment.location) ?
                config.single : config.threaded;

            try {
                return createWorkerFacade(environment, NativeWorker, scriptUrl, options,
                    hasOptions, {
                        engineSource: variant.engineSource,
                        wasmUrl: variant.wasmUrl,
                        name: variant.name,
                        timeoutMs: config.timeoutMs,
                    }, reportStatus);
            } catch (error) {
                reportStatus("fallback", "Stockfish 19 could not be started. " +
                    "Using the Chess.com engine.");
                return constructWorker(NativeWorker, scriptUrl, options, hasOptions);
            }
        }

        OverrideWorker.prototype = NativeWorker.prototype;
        try {
            Object.setPrototypeOf(OverrideWorker, NativeWorker);
        } catch (ignore) {}
        environment.Worker = OverrideWorker;
        reportStatus("waiting", "Preparing Stockfish 19.");
        return true;
    }

    return {
        CONFIG_EVENT: CONFIG_EVENT,
        STATUS_EVENT: STATUS_EVENT,
        install: install,
        isAnalysisLocation: isAnalysisLocation,
        isChessComLiteStockfishUrl: isChessComLiteStockfishUrl,
        isChessComStockfishUrl: isChessComStockfishUrl,
        isSingleThreadedUrl: isSingleThreadedUrl,
    };
}));
