import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useMutation, useQuery } from "@tanstack/react-query";
import { fetchMarkets, fetchSignals, previewScenario, speakOracle } from "./api";
import { FeedPanel } from "./components/FeedPanel";
import { MarketPanel } from "./components/MarketPanel";
import { ControlsBar } from "./components/ControlsBar";
import {
  globeLoadStageMeta,
  globeLoadStageOrder,
  type GlobeLoadStage
} from "./components/globeBoot";
import { cities, cityIndex } from "../shared/data";
import { useAppStore } from "./store/appStore";
import type { ScenarioPatch } from "../shared/types";

const GlobeScene = lazy(() => import("./components/GlobeScene"));

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
  const [isGlobeMounted, setIsGlobeMounted] = useState(false);
  const [isAppInteractive, setIsAppInteractive] = useState(false);
  const [loadStage, setLoadStage] = useState<GlobeLoadStage>("shell");

  const advanceLoadStage = (nextStage: GlobeLoadStage) => {
    setLoadStage((currentStage) => {
      const currentIndex = globeLoadStageOrder.indexOf(currentStage);
      const nextIndex = globeLoadStageOrder.indexOf(nextStage);
      return nextIndex > currentIndex ? nextStage : currentStage;
    });
  };

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

  useEffect(() => {
    if (!audioEnabled || !previewQuery.data) {
      return;
    }

    const { primary, oracleText } = previewQuery.data;
    if (primary.severity === "calm" || primary.severity === "watch") {
      return;
    }

    if (latestSpeechRef.current === oracleText || speakMutation.isPending) {
      return;
    }

    latestSpeechRef.current = oracleText;
    speakMutation.mutate(
      {
        text: oracleText,
        severity: primary.severity
      },
      {
        onSuccess: async (speech) => {
          pushOracleSpeech(speech);

          if (!speech.audioUrl) {
            return;
          }

          try {
            const audio = new Audio(speech.audioUrl);
            await audio.play();
          } catch {
            // Browser autoplay can reject; transcript still lands in the feed.
          }
        }
      }
    );
  }, [audioEnabled, previewQuery.data, pushOracleSpeech, speakMutation]);

  const signals = previewQuery.data?.signals ?? signalsQuery.data?.signals ?? [];
  const tickers = marketsQuery.data?.tickers ?? [];
  const sideMotionProps = isAppInteractive
    ? {
        initial: { opacity: 0, x: -24 },
        animate: { opacity: 1, x: 0 },
        transition: { duration: 0.5 }
      }
    : {
        initial: false,
        animate: { opacity: 1, x: 0 },
        transition: { duration: 0 }
      };
  const rightMotionProps = isAppInteractive
    ? {
        initial: { opacity: 0, x: 24 },
        animate: { opacity: 1, x: 0 },
        transition: { duration: 0.5 }
      }
    : {
        initial: false,
        animate: { opacity: 1, x: 0 },
        transition: { duration: 0 }
      };
  const globeMotionProps = isAppInteractive
    ? {
        initial: { opacity: 0, scale: 0.96 },
        animate: { opacity: 1, scale: 1 },
        transition: { duration: 0.6 }
      }
    : {
        initial: false,
        animate: { opacity: 1, scale: 1 },
        transition: { duration: 0 }
      };

  return (
    <div className={isAppInteractive ? "app-shell is-interactive" : "app-shell is-loading"}>
      <div className="starscape" />
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
                    compareCityId={compareCityId}
                    selectedAssetId={selectedAssetId}
                    signals={signals}
                    rankings={previewQuery.data?.rankings ?? []}
                    onStageChange={(stage) => advanceLoadStage(stage)}
                    onInteractive={() => {
                      advanceLoadStage("interactive");
                      setIsAppInteractive(true);
                    }}
                  />
                </Suspense>
              </div>
            ) : null}
          </div>
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
                Hybrid weather and atmospheric signals with regional soil baselines and dramatic
                fallback events.
              </p>
            </div>
          </div>
        </motion.section>

        <motion.div className="right-column" {...rightMotionProps}>
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

      {!isAppInteractive ? <GlobalLoadingScreen stage={loadStage} /> : null}
    </div>
  );
}

export default App;
