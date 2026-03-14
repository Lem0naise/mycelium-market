import { useState } from "react";
import { assetIndex, cityIndex } from "../../shared/data";
import { useTradingStore } from "../store/tradingStore";
import type {
  FlightState,
  MarketTicker,
  RankedCity,
  ScenarioSnapshot,
  TradeFailureReason
} from "../../shared/types";

type MarketPanelProps = {
  tickers: MarketTicker[];
  snapshot?: ScenarioSnapshot;
  selectedAssetId: string;
  focusedCityId: string;
  currentCityId: string;
  blockedCityIds: string[];
  flight: FlightState | null;
  travelDisabledReason: string | null;
  onSelectAsset?: (assetId: string) => void;
  onStartFlight?: () => void;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 1000 ? 0 : 2
  }).format(value);

const tradeFailureCopy: Record<TradeFailureReason, string> = {
  "not-in-city": "You can only trade in the city where you are physically located.",
  "in-flight": "Trading is locked while the aircraft is in motion.",
  "storm-blocked": "Storm interference is blocking this trade.",
  "insufficient-cash": "Not enough cash to complete that trade.",
  "no-holdings": "There are no units available to sell here.",
  "ecological-interference": "Ecological interference disrupted the trade."
};

function CityLeaderboard({
  rankings,
  blockedCityIds
}: {
  rankings: RankedCity[];
  blockedCityIds: string[];
}) {
  return (
    <div className="leaderboard">
      <div className="panel-topline">
        <span className="eyebrow">Travel</span>
        <span className="status-pill">LIVE</span>
      </div>
      {rankings.slice(0, 5).map((item, index) => (
        <div key={item.cityId} className="leader-row">
          <span>{String(index + 1).padStart(2, "0")}</span>
          <strong>{cityIndex[item.cityId]?.name ?? item.cityId}</strong>
          <span>{blockedCityIds.includes(item.cityId) ? "NO-FLY" : item.travelScore}</span>
        </div>
      ))}
    </div>
  );
}

