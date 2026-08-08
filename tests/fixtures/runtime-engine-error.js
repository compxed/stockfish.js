"use strict";

module.exports = function initEngine()
{
    return function createEngine()
    {
        process.on("uncaughtException", function () {});
        process.on("unhandledRejection", function () {});
        return Promise.reject(new Error("fixture initialization failed"));
    };
};
