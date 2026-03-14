import { Suspense, lazy, useEffect } from "react";
import { motion } from "framer-motion";
import { useMutation, useQuery } from "@tanstack/react-query";
import { fetchMarkets, fetchSignals, previewScenario, speakOracle } from "./api";
import { FeedPanel } from "./components/FeedPanel";
import { MarketPanel } from "./components/MarketPanel";
import { cities, cityIndex, assetProfiles } from "../shared/data";
import { useAppStore } from "./store/appStore";
import { useTradingStore } from "./store/tradingStore";
import { computeOracle } from "../shared/oracle";
import type { ScenarioPatch } from "../shared/types";

const GlobeScene = lazy(() => import("./components/GlobeScene"));

function App() {
  const {
    selectedAssetId,
    selectedCityId,
    compareCityId,
    audioEnabled,
    scenario,
    oracleHistory,
    feedHistory,
    setAsset,
    setCity,
    setCompareCity,
    setFeed,
    pushOracleSpeech
  } = useAppStore();

  const { prices, tickPrices } = useTradingStore();

  const marketsQuery = useQuery({
    queryKey: ["markets", "live"],
    queryFn: () => fetchMarkets("live"),
    refetchInterval: 15_000
  });

  const signalsQuery = useQuery({
    queryKey: ["signals", "live"],
    queryFn: () => fetchSignals("live", "all"),
    refetchInterval: 15_000
  });

  const previewQuery = useQuery({
    queryKey: ["preview", "live", selectedAssetId, selectedCityId, compareCityId],
    queryFn: () =>
      previewScenario({
        assetId: selectedAssetId,
        cityId: selectedCityId,
        compareCityId: compareCityId ?? undefined,
        mode: "live"
      }),
    enabled: marketsQuery.isSuccess
  });

  useEffect(() => {
    if (previewQuery.data?.feed) {
      setFeed(previewQuery.data.feed);
    }
  }, [previewQuery.data, setFeed]);

  const signals = previewQuery.data?.signals ?? signalsQuery.data?.signals ?? [];
  const baseTickers = marketsQuery.data?.tickers ?? [];

  // Map our custom local storage prices over the base tickers
  const tickers = baseTickers.map(t => ({
    ...t,
    price: prices[t.assetId] ?? t.price
  }));

  // Global price tick effect
  useEffect(() => {
    if (!signals.length) return;

    const interval = setInterval(() => {
      // Calculate Earth Delta for ALL assets for the currently selected city
      const currentCitySignal = signals.find(s => s.cityId === selectedCityId) ?? signals[0];
      if (!currentCitySignal) return;

      const deltas: Record<string, number> = {};
      baseTickers.forEach(t => {
        // computeOracle normally takes assetProfile, signal, baselineValue. 
        // For ticking, we just need the earthDelta.
        const assetProfile = require('../shared/data').assetProfiles.find((a: any) => a.id === t.assetId);
        if (assetProfile) {
          const comp = computeOracle(assetProfile, currentCitySignal, t.price);
          deltas[t.assetId] = comp.earthDelta;
        }
      });
      
      tickPrices(deltas);
    }, 1000);

    return () => clearInterval(interval);
  }, [signals, selectedCityId, baseTickers, tickPrices]);

  return (
    <div className="app-shell">
      <div className="starscape" />
      <header className="app-header">
        <div>
          <span className="eyebrow">Terra Arbitrage</span>
          <h1>The planet is the trader.</h1>
        </div>
        <div className="header-stats">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span>Primary city</span>
            <select 
              value={selectedCityId} 
              onChange={(e) => setCity(e.target.value)}
              style={{ background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', padding: '4px 8px', borderRadius: '4px' }}
            >
              {cities.map((city) => (
                <option key={city.id} value={city.id} style={{ background: '#000' }}>{city.name}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span>Compare city</span>
            <select 
              value={compareCityId ?? ""} 
              onChange={(e) => setCompareCity(e.target.value || null)}
              style={{ background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', padding: '4px 8px', borderRadius: '4px' }}
            >
              <option value="" style={{ background: '#000' }}>None</option>
              {cities.filter(c => c.id !== selectedCityId).map((city) => (
                <option key={city.id} value={city.id} style={{ background: '#000' }}>{city.name}</option>
              ))}
            </select>
          </div>
          <div>
            <span>Primary spread</span>
            <strong>
              {previewQuery.data?.primary.earthDelta
                ? `${previewQuery.data.primary.earthDelta > 0 ? "+" : ""}${previewQuery.data.primary.earthDelta}`
                : "..." }
            </strong>
          </div>
        </div>
      </header>

      <main className="dashboard-grid">
        <motion.div
          className="left-column"
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
        >
          <FeedPanel feed={feedHistory} oracleHistory={[]} />
        </motion.div>

        <motion.section
          className="globe-column"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6 }}
        >
          <Suspense fallback={<div className="globe-loading">Calibrating planetary mesh...</div>}>
            <GlobeScene
              selectedCityId={selectedCityId}
              compareCityId={compareCityId}
              selectedAssetId={selectedAssetId}
              signals={signals}
              rankings={previewQuery.data?.rankings ?? []}
            />
          </Suspense>
        </motion.section>

        <motion.div
          className="right-column"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
        >
          <MarketPanel
            tickers={tickers}
            preview={previewQuery.data}
            selectedAssetId={selectedAssetId}
            selectedCityId={selectedCityId}
            compareCityId={compareCityId}
            onSelectAsset={setAsset}
          />
        </motion.div>
      </main>
    </div>
  );
}

export default App;
