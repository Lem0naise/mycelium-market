import { create } from "zustand";
import { assetIndex, assetProfiles, cities } from "../../shared/data";
import type {
  MyceliumSignal,
  SignalKey,
  TradeFailureReason,
  TradeResult
} from "../../shared/types";
import { useAppStore } from "./appStore";

export type TradingState = {
  cash: number;
  holdings: Record<string, Record<string, number>>;
  prices: Record<string, Record<string, number>>;
  changePct: Record<string, Record<string, number>>;
  priceHistory: Record<string, Record<string, number[]>>;
  signalHistory: Record<string, Partial<Record<SignalKey, number[]>>>;
  buyAsset: (
    cityId: string,
    assetId: string,
    mycelium: MyceliumSignal,
    quantity?: number
  ) => Promise<TradeResult>;
  sellAsset: (
    cityId: string,
    assetId: string,
    mycelium: MyceliumSignal,
    quantity?: number
  ) => Promise<TradeResult>;
  tickAllPrices: (updates: Array<{ cityId: string; earthDeltas: Record<string, number>; mycelium?: MyceliumSignal }>) => void;
  recordAllSignals: (updates: Array<{ cityId: string; signals: Partial<Record<SignalKey, number>> }>) => void;
  resetPortfolio: () => void;
};

const INITIAL_CASH = 100000;

const initialHoldings: Record<string, Record<string, number>> = {};
const initialPrices: Record<string, Record<string, number>> = {};
const initialChangePct: Record<string, Record<string, number>> = {};
const initialPriceHistory: Record<string, Record<string, number[]>> = {};

cities.forEach((city) => {
  initialHoldings[city.id] = {};
  initialPrices[city.id] = {};
  initialChangePct[city.id] = {};
  initialPriceHistory[city.id] = {};

  assetProfiles.forEach((asset) => {
    initialHoldings[city.id][asset.id] = 0;
    initialPrices[city.id][asset.id] = asset.basePrice;
    initialChangePct[city.id][asset.id] = 0;
    initialPriceHistory[city.id][asset.id] = [asset.basePrice];
  });
});

function getMyceliumFailure(
  mycelium: MyceliumSignal
): { reason: TradeFailureReason; message: string } | null {
  const soilMoistureOk = mycelium.soilMoisture >= 20 && mycelium.soilMoisture <= 85;
  const soilPhOk = mycelium.soilPh >= 5 && mycelium.soilPh <= 8;
  const humidityOk = mycelium.humidity >= 20 && mycelium.humidity <= 80;

  // Only block trading if ALL THREE signals are outside their healthy ranges
  if (soilMoistureOk || soilPhOk || humidityOk) {
    return null;
  }

  return {
    reason: "mycelium-network-collapse",
    message: `Mycelium network has collapsed: soil moisture ${mycelium.soilMoisture.toFixed(0)}%, pH ${mycelium.soilPh.toFixed(1)}, humidity ${mycelium.humidity.toFixed(0)}% are all outside healthy ranges.`
  };
}

/** Shared pre-execution checks used by both buyAsset and sellAsset. */
async function applyPreTradeEffects(
  mycelium: MyceliumSignal
): Promise<{ blocked: false } | { blocked: true; reason: "humidity-reroute" }> {
  // Humidity > 80%: impose a 2-second execution delay
  if (mycelium.humidity > 80) {
    await new Promise<void>((res) => setTimeout(res, 2000));
  }

  // Humidity < 20%: 60% chance the signal gets scrambled → reroute
  if (mycelium.humidity < 20 && Math.random() < 0.6) {
    return { blocked: true, reason: "humidity-reroute" };
  }

  return { blocked: false };
}

