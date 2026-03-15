import {
  createFallbackSignals,
  createFallbackTickers,
  createScenarioPreview
} from "../shared/oracle";
import { defaultAssetId, defaultCityId } from "../shared/data";
import type {
  MarketsResponse,
  OracleSpeakRequest,
  OracleSpeakResponse,
  ScenarioPreviewRequest,
  ScenarioPreviewResponse,
  SignalsResponse
} from "../shared/types";

// Replaced server fetch calls with local logic to allow static deployment

export async function fetchMarkets(): Promise<MarketsResponse> {
  return {
    tickers: createFallbackTickers(),
    sourceMode: "synthetic",
    asOf: new Date().toISOString()
  };
}

export async function fetchSignals(cityId = "all"): Promise<SignalsResponse> {
  const signals = createFallbackSignals();
  const filteredSignals =
    !cityId || cityId === "all"
      ? signals
      : signals.filter((signal) => signal.cityId === cityId);

  return {
    signals: filteredSignals,
    sourceMode: "synthetic"
  };
}

export async function previewScenario(
  payload: ScenarioPreviewRequest
): Promise<ScenarioPreviewResponse> {
  return createScenarioPreview(
    {
      assetId: payload.assetId ?? defaultAssetId,
      cityId: payload.cityId ?? defaultCityId,
      compareCityId: payload.compareCityId,
      patch: payload.patch ?? null
    },
    createFallbackSignals(),
    createFallbackTickers()
  );
}

let globalAudioCooldown = 0;

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
    12_000,
    Math.min(45_000, Math.max(estimatedFromWords, estimatedFromChars) + 2_000)
  );
}

export async function speakOracle(
  payload: OracleSpeakRequest
): Promise<OracleSpeakResponse> {
  const now = Date.now();
  const text = sanitizeOracleSpeechText(payload.text ?? "");

  if (!text) {
    throw new Error("text is required");
  }

  if (now < globalAudioCooldown) {
    return {
      skipped: true,
      message: "Audio is already playing or on cooldown.",
      cooldownUntil: new Date(globalAudioCooldown).toISOString()
    };
  }

  globalAudioCooldown = now + estimateOracleSpeechCooldownMs(text);

  return {
    text,
    audioUrl: null, // ElevenLabs text-to-speech removed
    severity: payload.severity ?? "watch",
    cooldownUntil: new Date(globalAudioCooldown).toISOString()
  };
}
