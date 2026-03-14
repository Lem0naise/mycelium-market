import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import type { MarketsResponse, ScenarioPreviewResponse, SignalsResponse } from "../shared/types";
import { createFallbackSignals, createFallbackTickers, createScenarioPreview } from "../shared/oracle";

vi.mock("../src/components/GlobeScene", () => ({
  default: ({ onReady }: { onReady?: () => void }) => (
    <div>
      <div data-testid="globe-scene">globe</div>
      <div data-testid="globe-detail-stage">base</div>
      <button type="button" onClick={onReady}>
        ready
      </button>
      <button type="button">full-detail</button>
    </div>
  )
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
    cityId: "abidjan",
    compareCityId: "reykjavik",
    patch: null,
    mode: "demo"
  },
  signalsPayload.signals,
  marketsPayload.tickers
);

describe("App", () => {
  const originalFetch = global.fetch;
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;
  const originalRequestIdleCallback = window.requestIdleCallback;
  const originalCancelIdleCallback = window.cancelIdleCallback;

  beforeEach(() => {
    window.requestAnimationFrame = ((callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0)) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = ((handle: number) => {
      window.clearTimeout(handle);
    }) as typeof window.cancelAnimationFrame;
    window.requestIdleCallback = ((callback: IdleRequestCallback) =>
      window.setTimeout(
        () =>
          callback({
            didTimeout: false,
            timeRemaining: () => 50
          }),
        0
      )) as typeof window.requestIdleCallback;
    window.cancelIdleCallback = ((handle: number) => {
      window.clearTimeout(handle);
    }) as typeof window.cancelIdleCallback;

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
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    window.requestIdleCallback = originalRequestIdleCallback;
    window.cancelIdleCallback = originalCancelIdleCallback;
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
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>
    );

    expect(await screen.findByText("The planet is the trader.")).toBeInTheDocument();
    expect(screen.getByText("Loading globe...")).toBeInTheDocument();
    expect(screen.queryByTestId("globe-scene")).not.toBeInTheDocument();

    expect(await screen.findByTestId("globe-scene")).toBeInTheDocument();
    expect(screen.getByTestId("globe-detail-stage")).toHaveTextContent("base");
    await waitFor(() => expect(screen.getByText("Cocoa Futures")).toBeInTheDocument());

    const assetSelect = screen.getByLabelText("Asset");
    await user.selectOptions(assetSelect, "BTC");

    await waitFor(() => {
      expect(assetSelect).toHaveValue("BTC");
    });

    await user.click(screen.getByRole("button", { name: "ready" }));
    await waitFor(() => {
      expect(screen.queryByText("Loading globe...")).not.toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "full-detail" })).toBeInTheDocument();
  });
});
