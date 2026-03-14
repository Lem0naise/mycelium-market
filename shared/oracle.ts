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

function normalizeSignal(signal: SignalKey, value: number) {
  const bounds = signalBounds[signal];
  const spread = (bounds.max - bounds.min) / 2;
  return clamp((value - bounds.center) / spread, -1.35, 1.35);
}

function regionAffinity(asset: AssetProfile, region: string) {
  if (asset.homeRegions.includes("Global")) {
    return 3;
  }

  if (asset.homeRegions.includes(region)) {
    return 8;
  }

  return -2;
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
  compareSignal?: EnvironmentalSignal
): OracleComputation {
  const contributions = (Object.keys(asset.ecologicalWeights) as SignalKey[]).map((key) => {
    const normalized = normalizeSignal(key, signal[key]);
    return {
      key,
      contribution: normalized * asset.ecologicalWeights[key] * 11.5
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

  const regionalBias = regionAffinity(asset, signal.region);
  const rawDelta =
    contributions.reduce((sum, item) => sum + item.contribution, 0) + regionalBias + triggerBonus;

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

  const travelScore = clamp(Math.round(58 + earthDelta * 1.5 + regionalBias * 1.8), 1, 99);

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
      title: "Planetary Condition Alert",
      body: oracleText,
      cityId: request.cityId,
      severity: "critical",
      kind: "oracle",
      timestamp: new Date().toISOString()
    }
  ];
}

export function createScenarioPreview(
  request: ScenarioPreviewRequest,
  signals: EnvironmentalSignal[],
  tickers: MarketTicker[]
): ScenarioPreviewResponse {
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
    feed: buildFeed(request, oracleText, isCritical),
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

export function createFallbackSignals() {
  const time = (Date.now() / 60000) * 2; // ×2 speed → ~3–10 min cycles per signal
  return cities.map((city, index) => ({
    cityId: city.id,
    region: city.region,
    ...city.baselines,
    humidity: clamp(city.baselines.humidity + Math.sin(time + index * 2.1) * 45, 0, 100),
    rain: clamp(city.baselines.rain + Math.cos(time + index * 1.3) * 10, 0, 20),
    temperature: clamp(city.baselines.temperature + Math.sin(time * 0.5 + index) * 20, -10, 45),
    wind: clamp(city.baselines.wind + Math.cos(time * 0.8 + index) * 25, 0, 45),
    airQuality: clamp(city.baselines.airQuality + Math.sin(time * 1.2 + index) * 60, 0, 160),
    soilMoisture: clamp(city.baselines.soilMoisture + Math.cos(time * 0.3 + index) * 30, 0, 100),
    soilPh: clamp(city.baselines.soilPh + Math.sin(time * 0.7 + index * 1.9) * 1.5, 4, 9),
    sourceMode: "synthetic" as const
  }));
}
