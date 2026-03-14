import { useState } from "react";
import { assetIndex, cityIndex } from "../../shared/data";
import { useTradingStore } from "../store/tradingStore";
import { myceliumStatus } from "./MyceliumWidget";
import type {
  EnvironmentalSignal,
  FlightState,
  MarketTicker,
  ScenarioSnapshot,
  SignalKey,
  TradeFailureReason
} from "../../shared/types";

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
  `£${new Intl.NumberFormat("en-GB", {
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
  "mycelium-too-dry": "The mycelium network is too dry to route this trade.",
  "mycelium-waterlogged": "The mycelium network is waterlogged and trade routing has collapsed.",
  "mycelium-too-acidic": "The mycelium network is too acidic to carry the trade.",
  "mycelium-too-alkaline": "The mycelium network is too alkaline to carry the trade.",
  "mycelium-too-arid": "The air is too dry for the mycelium network to open.",
  "mycelium-oversaturated": "Humidity is oversaturating the mycelium network."
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
  const { cash, holdings, prices, buyAsset, sellAsset, resetPortfolio, signalHistory } = useTradingStore();

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
  const isFocusedCityBlocked = blockedCityIds.includes(focusedCityId);
  const isLocalTradingWindow = focusedCityId === currentCityId && !flight;

  const primaryDriver = (Object.entries(asset.ecologicalWeights) as [SignalKey, number][])
    .find(([, weight]) => weight !== 0);
  const driverKey = primaryDriver?.[0];
  const driverWeight = primaryDriver?.[1] ?? 0;
  const driverMeta = driverKey ? SIGNAL_META[driverKey] : null;
  const driverValue = driverKey && focusedSignal ? focusedSignal[driverKey] : null;
  const driverRef = driverMeta?.center ?? 0;
  const driverAboveRef = driverValue !== null && driverValue > driverRef;
  const isBullish =
    driverValue !== null &&
    ((driverWeight > 0 && driverAboveRef) || (driverWeight < 0 && !driverAboveRef));

  const [isTrading, setIsTrading] = useState(false);
  const [tradeError, setTradeError] = useState<string | null>(null);

  const handleBuy = async (quantity: number) => {
    setIsTrading(true);
    setTradeError(null);
    const result = await buyAsset(currentCityId, selectedAssetId, currentMycelium, quantity);
    if (!result.ok) {
      setTradeError(result.message ?? tradeFailureCopy[result.reason]);
    }
    setIsTrading(false);
  };

  const handleSell = async (quantity: number) => {
    setIsTrading(true);
    setTradeError(null);
    const result = await sellAsset(currentCityId, selectedAssetId, currentMycelium, quantity);
    if (!result.ok) {
      setTradeError(result.message ?? tradeFailureCopy[result.reason]);
    }
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
      <div className="hero-metric" style={{ marginBottom: "16px" }}>
        <div>
          <span>Available Cash</span>
          <strong>{formatGBP(cash)}</strong>
        </div>
        <div>
          <span>Total Value</span>
          <strong>
            {formatGBP(
              cash +
              Object.entries(holdings).reduce((sum, [cityId, cityHoldings]) => {
                return (
                  sum +
                  Object.entries(cityHoldings).reduce((citySum, [assetId, quantity]) => {
                    const livePrice = prices[cityId]?.[assetId] ?? assetIndex[assetId].basePrice;
                    return citySum + livePrice * quantity;
                  }, 0)
                );
              }, 0)
            )}
          </strong>
        </div>
      </div>

      <div className="panel-topline">
        <span className="eyebrow">Market Board</span>
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
              <strong>{formatGBP(ticker.price)}</strong>
              <small className={ticker.changePct >= 0 ? "up" : "down"}>
                {ticker.changePct >= 0 ? "+" : ""}
                {ticker.changePct}%
              </small>
            </button>
          );
        })}
      </div>

      <section className="asset-focus">
        <div className="panel-topline">
          <span className="eyebrow">Selected Asset</span>
          <span className="status-pill accent">{asset.marketType}</span>
        </div>
        <h2>{asset.label}</h2>
        <p className="muted" style={{ marginTop: "-6px", marginBottom: "14px" }}>
          Pricing shown for {focusedCity?.name ?? focusedCityId}. Trading and mycelium access are
          tied to {currentCity?.name ?? currentCityId}.
        </p>

        {driverKey && driverMeta && driverValue !== null ? (
          <div
            style={{
              marginBottom: "16px",
              padding: "12px 14px",
              borderRadius: "8px",
              background: isBullish ? "rgba(76,175,80,0.08)" : "rgba(255,77,77,0.08)",
              border: `1px solid ${isBullish ? "rgba(76,175,80,0.3)" : "rgba(255,77,77,0.3)"
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
                  color: isBullish ? "#4caf50" : "#ff4d4d"
                }}
              >
                {driverValue.toFixed(1)}
                {driverMeta.unit}
              </div>
            </div>
            <div
              style={{
                fontSize: "0.8rem",
                fontWeight: "bold",
                color: isBullish ? "#4caf50" : "#ff4d4d",
                textAlign: "right"
              }}
            >
              <div style={{ fontSize: "1.2rem" }}>
                {isBullish ? "▲" : "▼"} {isBullish ? "ABOVE" : "BELOW"}{" "}
                {driverRef.toFixed(1)}
                {driverMeta.unit}
              </div>
            </div>
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
          <div style={{ display: "flex", gap: "6px" }}>
            {([1, 10, 100] as const).map((quantity) => (
              <button
                key={quantity}
                className="action-btn buy-btn"
                onClick={() => handleBuy(quantity)}
                disabled={
                  cash < currentPrice * quantity ||
                  isTrading ||
                  !mycStatus.allOk ||
                  !isLocalTradingWindow
                }
              >
                {isTrading ? "..." : `BUY ${quantity}`}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: "6px" }}>
            {([1, 10, 100] as const).map((quantity) => (
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
                {isTrading ? "..." : `SELL ${quantity}`}
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
          <p style={{ color: "#ff8a8a", fontSize: "0.85rem", marginBottom: "16px" }}>
            {tradeError}
          </p>
        ) : null}

        {focusedSignal ? (
          <div className="ecological-factors">
            <span
              className="eyebrow"
              style={{ display: "block", marginBottom: "8px", marginTop: "16px" }}
            >
              Weather Conditions
            </span>
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "8px" }}>
              These drive token prices. The starred weather signal is the primary driver for this
              asset in {focusedCity?.name ?? focusedCityId}.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "8px",
                marginBottom: "16px",
                background: "var(--panel-bg)",
                padding: "12px",
                borderRadius: "8px",
                border: "1px solid var(--border)"
              }}
            >
              {(["temperature", "airQuality", "rain", "wind"] as SignalKey[]).map((key) => {
                const meta = SIGNAL_META[key];
                const value = focusedSignal[key];
                const isDriver = driverKey === key;

                return (
                  <div
                    key={key}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: "0.875rem",
                      opacity: isDriver ? 1 : 0.45
                    }}
                  >
                    <span>
                      {meta.label}
                      {isDriver ? " ★" : ""}
                    </span>
                    <strong>
                      {value.toFixed(1)}
                      {meta.unit}
                    </strong>
                  </div>
                );
              })}
            </div>

            <span
              className="eyebrow"
              style={{ display: "block", marginBottom: "8px", marginTop: "16px" }}
            >
              Current Mycelium Gate
            </span>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "8px",
                marginBottom: "16px",
                background: "var(--panel-bg)",
                padding: "12px",
                borderRadius: "8px",
                border: "1px solid var(--border)"
              }}
            >
              {(
                [
                  ["soilMoisture", currentMycelium.soilMoisture],
                  ["soilPh", currentMycelium.soilPh],
                  ["humidity", currentMycelium.humidity]
                ] as Array<[SignalKey, number]>
              ).map(([key, value]) => (
                <div
                  key={key}
                  style={{ display: "flex", justifyContent: "space-between", fontSize: "0.875rem" }}
                >
                  <span>{SIGNAL_META[key].label}</span>
                  <strong>
                    {value.toFixed(1)}
                    {SIGNAL_META[key].unit}
                  </strong>
                </div>
              ))}
              <div
                style={{ display: "flex", justifyContent: "space-between", fontSize: "0.875rem" }}
              >
                <span>Trade access</span>
                <strong className={mycStatus.allOk ? "up" : "down"}>
                  {mycStatus.allOk ? "OPEN" : "BLOCKED"}
                </strong>
              </div>
            </div>
          </div>
        ) : (
          <p className="muted">Waiting for live ecological data.</p>
        )}
      </section>
    </aside>
  );
}
