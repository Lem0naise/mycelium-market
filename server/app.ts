import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import {
  assetProfiles,
  cities,
  cityIndex,
  defaultAssetId,
  defaultCityId
} from "../shared/data";
import {
  createFallbackSignals,
  createFallbackTickers,
  createScenarioPreview
} from "../shared/oracle";
import type {
  EnvironmentalSignal,
  MarketsResponse,
  MarketTicker,
  OracleSpeakRequest,
  ScenarioPreviewRequest,
  SignalsResponse,
  SourceMode
} from "../shared/types";

dotenv.config();

type DataProvider = {
  getSignals: (mode: "live" | "demo") => Promise<{ signals: EnvironmentalSignal[]; sourceMode: SourceMode }>;
  getMarkets: (mode: "live" | "demo") => Promise<MarketsResponse>;
  speak: (text: string) => Promise<string | null>;
};

const yahooSymbolMap: Record<string, string | null> = {
  COCOA: "CC=F",
  BRENT: "BZ=F",
  BTC: "BTC-USD",
  NVDA: "NVDA",
  DAL: "DAL",
  TAN: "TAN",
  "KALSHI-RAIN": null
};

const sentimentFromChange = (changePct: number): MarketTicker["sentiment"] => {
  if (changePct >= 3) {
    return "feral";
  }
  if (changePct <= -2) {
    return "fragile";
  }
  if (Math.abs(changePct) < 0.8) {
    return "dormant";
  }
  return "ascendant";
};

