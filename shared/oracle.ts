import {
  assetIndex,
  assetProfiles,
  cities,
  cityIndex,
  defaultAssetId,
  defaultCityId
} from "./data";
import type {
  AssetProfile,
  EnvironmentalSignal,
  EventFeedItem,
  MarketTicker,
  OracleComputation,
  ScenarioSnapshot,
  ScenarioPatch,
  ScenarioPreviewRequest,
  ScenarioPreviewResponse,
  Severity,
  SignalKey
} from "./types";

const signalBounds: Record<SignalKey, { min: number; max: number; center: number }> = {
  humidity: { min: 0, max: 100, center: 55 },
  rain: { min: 0, max: 20, center: 4 },
  temperature: { min: -10, max: 45, center: 20 },
  wind: { min: 0, max: 40, center: 10 },
  airQuality: { min: 0, max: 160, center: 35 },
  soilMoisture: { min: 0, max: 100, center: 45 },
  soilPh: { min: 4, max: 9, center: 6.2 }
};

const signalLabels: Record<SignalKey, string> = {
  humidity: "humidity",
  rain: "rainfall",
  temperature: "temperature",
  wind: "wind shear",
  airQuality: "air quality",
  soilMoisture: "soil moisture",
  soilPh: "soil pH"
};

const severityOrder: Severity[] = ["calm", "watch", "alert", "critical"];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, precision = 1) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function normalizeSignal(signal: SignalKey, value: number, customCenter?: number) {
  const bounds = signalBounds[signal];
  const center = customCenter !== undefined ? customCenter : bounds.center;
  const spread = (bounds.max - bounds.min) / 2;
  return clamp((value - center) / spread, -1.35, 1.35);
}

// Per-signal normalization scale for rate-of-change computation.
// Each value is the approximate maximum natural change per 1-second tick
// under non-storm conditions, derived from the sinusoidal signal derivatives.
const signalTickScale: Record<SignalKey, number> = {
  temperature: 0.35,  // °C/tick   — max sinusoidal derivative ~0.33
  wind: 0.70,  // kn/tick   — max ~0.67
  rain: 0.45,  // mm/tick   — max ~0.43
  airQuality: 2.50,  // AQI/tick  — max ~2.4
  humidity: 1.50,  // %/tick    — max ~1.5
  soilMoisture: 0.35,  // %/tick    — max ~0.3
  soilPh: 0.04,  // pH/tick   — max ~0.035
};

/**
 * Compute earthDelta for price-ticking based on the *rate of change* of each
 * signal between the previous and current tick, rather than absolute levels.
 *
 * A rising signal → positive earthDelta → price up.
 * A falling signal → negative earthDelta → price down.
 * A stable signal → earthDelta ≈ 0 (only noise moves price).
 */
export function computeEarthDeltaFromChange(
  asset: AssetProfile,
  currentSignal: EnvironmentalSignal,
  previousSignal: EnvironmentalSignal
): number {
  const DELTA_AMPLIFIER = 10;

  const rawDelta = (Object.keys(asset.ecologicalWeights) as SignalKey[]).reduce((sum, key) => {
    const weight = asset.ecologicalWeights[key];
    if (weight === 0) return sum;
    const delta = currentSignal[key] - previousSignal[key];
    const normalized = clamp(delta / (signalTickScale[key] ?? 1), -1.35, 1.35);
    return sum + normalized * weight * DELTA_AMPLIFIER;
  }, 0);

  return round(clamp(rawDelta, -28, 32));
}

