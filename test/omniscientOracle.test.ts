import { describe, expect, it } from "vitest";
import { assetProfiles, cities } from "../shared/data";
import {
  createInitialOracleWatchState,
  evaluateOracleNotifications
} from "../shared/omniscientOracle";
import { createFallbackSignals, createFallbackTickers } from "../shared/oracle";

function buildPriceBook() {
  return Object.fromEntries(
    cities.map((city) => [
      city.id,
      Object.fromEntries(assetProfiles.map((asset) => [asset.id, asset.basePrice]))
    ])
  ) as Record<string, Record<string, number>>;
}

function buildHoldings() {
  return Object.fromEntries(
    cities.map((city) => [
      city.id,
      Object.fromEntries(assetProfiles.map((asset) => [asset.id, 0]))
    ])
  ) as Record<string, Record<string, number>>;
}

function patchSignals(
  cityId: string,
  overrides: Partial<ReturnType<typeof createFallbackSignals>[number]>,
  base = createFallbackSignals()
) {
  return base.map((signal) => (signal.cityId === cityId ? { ...signal, ...overrides } : signal));
}

describe("omniscient oracle", () => {
  it("emits storm entry and quiet recovery notifications for significant city exposure", () => {
    const holdings = buildHoldings();
    holdings.abidjan.KAICOIN = 1;
    const prices = buildPriceBook();
    const tickers = createFallbackTickers();
    const signals = createFallbackSignals();

    const seeded = evaluateOracleNotifications({
      signals,
      holdings,
      prices,
      tickers,
      cash: 0,
      blockedCityIds: [],
      currentCityId: "southampton",
      focusedCityId: "southampton",
      flight: null,
      previousState: createInitialOracleWatchState(),
      now: "2026-03-14T10:00:00.000Z"
    });

    const stormEntry = evaluateOracleNotifications({
      signals,
      holdings,
      prices,
      tickers,
      cash: 0,
      blockedCityIds: ["abidjan"],
      currentCityId: "southampton",
      focusedCityId: "southampton",
      flight: null,
      previousState: seeded.nextState,
      now: "2026-03-14T10:00:20.000Z"
    });

    expect(stormEntry.notifications).toHaveLength(1);
    expect(stormEntry.notifications[0].category).toBe("storm");
    expect(stormEntry.speakable?.eventKey).toBe("storm-abidjan");

    const unchanged = evaluateOracleNotifications({
      signals,
      holdings,
      prices,
      tickers,
      cash: 0,
      blockedCityIds: ["abidjan"],
      currentCityId: "southampton",
      focusedCityId: "southampton",
      flight: null,
      previousState: stormEntry.nextState,
      now: "2026-03-14T10:00:40.000Z"
    });

    expect(unchanged.notifications).toHaveLength(0);

    const cleared = evaluateOracleNotifications({
      signals,
      holdings,
      prices,
      tickers,
      cash: 0,
      blockedCityIds: [],
      currentCityId: "southampton",
      focusedCityId: "southampton",
      flight: null,
      previousState: unchanged.nextState,
      now: "2026-03-14T10:01:00.000Z"
    });

    expect(cleared.notifications).toHaveLength(1);
    expect(cleared.notifications[0].category).toBe("recovery");
    expect(cleared.notifications[0].state).toBe("resolved");
    expect(cleared.speakable?.eventKey).toBe("storm-abidjan");
  });

  it("makes alert-level storm exposure speakable when a remote holding is materially exposed", () => {
    const holdings = buildHoldings();
    holdings.abidjan.KAICOIN = 1;
    const prices = buildPriceBook();
    const tickers = createFallbackTickers();
    const signals = createFallbackSignals();

    const seeded = evaluateOracleNotifications({
      signals,
      holdings,
      prices,
      tickers,
      cash: 840_000,
      blockedCityIds: [],
      currentCityId: "southampton",
      focusedCityId: "southampton",
      flight: null,
      previousState: createInitialOracleWatchState(),
      now: "2026-03-14T10:00:00.000Z"
    });

    const result = evaluateOracleNotifications({
      signals,
      holdings,
      prices,
      tickers,
      cash: 840_000,
      blockedCityIds: ["abidjan"],
      currentCityId: "southampton",
      focusedCityId: "southampton",
      flight: null,
      previousState: seeded.nextState,
      now: "2026-03-14T10:00:20.000Z"
    });

    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0].severity).toBe("alert");
    expect(result.notifications[0].speakText).toMatch(/storm track/i);
    expect(result.speakable?.eventKey).toBe("storm-abidjan");
  });

  it("ignores storms on tiny remote positions", () => {
    const holdings = buildHoldings();
    holdings.abidjan.IWG = 1;
    const prices = buildPriceBook();
    const tickers = createFallbackTickers();
    const signals = createFallbackSignals();

    const seeded = evaluateOracleNotifications({
      signals,
      holdings,
      prices,
      tickers,
      cash: 100_000,
      blockedCityIds: [],
      currentCityId: "southampton",
      focusedCityId: "southampton",
      flight: null,
      previousState: createInitialOracleWatchState(),
      now: "2026-03-14T10:00:00.000Z"
    });

    const result = evaluateOracleNotifications({
      signals,
      holdings,
      prices,
      tickers,
      cash: 100_000,
      blockedCityIds: ["abidjan"],
      currentCityId: "southampton",
      focusedCityId: "southampton",
      flight: null,
      previousState: seeded.nextState,
      now: "2026-03-14T10:00:20.000Z"
    });

    expect(result.notifications).toHaveLength(0);
  });

  it("detects exact-city driver reversals for held positions", () => {
    const holdings = buildHoldings();
    holdings.abidjan.KAICOIN = 1;
    const prices = buildPriceBook();
    const tickers = createFallbackTickers();
    const lowAirSignals = patchSignals("abidjan", { airQuality: 10 });
    const highAirSignals = patchSignals("abidjan", { airQuality: 120 }, lowAirSignals);

    const seeded = evaluateOracleNotifications({
      signals: lowAirSignals,
      holdings,
      prices,
      tickers,
      cash: 0,
      blockedCityIds: [],
      currentCityId: "southampton",
      focusedCityId: "abidjan",
      flight: null,
      previousState: createInitialOracleWatchState(),
      now: "2026-03-14T10:00:00.000Z"
    });

    const result = evaluateOracleNotifications({
      signals: highAirSignals,
      holdings,
      prices,
      tickers,
      cash: 0,
      blockedCityIds: [],
      currentCityId: "southampton",
      focusedCityId: "abidjan",
      flight: null,
      previousState: seeded.nextState,
      now: "2026-03-14T10:00:20.000Z"
    });

    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0].eventKey).toBe("driver-abidjan-KAICOIN");
    expect(result.notifications[0].title).toMatch(/strengthening/i);
    expect(result.notifications[0].severity).toBe("alert");
    expect(result.speakable?.eventKey).toBe("driver-abidjan-KAICOIN");
  });

  it("keeps speaking enabled when a held position materially reprices back toward calm", () => {
    const holdings = buildHoldings();
    holdings.abidjan.KAICOIN = 1;
    const prices = buildPriceBook();
    const tickers = createFallbackTickers();
    const extremeSignals = patchSignals("abidjan", { airQuality: 120 });
    const calmerSignals = patchSignals("abidjan", { airQuality: 65 }, extremeSignals);

    const seeded = evaluateOracleNotifications({
      signals: extremeSignals,
      holdings,
      prices,
      tickers,
      cash: 0,
      blockedCityIds: [],
      currentCityId: "southampton",
      focusedCityId: "abidjan",
      flight: null,
      previousState: createInitialOracleWatchState(),
      now: "2026-03-14T10:00:00.000Z"
    });

    const result = evaluateOracleNotifications({
      signals: calmerSignals,
      holdings,
      prices,
      tickers,
      cash: 0,
      blockedCityIds: [],
      currentCityId: "southampton",
      focusedCityId: "abidjan",
      flight: null,
      previousState: seeded.nextState,
      now: "2026-03-14T10:00:20.000Z"
    });

    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0].speakText).toBeTruthy();
    expect(result.speakable?.eventKey).toBe("driver-abidjan-KAICOIN");
  });

  it("does not create cross-city driver alerts for assets held elsewhere", () => {
    const holdings = buildHoldings();
    holdings.tokyo.KAICOIN = 1;
    const prices = buildPriceBook();
    const tickers = createFallbackTickers();
    const lowAirSignals = patchSignals("abidjan", { airQuality: 10 });
    const highAirSignals = patchSignals("abidjan", { airQuality: 120 }, lowAirSignals);

    const seeded = evaluateOracleNotifications({
      signals: lowAirSignals,
      holdings,
      prices,
      tickers,
      cash: 0,
      blockedCityIds: [],
      currentCityId: "southampton",
      focusedCityId: "abidjan",
      flight: null,
      previousState: createInitialOracleWatchState(),
      now: "2026-03-14T10:00:00.000Z"
    });

    const result = evaluateOracleNotifications({
      signals: highAirSignals,
      holdings,
      prices,
      tickers,
      cash: 0,
      blockedCityIds: [],
      currentCityId: "southampton",
      focusedCityId: "abidjan",
      flight: null,
      previousState: seeded.nextState,
      now: "2026-03-14T10:00:20.000Z"
    });

    expect(result.notifications).toHaveLength(0);
  });

  it("surfaces remote market signals for assets not yet held", () => {
    const holdings = buildHoldings();
    const prices = buildPriceBook();
    const tickers = createFallbackTickers();
    const baseSignals = patchSignals("tokyo", { wind: 14 });
    const boostedSignals = patchSignals("tokyo", { wind: 34 }, baseSignals);

    const seeded = evaluateOracleNotifications({
      signals: baseSignals,
      holdings,
      prices,
      tickers,
      cash: 50_000,
      blockedCityIds: [],
      currentCityId: "southampton",
      focusedCityId: "tokyo",
      flight: null,
      previousState: createInitialOracleWatchState(),
      now: "2026-03-14T10:00:00.000Z"
    });

    const result = evaluateOracleNotifications({
      signals: boostedSignals,
      holdings,
      prices,
      tickers,
      cash: 50_000,
      blockedCityIds: [],
      currentCityId: "southampton",
      focusedCityId: "tokyo",
      flight: null,
      previousState: seeded.nextState,
      now: "2026-03-14T10:00:12.000Z"
    });

    expect(result.notifications.some((notification) => notification.category === "opportunity")).toBe(
      true
    );
    expect(
      result.notifications.some(
        (notification) =>
          notification.category === "opportunity" &&
          /wind/i.test(notification.body) &&
          /implied move/i.test(notification.body)
      )
    ).toBe(true);
    expect(result.speakable?.category).toBe("opportunity");
  });

  it("surfaces a strong opportunity in a non-focused city", () => {
    const holdings = buildHoldings();
    const prices = buildPriceBook();
    const tickers = createFallbackTickers();
    const baseSignals = patchSignals("tokyo", { wind: 12 });
    const boostedSignals = patchSignals("tokyo", { wind: 36 }, baseSignals);

    const seeded = evaluateOracleNotifications({
      signals: baseSignals,
      holdings,
      prices,
      tickers,
      cash: 50_000,
      blockedCityIds: [],
      currentCityId: "southampton",
      focusedCityId: "abidjan",
      flight: null,
      previousState: createInitialOracleWatchState(),
      now: "2026-03-14T10:00:00.000Z"
    });

    const result = evaluateOracleNotifications({
      signals: boostedSignals,
      holdings,
      prices,
      tickers,
      cash: 50_000,
      blockedCityIds: [],
      currentCityId: "southampton",
      focusedCityId: "abidjan",
      flight: null,
      previousState: seeded.nextState,
      now: "2026-03-14T10:00:12.000Z"
    });

    expect(result.notifications.some((notification) => notification.cityIds.includes("tokyo"))).toBe(true);
    expect(result.notifications.some((notification) => notification.category === "opportunity")).toBe(
      true
    );
  });

  it("tracks remote storm blocks for held cities that are not focused", () => {
    const holdings = buildHoldings();
    holdings.tokyo.KAICOIN = 1;
    const prices = buildPriceBook();
    const tickers = createFallbackTickers();
    const signals = createFallbackSignals();

    const seeded = evaluateOracleNotifications({
      signals,
      holdings,
      prices,
      tickers,
      cash: 0,
      blockedCityIds: [],
      currentCityId: "southampton",
      focusedCityId: "abidjan",
      flight: null,
      previousState: createInitialOracleWatchState(),
      now: "2026-03-14T10:00:00.000Z"
    });

    const result = evaluateOracleNotifications({
      signals,
      holdings,
      prices,
      tickers,
      cash: 0,
      blockedCityIds: ["tokyo"],
      currentCityId: "southampton",
      focusedCityId: "abidjan",
      flight: null,
      previousState: seeded.nextState,
      now: "2026-03-14T10:00:20.000Z"
    });

    expect(result.notifications.some((notification) => notification.eventKey === "storm-tokyo")).toBe(true);
  });

  it("tracks remote mycelium closures for held cities that are not focused", () => {
    const holdings = buildHoldings();
    holdings.tokyo.EMB = 100;
    const prices = buildPriceBook();
    const tickers = createFallbackTickers();
    const openSignals = patchSignals("tokyo", {
      soilMoisture: 55,
      soilPh: 6.4,
      humidity: 55
    });
    const blockedSignals = patchSignals(
      "tokyo",
      {
        soilMoisture: 10,
        soilPh: 4.3,
        humidity: 10
      },
      openSignals
    );

    const seeded = evaluateOracleNotifications({
      signals: openSignals,
      holdings,
      prices,
      tickers,
      cash: 0,
      blockedCityIds: [],
      currentCityId: "southampton",
      focusedCityId: "abidjan",
      flight: null,
      previousState: createInitialOracleWatchState(),
      now: "2026-03-14T10:00:00.000Z"
    });

    const result = evaluateOracleNotifications({
      signals: blockedSignals,
      holdings,
      prices,
      tickers,
      cash: 0,
      blockedCityIds: [],
      currentCityId: "southampton",
      focusedCityId: "abidjan",
      flight: null,
      previousState: seeded.nextState,
      now: "2026-03-14T10:00:20.000Z"
    });

    expect(result.notifications.some((notification) => notification.eventKey === "mycelium-tokyo")).toBe(
      true
    );
    expect(
      result.notifications.some(
        (notification) =>
          notification.eventKey === "mycelium-tokyo" &&
          /soil moisture/i.test(notification.body) &&
          /humidity/i.test(notification.body) &&
          /pH/i.test(notification.body)
      )
    ).toBe(true);
  });

  it("stays quiet when mycelium access changes in the current city", () => {
    const holdings = buildHoldings();
    holdings.abidjan.EMB = 100;
    const prices = buildPriceBook();
    const tickers = createFallbackTickers();
    const openSignals = patchSignals("abidjan", {
      soilMoisture: 55,
      soilPh: 6.4,
      humidity: 55
    });
    const blockedSignals = patchSignals(
      "abidjan",
      {
        soilMoisture: 10,
        soilPh: 6.4,
        humidity: 55
      },
      openSignals
    );

    const seeded = evaluateOracleNotifications({
      signals: openSignals,
      holdings,
      prices,
      tickers,
      cash: 0,
      blockedCityIds: [],
      currentCityId: "abidjan",
      focusedCityId: "abidjan",
      flight: null,
      previousState: createInitialOracleWatchState(),
      now: "2026-03-14T10:00:00.000Z"
    });

    const closed = evaluateOracleNotifications({
      signals: blockedSignals,
      holdings,
      prices,
      tickers,
      cash: 0,
      blockedCityIds: [],
      currentCityId: "abidjan",
      focusedCityId: "abidjan",
      flight: null,
      previousState: seeded.nextState,
      now: "2026-03-14T10:00:20.000Z"
    });

    expect(closed.notifications).toHaveLength(0);

    const reopened = evaluateOracleNotifications({
      signals: openSignals,
      holdings,
      prices,
      tickers,
      cash: 0,
      blockedCityIds: [],
      currentCityId: "abidjan",
      focusedCityId: "abidjan",
      flight: null,
      previousState: closed.nextState,
      now: "2026-03-14T10:00:40.000Z"
    });

    expect(reopened.notifications).toHaveLength(0);
  });

  it("stays quiet when the current city itself gets stormed", () => {
    const holdings = buildHoldings();
    holdings.abidjan.KAICOIN = 1;
    const prices = buildPriceBook();
    const tickers = createFallbackTickers();
    const signals = createFallbackSignals();

    const seeded = evaluateOracleNotifications({
      signals,
      holdings,
      prices,
      tickers,
      cash: 0,
      blockedCityIds: [],
      currentCityId: "abidjan",
      focusedCityId: "abidjan",
      flight: null,
      previousState: createInitialOracleWatchState(),
      now: "2026-03-14T10:00:00.000Z"
    });

    const stormed = evaluateOracleNotifications({
      signals,
      holdings,
      prices,
      tickers,
      cash: 0,
      blockedCityIds: ["abidjan"],
      currentCityId: "abidjan",
      focusedCityId: "abidjan",
      flight: null,
      previousState: seeded.nextState,
      now: "2026-03-14T10:00:20.000Z"
    });

    expect(stormed.notifications).toHaveLength(0);
  });

  it("alerts when a significant remote destination market becomes blocked", () => {
    const holdings = buildHoldings();
    holdings.tokyo.KAICOIN = 1;
    const prices = buildPriceBook();
    const tickers = createFallbackTickers();
    const signals = createFallbackSignals();

    const seeded = evaluateOracleNotifications({
      signals,
      holdings,
      prices,
      tickers,
      cash: 0,
      blockedCityIds: [],
      currentCityId: "abidjan",
      focusedCityId: "tokyo",
      flight: null,
      previousState: createInitialOracleWatchState(),
      now: "2026-03-14T10:00:00.000Z"
    });

    const blocked = evaluateOracleNotifications({
      signals,
      holdings,
      prices,
      tickers,
      cash: 0,
      blockedCityIds: ["tokyo"],
      currentCityId: "abidjan",
      focusedCityId: "tokyo",
      flight: null,
      previousState: seeded.nextState,
      now: "2026-03-14T10:00:20.000Z"
    });

    expect(blocked.notifications.some((notification) => /route to tokyo/i.test(notification.title))).toBe(true);
  });
});
