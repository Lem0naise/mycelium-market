import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketsResponse } from "../shared/types";
import { useAppStore } from "../src/store/appStore";
import { useTradingStore } from "../src/store/tradingStore";
import { createFallbackTickers } from "../shared/oracle";
import {
  createInitialOracleWatchState,
  createOracleNotification
} from "../shared/omniscientOracle";

const evaluateOracleNotificationsMock = vi.hoisted(() => vi.fn());

vi.mock("../shared/omniscientOracle", async () => {
  const actual = await vi.importActual<typeof import("../shared/omniscientOracle")>(
    "../shared/omniscientOracle"
  );

  return {
    ...actual,
    evaluateOracleNotifications: evaluateOracleNotificationsMock
  };
});

vi.mock("../src/components/GlobeScene", () => ({
  default: ({
    onStageChange,
    onInteractive
  }: {
    onStageChange?: (stage: "base" | "signals" | "labels" | "interactive") => void;
    onInteractive?: () => void;
  }) => (
    <div data-testid="globe-scene">
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

import App from "../src/App";

const marketsPayload: MarketsResponse = {
  tickers: createFallbackTickers(),
  sourceMode: "synthetic",
  asOf: "2026-03-14T10:00:00.000Z"
};

describe("App oracle cadence", () => {
  const originalFetch = global.fetch;
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;
  const originalRequestIdleCallback = window.requestIdleCallback;
  const originalCancelIdleCallback = window.cancelIdleCallback;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T10:00:00.000Z"));

    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      writable: true,
      value: (callback: FrameRequestCallback) =>
        window.setTimeout(() => callback(performance.now()), 1000)
    });
    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      writable: true,
      value: (handle: number) => {
        window.clearTimeout(handle);
      }
    });
    Object.defineProperty(window, "requestIdleCallback", {
      configurable: true,
      writable: true,
      value: (callback: IdleRequestCallback) =>
        window.setTimeout(
          () =>
            callback({
              didTimeout: false,
              timeRemaining: () => 50
            }),
          0
        )
    });
    Object.defineProperty(window, "cancelIdleCallback", {
      configurable: true,
      writable: true,
      value: (handle: number) => {
        window.clearTimeout(handle);
      }
    });

    useTradingStore.getState().resetPortfolio();
    useTradingStore.setState((state) => ({
      holdings: {
        ...state.holdings,
        abidjan: {
          ...state.holdings.abidjan,
          KAICOIN: 1
        }
      }
    }));

    useAppStore.setState({
      selectedAssetId: "KAICOIN",
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

    const seededState = {
      ...createInitialOracleWatchState(),
      initialized: true
    };
    const criticalNotification = createOracleNotification({
      eventKey: "storm-abidjan",
      category: "storm",
      severity: "critical",
      title: "Storm over Abidjan",
      body: "Critical pressure over a held city.",
      speakText: "Abidjan is under severe storm pressure.",
      cityIds: ["abidjan"],
      assetIds: ["KAICOIN"],
      affectedValue: 168000,
      affectedPortfolioShare: 62,
      holdingsCount: 1,
      timestamp: "2026-03-14T10:00:20.000Z"
    });
    const alertNotification = createOracleNotification({
      eventKey: "driver-abidjan-KAICOIN",
      category: "driver",
      severity: "alert",
      title: "Driver swing in Abidjan",
      body: "A material signal shift hit the held position.",
      speakText: "Abidjan has flipped in your favour.",
      cityIds: ["abidjan"],
      assetIds: ["KAICOIN"],
      affectedValue: 168000,
      affectedPortfolioShare: 62,
      holdingsCount: 1,
      timestamp: "2026-03-14T10:00:20.000Z"
    });
    const laterAlertNotification = createOracleNotification({
      eventKey: "destination-abidjan",
      category: "access",
      severity: "alert",
      title: "Route to Abidjan has closed",
      body: "The route is blocked again.",
      speakText: "Abidjan is behind the storm wall again.",
      cityIds: ["abidjan"],
      assetIds: ["KAICOIN"],
      affectedValue: 168000,
      affectedPortfolioShare: 62,
      holdingsCount: 1,
      timestamp: "2026-03-14T10:00:40.000Z"
    });
    const minuteLaterNotification = createOracleNotification({
      eventKey: "storm-lagos",
      category: "storm",
      severity: "critical",
      title: "Storm over Lagos",
      body: "Critical pressure in another held city.",
      speakText: "Lagos is under severe storm pressure.",
      cityIds: ["lagos"],
      assetIds: ["KAICOIN"],
      affectedValue: 168000,
      affectedPortfolioShare: 62,
      holdingsCount: 1,
      timestamp: "2026-03-14T10:01:20.000Z"
    });

    evaluateOracleNotificationsMock.mockReset();
    evaluateOracleNotificationsMock
      .mockReturnValueOnce({
        notifications: [],
        speakable: null,
        nextState: seededState
      })
      .mockReturnValueOnce({
        notifications: [alertNotification, criticalNotification],
        speakable: criticalNotification,
        nextState: seededState
      })
      .mockReturnValueOnce({
        notifications: [laterAlertNotification],
        speakable: laterAlertNotification,
        nextState: seededState
      })
      .mockReturnValueOnce({
        notifications: [laterAlertNotification],
        speakable: laterAlertNotification,
        nextState: seededState
      })
      .mockReturnValue({
        notifications: [minuteLaterNotification],
        speakable: minuteLaterNotification,
        nextState: seededState
      });

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const payload = url.includes("/api/markets")
        ? marketsPayload
        : {
            text: "Storm over Abidjan",
            audioUrl: null,
            severity: "critical",
            cooldownUntil: new Date(Date.now() + 60_000).toISOString()
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
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it(
    "evaluates on a 20-second cadence and speaks at most once per minute",
    async () => {
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

      await act(async () => {
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(1000);
      });

      expect(evaluateOracleNotificationsMock).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });

      expect(evaluateOracleNotificationsMock).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("heading", { name: "Storm over Abidjan" })).toBeInTheDocument();

      const speakCallsAfterFirstPoll = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([input]) => String(input).includes("/api/oracle/speak")
      );
      expect(speakCallsAfterFirstPoll).toHaveLength(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });

      expect(evaluateOracleNotificationsMock).toHaveBeenCalledTimes(3);

      const speakCallsAfterSecondPoll = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([input]) => String(input).includes("/api/oracle/speak")
      );
      expect(speakCallsAfterSecondPoll).toHaveLength(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });

      expect(evaluateOracleNotificationsMock).toHaveBeenCalledTimes(4);

      const speakCallsAfterThirdPoll = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([input]) => String(input).includes("/api/oracle/speak")
      );
      expect(speakCallsAfterThirdPoll).toHaveLength(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });

      expect(evaluateOracleNotificationsMock).toHaveBeenCalledTimes(5);

      const speakCallsAfterMinute = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([input]) => String(input).includes("/api/oracle/speak")
      );
      expect(speakCallsAfterMinute).toHaveLength(2);
    },
    10_000
  );
});