export function applyScenarioPatch(
  signal: EnvironmentalSignal,
  patch?: ScenarioPatch | null
): EnvironmentalSignal {
  if (!patch || patch.targetCityId !== signal.cityId) {
    return signal;
  }

  return {
    ...signal,
    humidity: clamp(signal.humidity + (patch.humidityDelta ?? patch.rainDelta * 0.8), 0, 100),
    rain: clamp(signal.rain + patch.rainDelta, 0, 20),
    temperature: clamp(signal.temperature + patch.temperatureDelta, -10, 45),
    wind: clamp(signal.wind + patch.windDelta, 0, 45),
    airQuality: clamp(signal.airQuality + (patch.airQualityDelta ?? patch.windDelta * 1.4), 0, 180),
    soilMoisture: clamp(signal.soilMoisture + patch.soilMoistureDelta, 0, 100),
    soilPh: clamp(signal.soilPh + patch.soilPhDelta, 4, 9),
    sourceMode: "synthetic"
  };
}

export function computeOracle(
  asset: AssetProfile,
  signal: EnvironmentalSignal,
  baselineValue: number,
  compareSignal?: EnvironmentalSignal,
  rollingCenters?: Partial<Record<SignalKey, number>>
): OracleComputation {
  // Use per-city baselines as the normalization center so prices react to
  // deviation from that city's own normal, not a global reference value.
  const cityBaselines = cityIndex[signal.cityId]?.baselines;

  const contributions = (Object.keys(asset.ecologicalWeights) as SignalKey[]).map((key) => {
    const center = rollingCenters?.[key] ?? cityBaselines?.[key];
    const normalized = normalizeSignal(key, signal[key], center);
    return {
      key,
      contribution: normalized * asset.ecologicalWeights[key] * 4.5
    };
  });

  const triggerBonus = asset.triggerRules.reduce((total, rule) => {
    const liveValue = signal[rule.signal];
    const passes = rule.kind === "drop" ? liveValue <= rule.threshold : liveValue >= rule.threshold;
    if (!passes) {
      return total;
    }

    if (rule.kind === "drop") {
      return total + rule.effect;
    }

    if (rule.kind === "inversion") {
      return total - Math.abs(rule.effect);
    }

    return total + rule.effect;
  }, 0);

  const rawDelta =
    contributions.reduce((sum, item) => sum + item.contribution, 0) + triggerBonus;

  const earthDelta = round(clamp(rawDelta, -28, 32));
  const environmentalPressure = round(
    contributions.reduce((sum, item) => sum + Math.abs(item.contribution), 0),
    1
  );
  const repricedValue = round(baselineValue * (1 + earthDelta / 100 * 0.38), 2);

  let severity: Severity = "calm";
  if (Math.abs(earthDelta) >= 8 || environmentalPressure >= 20) {
    severity = "watch";
  }
  if (Math.abs(earthDelta) >= 14 || environmentalPressure >= 27) {
    severity = "alert";
  }
  if (Math.abs(earthDelta) >= 20 || environmentalPressure >= 34) {
    severity = "critical";
  }

  const rankedContributions = contributions
    .slice()
    .sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution));

  const rationaleTokens = rankedContributions.slice(0, 3).map((entry) => {
    const direction = entry.contribution >= 0 ? "amplifies" : "suppresses";
    return `${signalLabels[entry.key]} ${direction}`;
  });

  let cityAdvantage = 0;
  if (compareSignal) {
    const compareOracle = computeOracle(asset, compareSignal, baselineValue);
    cityAdvantage = round(earthDelta - compareOracle.earthDelta);
  }

  const travelScore = clamp(Math.round(58 + earthDelta * 1.5), 1, 99);

  return {
    assetId: asset.id,
    cityId: signal.cityId,
    compareCityId: compareSignal?.cityId,
    earthDelta,
    travelScore,
    cityAdvantage,
    severity,
    rationaleTokens,
    repricedValue,
    baselineValue,
    environmentalPressure,
    sourceMode: signal.sourceMode
  };
}

