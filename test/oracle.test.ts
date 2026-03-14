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
  it("gives cocoa a stronger response in Abidjan than Reykjavik", () => {
    const signals = createFallbackSignals();
    const tickers = createFallbackTickers();
    const rankings = rankCities("COCOA", signals, tickers);
    const abidjan = rankings.find((entry) => entry.cityId === "abidjan");
    const reykjavik = rankings.find((entry) => entry.cityId === "reykjavik");

    expect(abidjan).toBeDefined();
    expect(reykjavik).toBeDefined();
    expect((abidjan?.travelScore ?? 0) > (reykjavik?.travelScore ?? 0)).toBe(true);
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

    const cocoa = computeOracle(assetIndex.COCOA, signal!, assetIndex.COCOA.basePrice);
    const cocoaAfterStorm = computeOracle(assetIndex.COCOA, patched, assetIndex.COCOA.basePrice);

    expect(patched.sourceMode).toBe("scenario");
    expect(cocoaAfterStorm.environmentalPressure).toBeGreaterThan(cocoa.environmentalPressure);
    expect(cocoaAfterStorm.severity === "critical" || cocoaAfterStorm.severity === "alert").toBe(true);
  });
});
