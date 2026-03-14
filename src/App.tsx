import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useMutation, useQuery } from "@tanstack/react-query";
import { fetchMarkets, fetchSignals, previewScenario, speakOracle } from "./api";
import { FeedPanel } from "./components/FeedPanel";
import { MarketPanel } from "./components/MarketPanel";
import { cities, cityIndex, assetProfiles } from "../shared/data";
import { useAppStore } from "./store/appStore";
import { useTradingStore } from "./store/tradingStore";
import { computeOracle } from "../shared/oracle";
import { AnimatePresence } from "framer-motion";

const GlobeScene = lazy(() => import("./components/GlobeScene"));

function App() {
  const [isOracleSpeaking, setIsOracleSpeaking] = useState(false);
  const {
    selectedAssetId,
    selectedCityId,
    audioEnabled,
    feedHistory,
    setAsset,
    setFeed,
    pushOracleSpeech
  } = useAppStore();

  const { prices, tickPrices } = useTradingStore();

  const latestSpeechRef = useRef<string | null>(null);
  const speakMutation = useMutation({ mutationFn: speakOracle });
  const liveMode = "live";

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
    queryKey: ["preview", "live", selectedAssetId, selectedCityId],
    queryFn: () =>
      previewScenario({
        assetId: selectedAssetId,
        cityId: selectedCityId,
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

  // Automated Oracle speech effect
  useEffect(() => {
    if (!audioEnabled || !previewQuery.data) return;

    const { primary, oracleText } = previewQuery.data;

    if (primary.severity === "calm" || primary.severity === "watch") return;
    if (latestSpeechRef.current === oracleText || speakMutation.isPending) return;

    latestSpeechRef.current = oracleText;
    speakMutation.mutate(
      { text: oracleText, severity: primary.severity },
      {
        onSuccess: async (speech) => {
          pushOracleSpeech(speech);
          if (!speech.audioUrl) return;

          try {
            const audio = new Audio(speech.audioUrl);

            // Sync UI visuals with ElevenLabs Audio
            audio.onplay = () => setIsOracleSpeaking(true);
            audio.onended = () => setIsOracleSpeaking(false);

            await audio.play();
          } catch (e) {
            console.error("Autoplay blocked or audio error", e);
            setIsOracleSpeaking(false);
          }
        }
      }
    );
  }, [audioEnabled, previewQuery.data, pushOracleSpeech, speakMutation]);

  // Background price tick effect
  useEffect(() => {
    if (!signals.length) return;

    const interval = setInterval(() => {
      // Calculate Earth Delta for ALL assets for the currently selected city
      const currentCitySignal = signals.find(s => s.cityId === selectedCityId) ?? signals[0];
      if (!currentCitySignal) return;

      const deltas: Record<string, number> = {};
      baseTickers.forEach(t => {
        const assetProfile = assetProfiles.find(a => a.id === t.assetId);
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
    <div className={`app-shell ${isOracleSpeaking ? "oracle-active" : ""}`}>
      <div className="starscape" />

      {/* Visual Glitch/Fungal layer that appears when speaking */}
      <AnimatePresence>
        {isOracleSpeaking && (
          <motion.div
            className="fungal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
        )}
      </AnimatePresence>

      <header className="app-header">
        <div>
          <span className="eyebrow">Terra Arbitrage</span>
          <h1>The planet is the trader.</h1>
        </div>
        <div className="header-stats">
          <div>
            <span>Mode</span>
            <strong>{liveMode.toUpperCase()}</strong>
          </div>
          <div>
            <span>Tracked cities</span>
            <strong>{cities.length}</strong>
          </div>
          <div>
            <span>Primary spread</span>
            <strong>
              {previewQuery.data?.primary.earthDelta
                ? `${previewQuery.data.primary.earthDelta > 0 ? "+" : ""}${previewQuery.data.primary.earthDelta}`
                : "..."}
            </strong>
          </div>
          <div>
            {audioEnabled && <span>Audio Oracle</span>}
            <div className={`spore-indicator ${audioEnabled ? "active" : ""}`} />
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
              selectedAssetId={selectedAssetId}
              signals={signals}
              rankings={previewQuery.data?.rankings ?? []}
            />
          </Suspense>
          <div className="globe-overlay">
            <div className="overlay-panel">
              <span className="eyebrow">Selected city</span>
              <strong>{cityIndex[selectedCityId]?.name}</strong>
              <p>{previewQuery.data?.oracleText ?? "Waiting for planetary repricing."}</p>
            </div>
            <div className="overlay-panel">
              <span className="eyebrow">Signal mode</span>
              <strong>{signalsQuery.data?.sourceMode ?? "fallback"}</strong>
              <p>
                Hybrid weather and atmospheric signals with regional soil baselines and dramatic fallback events.
              </p>
            </div>
          </div>
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
            onSelectAsset={setAsset}
          />
        </motion.div>
      </main>
    </div>
  );
}

export default App;
