import type {
  MarketsResponse,
  OracleSpeakRequest,
  OracleSpeech,
  ScenarioPreviewRequest,
  ScenarioPreviewResponse,
  SignalsResponse
} from "../shared/types";

async function requestJson<T>(input: RequestInfo, init?: RequestInit) {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

export function fetchMarkets(mode: "live" | "demo") {
  return requestJson<MarketsResponse>(`/api/markets?mode=${mode}`);
}

export function fetchSignals(mode: "live" | "demo", cityId = "all") {
  return requestJson<SignalsResponse>(`/api/signals?mode=${mode}&cityId=${cityId}`);
}

export function previewScenario(payload: ScenarioPreviewRequest) {
  return requestJson<ScenarioPreviewResponse>("/api/scenario/preview", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

export function speakOracle(payload: OracleSpeakRequest) {
  return requestJson<OracleSpeech>("/api/oracle/speak", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

