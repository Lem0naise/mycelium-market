import { create } from "zustand";
import { assetProfiles, cities } from "../../shared/data";
import type { TradeResult } from "../../shared/types";
import { useAppStore } from "./appStore";

export type TradingState = {
  cash: number;
  holdings: Record<string, Record<string, number>>; // cityId -> assetId -> quantity
  prices: Record<string, Record<string, number>>; // cityId -> assetId -> price
  changePct: Record<string, Record<string, number>>; // cityId -> assetId -> changePct
  
  buyAsset: (cityId: string, assetId: string, humidity: number, quantity?: number) => Promise<TradeResult>;
  sellAsset: (cityId: string, assetId: string, humidity: number, quantity?: number) => Promise<TradeResult>;
  tickPrices: (cityId: string, earthDeltas: Record<string, number>) => void;
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

    buyAsset: async (cityId, assetId, humidity, quantity = 1) => {
      const { currentCityId, focusedCityId, flight } = useAppStore.getState();

      if (flight) {
        return { ok: false, reason: "in-flight" };
      }

      if (currentCityId !== cityId || focusedCityId !== currentCityId) {
        return { ok: false, reason: "not-in-city" };
      }

      // Humidity checks
      if (humidity < 30 && Math.random() < 0.20) {
        return { ok: false, reason: "ecological-interference" };
      }
      if (humidity > 80) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      const state = get();
      const price = state.prices[cityId]?.[assetId];
      if (!price) {
        return { ok: false, reason: "insufficient-cash" };
      }
      
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
        return {
          ok: true,
          assetId,
          cityId,
          quantity,
          executedPrice: price
        };
      }
      return { ok: false, reason: "insufficient-cash" };
    },

    sellAsset: async (cityId, assetId, humidity, quantity = 1) => {
      const { currentCityId, focusedCityId, flight } = useAppStore.getState();

      if (flight) {
        return { ok: false, reason: "in-flight" };
      }

      if (currentCityId !== cityId || focusedCityId !== currentCityId) {
        return { ok: false, reason: "not-in-city" };
      }

      if (humidity < 30 && Math.random() < 0.20) {
        return { ok: false, reason: "ecological-interference" };
      }
      if (humidity > 80) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      const state = get();
      const currentHoldings = state.holdings[cityId]?.[assetId] || 0;
      if (currentHoldings >= quantity) {
        const price = state.prices[cityId]?.[assetId];
        if (!price) {
          return { ok: false, reason: "no-holdings" };
        }

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
        return {
          ok: true,
          assetId,
          cityId,
          quantity,
          executedPrice: price
        };
      }
      return { ok: false, reason: "no-holdings" };
    },

    tickPrices: (cityId, earthDeltas) =>
      set((state) => {
        const newCityPrices = { ...state.prices[cityId] };
        const newCityChangePct = { ...state.changePct[cityId] };
        
        Object.keys(newCityPrices).forEach((assetId) => {
          const delta = earthDeltas[assetId] || 0;
          const baseMultiplier = 1 + (delta * 0.001); 
          const volatility = 1 + (Math.random() - 0.5) * 0.01; 
          
          const oldPrice = newCityPrices[assetId];
          const newPrice = Math.max(0.01, oldPrice * baseMultiplier * volatility);
          newCityPrices[assetId] = newPrice;
          newCityChangePct[assetId] = Number((((newPrice - oldPrice) / oldPrice) * 100).toFixed(2));
        });

        return { 
          prices: { ...state.prices, [cityId]: newCityPrices },
          changePct: { ...state.changePct, [cityId]: newCityChangePct }
        };
      }),

    resetPortfolio: () => set({ 
      cash: INITIAL_CASH, 
      holdings: JSON.parse(JSON.stringify(initialHoldings)), 
      prices: JSON.parse(JSON.stringify(initialPrices)), 
      changePct: JSON.parse(JSON.stringify(initialChangePct)) 
    })
  })
);