export function rankCities(
  assetId: string,
  signals: EnvironmentalSignal[],
  tickers: MarketTicker[],
  patch?: ScenarioPatch | null
) {
  const asset = assetIndex[assetId] ?? assetIndex[defaultAssetId];
  const ticker = tickers.find((item) => item.assetId === asset.id);
  const baselineValue = ticker?.price ?? asset.basePrice;

  return signals
    .map((signal) => {
      const patched = applyScenarioPatch(signal, patch);
      const computed = computeOracle(asset, patched, baselineValue);
      return {
        cityId: signal.cityId,
        earthDelta: computed.earthDelta,
        travelScore: computed.travelScore,
        repricedValue: computed.repricedValue,
        severity: computed.severity,
        signal: patched
      };
    })
    .sort((left, right) => right.travelScore - left.travelScore);
}

function severityRank(severity: Severity) {
  return severityOrder.indexOf(severity);
}

/**
 * Returns the set of active threshold zones for a signal.
 * Each zone is a stable string key — the same key appears while the city stays
 * inside that zone and disappears the moment it exits.
 *
 * Zones: "hum-high" | "hum-low" | "temp-high" | "temp-low" | "wind-high" | "rain-high"
 */
export function getConditionZones(signal: EnvironmentalSignal): Set<string> {
  const zones = new Set<string>();
  if (signal.humidity > 80) zones.add("hum-high");
  if (signal.humidity < 30) zones.add("hum-low");
  if (signal.temperature > 40) zones.add("temp-high");
  if (signal.temperature < -5) zones.add("temp-low");
  if (signal.wind > 35) zones.add("wind-high");
  if (signal.rain > 15) zones.add("rain-high");
  return zones;
}

/**
 * Edge-detector: compares prevZones → currZones for one city and returns separate
 * entry and exit crossing data.
 *
 * - `entry`: zones just entered → speak via ElevenLabs + flash (no feed item)
 * - `exit`: zones just exited → push a "calm" feed item (no speech)
 *
 * Returns null when nothing changed — i.e. a city already at hum 94 moving to
 * hum 93 produces no result because "hum-high" was active before and is still active.
 *
 * Call once per signal update. The caller is responsible for persisting prevZones
 * between calls (e.g. in a React ref).
 */
export function checkBoundaryCrossings(
  prevZones: Set<string>,
  currZones: Set<string>,
  signal: EnvironmentalSignal,
  cityName: string
): {
  entry: { display: string; speech: string } | null;
  exit: { display: string } | null;
} | null {
  const entered: string[] = [];
  const exited: string[] = [];
  for (const z of currZones) if (!prevZones.has(z)) entered.push(z);
  for (const z of prevZones) if (!currZones.has(z)) exited.push(z);

  if (entered.length === 0 && exited.length === 0) return null;

  // Per-zone label factories — called at crossing time so values reflect actual signal
  const enterLabels: Record<string, [string, string]> = {
    "hum-high": [`hum. ${Math.round(signal.humidity)}% ↑`, `humidity rising to ${Math.round(signal.humidity)} percent`],
    "hum-low": [`hum. ${Math.round(signal.humidity)}% ↓`, `humidity dropping to ${Math.round(signal.humidity)} percent`],
    "temp-high": [`temp ${Math.round(signal.temperature)}° ↑`, `temperature at ${Math.round(signal.temperature)} degrees`],
    "temp-low": [`temp ${Math.round(signal.temperature)}° ↓`, `temperature dropping to ${Math.round(signal.temperature)} degrees`],
    "wind-high": [`wind ${Math.round(signal.wind)}kn ↑`, `wind at ${Math.round(signal.wind)} knots`],
    "rain-high": [`rain ${Math.round(signal.rain)}mm ↑`, `rainfall at ${Math.round(signal.rain)} millimetres`],
  };
  const exitLabels: Record<string, string> = {
    "hum-high": "hum. clearing",
    "hum-low": "hum. recovering",
    "temp-high": "temp easing",
    "temp-low": "temp rising",
    "wind-high": "wind settling",
    "rain-high": "rain easing",
  };

  let entry: { display: string; speech: string } | null = null;
  if (entered.length > 0) {
    const displayParts: string[] = [];
    const speechParts: string[] = [];
    for (const z of entered) {
      const [d, s] = enterLabels[z] ?? [z, z];
      displayParts.push(d);
      speechParts.push(s);
    }
    entry = {
      display: `${cityName}: ${displayParts.join(", ")}`,
      speech: `Alert — ${cityName}: ${speechParts.join(", ")}.`
    };
  }

  let exit: { display: string } | null = null;
  if (exited.length > 0) {
    const displayParts = exited.map(z => exitLabels[z] ?? z);
    exit = { display: `${cityName}: ${displayParts.join(", ")}` };
  }

  return { entry, exit };
}

