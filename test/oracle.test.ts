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
  it("gives cocoa a stronger response in Brazil than Reykjavik", () => {
    const signals = createFallbackSignals();
    const tickers = createFallbackTickers();
    const rankings = rankCities("COCOA", signals, tickers);
    const manaus = rankings.find((entry) => entry.cityId === "manaus");
    const reykjavik = rankings.find((entry) => entry.cityId === "reykjavik");

    expect(manaus).toBeDefined();
    expect(reykjavik).toBeDefined();
    expect((manaus?.travelScore ?? 0) > (reykjavik?.travelScore ?? 0)).toBe(true);
  });

  it("responds predictably to scenario overrides", () => {
    const signal = createFallbackSignals().find((entry) => entry.cityId === "saopaulo");
    expect(signal).toBeDefined();

    const patched = applyScenarioPatch(signal!, {
      targetCityId: "saopaulo",
      rainDelta: 6,
      temperatureDelta: 4,
      windDelta: 0,
      soilMoistureDelta: 10,
      soilPhDelta: -0.3
    });

    const cocoa = computeOracle(assetIndex.COCOA, signal!, assetIndex.COCOA.basePrice);
    const cocoaAfterStorm = computeOracle(assetIndex.COCOA, patched, assetIndex.COCOA.basePrice);

    expect(cocoaAfterStorm.earthDelta).toBeGreaterThan(cocoa.earthDelta);
    expect(cocoaAfterStorm.travelScore).toBeGreaterThan(cocoa.travelScore);
  });
});
