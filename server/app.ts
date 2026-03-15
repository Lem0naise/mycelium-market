import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import {
  defaultAssetId,
  defaultCityId
} from "../shared/data";
import {
  createFallbackSignals,
  createFallbackTickers,
  createScenarioPreview
} from "../shared/oracle";
import type {
  MarketsResponse,
  OracleSpeakRequest,
  ScenarioPreviewRequest,
  SignalsResponse
} from "../shared/types";

dotenv.config();

type DataProvider = {
  getSignals: () => Promise<SignalsResponse>;
  getMarkets: () => Promise<MarketsResponse>;
  speak: (text: string) => Promise<string | null>;
};

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
    async getSignals() {
      return {
        signals: createFallbackSignals(),
        sourceMode: "synthetic"
      };
    },
    async getMarkets() {
      return {
        tickers: createFallbackTickers(),
        sourceMode: "synthetic",
        asOf: new Date().toISOString()
      };
    },
    speak: elevenLabsSpeak
  };
}

export async function resolveMarkets(provider: DataProvider) {
  return provider.getMarkets();
}

export async function resolveSignals(provider: DataProvider, cityId?: string) {
  const signals = await provider.getSignals();
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
  const [signalPayload, marketPayload] = await Promise.all([
    provider.getSignals(),
    provider.getMarkets()
  ]);

  return createScenarioPreview(
    {
      assetId: body.assetId ?? defaultAssetId,
      cityId: body.cityId ?? defaultCityId,
      compareCityId: body.compareCityId,
      patch: body.patch ?? null
    },
    signalPayload.signals,
    marketPayload.tickers
  );
}
// Add a global lock variable at the top of your app.ts (outside the functions)
let globalAudioCooldown = 0;

export function resetOracleSpeechCooldown() {
  globalAudioCooldown = 0;
}

export async function resolveOracleSpeech(
  provider: DataProvider,
  body: OracleSpeakRequest
) {
  const now = Date.now();
  const text = body.text?.trim();

  if (!text) {
    throw new Error("text is required");
  }

  // 1. Prevent overlapping: If we are on cooldown, skip this request
  if (now < globalAudioCooldown) {
    return {
      skipped: true, // Frontend can check this flag to know it was ignored
      message: "Audio is already playing or on cooldown.",
      cooldownUntil: new Date(globalAudioCooldown).toISOString()
    };
  }

  // 2. Lock immediately so concurrent requests in the same millisecond don't overlap
  globalAudioCooldown = now + 15_000; // Temporary 15s lock while fetching

  try {
    let audioUrl: string | null = null;
    try {
      audioUrl = await provider.speak(text);
    } catch {
      audioUrl = null;
    }

    // 3. Extend the lock so the oracle finishes a single message before the next one starts.
    globalAudioCooldown = Date.now() + 20_000;

    return {
      text,
      audioUrl,
      severity: body.severity ?? "watch",
      cooldownUntil: new Date(globalAudioCooldown).toISOString()
    };
  } catch (error) {
    // 4. Release the lock only for unexpected server-side failures.
    globalAudioCooldown = 0;
    throw error;
  }
}

export function createApp(provider = createDefaultProvider()) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/api/markets", async (_request, response) => {
    response.json(await resolveMarkets(provider));
  });

  app.get("/api/signals", async (request, response) => {
    const cityId = typeof request.query.cityId === "string" ? request.query.cityId : undefined;
    response.json(await resolveSignals(provider, cityId));
  });

  app.post("/api/scenario/preview", async (request, response) => {
    response.json(await resolveScenarioPreview(provider, request.body as ScenarioPreviewRequest));
  });

  app.post("/api/oracle/speak", async (request, response) => {
    try {
      response.json(await resolveOracleSpeech(provider, request.body as OracleSpeakRequest));
    } catch (error) {
      const message = error instanceof Error ? error.message : "oracle speech failed";
      response.status(message === "text is required" ? 400 : 500).json({ error: message });
    }
  });

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true });
  });

  return app;
}

export function createMockProvider(overrides: Partial<DataProvider> = {}): DataProvider {
  return {
    async getSignals() {
      return {
        signals: createFallbackSignals(),
        sourceMode: "synthetic"
      };
    },
    async getMarkets() {
      return {
        tickers: createFallbackTickers(),
        sourceMode: "synthetic",
        asOf: new Date().toISOString()
      };
    },
    async speak(text) {
      return text.length > 0 ? "data:audio/mpeg;base64,ZmFrZQ==" : null;
    },
    ...overrides
  };
}