// Used internally by buildOracleText / createScenarioPreview only.
function checkCriticalConditions(
  signal: EnvironmentalSignal,
  cityName: string
): { display: string; speech: string } | null {
  const zones = getConditionZones(signal);
  if (zones.size === 0) return null;
  const displayParts: string[] = [];
  const speechParts: string[] = [];
  if (zones.has("hum-high") || zones.has("hum-low")) {
    displayParts.push(`hum. ${Math.round(signal.humidity)}%`);
    speechParts.push(`humidity ${Math.round(signal.humidity)} percent`);
  }
  if (zones.has("temp-high") || zones.has("temp-low")) {
    displayParts.push(`temp ${Math.round(signal.temperature)}°`);
    speechParts.push(`temperature ${Math.round(signal.temperature)} degrees`);
  }
  if (zones.has("wind-high")) {
    displayParts.push(`wind ${Math.round(signal.wind)}kn`);
    speechParts.push(`wind ${Math.round(signal.wind)} knots`);
  }
  if (zones.has("rain-high")) {
    displayParts.push(`rain ${Math.round(signal.rain)}mm`);
    speechParts.push(`rainfall ${Math.round(signal.rain)} millimetres`);
  }
  return {
    display: `${cityName}: ${displayParts.join(", ")}.`,
    speech: `${cityName}: ${speechParts.join(", ")}.`
  };
}

function isSignalCritical(signal: EnvironmentalSignal): boolean {
  return (
    signal.humidity > 80 ||
    signal.humidity < 30 ||
    signal.temperature > 40 ||
    signal.temperature < -5 ||
    signal.wind > 35 ||
    signal.rain > 15
  );
}

export function buildOracleText(signal: EnvironmentalSignal, cityName: string) {
  const result = checkCriticalConditions(signal, cityName);
  return result ? result.display : "Conditions stable.";
}

export function buildFeed(
  request: ScenarioPreviewRequest,
  oracleText: string,
  isCritical: boolean
): EventFeedItem[] {
  if (!isCritical) return [];

  return [
    {
      id: `${request.assetId}-${request.cityId}-oracle-${Date.now()}`,
      eventKey: `${request.assetId}-${request.cityId}-oracle`,
      title: "Planetary Condition Alert",
      body: oracleText,
      category: "driver",
      severity: "critical",
      speakText: null,
      cityIds: [request.cityId],
      assetIds: [request.assetId],
      affectedValue: 0,
      affectedPortfolioShare: 0,
      holdingsCount: 0,
      timestamp: new Date().toISOString(),
      state: "active"
    }
  ];
}

export function createScenarioPreview(
  request: ScenarioPreviewRequest,
  signals: EnvironmentalSignal[],
  tickers: MarketTicker[]
): ScenarioPreviewResponse {
  const snapshot = createScenarioSnapshot(request, signals, tickers);
  const primarySignal =
    snapshot.signals.find((signal) => signal.cityId === snapshot.primary.cityId) ?? snapshot.signals[0];
  const isCritical = isSignalCritical(primarySignal);

  return {
    ...snapshot,
    feed: buildFeed(request, snapshot.oracleText, isCritical)
  };
}

