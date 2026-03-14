export type SourceMode = "synthetic";

export type MarketType = "stock" | "commodity" | "crypto" | "prediction";

export type Severity = "calm" | "watch" | "alert" | "critical";

export type GeoPoint = {
  lat: number;
  lon: number;
};

export type SignalKey =
  | "humidity"
  | "rain"
  | "temperature"
  | "wind"
  | "airQuality"
  | "soilMoisture"
  | "soilPh";

export type EnvironmentalSignal = {
  cityId: string;
  region: string;
  humidity: number;
  rain: number;
  temperature: number;
  wind: number;
  airQuality: number;
  soilMoisture: number;
  soilPh: number;
  sourceMode: SourceMode;
};

export type AssetTriggerRule = {
  kind: "surge" | "drop" | "inversion";
  signal: SignalKey;
  threshold: number;
  effect: number;
};

export type AssetProfile = {
  id: string;
  label: string;
  marketType: MarketType;
  symbol: string;
  basePrice: number;
  accentColor: string;
  homeRegions: string[];
  ecologicalWeights: Record<SignalKey, number>;
  triggerRules: AssetTriggerRule[];
};

export type OracleComputation = {
  assetId: string;
  cityId: string;
  compareCityId?: string;
  earthDelta: number;
  travelScore: number;
  cityAdvantage: number;
  severity: Severity;
  rationaleTokens: string[];
  repricedValue: number;
  baselineValue: number;
  environmentalPressure: number;
  sourceMode: SourceMode;
};

export type ScenarioPatch = {
  targetCityId: string;
  rainDelta: number;
  temperatureDelta: number;
  windDelta: number;
  soilMoistureDelta: number;
  soilPhDelta: number;
  humidityDelta?: number;
  airQualityDelta?: number;
};

export type OracleSpeech = {
  text: string;
  audioUrl: string | null;
  severity: Severity;
  cooldownUntil: string;
};

export type OracleNotificationCategory =
  | "storm"
  | "driver"
  | "access"
  | "flight"
  | "recovery";

export type OracleNotificationState = "active" | "resolved";

export type OracleNotification = {
  id: string;
  eventKey: string;
  category: OracleNotificationCategory;
  severity: Severity;
  title: string;
  body: string;
  speakText?: string | null;
  cityIds: string[];
  assetIds: string[];
  affectedValue: number;
  affectedPortfolioShare: number;
  holdingsCount: number;
  timestamp: string;
  state: OracleNotificationState;
};

export type StormSystem = {
  id: string;
  seed: number;
  originLat: number;
  originLon: number;
  radiusDeg: number;
  velocityLat: number;
  velocityLon: number;
  targetCityId: string | null;
  targetAssignedAtMs: number;
  targetExpiresAtMs: number;
  lastHitCityId: string | null;
  lastHitAtMs: number | null;
  driftHeadingDeg: number;
  driftSpeedDegPerSec: number;
  latWaveAmplitude: number;
  lonWaveAmplitude: number;
  latWaveSpeed: number;
  lonWaveSpeed: number;
  phaseOffset: number;
  hue: string;
};

export type StormTrailPoint = GeoPoint & {
  timestampMs: number;
  ageMs: number;
};

export type WindIndicator = {
  id: string;
  stormId: string;
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
  etaSeconds: number;
};

export type StormSnapshot = {
  stormId: string;
  lat: number;
  lon: number;
  radiusDeg: number;
  intensity: number;
  hue: string;
  trail: StormTrailPoint[];
  windIndicators: WindIndicator[];
};

export type FlightPhase = "en-route" | "holding";

export type FlightState = {
  id: string;
  phase: FlightPhase;
  fromCityId: string;
  toCityId: string;
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  distanceKm: number;
  durationMs: number;
  progress: number;
  holdProgress: number | null;
  holdingStartedAtMs: number | null;
  remainingMs: number;
  currentLat: number;
  currentLon: number;
  orbitAngleDeg: number;
  path: GeoPoint[];
  lastUpdatedAtMs: number;
  isReturningHome: boolean;
};

export type MyceliumSignal = {
  soilMoisture: number;
  soilPh: number;
  humidity: number;
};

export type TradeFailureReason =
  | "not-in-city"
  | "in-flight"
  | "storm-blocked"
  | "insufficient-cash"
  | "no-holdings"
  | "ecological-interference"
  | "mycelium-network-collapse"
  | "moisture-wilting-cap"
  | "humidity-reroute";

export type TradeResult =
  | {
      ok: true;
      assetId: string;
      cityId: string;
      quantity: number;
      executedPrice: number;
    }
  | {
      ok: false;
      reason: TradeFailureReason;
      message?: string;
      /** Populated on "humidity-reroute": the buy that was auto-executed instead */
      redirectBuy?: { assetId: string; quantity: number; executedPrice: number };
    };

/**
 * Discriminated union returned by POST /api/oracle/speak.
 * When the server lock is active it returns the `skipped` branch so the
 * client can bail out without touching audio state.
 */
export type OracleSpeakResponse =
  | { skipped: true; message: string; cooldownUntil: string }
  | (OracleSpeech & { skipped?: false });

export type MarketTicker = {
  assetId: string;
  price: number;
  changePct: number;
  volume: string;
  sentiment: "ascendant" | "fragile" | "feral" | "dormant";
  sourceMode: SourceMode;
};

export type CityProfile = {
  id: string;
  name: string;
  country: string;
  region: string;
  lat: number;
  lon: number;
  timezone: string;
  accentColor: string;
  tags: string[];
  baselines: Omit<EnvironmentalSignal, "cityId" | "region" | "sourceMode">;
};

export type EventFeedItem = OracleNotification;

export type ScenarioPreviewRequest = {
  assetId: string;
  cityId: string;
  compareCityId?: string;
  patch?: ScenarioPatch | null;
};

export type RankedCity = {
  cityId: string;
  earthDelta: number;
  travelScore: number;
  repricedValue: number;
  severity: Severity;
  signal: EnvironmentalSignal;
};

export type ScenarioSnapshot = {
  primary: OracleComputation;
  compare: OracleComputation | null;
  rankings: RankedCity[];
  signals: EnvironmentalSignal[];
  oracleText: string;
  sourceMode: SourceMode;
};

export type ScenarioPreviewResponse = {
  primary: OracleComputation;
  compare: OracleComputation | null;
  rankings: RankedCity[];
  signals: EnvironmentalSignal[];
  feed: EventFeedItem[];
  oracleText: string;
  sourceMode: SourceMode;
};

export type OracleSpeakRequest = {
  text: string;
  severity: Severity;
};

export type SignalsResponse = {
  signals: EnvironmentalSignal[];
  sourceMode: SourceMode;
};

export type MarketsResponse = {
  tickers: MarketTicker[];
  sourceMode: SourceMode;
  asOf: string;
};
