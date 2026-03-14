import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useMutation, useQuery } from "@tanstack/react-query";
import { fetchMarkets, speakOracle } from "./api";
import { FeedPanel } from "./components/FeedPanel";
import { MarketPanel } from "./components/MarketPanel";
import { MyceliumWidget, EnvironmentalEffectsPanel } from "./components/MyceliumWidget";
import { assetProfiles, cities, cityIndex } from "../shared/data";
import {
  createInitialOracleWatchState,
  createOracleNotification,
  evaluateOracleNotifications
} from "../shared/omniscientOracle";
import { useAppStore } from "./store/appStore";
import { useTradingStore } from "./store/tradingStore";
import {
  checkBoundaryCrossings,
  computeEarthDeltaFromChange,
  computeOracle,
  createFallbackSignals,
  createScenarioSnapshot
} from "../shared/oracle";
import {
  applyStormEffectsToSignals,
  buildStormSnapshots,
  createFlightState,
  createReturnFlightState,
  createStormSystems,
  findFlightHoldProgress,
  getPathPointAtProgress,
  getStormBlockedCityIds
} from "../shared/simulation";
import type {
  EnvironmentalSignal,
  FlightState,
  OracleNotification,
  OracleSpeakResponse,
  ScenarioPatch,
  Severity,
  StormSnapshot
} from "../shared/types";
import {
  type GlobeLoadStage,
  globeLoadStageMeta,
  globeLoadStageOrder
} from "./components/globeBoot";

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

function buildScenarioPatch(
  focusedCityId: string,
  scenario: ReturnType<typeof useAppStore.getState>["scenario"]
): ScenarioPatch | null {
  const hasChanges = Object.values(scenario).some((value) => Math.abs(value) > 0.01);
  if (!hasChanges) {
    return null;
  }

  return {
    targetCityId: focusedCityId,
    ...scenario
  };
}

function describeFlightStatus(flight: FlightState | null) {
  if (!flight) {
    return "Grounded";
  }

  if (flight.isReturningHome) {
    return "Returning home";
  }

  if (flight.phase === "holding") {
    return "Turning back";
  }

  return "En route";
}

function createRuntimeOracleNotification(
  input: Omit<Parameters<typeof createOracleNotification>[0], "timestamp">
) {
  return createOracleNotification({
    ...input,
    timestamp: new Date().toISOString()
  });
}

