
/// Node 18+ exposes a global fetch(), but Emscripten 3.1.7 may try to use it
/// with a local filesystem path. Provide the local binary explicitly instead
/// of disabling fetch or installing an XMLHttpRequest polyfill globally.
if (typeof global !== "undefined" &&
        Object.prototype.toString.call(global.process) === "[object process]" &&
        typeof Module["wasmBinary"] === "undefined" &&
        typeof __filename === "string") {
    (function loadNodeWasmBinary()
    {
        var fs = require("fs");
        var path = require("path");
        var wasmName = path.basename(__filename, path.extname(__filename)) + ".wasm";
        var wasmPath = Module["locateFile"] ?
            Module["locateFile"](wasmName, path.dirname(__filename) + path.sep) :
            path.join(path.dirname(__filename), wasmName);

        if (typeof wasmPath === "string" && fs.existsSync(wasmPath)) {
            Module["wasmBinary"] = fs.readFileSync(wasmPath);
        }
    }());
}

Module["print"] = function (data)
{
    if (Module["listener"]) {
        Module["listener"](data);
    } else {
        console.log(data);
    }
}
Module["printErr"] = function (data)
{
    if (Module["listener"]) {
        Module["listener"](data);
    } else {
        console.error(data);
    }
}

Module["terminate"] = function ()
{
    if (typeof PThread !== "undefined") {
        PThread.terminateAllThreads();
    }
};
