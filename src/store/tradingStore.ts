import { create } from "zustand";
import { assetProfiles, cities } from "../../shared/data";
import type { SignalKey } from "../../shared/types";

// The three mycelium signals that can block trading when out of range.
// Safe zones: soilMoisture 20–85, soilPh 5–8, humidity 25–88.
export type MyceliumSignal = {
  soilMoisture: number;
  soilPh: number;
  humidity: number;
};

export type TradeResult = { ok: true } | { ok: false; reason: string };

export type TradingState = {
  cash: number;
  holdings: Record<string, Record<string, number>>; // cityId -> assetId -> quantity
  prices: Record<string, Record<string, number>>; // cityId -> assetId -> price
  changePct: Record<string, Record<string, number>>; // cityId -> assetId -> rolling 3-tick avg changePct
  changePctHistory: Record<string, Record<string, number[]>>; // cityId -> assetId -> last 3 raw tick changePcts
  // Rolling history of the last 5 signal readings per city/key (used for 5-week avg)
  signalHistory: Record<string, Partial<Record<SignalKey, number[]>>>;

  buyAsset: (cityId: string, assetId: string, mycelium: MyceliumSignal, quantity?: number) => Promise<TradeResult>;
  sellAsset: (cityId: string, assetId: string, mycelium: MyceliumSignal, quantity?: number) => Promise<TradeResult>;
  tickPrices: (cityId: string, earthDeltas: Record<string, number>) => void;
  recordSignals: (cityId: string, signals: Partial<Record<SignalKey, number>>) => void;
  resetPortfolio: () => void;
};

const INITIAL_CASH = 1000000;

const initialHoldings: Record<string, Record<string, number>> = {};
const initialPrices: Record<string, Record<string, number>> = {};
const initialChangePct: Record<string, Record<string, number>> = {};

cities.forEach(city => {
  initialHoldings[city.id] = {};
  initialPrices[city.id] = {};
  initialChangePct[city.id] = {};

  assetProfiles.forEach((asset) => {
    initialHoldings[city.id][asset.id] = 0;
    initialPrices[city.id][asset.id] = asset.basePrice;
    initialChangePct[city.id][asset.id] = 0;
  });
});

