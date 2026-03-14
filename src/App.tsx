import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useMutation, useQuery } from "@tanstack/react-query";
import { fetchMarkets, fetchSignals, previewScenario, speakOracle } from "./api";
import { FeedPanel } from "./components/FeedPanel";
import { MarketPanel } from "./components/MarketPanel";
import { ControlsBar } from "./components/ControlsBar";
import { cities, cityIndex } from "../shared/data";
import { useAppStore } from "./store/appStore";
import type { ScenarioPatch } from "../shared/types";
import { AnimatePresence } from "framer-motion";

const GlobeScene = lazy(() => import("./components/GlobeScene"));

function App() {
  const [isOracleSpeaking, setIsOracleSpeaking] = useState(false);
  const {
    selectedAssetId,
    selectedCityId,
    compareCityId,
    liveMode,
    audioEnabled,
    scenario,
    oracleHistory,
    feedHistory,
    setAsset,
    setCity,
    setCompareCity,
    setLiveMode,
    toggleAudio,
    setScenarioValue,
    resetScenario,
    pushOracleSpeech,
    setFeed
  } = useAppStore();

  const scenarioPatch: ScenarioPatch | null = useMemo(() => {
    const hasAnyDelta = Object.values(scenario).some((value) => value !== 0);
    if (!hasAnyDelta) {
      return null;
    }

    return {
      targetCityId: selectedCityId,
      ...scenario
    };
  }, [scenario, selectedCityId]);

  const marketsQuery = useQuery({
    queryKey: ["markets", liveMode],
    queryFn: () => fetchMarkets(liveMode),
    refetchInterval: 15_000
  });

  const signalsQuery = useQuery({
    queryKey: ["signals", liveMode],
    queryFn: () => fetchSignals(liveMode, "all"),
    refetchInterval: 15_000
  });

  const previewQuery = useQuery({
    queryKey: ["preview", liveMode, selectedAssetId, selectedCityId, compareCityId, scenarioPatch],
    queryFn: () =>
      previewScenario({
        assetId: selectedAssetId,
        cityId: selectedCityId,
        compareCityId: compareCityId ?? undefined,
        patch: scenarioPatch,
        mode: liveMode
      }),
    enabled: marketsQuery.isSuccess
  });

  const speakMutation = useMutation({
    mutationFn: speakOracle
  });

  useEffect(() => {
    if (previewQuery.data?.feed) {
      setFeed(previewQuery.data.feed);
    }
  }, [previewQuery.data, setFeed]);

  const latestSpeechRef = useRef("");

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


 // Inside your component
const handleManualSpeak = async () => {
  setIsOracleSpeaking(true);
  try {
    const response = await fetch('/api/consult', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker: 'COCOA' }), // Or your dynamic ticker
    });

    if (!response.ok) throw new Error('Network dormant');

    // 1. Get raw binary data
    const blob = await response.blob();
    
    // 2. Create a local URL for the blob
    const url = URL.createObjectURL(blob);
    
    // 3. Play it
    const audio = new Audio(url);
    audio.onended = () => setIsOracleSpeaking(false);
    await audio.play();
    
  } catch (e) {
    console.error("Audio playback error:", e);
    setIsOracleSpeaking(false);
  }
};

  const signals = previewQuery.data?.signals ?? signalsQuery.data?.signals ?? [];
  const tickers = marketsQuery.data?.tickers ?? [];

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
            <span>Market Pulse</span>
            <strong className={isOracleSpeaking ? "text-glow" : ""}>
              {isOracleSpeaking ? "SENSING..." : "SYNCED"}
            </strong>
          </div>
          <div>
            <span>Primary spread</span>
            <strong>
              {previewQuery.data?.primary.earthDelta
                ? `${previewQuery.data.primary.earthDelta > 0 ? "+" : ""}${previewQuery.data.primary.earthDelta}`
                : "..." }
            </strong>
          </div>
          <div>
            {audioEnabled && (

            <span>Audio Oracle</span>
            )}

            <div className={`spore-indicator ${audioEnabled ? 'active' : ''}`} />
            <button id="speak" onClick={handleManualSpeak}>Speak</button>
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
          <FeedPanel feed={feedHistory} oracleHistory={oracleHistory} />
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
          <div className="globe-overlay">
            <div className={`overlay-panel ${isOracleSpeaking ? 'bloom-glow' : ''}`}>
              <span className="eyebrow">
                {isOracleSpeaking ? "Oracle Communing..." : "Selected city"}
              </span>
              <strong>{cityIndex[selectedCityId]?.name}</strong>
              <p>{previewQuery.data?.oracleText ?? "Waiting for planetary repricing."}</p>
            </div>
            {/* ... rest of panels */}
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
            compareCityId={compareCityId}
          />
        </motion.div>
      </main>

      <ControlsBar
        selectedAssetId={selectedAssetId}
        selectedCityId={selectedCityId}
        compareCityId={compareCityId}
        liveMode={liveMode}
        audioEnabled={audioEnabled}
        scenario={scenario}
        onAssetChange={setAsset}
        onCityChange={setCity}
        onCompareChange={setCompareCity}
        onModeChange={setLiveMode}
        onScenarioChange={setScenarioValue}
        onResetScenario={resetScenario}
        onToggleAudio={toggleAudio}
      />
    </div>
  );
}

export default App;