export function createScenarioSnapshot(
  request: ScenarioPreviewRequest,
  signals: EnvironmentalSignal[],
  tickers: MarketTicker[]
): ScenarioSnapshot {
  const asset = assetIndex[request.assetId] ?? assetIndex[defaultAssetId];
  const ticker = tickers.find((item) => item.assetId === asset.id);
  const baselineValue = ticker?.price ?? asset.basePrice;
  const patchedSignals = signals.map((signal) => applyScenarioPatch(signal, request.patch));
  const primarySignal = patchedSignals.find((signal) => signal.cityId === request.cityId) ?? patchedSignals[0];
  const compareSignal = request.compareCityId
    ? patchedSignals.find((signal) => signal.cityId === request.compareCityId)
    : undefined;

  const primary = computeOracle(asset, primarySignal, baselineValue, compareSignal);
  const compare = compareSignal ? computeOracle(asset, compareSignal, baselineValue, primarySignal) : null;
  const rankings = rankCities(asset.id, signals, tickers, request.patch);
  const oracleText = buildOracleText(
    primarySignal,
    cityIndex[primary.cityId]?.name ?? primary.cityId
  );

  const isCritical = isSignalCritical(primarySignal);
  if (isCritical) {
    primary.severity = "critical";
  } else {
    primary.severity = "calm";
  }

  return {
    primary,
    compare,
    rankings,
    signals: patchedSignals,
    oracleText,
    sourceMode: primarySignal.sourceMode
  };
}

export function generateOracleSpeechText(
  computation: OracleComputation,
  assetId: string,
  cityId: string,
  compareCityId?: string
) {
  const asset = assetIndex[assetId] ?? assetIndex[defaultAssetId];
  const cityName = cityIndex[cityId]?.name ?? cityId;
  const compareCityName = compareCityId ? cityIndex[compareCityId]?.name ?? compareCityId : undefined;

  const compareLine = compareCityName
    ? ` ${cityName} is currently trading against ${compareCityName} at a spread of ${Math.abs(computation.cityAdvantage)} Earth Delta.`
    : "";

  return `Update: ${asset.label} is being affected by environmental factors in ${cityName}. Contributing factors are: ${computation.rationaleTokens.join(", ")}.${compareLine}`;
}

export function createFallbackTickers() {
  return assetProfiles.map((asset, index) => {
    const sentiment: MarketTicker["sentiment"] =
      index % 4 === 0 ? "feral" : index % 3 === 0 ? "fragile" : "ascendant";

    return {
      assetId: asset.id,
      price: round(asset.basePrice + Math.sin(index * 1.8 + 1.4) * asset.basePrice * 0.028, 2),
      changePct: round(Math.cos(index * 0.9 + 0.6) * 3.8, 2),
      volume: `${round(1.8 + index * 0.7, 1)}B`,
      sentiment,
      sourceMode: "synthetic" as const
    };
  });
}


// ─── Stock-like stochastic weather simulation ────────────────────────────────
//
// Each signal is modelled as a second-order process: it has both a current
// *value* and a *velocity* (momentum).  Every tick:
//   1. A small continuous noise shock is applied to velocity.
//   2. With low probability a large impulse hits (regime change / sudden rush).
//   3. A weak mean-reversion force nudges velocity back toward the city baseline.
//   4. Velocity is partially preserved (momentum decay).
//   5. The value advances by velocity and is clamped to physical limits.
//
// This produces behaviour very similar to a stock price: sustained trends,
// occasional sharp reversals, and periods of calm.  Unlike the old sine-wave
// approach it has *memory*, so signals cannot be recomputed from the clock
// alone — they live in the module-level `fallbackSignalState` object below.

type SignalSimConfig = {
  momentumDecay: number;   // fraction of velocity kept each tick [0,1]; higher = longer trends
  volatility: number;      // std-dev of the continuous noise shock (signal units/tick)
  meanRevStrength: number; // fraction of (baseline - value) added to velocity each tick
  jumpProb: number;        // probability per tick of a sudden large impulse
  jumpScale: number;       // impulse size = volatility × jumpScale
};

