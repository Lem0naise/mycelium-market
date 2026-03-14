import { describe, expect, it } from "vitest";
import { assetIndex } from "../shared/data";
import {
  applyScenarioPatch,
  computeOracle,
  createFallbackSignals,
  createFallbackTickers,
  rankCities
} from "../shared/oracle";

describe("oracle engine", () => {
  it("ranks cities in descending travel-score order for KaiCoin", () => {
    const signals = createFallbackSignals();
    const tickers = createFallbackTickers();
    const rankings = rankCities("KAI", signals, tickers);

    expect(rankings).not.toHaveLength(0);
    expect(rankings[0].travelScore).toBeGreaterThanOrEqual(
      rankings[rankings.length - 1].travelScore
    );
  });

  it("responds predictably to scenario overrides", () => {
    const signal = createFallbackSignals().find((entry) => entry.cityId === "abidjan");
    expect(signal).toBeDefined();

    const patched = applyScenarioPatch(signal!, {
      targetCityId: "abidjan",
      rainDelta: 10,
      temperatureDelta: 2,
      windDelta: 0,
      soilMoistureDelta: 18,
      soilPhDelta: -0.8
    });

    const kai = computeOracle(assetIndex["KAI"], signal!, assetIndex["KAI"].basePrice);
    const kaiAfterStorm = computeOracle(
      assetIndex["KAI"],
      patched,
      assetIndex["KAI"].basePrice
    );

    expect(patched.sourceMode).toBe("synthetic");
    expect(kaiAfterStorm.environmentalPressure).toBeGreaterThan(kai.environmentalPressure);
    expect(kaiAfterStorm.severity === "watch" || kaiAfterStorm.severity === "alert" || kaiAfterStorm.severity === "critical").toBe(true);
  });
});
