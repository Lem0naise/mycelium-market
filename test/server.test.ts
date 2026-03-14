import { describe, expect, it } from "vitest";
import {
  createMockProvider,
  resolveMarkets,
  resolveOracleSpeech,
  resolveScenarioPreview,
  resolveSignals
} from "../server/app";
import { createFallbackSignals, createFallbackTickers } from "../shared/oracle";

describe("terra arbitrage api", () => {
  it("returns fallback markets through the proxy logic", async () => {
    const provider = createMockProvider({
      async getMarkets(_mode) {
        return {
          tickers: createFallbackTickers(),
          sourceMode: "fallback",
          asOf: "2026-03-14T10:00:00.000Z"
        };
      }
    });

    const response = await resolveMarkets(provider, "live");
    expect(response.tickers).toHaveLength(7);
    expect(response.sourceMode).toBe("fallback");
  });

  it("keeps scenario preview working when everything is synthetic", async () => {
    const provider = createMockProvider({
      async getSignals(_mode) {
        return {
          signals: createFallbackSignals(),
          sourceMode: "fallback"
        };
      }
    });

    const response = await resolveScenarioPreview(provider, {
      assetId: "COCOA",
      cityId: "manaus",
      compareCityId: "reykjavik",
      patch: {
        targetCityId: "manaus",
        rainDelta: 5,
        temperatureDelta: 2,
        windDelta: 1,
        soilMoistureDelta: 8,
        soilPhDelta: -0.2
      },
      mode: "demo"
    });

    expect(response.primary.cityId).toBe("manaus");
    expect(response.compare?.cityId).toBe("reykjavik");
    expect(response.rankings[0].travelScore).toBeGreaterThan(0);
    expect(response.feed.length).toBeGreaterThan(0);
  });

  it("filters signals and emits oracle speech payloads without a real voice key", async () => {
    const provider = createMockProvider();
    const signals = await resolveSignals(provider, "live", "manaus");
    const speech = await resolveOracleSpeech(provider, {
      text: "The storm has become a valuation event.",
      severity: "alert"
    });

    expect(signals.signals).toHaveLength(1);
    expect(signals.signals[0].cityId).toBe("manaus");
    expect(speech.audioUrl).toContain("data:audio");
    expect(speech.severity).toBe("alert");
  });
});
