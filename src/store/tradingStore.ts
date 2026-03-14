import { create } from "zustand";
import { assetProfiles } from "../../shared/data";

export type TradingState = {
  cash: number;
  holdings: Record<string, number>;
  prices: Record<string, number>;
  changePct: Record<string, number>;
  
  buyAsset: (assetId: string, quantity?: number) => void;
  sellAsset: (assetId: string, quantity?: number) => void;
  tickPrices: (earthDeltas: Record<string, number>) => void;
  resetPortfolio: () => void;
};

const INITIAL_CASH = 1000000;

const initialPrices: Record<string, number> = {};
const initialChangePct: Record<string, number> = {};
assetProfiles.forEach((asset) => {
  initialPrices[asset.id] = asset.basePrice;
  initialChangePct[asset.id] = 0;
});

export const useTradingStore = create<TradingState>()(
  (set) => ({
    cash: INITIAL_CASH,
    holdings: {},
    prices: { ...initialPrices },
    changePct: { ...initialChangePct },

      buyAsset: (assetId, quantity = 1) =>
        set((state) => {
          const price = state.prices[assetId];
          const cost = price * quantity;
          if (state.cash >= cost) {
            // Market impact: driving the price UP by ~0.5% per unit bought
            const priceImpact = 1 + (0.005 * quantity);
            return {
              cash: state.cash - cost,
              holdings: {
                ...state.holdings,
                [assetId]: (state.holdings[assetId] || 0) + quantity
              },
              prices: {
                ...state.prices,
                [assetId]: state.prices[assetId] * priceImpact
              }
            };
          }
          return state;
        }),

      sellAsset: (assetId, quantity = 1) =>
        set((state) => {
          const currentHoldings = state.holdings[assetId] || 0;
          if (currentHoldings >= quantity) {
            const price = state.prices[assetId];
            const revenue = price * quantity;
            // Market impact: driving the price DOWN by ~0.5% per unit sold
            const priceImpact = 1 - (0.005 * quantity);
            return {
              cash: state.cash + revenue,
              holdings: {
                ...state.holdings,
                [assetId]: currentHoldings - quantity
              },
              prices: {
                ...state.prices,
                [assetId]: state.prices[assetId] * Math.max(0.01, priceImpact) // Prevent negative prices
              }
            };
          }
          return state;
        }),

      tickPrices: (earthDeltas) =>
        set((state) => {
          const newPrices = { ...state.prices };
          const newChangePct = { ...state.changePct };
          
          Object.keys(newPrices).forEach((assetId) => {
            const delta = earthDeltas[assetId] || 0;
            // The price moves based on the Earth Delta (e.g. Delta of +3 means upward pressure)
            // Plus some random noise/volatility (-0.5% to +0.5%)
            const baseMultiplier = 1 + (delta * 0.001); // 1 Earth Delta = 0.1% move per tick
            const volatility = 1 + (Math.random() - 0.5) * 0.01; 
            
            const oldPrice = newPrices[assetId];
            const newPrice = Math.max(0.01, oldPrice * baseMultiplier * volatility);
            newPrices[assetId] = newPrice;
            newChangePct[assetId] = Number((((newPrice - oldPrice) / oldPrice) * 100).toFixed(2));
          });

          return { prices: newPrices, changePct: newChangePct };
        }),

      resetPortfolio: () => set({ cash: INITIAL_CASH, holdings: {}, prices: { ...initialPrices }, changePct: { ...initialChangePct } })
    })
);