export const useTradingStore = create<TradingState>()(
  (set, get) => ({
    cash: INITIAL_CASH,
    holdings: JSON.parse(JSON.stringify(initialHoldings)),
    prices: JSON.parse(JSON.stringify(initialPrices)),
    changePct: JSON.parse(JSON.stringify(initialChangePct)),
    changePctHistory: {},
    signalHistory: {},

    buyAsset: async (cityId, assetId, mycelium, quantity = 1) => {
      // Mycelium network checks — hard block when conditions are out of safe range
      if (mycelium.soilMoisture < 20)
        return { ok: false, reason: `Soil moisture ${mycelium.soilMoisture.toFixed(0)}% — too dry for mycelium network` };
      if (mycelium.soilMoisture > 85)
        return { ok: false, reason: `Soil moisture ${mycelium.soilMoisture.toFixed(0)}% — network waterlogged` };
      if (mycelium.soilPh < 5)
        return { ok: false, reason: `Soil pH ${mycelium.soilPh.toFixed(1)} — too acidic, mycelium disrupted` };
      if (mycelium.soilPh > 8)
        return { ok: false, reason: `Soil pH ${mycelium.soilPh.toFixed(1)} — too alkaline, mycelium disrupted` };
      if (mycelium.humidity < 25)
        return { ok: false, reason: `Humidity ${mycelium.humidity.toFixed(0)}% — too dry, mycelium dormant` };
      if (mycelium.humidity > 88)
        return { ok: false, reason: `Humidity ${mycelium.humidity.toFixed(0)}% — oversaturated, mycelium disrupted` };

      const state = get();
      const price = state.prices[cityId]?.[assetId];
      if (!price) return { ok: false, reason: "Price unavailable" };

      const cost = price * quantity;
      if (state.cash >= cost) {
        const priceImpact = 1 + (0.005 * quantity);
        set((s) => ({
          cash: s.cash - cost,
          holdings: {
            ...s.holdings,
            [cityId]: {
              ...s.holdings[cityId],
              [assetId]: (s.holdings[cityId]?.[assetId] || 0) + quantity
            }
          },
          prices: {
            ...s.prices,
            [cityId]: {
              ...s.prices[cityId],
              [assetId]: s.prices[cityId][assetId] * priceImpact
            }
          }
        }));
        return { ok: true };
      }
      return { ok: false, reason: "Insufficient funds" };
    },

    sellAsset: async (cityId, assetId, mycelium, quantity = 1) => {
      // Mycelium network checks — hard block when conditions are out of safe range
      if (mycelium.soilMoisture < 20)
        return { ok: false, reason: `Soil moisture ${mycelium.soilMoisture.toFixed(0)}% — too dry for mycelium network` };
      if (mycelium.soilMoisture > 85)
        return { ok: false, reason: `Soil moisture ${mycelium.soilMoisture.toFixed(0)}% — network waterlogged` };
      if (mycelium.soilPh < 5)
        return { ok: false, reason: `Soil pH ${mycelium.soilPh.toFixed(1)} — too acidic, mycelium disrupted` };
      if (mycelium.soilPh > 8)
        return { ok: false, reason: `Soil pH ${mycelium.soilPh.toFixed(1)} — too alkaline, mycelium disrupted` };
      if (mycelium.humidity < 25)
        return { ok: false, reason: `Humidity ${mycelium.humidity.toFixed(0)}% — too dry, mycelium dormant` };
      if (mycelium.humidity > 88)
        return { ok: false, reason: `Humidity ${mycelium.humidity.toFixed(0)}% — oversaturated, mycelium disrupted` };

      const state = get();
      const currentHoldings = state.holdings[cityId]?.[assetId] || 0;
      if (currentHoldings >= quantity) {
        const price = state.prices[cityId]?.[assetId];
        if (!price) return { ok: false, reason: "Price unavailable" };

        const revenue = price * quantity;
        const priceImpact = 1 - (0.005 * quantity);

        set((s) => ({
          cash: s.cash + revenue,
          holdings: {
            ...s.holdings,
            [cityId]: {
              ...s.holdings[cityId],
              [assetId]: currentHoldings - quantity
            }
          },
          prices: {
            ...s.prices,
            [cityId]: {
              ...s.prices[cityId],
              [assetId]: Math.max(0.01, s.prices[cityId][assetId] * priceImpact)
            }
          }
        }));
        return { ok: true };
      }
      return { ok: false, reason: "No holdings to sell" };
    },

    tickPrices: (cityId, earthDeltas) =>
      set((state) => {
        const newCityPrices = { ...state.prices[cityId] };
        const newCityChangePct = { ...state.changePct[cityId] };
        const newCityChangePctHistory = { ...(state.changePctHistory[cityId] ?? {}) };

        Object.keys(newCityPrices).forEach((assetId) => {
          const delta = earthDeltas[assetId] || 0;
          const baseMultiplier = 1 + (delta * 0.001);
          const volatility = 1 + (Math.random() - 0.5) * 0.005; // ±0.25% random noise

          const oldPrice = newCityPrices[assetId];
          const newPrice = Math.max(0.01, oldPrice * baseMultiplier * volatility);
          newCityPrices[assetId] = newPrice;

          // Rolling 3-tick average changePct (smooths out per-tick noise)
          const rawChangePct = ((newPrice - oldPrice) / oldPrice) * 100;
          const prevHistory = newCityChangePctHistory[assetId] ?? [];
          const newHistory = [...prevHistory, rawChangePct].slice(-3);
          newCityChangePctHistory[assetId] = newHistory;
          const rollingAvg = newHistory.reduce((s, v) => s + v, 0) / newHistory.length;
          newCityChangePct[assetId] = Number(rollingAvg.toFixed(2));
        });

        return {
          prices: { ...state.prices, [cityId]: newCityPrices },
          changePct: { ...state.changePct, [cityId]: newCityChangePct },
          changePctHistory: { ...state.changePctHistory, [cityId]: newCityChangePctHistory }
        };
      }),

    resetPortfolio: () => set({
      cash: INITIAL_CASH,
      holdings: JSON.parse(JSON.stringify(initialHoldings)),
      prices: JSON.parse(JSON.stringify(initialPrices)),
      changePct: JSON.parse(JSON.stringify(initialChangePct)),
      changePctHistory: {},
      signalHistory: {}
    }),

    recordSignals: (cityId, signals) => set((state) => {
      const WINDOW = 5;
      const cityHistory = { ...(state.signalHistory[cityId] ?? {}) };
      (Object.keys(signals) as SignalKey[]).forEach((key) => {
        const val = signals[key];
        if (val === undefined) return;
        const prev = cityHistory[key] ?? [];
        cityHistory[key] = [...prev, val].slice(-WINDOW);
      });
      return { signalHistory: { ...state.signalHistory, [cityId]: cityHistory } };
    }),
  })
);