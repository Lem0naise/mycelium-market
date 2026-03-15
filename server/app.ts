import cors from "cors";
import dotenv from "dotenv";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
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

const ELEVENLABS_MODEL_ID = process.env.ELEVENLABS_MODEL_ID ?? "eleven_turbo_v2_5";
const ORACLE_SPEECH_FETCH_LOCK_MS = 15_000;
const ORACLE_SPEECH_MIN_COOLDOWN_MS = 12_000;
const ORACLE_SPEECH_MAX_COOLDOWN_MS = 45_000;

type DataProvider = {
  getSignals: () => Promise<SignalsResponse>;
  getMarkets: () => Promise<MarketsResponse>;
  speak: (text: string) => Promise<string | null>;
};

function sanitizeOracleSpeechText(text: string) {
  return text
    .replace(/\s+/g, " ")
    .replace(/[()[\]{}*_`~]/g, "")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/([!?.,]){2,}/g, "$1")
    .trim()
    .slice(0, 220);
}

function estimateOracleSpeechCooldownMs(text: string) {
  const sanitized = sanitizeOracleSpeechText(text);
  const words = sanitized.length === 0 ? 0 : sanitized.split(/\s+/).length;
  const estimatedFromWords = words * 420;
  const estimatedFromChars = sanitized.length * 55;
  return Math.max(
    ORACLE_SPEECH_MIN_COOLDOWN_MS,
    Math.min(ORACLE_SPEECH_MAX_COOLDOWN_MS, Math.max(estimatedFromWords, estimatedFromChars) + 2_000)
  );
}

async function elevenLabsSpeak(text: string) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey || !voiceId) {
    return null;
  }

  try {
    const client = new ElevenLabsClient({
      apiKey
    });
    const audioStream = await client.textToSpeech.convert(voiceId, {
      text: sanitizeOracleSpeechText(text),
      modelId: ELEVENLABS_MODEL_ID,
      outputFormat: "mp3_44100_128",
      voiceSettings: {
        stability: 0.62,
        similarityBoost: 0.78,
        style: 0.14,
        useSpeakerBoost: true
      }
    });

    const arrayBuffer = await new Response(audioStream).arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.byteLength === 0) {
      return null;
    }
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
  const text = sanitizeOracleSpeechText(body.text ?? "");

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
  globalAudioCooldown = now + ORACLE_SPEECH_FETCH_LOCK_MS;

  try {
    let audioUrl: string | null = null;
    try {
      audioUrl = await provider.speak(text);
    } catch {
      audioUrl = null;
    }

    globalAudioCooldown = Date.now() + estimateOracleSpeechCooldownMs(text);

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