export function MarketPanel({
  tickers,
  snapshot,
  selectedAssetId,
  focusedCityId,
  currentCityId,
  blockedCityIds,
  flight,
  travelDisabledReason,
  onSelectAsset,
  onStartFlight
}: MarketPanelProps) {
  const { cash, holdings, prices, buyAsset, sellAsset, resetPortfolio } = useTradingStore();

  const asset = assetIndex[selectedAssetId];
  const primaryTicker = tickers.find((ticker) => ticker.assetId === selectedAssetId);
  const focusedCity = cityIndex[focusedCityId];
  const currentCity = cityIndex[currentCityId];
  const currentHoldings = holdings[focusedCityId]?.[selectedAssetId] || 0;
  const currentPrice = primaryTicker?.price ?? asset.basePrice;
  const focusedSignal = snapshot?.signals.find((signal) => signal.cityId === focusedCityId);
  const currentHumidity = focusedSignal?.humidity ?? 50;
  const isFocusedCityBlocked = blockedCityIds.includes(focusedCityId);
  const isCurrentCityBlocked = blockedCityIds.includes(currentCityId);
  const isLocalTradingWindow = focusedCityId === currentCityId && !flight;
  const blockedRouteCityId = flight?.isReturningHome ? flight.fromCityId : flight?.toCityId;
  const homeCityId = flight?.isReturningHome ? flight.toCityId : flight?.fromCityId;

  const [isTrading, setIsTrading] = useState(false);
  const [tradeError, setTradeError] = useState<string | null>(null);

  const handleBuy = async () => {
    setIsTrading(true);
    setTradeError(null);
    const result = await buyAsset(focusedCityId, selectedAssetId, currentHumidity, 1);
    if (!result.ok) {
      setTradeError(tradeFailureCopy[result.reason]);
    }
    setIsTrading(false);
  };

  const handleSell = async () => {
    setIsTrading(true);
    setTradeError(null);
    const result = await sellAsset(focusedCityId, selectedAssetId, currentHumidity, 1);
    if (!result.ok) {
      setTradeError(tradeFailureCopy[result.reason]);
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
          <strong>{formatCurrency(cash)}</strong>
        </div>
        <div>
          <span>Total Value</span>
          <strong>
            {formatCurrency(
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

      <section className="travel-panel">
        <div className="panel-topline">
          <span className="eyebrow">Flight Deck</span>
          <span className="status-pill accent">
            {flight ? (flight.isReturningHome ? "returning" : flight.phase) : "grounded"}
          </span>
        </div>
        <div className="travel-card">
          <div>
            <span>Current city</span>
            <strong>{currentCity?.name ?? currentCityId}</strong>
          </div>
          <div>
            <span>Focused city</span>
            <strong>{focusedCity?.name ?? focusedCityId}</strong>
          </div>
          <div>
            <span>Airspace</span>
            <strong>
              {isCurrentCityBlocked
                ? "Departure stormed"
                : isFocusedCityBlocked
                  ? "Destination stormed"
                  : "Open"}
            </strong>
          </div>
        </div>
        <button
          className="action-btn flight-btn"
          onClick={onStartFlight}
          disabled={Boolean(travelDisabledReason) || focusedCityId === currentCityId}
        >
          {flight
            ? flight.isReturningHome
              ? `Returning ${(flight.remainingMs / 1000).toFixed(1)}s`
              : flight.phase === "holding"
                ? "Turning Back"
                : `Flying ${(flight.remainingMs / 1000).toFixed(1)}s`
            : focusedCityId === currentCityId
              ? "Already Here"
              : `Fly To ${focusedCity?.name ?? focusedCityId}`}
        </button>
        <p className="muted" style={{ marginTop: "8px" }}>
          {travelDisabledReason ??
            (focusedCityId === currentCityId
              ? "Inspect another city on the globe to plan a flight."
              : `Travel time: ${((snapshot?.rankings.find((city) => city.cityId === focusedCityId)?.travelScore ?? 50) / 10).toFixed(1)} tactical units.`)}
        </p>
        {flight?.isReturningHome || flight?.phase === "holding" ? (
          <div className="hold-panel">
            <span>
              The visible amber no-fly surface cut off the route to{" "}
              {cityIndex[blockedRouteCityId ?? ""]?.name ?? blockedRouteCityId}. The aircraft is
              automatically returning to {cityIndex[homeCityId ?? ""]?.name ?? homeCityId}.
            </span>
          </div>
        ) : null}
        <div className="no-fly-list-panel">
          <span className="eyebrow">Airspace Legend</span>
          <p className="muted" style={{ margin: 0 }}>
            Amber storm footprints painted onto the globe are the exact surfaces you cannot fly
            through. City ripples are removed so only the footprint matters.
          </p>
        </div>
      </section>

      <div className="panel-topline">
        <span className="eyebrow">Market Board</span>
      </div>
      <div className="ticker-grid">
        {tickers.map((ticker) => {
          const profile = assetIndex[ticker.assetId];
          return (
            <button
              key={ticker.assetId}
              className={`ticker-card ${ticker.assetId === selectedAssetId ? "active" : ""}`}
              type="button"
              onClick={() => onSelectAsset?.(ticker.assetId)}
            >
              <span className="textLeft">{profile ? profile.id : ticker.assetId}</span>
              <strong>{formatCurrency(ticker.price)}</strong>
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
          Pricing shown for {focusedCity?.name ?? focusedCityId}. Trading access belongs to{" "}
          {currentCity?.name ?? currentCityId}.
        </p>
        <div
          className="trading-controls"
          style={{ display: "flex", gap: "8px", margin: "16px 0", alignItems: "center" }}
        >
          <div style={{ flex: 1 }}>
            <span
              style={{ fontSize: "0.8rem", color: "var(--text-muted)", display: "block" }}
            >
              Owned Here
            </span>
            <strong style={{ fontSize: "1.2rem" }}>{currentHoldings}</strong>
          </div>
          <button
            className="action-btn buy-btn"
            onClick={handleBuy}
            disabled={cash < currentPrice || isTrading || !isLocalTradingWindow}
          >
            {isTrading ? "..." : "BUY 1"}
          </button>
          <button
            className="action-btn sell-btn"
            onClick={handleSell}
            disabled={currentHoldings <= 0 || isTrading || !isLocalTradingWindow}
          >
            {isTrading ? "..." : "SELL 1"}
          </button>
        </div>
        {!isLocalTradingWindow ? (
          <p className="muted" style={{ marginBottom: "10px" }}>
            Trading is unlocked only when your current city matches the focused market and you are
            not airborne.
          </p>
        ) : null}
        {tradeError ? (
          <p style={{ color: "#ff8a8a", fontSize: "0.85rem", marginBottom: "16px" }}>
            {tradeError}
          </p>
        ) : null}
        <div className="ecological-factors">
          <span
            className="eyebrow"
            style={{ display: "block", marginBottom: "8px", marginTop: "16px" }}
          >
            Current City Conditions
          </span>
          {focusedSignal ? (
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
              {Object.entries({
                humidity: focusedSignal.humidity,
                rain: focusedSignal.rain,
                temperature: focusedSignal.temperature,
                wind: focusedSignal.wind,
                airQuality: focusedSignal.airQuality,
                soilMoisture: focusedSignal.soilMoisture
              }).map(([key, value]) => (
                <div
                  key={key}
                  style={{ display: "flex", justifyContent: "space-between", fontSize: "0.875rem" }}
                >
                  <span style={{ textTransform: "capitalize" }}>{key}</span>
                  <strong>{value.toFixed(1)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Waiting for live ecological data.</p>
          )}

          <span
            className="eyebrow"
            style={{ display: "block", marginBottom: "8px", marginTop: "16px" }}
          >
            Ecological Sensitivities
          </span>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "8px" }}>
            Positive values mean the asset price increases when the environmental factor increases.
            Negative values suppress the price.
          </p>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "16px" }}
          >
            {Object.entries(asset.ecologicalWeights).map(([key, weight]) => (
              <div
                key={key}
                style={{ display: "flex", justifyContent: "space-between", fontSize: "0.875rem" }}
              >
                <span style={{ textTransform: "capitalize" }}>{key}</span>
                <strong className={weight >= 0 ? "up" : "down"}>
                  {weight > 0 ? "+" : ""}
                  {weight}
                </strong>
              </div>
            ))}
          </div>
        </div>
        {snapshot ? (
          <>
            <div className="hero-metric">
              <div>
                <span>Earth Delta</span>
                <strong className={snapshot.primary.earthDelta >= 0 ? "up" : "down"}>
                  {snapshot.primary.earthDelta >= 0 ? "+" : ""}
                  {snapshot.primary.earthDelta}
                </strong>
              </div>
              <div>
                <span>Storm Risk</span>
                <strong>{isFocusedCityBlocked ? "BLOCKED" : "CLEAR"}</strong>
              </div>
            </div>
            <CityLeaderboard rankings={snapshot.rankings} blockedCityIds={blockedCityIds} />
          </>
        ) : (
          <p className="muted">Computing planetary spread...</p>
        )}
      </section>
    </aside>
  );
}
