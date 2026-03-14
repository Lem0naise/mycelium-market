import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useMutation, useQuery } from "@tanstack/react-query";
import { fetchMarkets, previewScenario, speakOracle } from "./api";
import { FeedPanel } from "./components/FeedPanel";
import { MarketPanel } from "./components/MarketPanel";
import { MyceliumWidget } from "./components/MyceliumWidget";
import { cityIndex, assetProfiles } from "../shared/data";
import { useAppStore } from "./store/appStore";
import { useTradingStore } from "./store/tradingStore";
import { computeOracle, createFallbackSignals, getConditionZones, checkBoundaryCrossings } from "../shared/oracle";
import type { EnvironmentalSignal } from "../shared/types";
import { AnimatePresence } from "framer-motion";
import {
  type GlobeLoadStage,
  globeLoadStageMeta,
  globeLoadStageOrder
} from "./components/globeBoot";

const GlobeScene = lazy(() => import("./components/GlobeScene"));

const ORACLE_ENABLED = false;

function GlobalLoadingScreen({ stage }: { stage: GlobeLoadStage }) {
  const stageMeta = globeLoadStageMeta[stage];
  const currentStageIndex = globeLoadStageOrder.indexOf(stage);

  return (
    <div className="global-loading-screen" aria-live="polite" aria-busy="true">
      <div className="global-loading-panel">
        <span className="global-loading-kicker">Terra Arbitrage</span>
        <h2>Loading planetary engine</h2>
        <p>{stageMeta.description}</p>

        <div className="global-loading-progress-meta">
          <strong>{stageMeta.title}</strong>
          <span>{stageMeta.progress}%</span>
        </div>

        <div
          className="global-loading-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={stageMeta.progress}
          aria-label="Loading progress"
        >
          <div
            className="global-loading-progress-fill"
            style={{ width: `${stageMeta.progress}%` }}
          />
        </div>

        <div className="global-loading-steps">
          {globeLoadStageOrder.map((step, index) => (
            <div
              key={step}
              className={
                index <= currentStageIndex
                  ? "global-loading-step is-complete"
                  : "global-loading-step"
              }
            >
              <span>{globeLoadStageMeta[step].progress}</span>
              <small>{globeLoadStageMeta[step].stepLabel}</small>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [isOracleSpeaking, setIsOracleSpeaking] = useState(false);
  const [oracleFlash, setOracleFlash] = useState(false);
  const [isGlobeMounted, setIsGlobeMounted] = useState(false);
  const [isAppInteractive, setIsAppInteractive] = useState(false);
  const [loadStage, setLoadStage] = useState<GlobeLoadStage>("shell");
  const [gameTick, setGameTick] = useState(0);

  const {
    selectedAssetId,
    selectedCityId,
    audioEnabled,
    oracleHistory,
    feedHistory,
    setAsset,
    setCity,
    setFeed,
    pushOracleSpeech
  } = useAppStore();

  const { prices, tickPrices, recordSignals } = useTradingStore();

  const [liveSignals, setLiveSignals] = useState<EnvironmentalSignal[]>(() => createFallbackSignals());
  const liveSignalsRef = useRef<EnvironmentalSignal[]>(liveSignals);

  const speakMutation = useMutation({ mutationFn: speakOracle });
  const audioContextRef = useRef<AudioContext | null>(null);
  // Tracks which threshold zones were active per city on the previous tick.
  // undefined = not yet initialised (first observation — no alert fired).
  const prevZonesByCityRef = useRef<Record<string, Set<string>>>({});
  const oracleFlashTimeoutRef = useRef<number | null>(null);
  // Refs so the interval callback always reads the latest speaking state
  // without needing them as deps (which would reset the interval).
  const isOracleSpeakingRef = useRef(false);
  const speakPendingRef = useRef(false);

  // Unlock AudioContext on user interaction — must happen before first audio play
  const unlockAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    if (audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume().catch(console.error);
    }
  };

  // Play a base64 data: URL through the pre-unlocked AudioContext
  const playBase64Audio = async (dataUrl?: string | null) => {
    // 1. Add this safety check!
    if (!dataUrl || !dataUrl.includes(",")) {
      setIsOracleSpeaking(false);
      return;
    }

    try {
      const ctx = audioContextRef.current;
      if (!ctx) {
        const audio = new Audio(dataUrl);
        audio.onplay = () => setIsOracleSpeaking(true);
        audio.onended = () => setIsOracleSpeaking(false);
        await audio.play();
        return;
      }

      if (ctx.state === "suspended") {
        await ctx.resume();
      }

      const base64 = dataUrl.split(",")[1];
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      const audioBuffer = await ctx.decodeAudioData(bytes.buffer);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.onended = () => setIsOracleSpeaking(false);

      // Lock state BEFORE starting playback
      setIsOracleSpeaking(true);
      source.start();
    } catch (e) {
      console.error("Audio playback error", e);
      setIsOracleSpeaking(false);
    }
  };

  const marketsQuery = useQuery({
    queryKey: ["markets"],
    queryFn: () => fetchMarkets(),
    refetchInterval: 15_000
  });

  const previewQuery = useQuery({
    queryKey: ["preview", selectedAssetId, selectedCityId],
    queryFn: () =>
      previewScenario({
        assetId: selectedAssetId,
        cityId: selectedCityId
      }),
    enabled: marketsQuery.isSuccess
  });

  useEffect(() => {
    if (previewQuery.data?.feed) {
      setFeed(previewQuery.data.feed);
    }
  }, [previewQuery.data, setFeed]);

  const signals = liveSignals;
  const baseTickers = marketsQuery.data?.tickers ?? [];

  // Map our custom local storage prices over the base tickers
  const tickers = baseTickers.map(t => {
    const { prices, changePct } = useTradingStore.getState();
    return {
      ...t,
      price: prices[selectedCityId]?.[t.assetId] ?? t.price,
      changePct: changePct[selectedCityId]?.[t.assetId] ?? t.changePct
    };
  });

  const advanceLoadStage = (nextStage: GlobeLoadStage) => {
    setLoadStage((currentStage) => {
      const currentIndex = globeLoadStageOrder.indexOf(currentStage);
      const nextIndex = globeLoadStageOrder.indexOf(nextStage);
      return nextIndex > currentIndex ? nextStage : currentStage;
    });
  };

  // Globe mount orchestration
  useEffect(() => {
    let timeoutId: number | undefined;
    let animationFrameId = 0;
    let idleCallbackId: number | undefined;
    const requestIdle = window.requestIdleCallback?.bind(window);
    const cancelIdle = window.cancelIdleCallback?.bind(window);

    const mountGlobe = () => {
      advanceLoadStage("chunk");
      setIsGlobeMounted(true);
    };

    animationFrameId = window.requestAnimationFrame(() => {
      if (requestIdle) {
        idleCallbackId = requestIdle(mountGlobe, { timeout: 320 });
        return;
      }
      timeoutId = window.setTimeout(mountGlobe, 90);
    });

    return () => {
      if (typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(animationFrameId);
      }
      if (idleCallbackId !== undefined && cancelIdle) {
        cancelIdle(idleCallbackId);
      }
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  // Keep speaking-state refs in sync so the interval callback can read them
  // without taking them as deps (which would reset the interval on every state change).
  useEffect(() => { isOracleSpeakingRef.current = isOracleSpeaking; }, [isOracleSpeaking]);
  useEffect(() => { speakPendingRef.current = speakMutation.isPending; }, [speakMutation.isPending]);

  // Multi-city oracle scanning — fires alerts only for cities where the user
  // has stock holdings AND is NOT currently visiting that city.
  // Runs on a fixed 5 s clock, independent of React Query refresh cycle.
  useEffect(() => {
    if (!ORACLE_ENABLED || !audioEnabled) return;

    const scan = () => {
      // Never overlap: skip the entire scan while a request is in-flight or
      // audio is still playing.  The onended handler clears isOracleSpeakingRef;
      // the mutation's onSettled clears speakPendingRef.
      if (isOracleSpeakingRef.current || speakPendingRef.current) return;

      // Snapshot latest live signals from ref
      const latestSignals = liveSignalsRef.current;
      if (!latestSignals.length) return;

      const latestHoldings = useTradingStore.getState().holdings;

      for (const signal of latestSignals) {
        // Skip the city the user is currently in
        if (signal.cityId === selectedCityId) continue;

        // Skip cities where the user holds no positions
        const cityHoldings = latestHoldings[signal.cityId] ?? {};
        const hasHoldings = Object.values(cityHoldings).some(qty => qty > 0);
        if (!hasHoldings) continue;

        const currZones = getConditionZones(signal);
        const prevZones = prevZonesByCityRef.current[signal.cityId];

        // First observation — initialise zones silently, don't fire anything
        if (prevZones === undefined) {
          prevZonesByCityRef.current[signal.cityId] = currZones;
          continue;
        }

        const cityName = cityIndex[signal.cityId]?.name ?? signal.cityId;
        const crossing = checkBoundaryCrossings(prevZones, currZones, signal, cityName);

        // Always update stored zones before acting on the result
        prevZonesByCityRef.current[signal.cityId] = currZones;

        if (!crossing) continue;

        // Zone EXIT → push a calm feed item, no speech
        if (crossing.exit) {
          setFeed([{
            id: `${signal.cityId}-exit-${Date.now()}`,
            title: "Conditions easing",
            body: crossing.exit.display,
            cityId: signal.cityId,
            severity: "calm",
            kind: "environment",
            timestamp: new Date().toISOString()
          }]);
        }

        // Zone ENTRY → green flash + speak (if oracle is free)
        if (crossing.entry) {
          if (oracleFlashTimeoutRef.current !== null) clearTimeout(oracleFlashTimeoutRef.current);
          setOracleFlash(true);
          oracleFlashTimeoutRef.current = window.setTimeout(() => setOracleFlash(false), 1500);

          if (!isOracleSpeakingRef.current && !speakPendingRef.current) {
            speakMutation.mutate(
              { text: crossing.entry.speech, severity: "critical" },
              {
                onSuccess: async (response) => {
                  // Server returns { skipped: true } when the audio lock is active.
                  // Bail out cleanly without touching oracle history or audio state.
                  if (response.skipped) return;
                  pushOracleSpeech(response);
                  if (response.audioUrl) await playBase64Audio(response.audioUrl);
                }
              }
            );
          }
        }

        break; // Queue one alert at a time; remainder will catch up next tick
      }
    };

    // Run immediately, then every 5 s
    scan();
    const intervalId = window.setInterval(scan, 5_000);
    return () => window.clearInterval(intervalId);
  }, [audioEnabled, selectedCityId]);

  // Combined 1-second tick: refresh liveSignals + advance all city prices + advance game calendar
  useEffect(() => {
    const baseTks = marketsQuery.data?.tickers ?? [];
    const interval = setInterval(() => {
      setGameTick(t => t + 1);

      const freshSignals = createFallbackSignals();
      liveSignalsRef.current = freshSignals;
      setLiveSignals(freshSignals);

      freshSignals.forEach((citySignal: EnvironmentalSignal) => {
        const deltas: Record<string, number> = {};
        assetProfiles.forEach(asset => {
          const baseTicker = baseTks.find(t => t.assetId === asset.id);
          const basePrice = baseTicker?.price ?? asset.basePrice;
          const comp = computeOracle(asset, citySignal, basePrice);
          deltas[asset.id] = comp.earthDelta;
        });
        tickPrices(citySignal.cityId, deltas);
        recordSignals(citySignal.cityId, citySignal);
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [marketsQuery.data, tickPrices, recordSignals]);

  const DAYS_PER_WEEK = 7;
  const WEEKS_PER_YEAR = 52;
  const DAYS_PER_YEAR = DAYS_PER_WEEK * WEEKS_PER_YEAR; // 364
  const START_YEAR = 2157;
  const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  const fictionalYear = START_YEAR + Math.floor(gameTick / DAYS_PER_YEAR);
  const dayOfYear = gameTick % DAYS_PER_YEAR;
  const fictionalWeek = Math.floor(dayOfYear / DAYS_PER_WEEK) + 1;
  const fictionalDayName = DAY_NAMES[dayOfYear % DAYS_PER_WEEK];

  const sideMotionProps = isAppInteractive
    ? { initial: { opacity: 0, x: -24 }, animate: { opacity: 1, x: 0 }, transition: { duration: 0.5 } }
    : { initial: false as const, animate: { opacity: 1, x: 0 }, transition: { duration: 0 } };

  const rightMotionProps = isAppInteractive
    ? { initial: { opacity: 0, x: 24 }, animate: { opacity: 1, x: 0 }, transition: { duration: 0.5 } }
    : { initial: false as const, animate: { opacity: 1, x: 0 }, transition: { duration: 0 } };

  const globeMotionProps = isAppInteractive
    ? { initial: { opacity: 0, scale: 0.96 }, animate: { opacity: 1, scale: 1 }, transition: { duration: 0.6 } }
    : { initial: false as const, animate: { opacity: 1, scale: 1 }, transition: { duration: 0 } };

  return (
    <div className={isAppInteractive ? "app-shell is-interactive" : "app-shell is-loading"}>
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

      {/* Green flash when a new oracle alert fires */}
      {oracleFlash && <div className="oracle-flash-overlay" aria-hidden="true" />}

      <header className="app-header">
        <div>
          <span className="eyebrow">Terra Arbitrage</span>
          <h1>The planet is the trader.</h1>
        </div>

        {/* Fictional planetary calendar — absolutely centred in the header */}
        <div style={{
          position: "absolute",
          left: "50%",
          transform: "translateX(-50%)",
          textAlign: "center",
          pointerEvents: "none",
          userSelect: "none",
        }}>
          <span style={{
            display: "block",
            fontSize: "0.62rem",
            fontWeight: "bold",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
            marginBottom: "4px",
          }}>
            Planetary Cycle
          </span>
          <div style={{
            fontSize: "clamp(1.6rem, 2.4vw, 2.8rem)",
            fontWeight: "bold",
            letterSpacing: "-0.03em",
            lineHeight: 1,
            color: "var(--text)",
          }}>
            {fictionalDayName}
          </div>
          <div style={{
            fontSize: "0.78rem",
            color: "var(--text-muted)",
            marginTop: "5px",
            letterSpacing: "0.05em",
          }}>
            Week {fictionalWeek} &middot; Cycle {fictionalYear}
          </div>
        </div>

        <div className="header-right" style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <MyceliumWidget signals={liveSignals} selectedCityId={selectedCityId} />
          <div className="header-stats">
            <div>
              {audioEnabled && <span>Audio Oracle</span>}
              <div className={`spore-indicator ${audioEnabled ? "active" : ""}`} />
            </div>
          </div>
        </div>
      </header>

      <main className="dashboard-grid">
        <motion.div className="left-column" {...sideMotionProps}>
          <FeedPanel feed={feedHistory} oracleHistory={oracleHistory} />
        </motion.div>

        <motion.section className="globe-column" {...globeMotionProps}>
          <div className={isAppInteractive ? "globe-stage is-ready" : "globe-stage"}>
            {isGlobeMounted ? (
              <div className={isAppInteractive ? "globe-scene-slot is-ready" : "globe-scene-slot"}>
                <Suspense fallback={null}>
                  <GlobeScene
                    selectedCityId={selectedCityId}
                    selectedAssetId={selectedAssetId}
                    signals={signals}
                    rankings={previewQuery.data?.rankings ?? []}
                    onSelectCity={setCity}
                    onStageChange={(stage) => advanceLoadStage(stage)}
                    onInteractive={() => {
                      advanceLoadStage("interactive");
                      setIsAppInteractive(true);
                      unlockAudioContext();
                    }}
                  />
                </Suspense>
              </div>
            ) : null}
          </div>
          <div className="globe-overlay">

            <div className="overlay-panel">
              <span className="eyebrow">Active Holdings</span>
              {(() => {
                const holdings = useTradingStore.getState().holdings;
                const portfolioItems = [];
                for (const cId in holdings) {
                  for (const aId in holdings[cId]) {
                    const qty = holdings[cId][aId];
                    if (qty > 0) {
                      portfolioItems.push({ cityId: cId, assetId: aId, qty });
                    }
                  }
                }

                if (portfolioItems.length === 0) {
                  return <p>No active holdings.</p>;
                }

                return (
                  <ul style={{ listStyle: "none", padding: 0, margin: 0, marginTop: "0.5rem" }}>
                    {portfolioItems.map((item, idx) => {
                      const cityName = cityIndex[item.cityId]?.name ?? item.cityId;
                      const assetLabel = assetProfiles.find(a => a.id === item.assetId)?.label ?? item.assetId;
                      return (
                        <li key={idx} style={{ marginBottom: "0.25rem", fontSize: "0.9rem" }}>
                          <strong>{cityName}</strong>: {assetLabel} (x{item.qty})
                        </li>
                      );
                    })}
                  </ul>
                );
              })()}
            </div>
          </div>
        </motion.section>

        <motion.div className="right-column" {...rightMotionProps}>
          <MarketPanel
            tickers={tickers}
            signals={liveSignals}
            selectedAssetId={selectedAssetId}
            selectedCityId={selectedCityId}
            onSelectAsset={setAsset}
          />
        </motion.div>
      </main>

      {!isAppInteractive ? <GlobalLoadingScreen stage={loadStage} /> : null}
    </div>
  );
}

export default App;