const SIGNAL_SIM: Record<SignalKey, SignalSimConfig> = {
  // Temperature: long, slow trends — can drift 15-20 °C over several minutes.
  temperature:  { momentumDecay: 0.97, volatility: 0.06,  meanRevStrength: 0.003, jumpProb: 0.005, jumpScale: 12 },
  // Rain: bursty — intense episodes that recede quickly, strong mean reversion.
  rain:         { momentumDecay: 0.86, volatility: 0.10,  meanRevStrength: 0.030, jumpProb: 0.010, jumpScale: 10 },
  // Wind: medium persistence, gusty spikes.
  wind:         { momentumDecay: 0.90, volatility: 0.20,  meanRevStrength: 0.005, jumpProb: 0.008, jumpScale: 8  },
  // Air quality: gradual, persistent shifts (pollution fronts).
  airQuality:   { momentumDecay: 0.95, volatility: 0.60,  meanRevStrength: 0.003, jumpProb: 0.006, jumpScale: 7  },
  // Humidity: slow, drifts with temperature/rain trends.
  humidity:     { momentumDecay: 0.95, volatility: 0.30,  meanRevStrength: 0.003, jumpProb: 0.004, jumpScale: 6  },
  // Soil moisture: inertia-heavy, responds slowly.
  soilMoisture: { momentumDecay: 0.97, volatility: 0.12,  meanRevStrength: 0.003, jumpProb: 0.003, jumpScale: 5  },
  // Soil pH: very stable, tiny fluctuations.
  soilPh:       { momentumDecay: 0.98, volatility: 0.008, meanRevStrength: 0.003, jumpProb: 0.002, jumpScale: 5  },
};

// Persistent simulation state — survives across ticks for the lifetime of the page.
type SignalParticle = { value: number; velocity: number };
const fallbackSignalState: Record<string, Partial<Record<SignalKey, SignalParticle>>> = {};

function initFallbackSignalState() {
  cities.forEach((city) => {
    fallbackSignalState[city.id] = {};
    (Object.keys(SIGNAL_SIM) as SignalKey[]).forEach((key) => {
      fallbackSignalState[city.id][key] = { value: city.baselines[key], velocity: 0 };
    });
  });
}

export function createFallbackSignals(): EnvironmentalSignal[] {
  // Lazy initialisation: build state on the first call.
  if (Object.keys(fallbackSignalState).length === 0) {
    initFallbackSignalState();
  }

  return cities.map((city) => {
    const cityState = fallbackSignalState[city.id];
    const out: Partial<Record<SignalKey, number>> = {};

    (Object.keys(SIGNAL_SIM) as SignalKey[]).forEach((key) => {
      const sim = SIGNAL_SIM[key];
      const bounds = signalBounds[key];
      const particle = cityState[key]!;
      const center = city.baselines[key];

      // Continuous noise: approximates N(0, volatility²) via scaled uniform.
      const noise = (Math.random() - 0.5) * sim.volatility * 3.46;

      // Occasional large impulse in a random direction — sudden weather rush.
      const jump = Math.random() < sim.jumpProb
        ? (Math.random() < 0.5 ? 1 : -1) * sim.volatility * sim.jumpScale
        : 0;

      // Weak restoring force toward city-specific baseline.
      const meanRevForce = (center - particle.value) * sim.meanRevStrength;

      // Second-order update: velocity → value.
      particle.velocity = particle.velocity * sim.momentumDecay + noise + jump + meanRevForce;
      particle.value = clamp(particle.value + particle.velocity, bounds.min, bounds.max);

      out[key] = particle.value;
    });

    return {
      cityId: city.id,
      region: city.region,
      humidity:     round(out.humidity!,     1),
      rain:         round(out.rain!,         1),
      temperature:  round(out.temperature!,  1),
      wind:         round(out.wind!,         1),
      airQuality:   round(out.airQuality!,   1),
      soilMoisture: round(out.soilMoisture!, 1),
      soilPh:       round(out.soilPh!,       2),
      sourceMode: "synthetic" as const
    };
  });
}