/// License: GPL-3.0

(function exposeStockfishLoader(root, factory)
{
    "use strict";

    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.StockfishLoader = factory();
    }
}(typeof self === "object" ? self : this, function createStockfishLoader()
{
    "use strict";

    // Probe the exact relaxed dot-product instruction used by Stockfish's NNUE
    // path: i32x4.relaxed_dot_i8x16_i7x16_add_s (opcode 0x113).
    var RELAXED_SIMD_TEST = new Uint8Array([
        0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,19,1,17,0,
        65,1,253,15,65,2,253,15,65,0,253,15,253,147,2,11
    ]);
    var SIMD_TEST = new Uint8Array([
        0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,
        65,0,253,15,253,98,11
    ]);
    var THREADS_TEST = new Uint8Array([
        0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,5,4,1,3,1,1,10,
        11,1,9,0,65,0,254,16,2,0,26,11
    ]);
    var WASM_TEST = new Uint8Array([0,97,115,109,1,0,0,0]);

    function validate(bytes)
    {
        try {
            return typeof WebAssembly === "object" &&
                typeof WebAssembly.validate === "function" &&
                WebAssembly.validate(bytes);
        } catch (error) {
            return false;
        }
    }

    function detectThreads()
    {
        var channel;

        try {
            if (typeof SharedArrayBuffer !== "function" ||
                    typeof MessageChannel !== "function") {
                return false;
            }
            channel = new MessageChannel();
            channel.port1.postMessage(new SharedArrayBuffer(1));
            channel.port1.close();
            channel.port2.close();
            return validate(THREADS_TEST);
        } catch (error) {
            if (channel) {
                try { channel.port1.close(); } catch (ignore) {}
                try { channel.port2.close(); } catch (ignore) {}
            }
            return false;
        }
    }

    function detectFeatures()
    {
        var navigatorObject = typeof navigator === "object" ? navigator : {};

        return Promise.resolve({
            wasm: validate(WASM_TEST),
            simd: validate(SIMD_TEST),
            relaxedSimd: validate(RELAXED_SIMD_TEST),
            threads: detectThreads(),
            hardwareConcurrency: navigatorObject.hardwareConcurrency || 1,
            deviceMemory: navigatorObject.deviceMemory || null,
            crossOriginIsolated: typeof crossOriginIsolated === "boolean" ?
                crossOriginIsolated : false,
        });
    }

    function cloneObject(value)
    {
        var copy = {};
        var key;

        for (key in value) {
            if (Object.prototype.hasOwnProperty.call(value, key)) {
                Object.defineProperty(copy, key, {
                    value: value[key],
                    enumerable: true,
                    configurable: true,
                    writable: true,
                });
            }
        }
        return copy;
    }

    function defaultVariants(options)
    {
        var flavor = options.flavor === "full" ? "full" : "lite";
        var version = options.version || "19";
        var stem = "stockfish-" + version + (flavor === "lite" ? "-lite" : "");
        var variants = [];

        function add(id, suffix, requires, priority, threaded)
        {
            variants.push({
                id: id,
                js: stem + suffix + ".js",
                wasm: stem + suffix + ".wasm",
                requires: requires,
                priority: priority,
                threads: threaded,
            });
        }

        if (options.threads !== false) {
            if (options.relaxedSimd !== false) {
                add(flavor + "-threaded-relaxed", "-relaxed",
                    ["wasm", "simd", "relaxedSimd", "threads"],
                    40, true);
            }
            add(flavor + "-threaded", "", ["wasm", "simd", "threads"],
                30, true);
        }
        if (options.threads !== true) {
            if (options.relaxedSimd !== false) {
                add(flavor + "-single-relaxed", "-single-relaxed",
                    ["wasm", "simd", "relaxedSimd"],
                    20, false);
            }
            add(flavor + "-single", "-single", ["wasm", "simd"],
                10, false);
        }
        if (options.allowAsm !== false) {
            variants.push({
                id: "asm",
                js: "stockfish-" + version + "-asm.js",
                requires: [],
                priority: 0,
                threads: false,
            });
        }
        return variants;
    }

    function validateOptions(input)
    {
        var options;
        var variants;
        var ids = Object.create(null);

        if (input === undefined || input === null) {
            input = {};
        }
        if (typeof input !== "object" || Array.isArray(input)) {
            throw new TypeError("StockfishLoader options must be an object.");
        }
        options = cloneObject(input);
        if (options.baseUrl !== undefined && typeof options.baseUrl !== "string") {
            throw new TypeError("baseUrl must be a string.");
        }
        if (options.timeout !== undefined &&
                (typeof options.timeout !== "number" || !isFinite(options.timeout) ||
                 options.timeout <= 0)) {
            throw new TypeError("timeout must be a positive number.");
        }
        if (options.onFallback !== undefined && typeof options.onFallback !== "function") {
            throw new TypeError("onFallback must be a function.");
        }
        if (options.features !== undefined &&
                (typeof options.features !== "object" || options.features === null ||
                 Array.isArray(options.features))) {
            throw new TypeError("features must be an object.");
        }
        if (options.flavor !== undefined &&
                options.flavor !== "lite" && options.flavor !== "full") {
            throw new TypeError("flavor must be either lite or full.");
        }
        if (options.version !== undefined &&
                !/^[A-Za-z0-9._-]+$/.test(String(options.version))) {
            throw new TypeError("version contains unsupported filename characters.");
        }
        ["threads", "relaxedSimd", "allowAsm"].forEach(function (name)
        {
            if (options[name] !== undefined && typeof options[name] !== "boolean") {
                throw new TypeError(name + " must be a boolean.");
            }
        });
        if (options.Worker !== undefined && typeof options.Worker !== "function") {
            throw new TypeError("Worker must be a constructor.");
        }
        if (options.workerOptions !== undefined &&
                (typeof options.workerOptions !== "object" ||
                 options.workerOptions === null || Array.isArray(options.workerOptions))) {
            throw new TypeError("workerOptions must be an object.");
        }
        variants = options.variants === undefined ? defaultVariants(options) : options.variants;
        if (!Array.isArray(variants) || !variants.length) {
            throw new TypeError("variants must be a non-empty array.");
        }
        options.variants = variants.map(function (variant)
        {
            var copy;

            if (!variant || typeof variant !== "object" || Array.isArray(variant)) {
                throw new TypeError("Each Stockfish.js variant must be an object.");
            }
            copy = cloneObject(variant);
            if (typeof copy.id !== "string" || !copy.id || ids[copy.id]) {
                throw new TypeError("Variant ids must be unique non-empty strings.");
            }
            ids[copy.id] = true;
            if (typeof copy.js !== "string" || !copy.js || copy.js.indexOf("#") > -1) {
                throw new TypeError("Variant " + copy.id + " needs a hash-free JavaScript path.");
            }
            if (copy.wasm !== undefined &&
                    (typeof copy.wasm !== "string" || !copy.wasm ||
                     copy.wasm.indexOf("#") > -1)) {
                throw new TypeError("Variant " + copy.id + " has an invalid WebAssembly path.");
            }
            if (copy.requires === undefined) {
                copy.requires = [];
            }
            if (!Array.isArray(copy.requires) || copy.requires.some(function (feature)
            {
                return typeof feature !== "string" || !feature;
            })) {
                throw new TypeError("Variant " + copy.id + " has invalid feature requirements.");
            }
            copy.requires = copy.requires.slice();
            if (copy.priority !== undefined &&
                    (typeof copy.priority !== "number" || !isFinite(copy.priority))) {
                throw new TypeError("Variant " + copy.id + " has an invalid priority.");
            }
            if (copy.test !== undefined && typeof copy.test !== "function") {
                throw new TypeError("Variant " + copy.id + " has an invalid feature test.");
            }
            return copy;
        });
        return options;
    }

    function joinUrl(baseUrl, path)
    {
        var contextUrl;
        var directoryUrl;

        if (!baseUrl) {
            return path;
        }
        if (typeof URL === "function") {
            try {
                contextUrl = typeof document === "object" && document.baseURI ?
                    document.baseURI :
                    (typeof location === "object" && location.href ? location.href : null);
                directoryUrl = contextUrl ? new URL(baseUrl, contextUrl) : new URL(baseUrl);
                if (directoryUrl.pathname.slice(-1) !== "/") {
                    directoryUrl.pathname += "/";
                }
                directoryUrl.search = "";
                directoryUrl.hash = "";
                return new URL(path, directoryUrl.href).href;
            } catch (error) {
                // Relative URLs without a document context remain valid Worker URLs.
            }
        }
        return baseUrl.replace(/\/?$/, "/") + path.replace(/^\//, "");
    }

    function supportFailures(variant, features)
    {
        var failures = [];

        variant.requires.forEach(function (feature)
        {
            if (!features[feature]) {
                failures.push("missing " + feature);
            }
        });
        if (typeof variant.test === "function" && !variant.test(features)) {
            failures.push("custom feature test failed");
        }
        return failures;
    }

    function resolveVariants(options, features)
    {
        var compatible = [];
        var skipped = [];

        options.variants.forEach(function (variant, index)
        {
            var copy = cloneObject(variant);
            var failures = supportFailures(copy, features);

            copy.requires = copy.requires.slice();
            copy.js = joinUrl(options.baseUrl, copy.js);
            if (copy.wasm) {
                copy.wasm = joinUrl(options.baseUrl, copy.wasm);
            }
            copy._order = index;
            if (failures.length) {
                skipped.push({variant: copy.id, reasons: failures});
            } else {
                compatible.push(copy);
            }
        });
        compatible.sort(function (a, b)
        {
            return (b.priority || 0) - (a.priority || 0) || a._order - b._order;
        });
        compatible.forEach(function (variant) { delete variant._order; });
        return {compatible: compatible, skipped: skipped};
    }

    function resolveFeatures(options)
    {
        return options.features ? Promise.resolve(cloneObject(options.features)) : detectFeatures();
    }

    function normalizeAsync(input)
    {
        try {
            return Promise.resolve(validateOptions(input));
        } catch (error) {
            return Promise.reject(error);
        }
    }

    function select(input)
    {
        return normalizeAsync(input).then(function (options)
        {
            return resolveFeatures(options).then(function (features)
            {
                var resolved = resolveVariants(options, features);
                var selected;

                if (!resolved.compatible.length) {
                    var error = new Error("No Stockfish.js build is compatible with this runtime.");
                    error.skipped = resolved.skipped;
                    throw error;
                }
                selected = resolved.compatible[0];
                selected.features = features;
                selected.skipped = resolved.skipped;
                return selected;
            });
        });
    }

    function workerUrl(variant)
    {
        return variant.wasm ? variant.js + "#" + encodeURIComponent(variant.wasm) : variant.js;
    }

    function startVariant(variant, options)
    {
        return new Promise(function (resolve, reject)
        {
            var WorkerConstructor = options.Worker ||
                (typeof Worker === "function" ? Worker : null);
            var worker;
            var timer;
            var done = false;

            function cleanup()
            {
                clearTimeout(timer);
                if (worker) {
                    worker.removeEventListener("message", onMessage);
                    worker.removeEventListener("error", onError);
                    worker.removeEventListener("messageerror", onError);
                }
            }

            function fail(error)
            {
                if (done) {
                    return;
                }
                done = true;
                cleanup();
                if (worker && typeof worker.terminate === "function") {
                    worker.terminate();
                }
                reject(error instanceof Error ? error : new Error(String(error)));
            }

            function onError(event)
            {
                fail(event.error || new Error(event.message || "Worker initialization failed"));
            }

            function onMessage(event)
            {
                if (/(^|\n)uciok(?:\n|$)/.test(String(event.data))) {
                    done = true;
                    cleanup();
                    resolve(worker);
                }
            }

            if (!WorkerConstructor) {
                reject(new Error("Web Workers are not available in this runtime."));
                return;
            }
            try {
                worker = new WorkerConstructor(workerUrl(variant), options.workerOptions);
                worker.addEventListener("message", onMessage);
                worker.addEventListener("error", onError);
                worker.addEventListener("messageerror", onError);
                timer = setTimeout(function ()
                {
                    fail(new Error("Timed out while starting " + variant.id));
                }, options.timeout || 60000);
                worker.postMessage("uci");
            } catch (error) {
                fail(error);
            }
        });
    }

    function load(input)
    {
        return normalizeAsync(input).then(function (options)
        {
            return resolveFeatures(options).then(function (features)
            {
                var resolved = resolveVariants(options, features);
                var report = {features: features, skipped: resolved.skipped, attempts: []};

                function attempt(index)
                {
                    var variant;

                    if (index >= resolved.compatible.length) {
                        var error = new Error("Unable to start a compatible Stockfish.js build.");
                        error.selectionReport = report;
                        throw error;
                    }
                    variant = resolved.compatible[index];
                    return startVariant(variant, options).then(function (worker)
                    {
                        report.attempts.push({variant: variant.id, status: "selected"});
                        worker.stockfishVariant = variant;
                        worker.stockfishSelection = report;
                        return worker;
                    }).catch(function (error)
                    {
                        report.attempts.push({
                            variant: variant.id,
                            status: "failed",
                            error: error,
                        });
                        if (typeof options.onFallback === "function") {
                            try {
                                options.onFallback(error, variant);
                            } catch (callbackError) {
                                setTimeout(function () { throw callbackError; }, 0);
                            }
                        }
                        return attempt(index + 1);
                    });
                }

                return attempt(0);
            });
        });
    }

    return {
        detectFeatures: detectFeatures,
        compatibleVariants: function (input, features)
        {
            var options = validateOptions(input);
            return resolveVariants(options, features || {}).compatible;
        },
        select: select,
        load: load,
    };
}));