export const useTradingStore = create<TradingState>()((set, get) => ({
  cash: INITIAL_CASH,
  holdings: JSON.parse(JSON.stringify(initialHoldings)),
  prices: JSON.parse(JSON.stringify(initialPrices)),
  priceHistory: JSON.parse(JSON.stringify(initialPriceHistory)),
  changePct: JSON.parse(JSON.stringify(initialChangePct)),
  signalHistory: {},

  buyAsset: async (cityId, assetId, mycelium, quantity = 1) => {
    const { currentCityId, focusedCityId, flight } = useAppStore.getState();

    if (flight) {
      return { ok: false, reason: "in-flight" };
    }

    if (currentCityId !== cityId || focusedCityId !== currentCityId) {
      return { ok: false, reason: "not-in-city" };
    }

    const myceliumFailure = getMyceliumFailure(mycelium);
    if (myceliumFailure) {
      return {
        ok: false,
        reason: myceliumFailure.reason,
        message: myceliumFailure.message
      };
    }

    // ── Humidity effects ─────────────────────────────────────────────────────
    const preCheck = await applyPreTradeEffects(mycelium);
    if (preCheck.blocked) {
      // Try to execute a random asset buy instead
      const state = get();
      const otherAssets = assetProfiles.filter((a) => a.id !== assetId);
      let redirectBuy: { assetId: string; quantity: number; executedPrice: number } | undefined;

      if (otherAssets.length > 0) {
        const randomAsset = otherAssets[Math.floor(Math.random() * otherAssets.length)];
        const randomPrice = state.prices[cityId]?.[randomAsset.id] ?? randomAsset.basePrice;

        if (state.cash >= randomPrice) {
          set((cs) => ({
            cash: cs.cash - randomPrice,
            holdings: {
              ...cs.holdings,
              [cityId]: {
                ...cs.holdings[cityId],
                [randomAsset.id]: (cs.holdings[cityId]?.[randomAsset.id] || 0) + 1
              }
            }
          }));
          redirectBuy = { assetId: randomAsset.id, quantity: 1, executedPrice: randomPrice };
        }
      }

      return {
        ok: false,
        reason: "humidity-reroute",
        message: redirectBuy
          ? `Low humidity scrambled the network — bought 1× ${redirectBuy.assetId} at £${redirectBuy.executedPrice.toFixed(2)} instead.`
          : `Low humidity scrambled the network — no affordable assets for redirect.`,
        redirectBuy
      };
    }

    // ── Price & cash checks ──────────────────────────────────────────────────
    const state = get();
    const price = state.prices[cityId]?.[assetId];
    if (!price) {
      return {
        ok: false,
        reason: "ecological-interference",
        message: "Price unavailable for this market."
      };
    }

    const cost = price * quantity;

    // Soil Moisture < 20% (Wilting): cap each trade to 10% of current balance
    if (mycelium.soilMoisture < 20) {
      const maxSpend = state.cash * 0.1;
      if (cost > maxSpend) {
        return {
          ok: false,
          reason: "moisture-wilting-cap",
          message: `Wilting roots restrict trades to 10% of balance — max £${maxSpend.toFixed(2)} per trade.`
        };
      }
    }

    // Soil Moisture > 80% (Saturated): 10× leverage — need only 1/10 of cost in cash
    if (mycelium.soilMoisture > 80) {
      if (state.cash < cost / 10) {
        return { ok: false, reason: "insufficient-cash" };
      }
    } else {
      if (state.cash < cost) {
        return { ok: false, reason: "insufficient-cash" };
      }
    }

    set((currentState) => ({
      cash: currentState.cash - cost,
      holdings: {
        ...currentState.holdings,
        [cityId]: {
          ...currentState.holdings[cityId],
          [assetId]: (currentState.holdings[cityId]?.[assetId] || 0) + quantity
        }
      }
    }));

    return {
      ok: true,
      assetId,
      cityId,
      quantity,
      executedPrice: price
    };
  },

  sellAsset: async (cityId, assetId, mycelium, quantity = 1) => {
    const { currentCityId, focusedCityId, flight } = useAppStore.getState();

    if (flight) {
      return { ok: false, reason: "in-flight" };
    }

    if (currentCityId !== cityId || focusedCityId !== currentCityId) {
      return { ok: false, reason: "not-in-city" };
    }

    const myceliumFailure = getMyceliumFailure(mycelium);
    if (myceliumFailure) {
      return {
        ok: false,
        reason: myceliumFailure.reason,
        message: myceliumFailure.message
      };
    }

    // ── Humidity effects ─────────────────────────────────────────────────────
    const preCheck = await applyPreTradeEffects(mycelium);
    if (preCheck.blocked) {
      const state = get();
      const otherAssets = assetProfiles.filter((a) => a.id !== assetId);
      let redirectBuy: { assetId: string; quantity: number; executedPrice: number } | undefined;

      if (otherAssets.length > 0) {
        const randomAsset = otherAssets[Math.floor(Math.random() * otherAssets.length)];
        const randomPrice = state.prices[cityId]?.[randomAsset.id] ?? randomAsset.basePrice;

        if (state.cash >= randomPrice) {
          set((cs) => ({
            cash: cs.cash - randomPrice,
            holdings: {
              ...cs.holdings,
              [cityId]: {
                ...cs.holdings[cityId],
                [randomAsset.id]: (cs.holdings[cityId]?.[randomAsset.id] || 0) + 1
              }
            }
          }));
          redirectBuy = { assetId: randomAsset.id, quantity: 1, executedPrice: randomPrice };
        }
      }

      return {
        ok: false,
        reason: "humidity-reroute",
        message: redirectBuy
          ? `Low humidity scrambled the network — bought 1× ${redirectBuy.assetId} at £${redirectBuy.executedPrice.toFixed(2)} instead.`
          : `Low humidity scrambled the network — no affordable assets for redirect.`,
        redirectBuy
      };
    }

    // ── Holdings & price checks ───────────────────────────────────────────────
    const state = get();
    const currentHoldings = state.holdings[cityId]?.[assetId] || 0;
    if (currentHoldings < quantity) {
      return { ok: false, reason: "no-holdings" };
    }

    const price = state.prices[cityId]?.[assetId];
    if (!price) {
      return {
        ok: false,
        reason: "ecological-interference",
        message: "Price unavailable for this market."
      };
    }

    const revenue = price * quantity;

    set((currentState) => ({
      cash: currentState.cash + revenue,
      holdings: {
        ...currentState.holdings,
        [cityId]: {
          ...currentState.holdings[cityId],
          [assetId]: currentHoldings - quantity
        }
      }
    }));

    return {
      ok: true,
      assetId,
      cityId,
      quantity,
      executedPrice: price
    };
  },

  tickAllPrices: (updates) =>
    set((state) => {
      const newPrices = { ...state.prices };
      const newPriceHistory = { ...state.priceHistory };
      const newChangePct = { ...state.changePct };

      updates.forEach(({ cityId, earthDeltas, mycelium }) => {
        const newCityPrices = { ...newPrices[cityId] };
        const newCityChangePct = { ...newChangePct[cityId] };
        const newCityPriceHistory = { ...newPriceHistory[cityId] };

        const pH = mycelium?.soilPh ?? 6.5;
        const pHVolatilityFactor = pH < 5.5 ? 2 : pH > 7.5 ? 0.5 : 1; // VOLATILITY OF PH of soil

        Object.keys(newCityPrices).forEach((assetId) => {
          const delta = earthDeltas[assetId] || 0;
          const oldPrice = newCityPrices[assetId];
          const basePrice = assetIndex[assetId]?.basePrice ?? oldPrice;

          const logShift = delta * 0.006 * pHVolatilityFactor;
          const meanRevPull = -0.001 * (Math.log(oldPrice) - Math.log(basePrice));
          const logNoise = (Math.random() - 0.5) * 0.03 * pHVolatilityFactor;

          const newPrice = Math.max(0.01, Math.exp(Math.log(oldPrice) + logShift + meanRevPull + logNoise));
          newCityPrices[assetId] = newPrice;

          const WINDOW = 40;
          const prevHistory = newCityPriceHistory[assetId] || [basePrice];
          newCityPriceHistory[assetId] = [...prevHistory, newPrice].slice(-WINDOW);

          const rawChangePct = ((newPrice - oldPrice) / oldPrice) * 100;
          newCityChangePct[assetId] = Number(rawChangePct.toFixed(2));
        });

        newPrices[cityId] = newCityPrices;
        newPriceHistory[cityId] = newCityPriceHistory;
        newChangePct[cityId] = newCityChangePct;
      });

      return {
        prices: newPrices,
        priceHistory: newPriceHistory,
        changePct: newChangePct
      };
    }),

  resetPortfolio: () =>
    set({
      cash: INITIAL_CASH,
      holdings: JSON.parse(JSON.stringify(initialHoldings)),
      prices: JSON.parse(JSON.stringify(initialPrices)),
      priceHistory: JSON.parse(JSON.stringify(initialPriceHistory)),
      changePct: JSON.parse(JSON.stringify(initialChangePct)),
      signalHistory: {}
    }),

  recordAllSignals: (updates) =>
    set((state) => {
      const WINDOW = 10;
      const newSignalHistory = { ...state.signalHistory };

      updates.forEach(({ cityId, signals }) => {
        const cityHistory = { ...(newSignalHistory[cityId] ?? {}) };

        (Object.keys(signals) as SignalKey[]).forEach((key) => {
          const value = signals[key];
          if (value === undefined) {
            return;
          }

          const previous = cityHistory[key] ?? [];
          cityHistory[key] = [...previous, value].slice(-WINDOW);
        });

        newSignalHistory[cityId] = cityHistory;
      });

      return {
        signalHistory: newSignalHistory
      };
    })
}));