const round = (value: number, precision = 2) => {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

const fetchJson = async <T>(url: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
};

async function fetchWeatherSignal(cityId: string, mode: "live" | "demo"): Promise<EnvironmentalSignal> {
  const city = cityIndex[cityId] ?? cityIndex[defaultCityId];

  if (mode === "demo") {
    return {
      cityId: city.id,
      region: city.region,
      ...city.baselines,
      humidity: Math.min(100, city.baselines.humidity + (city.id === "manaus" ? 4 : 0)),
      rain: Math.min(20, city.baselines.rain + (city.id === "manaus" ? 2.2 : 0)),
      sourceMode: "demo"
    };
  }

  try {
    const weather = await fetchJson<{
      current?: {
        temperature_2m?: number;
        relative_humidity_2m?: number;
        precipitation?: number;
        wind_speed_10m?: number;
      };
    }>(
      `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m`
    );

    const airQuality = await fetchJson<{
      current?: {
        us_aqi?: number;
      };
    }>(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${city.lat}&longitude=${city.lon}&current=us_aqi`
    );

    return {
      cityId: city.id,
      region: city.region,
      humidity: weather.current?.relative_humidity_2m ?? city.baselines.humidity,
      rain: weather.current?.precipitation ?? city.baselines.rain,
      temperature: weather.current?.temperature_2m ?? city.baselines.temperature,
      wind: weather.current?.wind_speed_10m ?? city.baselines.wind,
      airQuality: airQuality.current?.us_aqi ?? city.baselines.airQuality,
      soilMoisture: city.baselines.soilMoisture,
      soilPh: city.baselines.soilPh,
      sourceMode: "hybrid"
    };
  } catch {
    return {
      cityId: city.id,
      region: city.region,
      ...city.baselines,
      sourceMode: "fallback"
    };
  }
}

async function fetchMarketTicker(assetId: string, mode: "live" | "demo"): Promise<MarketTicker> {
  const asset = assetProfiles.find((item) => item.id === assetId) ?? assetProfiles[0];
  const symbol = yahooSymbolMap[assetId];

  if (mode === "demo") {
    return {
      assetId,
      price: round(asset.basePrice * (1 + Math.sin(asset.basePrice) * 0.02)),
      changePct: round(Math.cos(asset.basePrice / 17) * 4.2),
      volume: `${round(asset.basePrice / 3200 + 1.4, 1)}B`,
      sentiment: "feral",
      sourceMode: "demo"
    };
  }

  if (!symbol) {
    return {
      assetId,
      price: asset.basePrice,
      changePct: 5.4,
      volume: "0.8B",
      sentiment: "ascendant",
      sourceMode: "fallback"
    };
  }

  try {
    const payload = await fetchJson<{
      chart?: {
        result?: Array<{
          meta?: {
            regularMarketPrice?: number;
          };
          indicators?: {
            quote?: Array<{
              close?: Array<number | null>;
              volume?: Array<number | null>;
            }>;
          };
        }>;
      };
    }>(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`);

    const result = payload.chart?.result?.[0];
    const closes = result?.indicators?.quote?.[0]?.close?.filter((value): value is number => value != null) ?? [];
    const price = result?.meta?.regularMarketPrice ?? closes.at(-1) ?? asset.basePrice;
    const previous = closes.at(-2) ?? price;
    const volume = result?.indicators?.quote?.[0]?.volume?.at(-1) ?? 0;
    const changePct = previous === 0 ? 0 : round(((price - previous) / previous) * 100);

    return {
      assetId,
      price: round(price),
      changePct,
      volume: `${round(volume / 1_000_000_000, 1)}B`,
      sentiment: sentimentFromChange(changePct),
      sourceMode: "hybrid"
    };
  } catch {
    const fallback = createFallbackTickers().find((ticker) => ticker.assetId === assetId);
    return fallback ?? {
      assetId,
      price: asset.basePrice,
      changePct: 0,
      volume: "0.0B",
      sentiment: "dormant",
      sourceMode: "fallback"
    };
  }
}

async function elevenLabsSpeak(text: string) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey || !voiceId) {
    return null;
  }

  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.33,
          similarity_boost: 0.58,
          style: 0.84,
          use_speaker_boost: true
        }
      })
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs failed with ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return `data:audio/mpeg;base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

function createDefaultProvider(): DataProvider {
  return {
    async getSignals(mode) {
      if (mode === "demo") {
        return { signals: createFallbackSignals().map((signal) => ({ ...signal, sourceMode: "demo" })), sourceMode: "demo" };
      }

      const signals = await Promise.all(cities.map((city) => fetchWeatherSignal(city.id, mode)));
      const sourceMode = signals.some((signal) => signal.sourceMode === "hybrid") ? "hybrid" : "fallback";
      return { signals, sourceMode };
    },
    async getMarkets(mode) {
      if (mode === "demo") {
        return {
          tickers: await Promise.all(assetProfiles.map((asset) => fetchMarketTicker(asset.id, "demo"))),
          sourceMode: "demo",
          asOf: new Date().toISOString()
        };
      }

      const tickers = await Promise.all(assetProfiles.map((asset) => fetchMarketTicker(asset.id, "live")));
      const sourceMode = tickers.some((ticker) => ticker.sourceMode === "hybrid") ? "hybrid" : "fallback";
      return { tickers, sourceMode, asOf: new Date().toISOString() };
    },
    speak: elevenLabsSpeak
  };
}

export async function resolveMarkets(provider: DataProvider, mode: "live" | "demo") {
  return provider.getMarkets(mode);
}

export async function resolveSignals(
  provider: DataProvider,
  mode: "live" | "demo",
  cityId?: string
) {
  const signals = await provider.getSignals(mode);
  const filteredSignals =
    !cityId || cityId === "all"
      ? signals.signals
      : signals.signals.filter((signal) => signal.cityId === cityId);

  const payload: SignalsResponse = {
    signals: filteredSignals,
    sourceMode: signals.sourceMode
  };

  return payload;
}

export async function resolveScenarioPreview(
  provider: DataProvider,
  body: ScenarioPreviewRequest
) {
  const mode = body.mode === "demo" ? "demo" : "live";
  const [signalPayload, marketPayload] = await Promise.all([
    provider.getSignals(mode),
    provider.getMarkets(mode)
  ]);

  return createScenarioPreview(
    {
      assetId: body.assetId ?? defaultAssetId,
      cityId: body.cityId ?? defaultCityId,
      compareCityId: body.compareCityId,
      patch: body.patch ?? null,
      mode
    },
    signalPayload.signals,
    marketPayload.tickers
  );
}

export async function resolveOracleSpeech(
  provider: DataProvider,
  body: OracleSpeakRequest
) {
  const text = body.text?.trim();
  if (!text) {
    throw new Error("text is required");
  }

  const audioUrl = await provider.speak(text);
  return {
    text,
    audioUrl,
    severity: body.severity ?? "watch",
    cooldownUntil: new Date(Date.now() + 30_000).toISOString()
  };
}

export function createApp(provider = createDefaultProvider()) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/api/markets", async (request, response) => {
    const mode = request.query.mode === "demo" ? "demo" : "live";
    response.json(await resolveMarkets(provider, mode));
  });

  app.get("/api/signals", async (request, response) => {
    const mode = request.query.mode === "demo" ? "demo" : "live";
    const cityId = typeof request.query.cityId === "string" ? request.query.cityId : undefined;
    response.json(await resolveSignals(provider, mode, cityId));
  });

  app.post("/api/scenario/preview", async (request, response) => {
    response.json(await resolveScenarioPreview(provider, request.body as ScenarioPreviewRequest));
  });

  app.post("/api/oracle/speak", async (request, response) => {
    try {
      response.json(await resolveOracleSpeech(provider, request.body as OracleSpeakRequest));
    } catch {
      response.status(400).json({ error: "text is required" });
    }
  });

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true });
  });

  return app;
}

export function createMockProvider(overrides: Partial<DataProvider> = {}): DataProvider {
  return {
    async getSignals(_mode) {
      return {
        signals: createFallbackSignals(),
        sourceMode: "fallback"
      };
    },
    async getMarkets(_mode) {
      return {
        tickers: createFallbackTickers(),
        sourceMode: "fallback",
        asOf: new Date().toISOString()
      };
    },
    async speak(text) {
      return text.length > 0 ? "data:audio/mpeg;base64,ZmFrZQ==" : null;
    },
    ...overrides
  };
}
