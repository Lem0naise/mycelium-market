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

export function fetchMarkets() {
  return requestJson<MarketsResponse>("/api/markets");
}

export function fetchSignals(cityId = "all") {
  return requestJson<SignalsResponse>(`/api/signals?cityId=${cityId}`);
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

export const fetchFungalOracle = async (ticker: string) => {
  const response = await fetch('/api/consult', { 
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticker }),
  });
  
  if (!response.ok) throw new Error('Network dormant');
  
  return await response.blob();
};
