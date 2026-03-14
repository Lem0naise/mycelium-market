import { beforeEach, describe, expect, it } from "vitest";
import { createFlightState } from "../shared/simulation";
import { useAppStore } from "../src/store/appStore";
import { useTradingStore } from "../src/store/tradingStore";

describe("trading store location gating", () => {
  beforeEach(() => {
    useTradingStore.getState().resetPortfolio();
    useAppStore.setState({
      selectedAssetId: "KAI",
      focusedCityId: "abidjan",
      currentCityId: "abidjan",
      flight: null
    });
  });

  it("rejects trades when the player is not in the focused city", async () => {
    useAppStore.setState({
      focusedCityId: "tokyo",
      currentCityId: "abidjan",
      flight: null
    });

    const result = await useTradingStore.getState().buyAsset("tokyo", "KAI", 55, 1);

    expect(result).toEqual({ ok: false, reason: "not-in-city" });
  });

  it("rejects trades while the player is in flight", async () => {
    useAppStore.setState({
      focusedCityId: "tokyo",
      currentCityId: "abidjan",
      flight: createFlightState("abidjan", "tokyo", 0)
    });

    const result = await useTradingStore.getState().buyAsset("tokyo", "KAI", 55, 1);

    expect(result).toEqual({ ok: false, reason: "in-flight" });
  });

  it("allows local buys when grounded in the active city", async () => {
    const result = await useTradingStore.getState().buyAsset("abidjan", "KAI", 55, 1);

    expect(result.ok).toBe(true);
    expect(useTradingStore.getState().holdings.abidjan.KAI).toBe(1);
  });
});
