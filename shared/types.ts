export type SourceMode = "live" | "fallback" | "hybrid" | "scenario" | "demo";

export type MarketType = "stock" | "commodity" | "crypto" | "prediction";

export type Severity = "calm" | "watch" | "alert" | "critical";

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

export type EventFeedItem = {
  id: string;
  title: string;
  body: string;
  cityId?: string;
  severity: Severity;
  kind: "market" | "environment" | "oracle" | "scenario";
  timestamp: string;
};

export type ScenarioPreviewRequest = {
  assetId: string;
  cityId: string;
  patch?: ScenarioPatch | null;
  mode: "live" | "demo";
};

export type RankedCity = {
  cityId: string;
  earthDelta: number;
  travelScore: number;
  repricedValue: number;
  severity: Severity;
  signal: EnvironmentalSignal;
};

export type ScenarioPreviewResponse = {
  primary: OracleComputation;
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

