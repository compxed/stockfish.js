"use strict";

module.exports = function initEngine()
{
    return function createEngine(options)
    {
        var instance;

        process.on("uncaughtException", function () {});
        process.on("unhandledRejection", function () {});
        instance = {
            terminateCalls: 0,
            _isReady: function () { return false; },
            ccall: function () {},
            emit: function (line) { options.listener(line); },
            terminate: function () { instance.terminateCalls += 1; }
        };
        return new Promise(function (resolve)
        {
            setTimeout(function ()
            {
                options.listener("late initialization output");
                resolve(instance);
            }, 40);
        });
    };
};
