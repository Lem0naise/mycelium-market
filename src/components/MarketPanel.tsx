import { useState, useRef, useEffect } from "react";
import { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler } from "chart.js";
import type { ChartDataset } from "chart.js";
import { assetIndex, cityIndex } from "../../shared/data";
import { useTradingStore } from "../store/tradingStore";
import { myceliumStatus } from "./MyceliumWidget";
import { renderCurrencyText } from "./currency";
import type {
  EnvironmentalSignal,
  FlightState,
  MarketTicker,
  ScenarioSnapshot,
  SignalKey,
  TradeFailureReason,
  TradeResult
} from "../../shared/types";

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler);

function PriceSparkline({ data, cityName, avgBuyPrice }: { data: number[]; cityName: string; avgBuyPrice?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const isUpTrend = data[data.length - 1] >= data[0];
  const color = isUpTrend ? "#4caf50" : "#ff4d4d";

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();

    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    const grad = ctx.createLinearGradient(0, 0, 0, 40);
    grad.addColorStop(0, color + "44");
    grad.addColorStop(1, color + "00");

    const datasets: ChartDataset<"line">[] = [{
      data,
      borderColor: color,
      borderWidth: 2,
      pointRadius: 0,
      fill: true,
      backgroundColor: grad,
      tension: 0.3,
    }];

    if (avgBuyPrice && avgBuyPrice > 0) {
      datasets.push({
        data: data.map(() => avgBuyPrice),
        borderColor: "#f59e0b",
        borderWidth: 1.5,
        borderDash: [5, 4],
        pointRadius: 0,
        fill: false,
        tension: 0,
      });
    }

    chartRef.current = new Chart(ctx, {
      type: "line",
      data: {
        labels: data.map((_, i) => i),
        datasets,
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: true } },
        scales: {
          x: { display: true },
          y: { display: true },
        },
      },
    });

    return () => { chartRef.current?.destroy(); chartRef.current = null; };
  }, [data, color, avgBuyPrice]);

  return (
    <div style={{ marginBottom: "16px", padding: "12px 14px", background: "var(--panel-bg)", borderRadius: "8px", border: "1px solid var(--border)" }}>
      <span className="eyebrow" style={{ display: "block", marginBottom: "8px" }}>
        Past Prices ({cityName})
        {avgBuyPrice && avgBuyPrice > 0 ? (
          <span style={{ marginLeft: "10px", color: "#f59e0b", fontStyle: "normal", fontSize: "0.72rem" }}>
            — avg buy {formatGBP(avgBuyPrice)}
          </span>
        ) : null}
      </span>
      <div style={{ height: "150px", position: "relative" }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}

type MarketPanelProps = {
  tickers: MarketTicker[];
  snapshot?: ScenarioSnapshot;
  signals: EnvironmentalSignal[];
  selectedAssetId: string;
  focusedCityId: string;
  currentCityId: string;
  blockedCityIds: string[];
  flight: FlightState | null;
  onSelectAsset?: (assetId: string) => void;
};

const formatGBP = (value: number) =>
  `${new Intl.NumberFormat("en-GB", {
    maximumFractionDigits: value >= 1000 ? 0 : 2,
    minimumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value)}`;

const SIGNAL_META: Record<SignalKey, { label: string; unit: string; center: number }> = {
  humidity: { label: "Humidity", unit: "%", center: 55 },
  rain: { label: "Rainfall", unit: "mm", center: 4 },
  temperature: { label: "Temperature", unit: "°C", center: 20 },
  wind: { label: "Wind", unit: "kn", center: 10 },
  airQuality: { label: "Air Quality", unit: "AQI", center: 35 },
  soilMoisture: { label: "Soil Moisture", unit: "%", center: 45 },
  soilPh: { label: "Soil pH", unit: "", center: 6.2 }
};

const DRIVER_LABEL: Partial<Record<SignalKey, string>> = {
  temperature: "Temp",
  airQuality: "Air Quality",
  rain: "Rainfall",
  wind: "Wind"
};

const tradeFailureCopy: Record<TradeFailureReason, string> = {
  "not-in-city": "You can only trade in the city where you are physically located.",
  "in-flight": "Trading is locked while the aircraft is in motion.",
  "storm-blocked": "Storm interference is blocking this trade.",
  "insufficient-cash": "Not enough cash to complete that trade.",
  "no-holdings": "There are no units available to sell here.",
  "ecological-interference": "Ecological interference disrupted the trade.",
  "mycelium-network-collapse": "The mycelium network has fully collapsed — all three signals are outside healthy ranges.",
  "moisture-wilting-cap": "Wilting roots are restricting this trade — cap is 10% of balance per transaction.",
  "humidity-reroute": "Low humidity scrambled the signal routing."
};

export function MarketPanel({
  tickers,
  snapshot,
  signals,
  selectedAssetId,
  focusedCityId,
  currentCityId,
  blockedCityIds,
  flight,
  onSelectAsset,
}: MarketPanelProps) {
  const { cash, holdings, avgBuyPrice, prices, priceHistory, buyAsset, sellAsset, resetPortfolio, signalHistory } = useTradingStore();

  const asset = assetIndex[selectedAssetId];
  const primaryTicker = tickers.find((ticker) => ticker.assetId === selectedAssetId);
  const focusedCity = cityIndex[focusedCityId];
  const currentCity = cityIndex[currentCityId];
  const currentHoldings = holdings[focusedCityId]?.[selectedAssetId] || 0;
  const currentPrice = primaryTicker?.price ?? asset.basePrice;
  const focusedSignal = signals.find((signal) => signal.cityId === focusedCityId);
  const currentSignal = signals.find((signal) => signal.cityId === currentCityId);
  const currentMycelium = {
    soilMoisture: currentSignal?.soilMoisture ?? 45,
    soilPh: currentSignal?.soilPh ?? 6.5,
    humidity: currentSignal?.humidity ?? 50
  };
  const mycStatus = myceliumStatus(
    currentMycelium.soilMoisture,
    currentMycelium.soilPh,
    currentMycelium.humidity
  );
  const isLocalTradingWindow = focusedCityId === currentCityId && !flight;

  // ── Moisture-aware trade capacities ────────────────────────────────────────
  const isSaturated = currentMycelium.soilMoisture > 80;
  const isWilting = currentMycelium.soilMoisture < 20;
  // Saturated: trade quantities scale 10×; Wilting: normal quantities but capped by spend
  const buyQuantities: readonly number[] = isSaturated ? ([10, 100, 1000, 10000, 100000, 1000000, 10000000] as const) : ([1, 10, 100, 1000, 10000, 100000, 1000000, 10000000] as const);
  const sellQuantities: readonly number[] = [1, 10, 100, 1000, 10000, 100000, 1000000, 10000000] as const;

  const formatQuantity = (q: number) => {
    if (q >= 1000000) return `${q / 1000000}M`;
    if (q >= 1000) return `${q / 1000}k`;
    return q.toString();
  };
  // Max spend per trade when wilting: 10% of cash
  const maxSpendWilting = isWilting ? cash * 0.1 : Infinity;

  const primaryDriver = (Object.entries(asset.ecologicalWeights) as [SignalKey, number][])
    .find(([, weight]) => weight !== 0);
  const driverKey = primaryDriver?.[0];
  const driverMeta = driverKey ? SIGNAL_META[driverKey] : null;
  const driverValue = driverKey && focusedSignal ? focusedSignal[driverKey] : null;

  // Yesterday comparison: use the second-to-last recorded value for the driver signal
  const focusedSignalHistory = driverKey ? signalHistory[focusedCityId]?.[driverKey] : undefined;
  const previousDriverValue =
    focusedSignalHistory && focusedSignalHistory.length >= 2
      ? focusedSignalHistory[focusedSignalHistory.length - 2]
      : null;
  const isUp: boolean | null =
    previousDriverValue !== null && driverValue !== null
      ? driverValue > previousDriverValue
      : null;

  const [isTrading, setIsTrading] = useState(false);
  const [tradeError, setTradeError] = useState<string | null>(null);
  const [redirectInfo, setRedirectInfo] = useState<{ assetId: string; executedPrice: number } | null>(null);

  const handleResult = (result: TradeResult) => {
    if (!result.ok) {
      setTradeError(result.message ?? tradeFailureCopy[result.reason]);
      const redirect = "redirectBuy" in result ? result.redirectBuy : undefined;
      setRedirectInfo(redirect ? { assetId: redirect.assetId, executedPrice: redirect.executedPrice } : null);
    } else {
      setRedirectInfo(null);
    }
  };

  const handleBuy = async (quantity: number) => {
    setIsTrading(true);
    setTradeError(null);
    setRedirectInfo(null);
    const result = await buyAsset(currentCityId, selectedAssetId, currentMycelium, quantity);
    handleResult(result);
    setIsTrading(false);
  };

  const handleSell = async (quantity: number) => {
    setIsTrading(true);
    setTradeError(null);
    setRedirectInfo(null);
    const result = await sellAsset(currentCityId, selectedAssetId, currentMycelium, quantity);
    handleResult(result);
    setIsTrading(false);
  };

  return (
    <aside className="panel market-panel">
      <div className="panel-topline">
        <span className="eyebrow">Portfolio</span>
        <button className="status-pill minimal-btn" onClick={resetPortfolio} title="Reset Progress">
          Reset
        </button>
      </div>

      <div className="ticker-grid">
        {tickers.map((ticker) => {
          const profile = assetIndex[ticker.assetId];
          const tokenDriver = profile
            ? (Object.entries(profile.ecologicalWeights) as [SignalKey, number][])
              .find(([, weight]) => weight !== 0)
            : null;
          const driverShortLabel = tokenDriver
            ? DRIVER_LABEL[tokenDriver[0]] ?? SIGNAL_META[tokenDriver[0]].label
            : null;

          return (
            <button
              key={ticker.assetId}
              className={`ticker-card ${ticker.assetId === selectedAssetId ? "active" : ""}`}
              type="button"
              onClick={() => onSelectAsset?.(ticker.assetId)}
            >
              <span
                className="textLeft"
                style={{ display: "flex", flexDirection: "column", gap: "1px" }}
              >
                <span>{profile ? profile.id : ticker.assetId}</span>
                {driverShortLabel ? (
                  <span
                    style={{
                      fontSize: "0.7rem",
                      color: "var(--text-muted)",
                      fontWeight: "normal"
                    }}
                  >
                    {driverShortLabel}
                  </span>
                ) : null}
              </span>
              <strong>{renderCurrencyText(formatGBP(ticker.price))}</strong>
              <small className={ticker.changePct >= 0 ? "up textRight" : "down textRight"}>
                {ticker.changePct >= 0 ? "+" : ""}
                {ticker.changePct}%
              </small>
            </button>
          );
        })}
      </div>

      <section className="asset-focus">

        <h2>{asset.label}</h2>
        <p className="muted" style={{ marginTop: "-6px", marginBottom: "14px" }}>
          Pricing shown for {focusedCity?.name ?? focusedCityId}. Trading and mycelium access are
          tied to {currentCity?.name ?? currentCityId}.
        </p>

        {/* Past Prices Graph */}
        {(() => {
          const historyData = priceHistory[currentCityId]?.[selectedAssetId] || [];
          if (historyData.length < 2) return null;
          const cityAvgBuy = avgBuyPrice[currentCityId]?.[selectedAssetId] || 0;
          return (
            <PriceSparkline
              data={historyData}
              cityName={currentCity?.name ?? currentCityId}
              avgBuyPrice={cityAvgBuy > 0 ? cityAvgBuy : undefined}
            />
          );
        })()}

        {driverKey && driverMeta && driverValue !== null ? (
          <div
            style={{
              marginBottom: "16px",
              padding: "12px 14px",
              borderRadius: "8px",
              background:
                isUp === null
                  ? "rgba(100,100,100,0.08)"
                  : isUp
                    ? "rgba(76,175,80,0.08)"
                    : "rgba(255,77,77,0.08)",
              border: `1px solid ${isUp === null
                ? "rgba(100,100,100,0.3)"
                : isUp
                  ? "rgba(76,175,80,0.3)"
                  : "rgba(255,77,77,0.3)"
                }`,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between"
            }}
          >
            <div>
              <div
                style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "2px" }}
              >
                {driverMeta.label}
              </div>
              <div
                style={{
                  fontSize: "1.6rem",
                  fontWeight: "bold",
                  lineHeight: 1,
                  color:
                    isUp === null ? "var(--text)" : isUp ? "#4caf50" : "#ff4d4d"
                }}
              >
                {driverValue.toFixed(1)}
                {driverMeta.unit}
              </div>
            </div>
            {isUp !== null && (
              <div
                style={{
                  fontSize: "1.8rem",
                  fontWeight: "bold",
                  color: isUp ? "#4caf50" : "#ff4d4d"
                }}
              >
                {isUp ? "▲" : "▼"}
              </div>
            )}
          </div>
        ) : null}

        <div
          className="trading-controls"
          style={{ display: "flex", flexDirection: "column", gap: "8px", margin: "16px 0" }}
        >
          <div>
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", display: "block" }}>
              Owned In {focusedCity?.name ?? focusedCityId}
            </span>
            <strong style={{ fontSize: "1.2rem" }}>{currentHoldings}</strong>
          </div>

          {/* Moisture capacity indicator */}
          {isSaturated || isWilting ? (
            <div style={{
              fontSize: "0.72rem",
              padding: "4px 9px",
              borderRadius: "4px",
              background: isSaturated ? "rgba(74,222,128,0.08)" : "rgba(245,158,11,0.08)",
              border: `1px solid ${isSaturated ? "rgba(74,222,128,0.3)" : "rgba(245,158,11,0.3)"}`,
              color: isSaturated ? "#4ade80" : "#f59e0b",
              fontWeight: "bold",
            }}>
              {isSaturated
                ? "DEEP LIQUIDITY — buying at 10× capacity"
                : renderCurrencyText(`WILTING — max trade: ${formatGBP(maxSpendWilting)} (10% balance)`)}
            </div>
          ) : null}

          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {buyQuantities.map((quantity) => {
              const cost = currentPrice * quantity;
              // For saturated: need only 1/10 of cost; for wilting: cost must be ≤ maxSpendWilting
              const cashRequired = isSaturated ? cost / 10 : cost;
              const exceedsWilting = isWilting && cost > maxSpendWilting;
              return (
                <button
                  key={quantity}
                  className="action-btn buy-btn"
                  onClick={() => handleBuy(quantity)}
                  disabled={
                    cash < cashRequired ||
                    exceedsWilting ||
                    isTrading ||
                    !mycStatus.allOk ||
                    !isLocalTradingWindow
                  }
                >
                  {isTrading ? "..." : `BUY ${formatQuantity(quantity)}`}
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {sellQuantities.map((quantity) => (
              <button
                key={quantity}
                className="action-btn sell-btn"
                onClick={() => handleSell(quantity)}
                disabled={
                  currentHoldings < quantity ||
                  isTrading ||
                  !mycStatus.allOk ||
                  !isLocalTradingWindow
                }
              >
                {isTrading ? "..." : `SELL ${formatQuantity(quantity)}`}
              </button>
            ))}
          </div>
        </div>

        {!mycStatus.allOk ? (
          <p className="muted" style={{ marginBottom: "10px" }}>
            The mycelium network at {currentCity?.name ?? currentCityId} is outside its safe range,
            so trading is blocked until local soil moisture, soil pH, and humidity recover.
          </p>
        ) : null}
        {tradeError ? (
          <p style={{ color: "#ff8a8a", fontSize: "0.85rem", marginBottom: "8px" }}>
            {renderCurrencyText(tradeError)}
          </p>
        ) : null}
        {redirectInfo ? (
          <p style={{ color: "#f59e0b", fontSize: "0.8rem", marginBottom: "16px" }}>
            {renderCurrencyText(`Redirected buy: 1× ${redirectInfo.assetId} @ ${formatGBP(redirectInfo.executedPrice)}`)}
          </p>
        ) : null}

      </section>
    </aside>
  );
}
