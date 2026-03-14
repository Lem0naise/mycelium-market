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
  tickPrices: (cityId: string, earthDeltas: Record<string, number>) => void;
  recordSignals: (cityId: string, signals: Partial<Record<SignalKey, number>>) => void;
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
  if (mycelium.soilMoisture < 20) {
    return {
      reason: "mycelium-too-dry",
      message: `Soil moisture ${mycelium.soilMoisture.toFixed(0)}% is too dry for the mycelium network.`
    };
  }

  if (mycelium.soilMoisture > 85) {
    return {
      reason: "mycelium-waterlogged",
      message: `Soil moisture ${mycelium.soilMoisture.toFixed(0)}% has waterlogged the mycelium network.`
    };
  }

  if (mycelium.soilPh < 5) {
    return {
      reason: "mycelium-too-acidic",
      message: `Soil pH ${mycelium.soilPh.toFixed(1)} is too acidic for the mycelium network.`
    };
  }

  if (mycelium.soilPh > 8) {
    return {
      reason: "mycelium-too-alkaline",
      message: `Soil pH ${mycelium.soilPh.toFixed(1)} is too alkaline for the mycelium network.`
    };
  }

  if (mycelium.humidity < 25) {
    return {
      reason: "mycelium-too-arid",
      message: `Humidity ${mycelium.humidity.toFixed(0)}% is too low for the mycelium network.`
    };
  }

  if (mycelium.humidity > 88) {
    return {
      reason: "mycelium-oversaturated",
      message: `Humidity ${mycelium.humidity.toFixed(0)}% is oversaturating the mycelium network.`
    };
  }

  return null;
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
    if (state.cash < cost) {
      return { ok: false, reason: "insufficient-cash" };
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

  tickPrices: (cityId, earthDeltas) =>
    set((state) => {
      const newCityPrices = { ...state.prices[cityId] };
      const newCityChangePct = { ...state.changePct[cityId] };
      const newCityPriceHistory = { ...state.priceHistory[cityId] };

      Object.keys(newCityPrices).forEach((assetId) => {
        const delta = earthDeltas[assetId] || 0;
        const oldPrice = newCityPrices[assetId];
        const basePrice = assetIndex[assetId]?.basePrice ?? oldPrice;

        // New, highly volatile code
        // 1. Environmental Impact: Increased 5x so weather changes hit the price much harder
        const logShift = delta * 0.01;

        // 2. Mean Reversion: Weakened by 5x. The "rubber band" pulling it back to basePrice 
        // is much looser now, allowing the stock to go on massive bull or bear runs.
        const meanRevPull = -0.005 * (Math.log(oldPrice) - Math.log(basePrice));

        // 3. Random Noise: Increased 5x. Creates a wilder ±1.5% random swing per tick, 
        // ensuring the chart looks highly active and volatile.
        const logNoise = (Math.random() - 0.5) * 0.03;

        const newPrice = Math.max(0.01, Math.exp(Math.log(oldPrice) + logShift + meanRevPull + logNoise));
        newCityPrices[assetId] = newPrice;

        const WINDOW = 40;
        const prevHistory = newCityPriceHistory[assetId] || [basePrice];
        newCityPriceHistory[assetId] = [...prevHistory, newPrice].slice(-WINDOW);

        // Raw single-tick change — no rolling average, no lag.
        const rawChangePct = ((newPrice - oldPrice) / oldPrice) * 100;
        newCityChangePct[assetId] = Number(rawChangePct.toFixed(2));
      });

      return {
        prices: { ...state.prices, [cityId]: newCityPrices },
        priceHistory: { ...state.priceHistory, [cityId]: newCityPriceHistory },
        changePct: { ...state.changePct, [cityId]: newCityChangePct }
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

  recordSignals: (cityId, signals) =>
    set((state) => {
      const WINDOW = 10;
      const cityHistory = { ...(state.signalHistory[cityId] ?? {}) };

      (Object.keys(signals) as SignalKey[]).forEach((key) => {
        const value = signals[key];
        if (value === undefined) {
          return;
        }

        const previous = cityHistory[key] ?? [];
        cityHistory[key] = [...previous, value].slice(-WINDOW);
      });

      return {
        signalHistory: {
          ...state.signalHistory,
          [cityId]: cityHistory
        }
      };
    })
}));
