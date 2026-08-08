(function (root, factory) {
    "use strict";

    const api = factory();

    if (typeof module === "object" && module.exports) {
        module.exports = api;
    } else {
        root.StockfishBenchmarkCore = api;
    }
}(typeof globalThis === "object" ? globalThis : this, function () {
    "use strict";

    function sum(values)
    {
        return values.reduce((total, value) => total + value, 0);
    }

    function mean(values)
    {
        if (!values.length) {
            throw new Error("cannot summarize an empty sample");
        }
        return sum(values) / values.length;
    }

    function median(values)
    {
        if (!values.length) {
            throw new Error("cannot summarize an empty sample");
        }

        const sorted = values.slice().sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[middle] :
            (sorted[middle - 1] + sorted[middle]) / 2;
    }

    function coefficientOfVariation(values)
    {
        const average = mean(values);

        if (average === 0) {
            return null;
        }

        const variance = mean(values.map(value => Math.pow(value - average, 2)));
        return Math.sqrt(variance) / Math.abs(average) * 100;
    }

    function sampleStandardDeviation(values)
    {
        if (values.length < 2) {
            return null;
        }

        const average = mean(values);
        const variance = sum(values.map(value => Math.pow(value - average, 2))) /
            (values.length - 1);
        return Math.sqrt(variance);
    }

    function studentTCritical95(degreesOfFreedom)
    {
        const critical = [
            null, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365,
            2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145, 2.131,
            2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069,
            2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042
        ];

        return degreesOfFreedom < critical.length ? critical[degreesOfFreedom] : 1.96;
    }

    function readInteger(line, field)
    {
        const match = line.match(new RegExp(`(?:^|\\s)${field}\\s+(\\d+)`));
        return match ? Number(match[1]) : null;
    }

    function parseInfo(line)
    {
        const scoreMatch = line.match(/(?:^|\s)score\s+(cp|mate)\s+(-?\d+)/);
        const result = {
            depth: readInteger(line, "depth"),
            seldepth: readInteger(line, "seldepth"),
            nodes: readInteger(line, "nodes"),
            engineMs: readInteger(line, "time"),
            reportedNps: readInteger(line, "nps"),
            score: scoreMatch ? {type: scoreMatch[1], value: Number(scoreMatch[2])} : null
        };

        if (result.nodes === null || result.engineMs === null) {
            throw new Error(`incomplete final info line: ${line}`);
        }
        return result;
    }

    function pairPlan(count)
    {
        if (!Number.isSafeInteger(count) || count < 4 || count % 4 !== 0) {
            throw new Error("pair count must be a positive multiple of four");
        }

        return Array.from({length: count}, function (_, index) {
            return {
                pair: index + 1,
                lane: Math.floor(index / 2) % 2 === 0 ? "direct" : "mirrored",
                order: index % 2 === 0 ? ["control", "candidate"] :
                    ["candidate", "control"]
            };
        });
    }

    function summarizeRound(index, results)
    {
        const totalNodes = sum(results.map(result => result.nodes));
        const totalEngineMs = sum(results.map(result => result.engineMs));
        const totalWallMs = sum(results.map(result => result.wallMs));

        return {
            run: index + 1,
            totalNodes,
            totalEngineMs,
            totalWallMs,
            engineNps: totalNodes * 1000 / totalEngineMs,
            wallNps: totalNodes * 1000 / totalWallMs,
            signature: results.map(result => result.bestmove).join(" "),
            positions: results
        };
    }

    function summarizeVariant(rounds)
    {
        const wallNps = rounds.map(round => round.wallNps);
        const engineNps = rounds.map(round => round.engineNps);

        return {
            medianWallNps: median(wallNps),
            meanWallNps: mean(wallNps),
            minWallNps: Math.min(...wallNps),
            maxWallNps: Math.max(...wallNps),
            wallNpsCvPercent: coefficientOfVariation(wallNps),
            medianEngineNps: median(engineNps),
            bestmoveSignaturesStable: new Set(rounds.map(round => round.signature)).size === 1
        };
    }

    function geometricDelta(ratios)
    {
        if (!ratios.length) {
            return null;
        }
        return (Math.exp(mean(ratios.map(Math.log))) - 1) * 100;
    }

    function summarizePaired(pairs)
    {
        if (!pairs.length) {
            throw new Error("cannot summarize an empty pair set");
        }

        const ratios = pairs.map(pair => pair.candidate.wallNps / pair.control.wallNps);
        const logRatios = ratios.map(Math.log);
        const meanLogRatio = mean(logRatios);
        const deviation = sampleStandardDeviation(logRatios);
        let confidence95 = null;

        if (deviation !== null) {
            const margin = studentTCritical95(logRatios.length - 1) *
                deviation / Math.sqrt(logRatios.length);
            confidence95 = {
                lowerDeltaPercent: (Math.exp(meanLogRatio - margin) - 1) * 100,
                upperDeltaPercent: (Math.exp(meanLogRatio + margin) - 1) * 100
            };
        }

        function subset(predicate)
        {
            return geometricDelta(pairs.filter(predicate).map(
                pair => pair.candidate.wallNps / pair.control.wallNps
            ));
        }

        const controlFirst = subset(pair => pair.order[0] === "control");
        const candidateFirst = subset(pair => pair.order[0] === "candidate");
        const direct = subset(pair => pair.lane === "direct");
        const mirrored = subset(pair => pair.lane === "mirrored");

        return {
            pairs: pairs.length,
            ratioGeometricMean: Math.exp(meanLogRatio),
            deltaPercent: (Math.exp(meanLogRatio) - 1) * 100,
            medianPairDeltaPercent: median(ratios.map(ratio => (ratio - 1) * 100)),
            minPairDeltaPercent: (Math.min(...ratios) - 1) * 100,
            maxPairDeltaPercent: (Math.max(...ratios) - 1) * 100,
            logRatioSampleStdDev: deviation,
            confidence95,
            order: {
                controlFirstDeltaPercent: controlFirst,
                candidateFirstDeltaPercent: candidateFirst,
                biasPercent: candidateFirst - controlFirst
            },
            lane: {
                directDeltaPercent: direct,
                mirroredDeltaPercent: mirrored,
                biasPercent: mirrored - direct
            }
        };
    }

    return {
        coefficientOfVariation,
        mean,
        median,
        pairPlan,
        parseInfo,
        summarizePaired,
        summarizeRound,
        summarizeVariant
    };
}));
