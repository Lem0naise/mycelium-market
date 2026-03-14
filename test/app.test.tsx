import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import type { MarketsResponse, SignalsResponse } from "../shared/types";
import { createFallbackSignals, createFallbackTickers } from "../shared/oracle";
import { useAppStore } from "../src/store/appStore";
import { useTradingStore } from "../src/store/tradingStore";

vi.mock("../src/components/GlobeScene", () => ({
  default: ({
    onStageChange,
    onInteractive,
    onSelectCity
  }: {
    onStageChange?: (stage: "base" | "signals" | "labels" | "interactive") => void;
    onInteractive?: () => void;
    onSelectCity?: (cityId: string) => void;
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
      <button type="button" onClick={() => onSelectCity?.("tokyo")}>
        select-tokyo
      </button>
    </div>
  )
}));

const signalsPayload: SignalsResponse = {
  signals: createFallbackSignals(),
  sourceMode: "synthetic"
};

const marketsPayload: MarketsResponse = {
  tickers: createFallbackTickers(),
  sourceMode: "synthetic",
  asOf: "2026-03-14T10:00:00.000Z"
};

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

    useAppStore.setState({
      selectedAssetId: "KAI",
      focusedCityId: "abidjan",
      currentCityId: "abidjan",
      audioEnabled: true,
      scenario: {
        rainDelta: 0,
        temperatureDelta: 0,
        windDelta: 0,
        soilMoistureDelta: 0,
        soilPhDelta: 0,
        humidityDelta: 0,
        airQualityDelta: 0
      },
      oracleHistory: [],
      feedHistory: [],
      stormSeed: 42,
      flight: null
    });
    useTradingStore.getState().resetPortfolio();

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const payload = url.includes("/api/markets")
        ? marketsPayload
        : url.includes("/api/signals")
          ? signalsPayload
          : {
              text: "Storm alert",
              audioUrl: null,
              severity: "critical",
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

    await waitFor(() => expect(screen.getByText("KaiCoin")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /WTFII/i }));

    await waitFor(() => {
      expect(screen.getByText("WTFisIndie")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "select-tokyo" }));

    const travelPanel = screen.getByText("Flight Deck").closest("section");
    expect(travelPanel).not.toBeNull();
    expect(within(travelPanel!).getByText("Tokyo")).toBeInTheDocument();
    expect(within(travelPanel!).getByText("Abidjan")).toBeInTheDocument();
  });
});
