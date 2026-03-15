import { beforeEach, describe, expect, it } from "vitest";
import {
  createMockProvider,
  resetOracleSpeechCooldown,
  resolveMarkets,
  resolveOracleSpeech,
  resolveScenarioPreview,
  resolveSignals
} from "../server/app";
import { createFallbackSignals, createFallbackTickers } from "../shared/oracle";

describe("terra arbitrage api", () => {
  beforeEach(() => {
    resetOracleSpeechCooldown();
  });

  it("returns synthetic markets through the proxy logic", async () => {
    const provider = createMockProvider({
      async getMarkets() {
        return {
          tickers: createFallbackTickers(),
          sourceMode: "synthetic",
          asOf: "2026-03-14T10:00:00.000Z"
        };
      }
    });

    const response = await resolveMarkets(provider);
    expect(response.tickers).toHaveLength(6);
    expect(response.sourceMode).toBe("synthetic");
  });

  it("keeps scenario preview working when everything is synthetic", async () => {
    const provider = createMockProvider({
      async getSignals() {
        return {
          signals: createFallbackSignals(),
          sourceMode: "synthetic"
        };
      }
    });

    const response = await resolveScenarioPreview(provider, {
      assetId: "KAICOIN",
      cityId: "abidjan",
      compareCityId: "reykjavik",
      patch: {
        targetCityId: "abidjan",
        rainDelta: 5,
        temperatureDelta: 2,
        windDelta: 1,
        soilMoistureDelta: 8,
        soilPhDelta: -0.2
      }
    });

    expect(response.primary.cityId).toBe("abidjan");
    expect(response.compare?.cityId).toBe("reykjavik");
    expect(response.rankings[0].travelScore).toBeGreaterThan(0);
    expect(response.feed.length).toBeGreaterThan(0);
  });

  it("filters signals and emits oracle speech payloads without a real voice key", async () => {
    const provider = createMockProvider();
    const signals = await resolveSignals(provider, "abidjan");
    const speech = await resolveOracleSpeech(provider, {
      text: "The storm has become a valuation event.",
      severity: "alert"
    });

    expect(signals.signals).toHaveLength(1);
    expect(signals.signals[0].cityId).toBe("abidjan");
    expect(speech.audioUrl).toContain("data:audio");
    expect(speech.severity).toBe("alert");
    expect(Date.parse(speech.cooldownUntil) - Date.now()).toBeGreaterThanOrEqual(11_000);
  });

  it("falls back to transcript-only oracle speech when audio generation is unavailable", async () => {
    const provider = createMockProvider({
      async speak() {
        return null;
      }
    });

    const speech = await resolveOracleSpeech(provider, {
      text: "Tokyo just turned against your holding.",
      severity: "alert"
    });

    expect(speech.text).toBe("Tokyo just turned against your holding.");
    expect(speech.audioUrl).toBeNull();
    expect(speech.severity).toBe("alert");
    expect(Date.parse(speech.cooldownUntil) - Date.now()).toBeGreaterThanOrEqual(11_000);
  });
});