function App() {
  const [isOracleSpeaking, setIsOracleSpeaking] = useState(false);
  const [oracleFlash, setOracleFlash] = useState(false);
  const [isGlobeMounted, setIsGlobeMounted] = useState(false);
  const [isAppInteractive, setIsAppInteractive] = useState(false);
  const [loadStage, setLoadStage] = useState<GlobeLoadStage>("shell");
  const [simulationMs, setSimulationMs] = useState(0);
  const [gameTick, setGameTick] = useState(0);
  const prevSignalsRef = useRef<Record<string, EnvironmentalSignal>>({});
  const portfolioHistoryRef = useRef<number[]>([]);
  const [portfolioRollingPct, setPortfolioRollingPct] = useState<number | null>(null);
  const [liveSignals, setLiveSignals] = useState<EnvironmentalSignal[]>(() =>
    createFallbackSignals()
  );

  const {
    selectedAssetId,
    focusedCityId,
    currentCityId,
    audioEnabled,
    scenario,
    oracleHistory,
    feedHistory,
    stormSeed,
    flight,
    setAsset,
    setFocusedCity,
    setCurrentCity,
    setFlight,
    setFeed,
    pushOracleSpeech
  } = useAppStore();

  const { cash, holdings, prices, changePct, tickAllPrices, recordAllSignals } = useTradingStore();

  const speakMutation = useMutation({ mutationFn: speakOracle });
  const audioContextRef = useRef<AudioContext | null>(null);
  const oracleFlashTimeoutRef = useRef<number | null>(null);
  const isOracleSpeakingRef = useRef(false);
  const speakPendingRef = useRef(false);
  const simulationStartRef = useRef<number | null>(null);
  const liveSignalsRef = useRef<EnvironmentalSignal[]>(liveSignals);
  const stormSnapshotsRef = useRef<StormSnapshot[]>([]);
  const latestOracleContextRef = useRef({
    signals: [] as EnvironmentalSignal[],
    holdings,
    prices,
    cash,
    blockedCityIds: [] as string[],
    currentCityId,
    focusedCityId,
    flight,
    tickers: [] as typeof baseTickers
  });
  const oracleWatchStateRef = useRef(createInitialOracleWatchState());
  const lastSpokenNotificationIdRef = useRef<string | null>(null);

  const queueOracleSpeech = (text: string, severity: Severity) => {
    if (!audioEnabled || isOracleSpeakingRef.current || speakPendingRef.current) {
      return;
    }

    speakMutation.mutate(
      { text, severity },
      {
        onSuccess: async (response: OracleSpeakResponse) => {
          if (response.skipped) {
            return;
          }

          pushOracleSpeech(response);
          if (response.audioUrl) {
            await playBase64Audio(response.audioUrl);
          }
        }
      }
    );
  };

  const unlockAudioContext = () => {
    const AudioContextCtor =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextCtor) {
      return;
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextCtor();
    }

    if (audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume().catch(console.error);
    }
  };

  const playBase64Audio = async (dataUrl?: string | null) => {
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
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }

      const audioBuffer = await ctx.decodeAudioData(bytes.buffer);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.onended = () => setIsOracleSpeaking(false);

      setIsOracleSpeaking(true);
      source.start();
    } catch (error) {
      console.error("Audio playback error", error);
      setIsOracleSpeaking(false);
    }
  };

  const pulseOracleFlash = () => {
    if (oracleFlashTimeoutRef.current !== null) {
      window.clearTimeout(oracleFlashTimeoutRef.current);
    }

    setOracleFlash(true);
    oracleFlashTimeoutRef.current = window.setTimeout(() => setOracleFlash(false), 1500);
  };

  const publishOracleNotifications = (
    notifications: OracleNotification[],
    speakable: OracleNotification | null = null
  ) => {
    if (notifications.length > 0) {
      setFeed(notifications);
    }

    if (!speakable?.speakText || lastSpokenNotificationIdRef.current === speakable.id) {
      return;
    }

    lastSpokenNotificationIdRef.current = speakable.id;
    pulseOracleFlash();
    queueOracleSpeech(speakable.speakText, speakable.severity);
  };

  const marketsQuery = useQuery({
    queryKey: ["markets"],
    queryFn: () => fetchMarkets(),
    refetchInterval: 15_000
  });

  const baseTickers = marketsQuery.data?.tickers ?? [];
  const stormSystems = useMemo(() => createStormSystems(stormSeed), [stormSeed]);
  const stormSnapshots = useMemo(
    () => buildStormSnapshots(stormSystems, simulationMs),
    [stormSystems, simulationMs]
  );
  const blockedCityIds = useMemo(() => getStormBlockedCityIds(stormSnapshots), [stormSnapshots]);
  const blockedCityKey = useMemo(() => [...blockedCityIds].sort().join(","), [blockedCityIds]);
  const scenarioPatch = useMemo(
    () => buildScenarioPatch(focusedCityId, scenario),
    [focusedCityId, scenario]
  );
  const stormAdjustedSignals = useMemo(
    () => applyStormEffectsToSignals(liveSignals, stormSnapshots),
    [liveSignals, stormSnapshots]
  );
  const scenarioSnapshot = useMemo(() => {
    if (!stormAdjustedSignals.length || !baseTickers.length) {
      return null;
    }

    return createScenarioSnapshot(
      {
        assetId: selectedAssetId,
        cityId: focusedCityId,
        patch: scenarioPatch
      },
      stormAdjustedSignals,
      baseTickers
    );
  }, [baseTickers, focusedCityId, scenarioPatch, selectedAssetId, stormAdjustedSignals]);

  const signals = scenarioSnapshot?.signals ?? stormAdjustedSignals;

  const tickers = baseTickers.map((ticker) => ({
    ...ticker,
    price: prices[focusedCityId]?.[ticker.assetId] ?? ticker.price,
    changePct: changePct[focusedCityId]?.[ticker.assetId] ?? ticker.changePct
  }));

  const travelDisabledReason = useMemo(() => {
    if (flight) {
      if (flight.isReturningHome) {
        return `Storm wall detected. Aircraft is automatically returning to ${cityIndex[flight.toCityId]?.name ?? flight.toCityId}.`;
      }

      return flight.phase === "holding"
        ? "Storm wall detected. Aircraft is automatically turning back."
        : "You are already airborne.";
    }

    if (focusedCityId === currentCityId) {
      return null;
    }

    if (blockedCityIds.has(currentCityId)) {
      return `${cityIndex[currentCityId]?.name ?? currentCityId} sits inside a visible no-fly footprint.`;
    }

    if (blockedCityIds.has(focusedCityId)) {
      return `${cityIndex[focusedCityId]?.name ?? focusedCityId} sits inside a visible no-fly footprint.`;
    }

    return null;
  }, [blockedCityIds, currentCityId, flight, focusedCityId]);

  const advanceLoadStage = (nextStage: GlobeLoadStage) => {
    setLoadStage((currentStage) => {
      const currentIndex = globeLoadStageOrder.indexOf(currentStage);
      const nextIndex = globeLoadStageOrder.indexOf(nextStage);
      return nextIndex > currentIndex ? nextStage : currentStage;
    });
  };

  const handleStartFlight = () => {
    if (flight || focusedCityId === currentCityId || travelDisabledReason) {
      return;
    }

    setFlight(createFlightState(currentCityId, focusedCityId, performance.now()));
  };

  useEffect(() => {
    liveSignalsRef.current = liveSignals;
  }, [liveSignals]);

  useEffect(() => {
    stormSnapshotsRef.current = stormSnapshots;
  }, [stormSnapshots]);

  useEffect(() => {
    latestOracleContextRef.current = {
      signals,
      holdings,
      prices,
      cash,
      blockedCityIds: [...blockedCityIds],
      currentCityId,
      focusedCityId,
      flight,
      tickers: baseTickers
    };
  }, [baseTickers, blockedCityIds, cash, currentCityId, flight, focusedCityId, holdings, prices, signals]);

  useEffect(() => {
    let animationFrameId = 0;
    let lastCommittedMs = -1000;

    const tick = (now: number) => {
      if (simulationStartRef.current === null) {
        simulationStartRef.current = now;
      }

      const elapsedMs = now - simulationStartRef.current;
      if (elapsedMs - lastCommittedMs >= 33) {
        setSimulationMs(elapsedMs);
        lastCommittedMs = elapsedMs;
      }

      animationFrameId = window.requestAnimationFrame(tick);
    };

    animationFrameId = window.requestAnimationFrame(tick);
    return () => {
      if (typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(animationFrameId);
      }
    };
  }, []);

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

  // Track rolling 3-tick average portfolio value change
  useEffect(() => {
    const { prices: p, holdings: h, cash: c } = useTradingStore.getState();
    let holdingsVal = 0;
    for (const cId in h) {
      for (const aId in h[cId]) {
        holdingsVal += (p[cId]?.[aId] ?? 0) * h[cId][aId];
      }
    }
    const totalVal = c + holdingsVal;
    const hist = portfolioHistoryRef.current;
    hist.push(totalVal);
    if (hist.length > 4) hist.shift(); // keep last 4 values → up to 3 tick-to-tick changes
    if (hist.length >= 2) {
      const changes: number[] = [];
      for (let i = 1; i < hist.length; i++) {
        const prev = hist[i - 1];
        if (prev !== 0) changes.push(((hist[i] - prev) / prev) * 100);
      }
      const avg = changes.reduce((s, v) => s + v, 0) / changes.length;
      setPortfolioRollingPct(Number(avg.toFixed(2)));
    }
  }, [gameTick]);


  useEffect(() => {
    isOracleSpeakingRef.current = isOracleSpeaking;
  }, [isOracleSpeaking]);

  useEffect(() => {
    speakPendingRef.current = speakMutation.isPending;
  }, [speakMutation.isPending]);

  useEffect(() => {
    const activeFlight = useAppStore.getState().flight;
    if (!activeFlight) {
      return;
    }

    const nowMs = performance.now();
    const deltaMs = Math.max(0, nowMs - activeFlight.lastUpdatedAtMs);
    if (deltaMs === 0) {
      return;
    }

    if (activeFlight.isReturningHome) {
      const nextProgress = Math.min(1, activeFlight.progress + deltaMs / activeFlight.durationMs);

      if (nextProgress >= 1) {
        setCurrentCity(activeFlight.toCityId);
        setFocusedCity(activeFlight.toCityId);
        setFlight(null);
        return;
      }

      const nextPoint = getPathPointAtProgress(activeFlight.path, nextProgress);
      setFlight({
        ...activeFlight,
        progress: nextProgress,
        currentLat: nextPoint.lat,
        currentLon: nextPoint.lon,
        remainingMs: Math.max(0, activeFlight.durationMs * (1 - nextProgress)),
        lastUpdatedAtMs: nowMs
      });
      return;
    }

    const triggerForcedReturn = (flightToReverse: FlightState) => {
      const returnFlight = createReturnFlightState(flightToReverse, nowMs);
      setFocusedCity(returnFlight.toCityId);
      setFlight(returnFlight);
      const notification = createRuntimeOracleNotification({
        eventKey: `flight-return-${returnFlight.id}`,
        category: "flight",
        severity: "critical",
        title: "Storm forced a return",
        body: `${cityIndex[flightToReverse.toCityId]?.name ?? flightToReverse.toCityId} is cut off by the storm wall. The aircraft is abandoning the approach and returning to ${cityIndex[returnFlight.toCityId]?.name ?? returnFlight.toCityId}.`,
        speakText: `${cityIndex[flightToReverse.toCityId]?.name ?? flightToReverse.toCityId} has been cut off by the storm wall. The aircraft is returning home now.`,
        cityIds: [flightToReverse.toCityId, returnFlight.toCityId],
        assetIds: [],
        affectedValue: 0,
        affectedPortfolioShare: 0,
        holdingsCount: 0
      });
      publishOracleNotifications([notification], notification);
    };

    if (activeFlight.phase === "holding") {
      triggerForcedReturn(activeFlight);
      return;
    }

    const holdProgress = findFlightHoldProgress(
      activeFlight.path,
      stormSnapshots,
      activeFlight.progress
    );
    const nextProgress = Math.min(1, activeFlight.progress + deltaMs / activeFlight.durationMs);

    if (holdProgress !== null && nextProgress >= holdProgress) {
      const holdPoint = getPathPointAtProgress(activeFlight.path, holdProgress);
      triggerForcedReturn({
        ...activeFlight,
        phase: "holding",
        progress: holdProgress,
        holdProgress,
        holdingStartedAtMs: nowMs,
        currentLat: holdPoint.lat,
        currentLon: holdPoint.lon,
        remainingMs: Math.max(0, activeFlight.durationMs * (1 - holdProgress)),
        lastUpdatedAtMs: nowMs
      });
      return;
    }

    if (nextProgress >= 1) {
      setCurrentCity(activeFlight.toCityId);
      setFocusedCity(activeFlight.toCityId);
      setFlight(null);
      return;
    }

    const nextPoint = getPathPointAtProgress(activeFlight.path, nextProgress);
    setFlight({
      ...activeFlight,
      progress: nextProgress,
      currentLat: nextPoint.lat,
      currentLon: nextPoint.lon,
      remainingMs: Math.max(0, activeFlight.durationMs * (1 - nextProgress)),
      lastUpdatedAtMs: nowMs
    });
  }, [setCurrentCity, setFeed, setFlight, setFocusedCity, simulationMs, stormSnapshots]);

  useEffect(() => {
    if (!baseTickers.length || !signals.length) {
      return;
    }

    oracleWatchStateRef.current = evaluateOracleNotifications({
      ...latestOracleContextRef.current,
      previousState: createInitialOracleWatchState()
    }).nextState;

    const intervalId = window.setInterval(() => {
      const { notifications, speakable, nextState } = evaluateOracleNotifications({
        ...latestOracleContextRef.current,
        previousState: oracleWatchStateRef.current
      });

      oracleWatchStateRef.current = nextState;
      publishOracleNotifications(notifications, speakable);
    }, 20_000);

    return () => window.clearInterval(intervalId);
  }, [baseTickers.length, signals.length]);

  useEffect(() => {
    if (!baseTickers.length) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setGameTick((value) => value + 1);

      const freshSignals = createFallbackSignals();
      liveSignalsRef.current = freshSignals;
      setLiveSignals(freshSignals);

      const effectiveSignals = applyStormEffectsToSignals(freshSignals, stormSnapshotsRef.current);

      const priceUpdates: Array<{ cityId: string; earthDeltas: Record<string, number>; mycelium: { soilMoisture: number; soilPh: number; humidity: number } }> = [];
      const signalUpdates: Array<{ cityId: string; signals: EnvironmentalSignal }> = [];

      effectiveSignals.forEach((citySignal) => {
        const deltas: Record<string, number> = {};
        const prevSignal = prevSignalsRef.current[citySignal.cityId];

        if (prevSignal) {
          assetProfiles.forEach((assetProfile) => {
            deltas[assetProfile.id] = computeEarthDeltaFromChange(assetProfile, citySignal, prevSignal);
          });
        }

        priceUpdates.push({
          cityId: citySignal.cityId,
          earthDeltas: deltas,
          mycelium: {
            soilMoisture: citySignal.soilMoisture,
            soilPh: citySignal.soilPh,
            humidity: citySignal.humidity,
          }
        });

        signalUpdates.push({
          cityId: citySignal.cityId,
          signals: citySignal
        });
      });

      tickAllPrices(priceUpdates);
      recordAllSignals(signalUpdates);

      // Snapshot this tick's signals so the next tick can compute deltas
      prevSignalsRef.current = Object.fromEntries(
        effectiveSignals.map((s) => [s.cityId, s])
      );
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [baseTickers, recordAllSignals, tickAllPrices]);

  const DAYS_PER_WEEK = 7;
  const WEEKS_PER_YEAR = 52;
  const DAYS_PER_YEAR = DAYS_PER_WEEK * WEEKS_PER_YEAR;
  const START_YEAR = 2157;
  const DAY_NAMES = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday"
  ];

  const fictionalYear = START_YEAR + Math.floor(gameTick / DAYS_PER_YEAR);
  const dayOfYear = gameTick % DAYS_PER_YEAR;
  const fictionalWeek = Math.floor(dayOfYear / DAYS_PER_WEEK) + 1;
  const fictionalDayName = DAY_NAMES[dayOfYear % DAYS_PER_WEEK];

  const sideMotionProps = isAppInteractive
    ? {
      initial: { opacity: 0, x: -24 },
      animate: { opacity: 1, x: 0 },
      transition: { duration: 0.5 }
    }
    : {
      initial: false as const,
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
      initial: false as const,
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
      initial: false as const,
      animate: { opacity: 1, scale: 1 },
      transition: { duration: 0 }
    };

  return (
    <div className={isAppInteractive ? "app-shell is-interactive" : "app-shell is-loading"}>
      <div className="starscape" />

      <AnimatePresence>
        {isOracleSpeaking ? (
          <motion.div
            className="fungal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
        ) : null}
      </AnimatePresence>

      {oracleFlash ? <div className="oracle-flash-overlay" aria-hidden="true" /> : null}

      <header className="app-header">

        {/* 1. Left Section */}
        <div className="header-left">
          <div>
            <span className="eyebrow">Mycelium Market</span>
            <h1>The planet is the trader.</h1>
          </div>
        </div>

        {/* 2. Center Section (No absolute positioning needed!) */}
        <div className="header-center">
          <div style={{ textAlign: "right" }}>
            <span
              style={{
                display: "block",
                fontSize: "0.62rem",
                fontWeight: "bold",
                letterSpacing: "0.15em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
                marginBottom: "4px"
              }}
            >
              Current Base
            </span>
            <div
              style={{
                fontSize: "clamp(1rem, 1.6vw, 1.4rem)",
                fontWeight: "bold",
                letterSpacing: "-0.02em",
                lineHeight: 1,
                color: "var(--text)"
              }}
            >
              {cityIndex[currentCityId]?.name ?? currentCityId}
            </div>
          </div>

          <div style={{ width: "1px", height: "36px", background: "var(--border)" }} />

          <div style={{ textAlign: "center" }}>
            <span
              style={{
                display: "block",
                fontSize: "0.62rem",
                fontWeight: "bold",
                letterSpacing: "0.15em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
                marginBottom: "4px"
              }}
            >
            </span>
            <div
              style={{
                fontSize: "clamp(1.6rem, 2.4vw, 2.8rem)",
                fontWeight: "bold",
                letterSpacing: "-0.03em",
                lineHeight: 1,
                color: "var(--text)",
                textAlign: "left"
              }}
            >
              {dayOfYear} <span style={{
                fontSize: "1rem"
              }} >{fictionalDayName}</span>
            </div>
            <div
              style={{
                fontSize: "0.78rem",
                color: "var(--text-muted)",
                marginTop: "5px",
                letterSpacing: "0.05em",
                textAlign: "left"
              }}
            >
              Week {fictionalWeek} · Year {fictionalYear}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }} className="mycelium-spacer">
          <MyceliumWidget signals={signals} cityId={currentCityId} />
          <EnvironmentalEffectsPanel signals={signals} cityId={currentCityId} />
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
                    focusedCityId={focusedCityId}
                    currentCityId={currentCityId}
                    selectedAssetId={selectedAssetId}
                    signals={signals}
                    rankings={scenarioSnapshot?.rankings ?? []}
                    storms={stormSnapshots}
                    blockedCityIds={[...blockedCityIds]}
                    flight={flight}
                    onSelectCity={setFocusedCity}
                    onStartFlight={handleStartFlight}
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
              {(() => {
                const formatGBPOverlay = (v: number) =>
                  `£${new Intl.NumberFormat("en-GB", {
                    maximumFractionDigits: v >= 1000 ? 0 : 2,
                    minimumFractionDigits: v >= 1000 ? 0 : 2,
                  }).format(v)}`;

                const portfolioItems: { cityId: string; assetId: string; qty: number }[] = [];
                for (const cId in holdings) {
                  for (const aId in holdings[cId]) {
                    const qty = holdings[cId][aId];
                    if (qty > 0) portfolioItems.push({ cityId: cId, assetId: aId, qty });
                  }
                }

                const holdingsValue = portfolioItems.reduce((sum, item) => {
                  const unitPrice = prices[item.cityId]?.[item.assetId] ?? 0;
                  return sum + unitPrice * item.qty;
                }, 0);
                const totalValue = cash + holdingsValue;

                return (
                  <>
                    {/* Portfolio label + rolling pct badge */}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                      <span className="eyebrow">Portfolio</span>
                      {portfolioRollingPct !== null && (
                        <span style={{
                          fontSize: "1rem",
                          fontWeight: "bold",
                          letterSpacing: "0.03em",
                          padding: "2px 7px",
                          borderRadius: "4px",
                          background: portfolioRollingPct >= 0 ? "rgba(0,200,100,0.15)" : "rgba(220,50,50,0.15)",
                          color: portfolioRollingPct >= 0 ? "#3ddc84" : "#ff5c5c",
                          border: `1px solid ${portfolioRollingPct >= 0 ? "rgba(61,220,132,0.35)" : "rgba(255,92,92,0.35)"}`,
                        }}>
                          {portfolioRollingPct >= 0 ? "▲" : "▼"} {Math.abs(portfolioRollingPct).toFixed(2)}%
                        </span>
                      )}
                    </div>

                    {/* Big total value display */}
                    <div style={{
                      fontSize: "clamp(1.5rem, 2.8vw, 4rem)",
                      fontWeight: "bold",
                      letterSpacing: "-0.03em",
                      lineHeight: 1,
                      color: "var(--accent)",
                      marginBottom: "12px",
                    }}>
                      {formatGBPOverlay(totalValue)}
                    </div>

                    {/* Cash row */}
                    <div style={{
                      display: "flex", justifyContent: "space-between",
                      fontSize: "0.8rem", color: "var(--text-muted)",
                      paddingBottom: "8px",
                      borderBottom: portfolioItems.length > 0 ? "1px solid var(--border)" : "none",
                      marginBottom: portfolioItems.length > 0 ? "8px" : 0,
                    }}>
                      <span>Cash</span>
                      <span>{formatGBPOverlay(cash)}</span>
                    </div>

                    {/* Holdings list */}
                    {portfolioItems.length === 0 ? (
                      <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: 0 }}>No active holdings.</p>
                    ) : (
                      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                        {portfolioItems.map((item, idx) => {
                          const cityName = cityIndex[item.cityId]?.name ?? item.cityId;
                          const profile = assetProfiles.find(a => a.id === item.assetId);
                          const assetLabel = profile?.id ?? item.assetId;
                          const unitPrice = prices[item.cityId]?.[item.assetId] ?? (profile?.basePrice ?? 0);
                          const positionValue = unitPrice * item.qty;
                          return (
                            <li key={idx} style={{
                              marginBottom: "8px",
                              paddingBottom: "8px",
                              borderBottom: idx < portfolioItems.length - 1 ? "1px solid var(--border)" : "none",
                            }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                                <span style={{ fontWeight: "bold", fontSize: "1.3rem" }}>
                                  {assetLabel} <span style={{ fontWeight: "normal", color: "var(--text-muted)" }}>×{item.qty}</span>
                                </span>
                                <strong style={{ fontSize: "1.3rem", color: "var(--accent)" }}>
                                  {formatGBPOverlay(positionValue)}
                                </strong>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "2px" }}>
                                <span>{cityName}</span>
                                <span>{formatGBPOverlay(unitPrice)} / unit</span>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}

                  </>
                );
              })()}
            </div>
          </div>
        </motion.section>

        <motion.div className="right-column" {...rightMotionProps}>
          <MarketPanel
            tickers={tickers}
            snapshot={scenarioSnapshot ?? undefined}
            signals={signals}
            selectedAssetId={selectedAssetId}
            focusedCityId={focusedCityId}
            currentCityId={currentCityId}
            blockedCityIds={[...blockedCityIds]}
            flight={flight}
            onSelectAsset={setAsset}
          />
        </motion.div>
      </main>

      {!isAppInteractive ? <GlobalLoadingScreen stage={loadStage} /> : null}
    </div>
  );
}

export default App;
