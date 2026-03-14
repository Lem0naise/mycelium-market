import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import type { MarketsResponse, ScenarioPreviewResponse, SignalsResponse } from "../shared/types";
import { createFallbackSignals, createFallbackTickers, createScenarioPreview } from "../shared/oracle";

vi.mock("../src/components/GlobeScene", () => ({
  default: ({
    onStageChange,
    onInteractive
  }: {
    onStageChange?: (stage: "base" | "signals" | "labels" | "interactive") => void;
    onInteractive?: () => void;
  }) => (
    <div data-testid="globe-scene">
      <button type="button" onClick={() => onStageChange?.("base")}>
        stage-base
      </button>
      <button type="button" onClick={() => onStageChange?.("signals")}>
        stage-signals
      </button>
      <button type="button" onClick={() => onStageChange?.("labels")}>
        stage-labels
      </button>
      <button
        type="button"
        onClick={() => {
          onStageChange?.("interactive");
          onInteractive?.();
        }}
      >
        stage-interactive
      </button>
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

  it("keeps the global loader visible until the globe reports interactive readiness", async () => {
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
    expect(screen.getByText("Loading planetary engine")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    expect(await screen.findByTestId("globe-scene")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "30");
    });

    await user.click(screen.getByRole("button", { name: "stage-base" }));
    await waitFor(() => {
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "55");
    });
    expect(screen.getByText("Mapping country topology")).toBeInTheDocument();
    expect(screen.getByText("Loading planetary engine")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "stage-signals" }));
    await waitFor(() => {
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "75");
    });

    await user.click(screen.getByRole("button", { name: "stage-labels" }));
    await waitFor(() => {
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "90");
    });
    expect(screen.getByText("Activating city labels")).toBeInTheDocument();
    expect(screen.getByText("Loading planetary engine")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "stage-interactive" }));
    await waitFor(() => {
      expect(screen.queryByText("Loading planetary engine")).not.toBeInTheDocument();
    });

    await waitFor(() => expect(screen.getByText("Cocoa Futures")).toBeInTheDocument());

    const assetSelect = screen.getByLabelText("Asset");
    await user.selectOptions(assetSelect, "BTC");

    await waitFor(() => {
      expect(assetSelect).toHaveValue("BTC");
    });
  });
});
