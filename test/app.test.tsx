import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import type { MarketsResponse, ScenarioPreviewResponse, SignalsResponse } from "../shared/types";
import { createFallbackSignals, createFallbackTickers, createScenarioPreview } from "../shared/oracle";

vi.mock("../src/components/GlobeScene", () => ({
  default: () => <div data-testid="globe-scene">globe</div>
}));

const signalsPayload: SignalsResponse = {
  signals: createFallbackSignals(),
  sourceMode: "fallback"
};

const marketsPayload: MarketsResponse = {
  tickers: createFallbackTickers(),
  sourceMode: "fallback",
  asOf: "2026-03-14T10:00:00.000Z"
};

const previewPayload: ScenarioPreviewResponse = createScenarioPreview(
  {
    assetId: "COCOA",
    cityId: "manaus",
    compareCityId: "reykjavik",
    patch: null,
    mode: "demo"
  },
  signalsPayload.signals,
  marketsPayload.tickers
);

describe("App", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const payload = url.includes("/api/markets")
        ? marketsPayload
        : url.includes("/api/signals")
          ? signalsPayload
          : url.includes("/api/scenario/preview")
            ? previewPayload
            : {
                text: previewPayload.oracleText,
                audioUrl: null,
                severity: previewPayload.primary.severity,
                cooldownUntil: new Date().toISOString()
              };

      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("renders the planetary dashboard loop and lets the user switch assets", async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false
        }
      }
    });

    render(
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>
    );

    expect(await screen.findByText("The planet is the trader.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Cocoa Futures")).toBeInTheDocument());

    const assetSelect = screen.getByLabelText("Asset");
    await userEvent.selectOptions(assetSelect, "BTC");

    await waitFor(() => {
      expect(assetSelect).toHaveValue("BTC");
    });
  });
});
