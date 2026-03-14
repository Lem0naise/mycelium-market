import { describe, expect, it } from "vitest";
import { assetIndex } from "../shared/data";
import {
  applyScenarioPatch,
  computeOracle,
  createFallbackSignals,
  createFallbackTickers,
  rankCities
} from "../shared/oracle";
import type { EnvironmentalSignal } from "../shared/types";

describe("oracle engine", () => {
  it("ranks cities in descending travel-score order for KaiCoin", () => {
    const signals = createFallbackSignals();
    const tickers = createFallbackTickers();
    const rankings = rankCities("KAICOIN", signals, tickers);

    expect(rankings).not.toHaveLength(0);
    expect(rankings[0].travelScore).toBeGreaterThanOrEqual(
      rankings[rankings.length - 1].travelScore
    );
  });

  it("responds predictably to scenario overrides", () => {
    const signal: EnvironmentalSignal = {
      cityId: "abidjan",
      region: "Gulf of Guinea",
      humidity: 60,
      rain: 4,
      temperature: 27,
      wind: 8,
      airQuality: 46,
      soilMoisture: 55,
      soilPh: 6.2,
      sourceMode: "synthetic"
    };

    const patched = applyScenarioPatch(signal, {
      targetCityId: "abidjan",
      rainDelta: 10,
      temperatureDelta: 2,
      windDelta: 0,
      soilMoistureDelta: 18,
      soilPhDelta: -0.8
    });

    const iwg = computeOracle(assetIndex["IWG"], signal, assetIndex["IWG"].basePrice);
    const iwgAfterStorm = computeOracle(
      assetIndex["IWG"],
      patched,
      assetIndex["IWG"].basePrice
    );

    expect(patched.sourceMode).toBe("synthetic");
    expect(iwgAfterStorm.earthDelta).not.toBe(iwg.earthDelta);
    expect(iwgAfterStorm.rationaleTokens).not.toEqual(iwg.rationaleTokens);
  });
});
