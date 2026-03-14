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
    const passes = rule.kind === "drop" ? liveValue >= rule.threshold : liveValue >= rule.threshold;
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

export function buildOracleText(
  asset: AssetProfile,
  cityName: string,
  primary: OracleComputation,
  compareCityName?: string,
  compare?: OracleComputation | null
) {
  const comparison = compare && compareCityName
    ? ` Compared to ${compareCityName}, ${cityName} is ${primary.cityAdvantage >= 0 ? "stronger" : "weaker"}.`
    : "";

  return `The environmental conditions in ${cityName} are currently causing ${asset.label} to shift by ${primary.earthDelta > 0 ? "+" : ""}${primary.earthDelta}%. Primary factors: ${primary.rationaleTokens.join(", ")}.${comparison}`;
}

export function buildFeed(
  request: ScenarioPreviewRequest,
  rankings: ReturnType<typeof rankCities>,
  primary: OracleComputation,
  compare: OracleComputation | null,
  oracleText: string
): EventFeedItem[] {
  const selectedCity = cityIndex[request.cityId] ?? cityIndex[defaultCityId];
  const topCity = cityIndex[rankings[0]?.cityId] ?? selectedCity;
  const feed: EventFeedItem[] = [
    {
      id: `${request.assetId}-${request.cityId}-oracle`,
      title: "Oracle interruption",
      body: oracleText,
      cityId: request.cityId,
      severity: primary.severity,
      kind: "oracle",
      timestamp: new Date().toISOString()
    },
    {
      id: `${request.assetId}-${rankings[0]?.cityId}-market`,
      title: `${topCity.name} now leads ${request.assetId}`,
      body: `${topCity.name} is generating the strongest travel score at ${rankings[0]?.travelScore ?? primary.travelScore}.`,
      cityId: topCity.id,
      severity: rankings[0]?.severity ?? primary.severity,
      kind: "market",
      timestamp: new Date().toISOString()
    }
  ];

  if (request.patch) {
    feed.unshift({
      id: `${request.assetId}-${request.patch.targetCityId}-scenario`,
      title: "Scenario patch applied",
      body: `${selectedCity.name} was forced into a new weather state to test how price reacts under pressure.`,
      cityId: request.patch.targetCityId,
      severity: primary.severity,
      kind: "scenario",
      timestamp: new Date().toISOString()
    });
  }

  if (compare) {
    const compareCity = cityIndex[compare.cityId];
    feed.push({
      id: `${primary.cityId}-${compare.cityId}-compare`,
      title: "City arbitrage spread",
      body: `${selectedCity.name} is ${primary.cityAdvantage >= 0 ? "outperforming" : "underperforming"} ${compareCity?.name ?? compare.cityId} by ${Math.abs(primary.cityAdvantage)} Earth Delta.`,
      cityId: primary.cityId,
      severity: severityRank(primary.severity) >= severityRank(compare.severity) ? primary.severity : compare.severity,
      kind: "environment",
      timestamp: new Date().toISOString()
    });
  }

  return feed;
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
    asset,
    cityIndex[primary.cityId]?.name ?? primary.cityId,
    primary,
    compare ? cityIndex[compare.cityId]?.name ?? compare.cityId : undefined,
    compare
  );

  return {
    primary,
    compare,
    rankings,
    signals: patchedSignals,
    feed: buildFeed(request, rankings, primary, compare, oracleText),
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
  return cities.map((city, index) => ({
    cityId: city.id,
    region: city.region,
    ...city.baselines,
    humidity: clamp(city.baselines.humidity + Math.sin(index + 2) * 3, 0, 100),
    rain: clamp(city.baselines.rain + Math.cos(index * 1.3) * 1.4, 0, 20),
    sourceMode: "synthetic" as const
  }));
}
