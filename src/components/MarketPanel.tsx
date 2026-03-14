import { useState } from "react";
import { assetIndex } from "../../shared/data";
import { useTradingStore } from "../store/tradingStore";
import { myceliumStatus } from "./MyceliumWidget";
import type {
  EnvironmentalSignal,
  MarketTicker,
  SignalKey
} from "../../shared/types";

type MarketPanelProps = {
  tickers: MarketTicker[];
  signals: EnvironmentalSignal[];
  selectedAssetId: string;
  selectedCityId: string;
  onSelectAsset?: (assetId: string) => void;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 1000 ? 0 : 2
  }).format(value);

// Human-readable label and unit for each signal key
const SIGNAL_META: Record<SignalKey, { label: string; unit: string; center: number }> = {
  humidity: { label: "Humidity", unit: "%", center: 55 },
  rain: { label: "Rainfall", unit: "mm", center: 4 },
  temperature: { label: "Temperature", unit: "°C", center: 20 },
  wind: { label: "Wind", unit: "kn", center: 10 },
  airQuality: { label: "Air Quality", unit: "AQI", center: 35 },
  soilMoisture: { label: "Soil Moisture", unit: "%", center: 45 },
  soilPh: { label: "Soil pH", unit: "", center: 6.2 },
};

// Short driver label shown on ticker cards
const DRIVER_LABEL: Partial<Record<SignalKey, string>> = {
  temperature: "Temp",
  airQuality: "Air Quality",
  rain: "Rainfall",
  wind: "Wind",
};


export function MarketPanel({
  tickers,
  signals,
  selectedAssetId,
  selectedCityId,
  onSelectAsset
}: MarketPanelProps) {
  const { cash, holdings, prices, buyAsset, sellAsset, resetPortfolio, signalHistory } = useTradingStore();

  const asset = assetIndex[selectedAssetId];
  const primaryTicker = tickers.find((ticker) => ticker.assetId === selectedAssetId);

  const currentHoldings = holdings[selectedCityId]?.[selectedAssetId] || 0;
  const currentPrice = primaryTicker?.price ?? asset.basePrice;

  // Pull the live signals for the selected city
  const citySignal = signals.find(s => s.cityId === selectedCityId);
  const mycelium = {
    soilMoisture: citySignal?.soilMoisture ?? 45,
    soilPh: citySignal?.soilPh ?? 6.5,
    humidity: citySignal?.humidity ?? 50,
  };
  const mycStatus = myceliumStatus(mycelium.soilMoisture, mycelium.soilPh, mycelium.humidity);

  const [isTrading, setIsTrading] = useState(false);
  const [tradeError, setTradeError] = useState<string | null>(null);

  const handleBuy = async (qty: number) => {
    setIsTrading(true);
    setTradeError(null);
    const result = await buyAsset(selectedCityId, selectedAssetId, mycelium, qty);
    if (!result.ok) {
      setTradeError(result.reason);
    }
    setIsTrading(false);
  };

  const handleSell = async (qty: number) => {
    setIsTrading(true);
    setTradeError(null);
    const result = await sellAsset(selectedCityId, selectedAssetId, mycelium, qty);
    if (!result.ok) {
      setTradeError(result.reason);
    }
    setIsTrading(false);
  };

  // The single primary weather driver for this asset (non-zero weight)
  const primaryDriver = asset
    ? (Object.entries(asset.ecologicalWeights) as [SignalKey, number][])
      .find(([, w]) => w !== 0)
    : null;

  // Big-number driver display: value + bullish/bearish indicator vs 5-reading rolling average
  const driverKey = primaryDriver?.[0];
  const driverWeight = primaryDriver?.[1] ?? 0;
  const driverMeta = driverKey ? SIGNAL_META[driverKey] : null;
  const driverValue = driverKey && citySignal ? citySignal[driverKey] : null;

  // 5-reading rolling average; fall back to hardcoded center until history accumulates
  const driverHistoryArr = driverKey ? (signalHistory[selectedCityId]?.[driverKey] ?? []) : [];
  const driverRef = driverHistoryArr.length > 0
    ? driverHistoryArr.reduce((sum, v) => sum + v, 0) / driverHistoryArr.length
    : (driverMeta?.center ?? 0);

  // bullish when high signal + positive weight, or low signal + negative weight
  const driverAboveRef = driverValue !== null && driverValue > driverRef;
  const isBullish = driverValue !== null && (
    (driverWeight > 0 && driverAboveRef) ||
    (driverWeight < 0 && !driverAboveRef)
  );

  return (
    <aside className="panel market-panel">
      <div className="panel-topline">
        <span className="eyebrow">Portfolio</span>
        <button className="status-pill minimal-btn" onClick={resetPortfolio} title="Reset Progress">Reset</button>
      </div>
      <div className="hero-metric" style={{ marginBottom: '16px' }}>
        <div>
          <span>Available Cash</span>
          <strong>{formatCurrency(cash)}</strong>
        </div>
        <div>
          <span>Total Value</span>
          <strong>{formatCurrency(cash + Object.entries(holdings).reduce((sum, [cityId, cityHoldings]) => {
            return sum + Object.entries(cityHoldings).reduce((citySum, [id, qty]) => {
              const p = prices[cityId]?.[id] ?? assetIndex[id].basePrice;
              return citySum + p * qty;
            }, 0);
          }, 0))}</strong>
        </div>
      </div>

      <div className="panel-topline">
        <span className="eyebrow">Market Board</span>
      </div>
      <div className="ticker-grid">
        {tickers.map((ticker) => {
          const profile = assetIndex[ticker.assetId];
          // Find the primary driver for this token's ticker card
          const tokenDriver = profile
            ? (Object.entries(profile.ecologicalWeights) as [SignalKey, number][])
              .find(([, w]) => w !== 0)
            : null;
          const driverShortLabel = tokenDriver ? (DRIVER_LABEL[tokenDriver[0]] ?? SIGNAL_META[tokenDriver[0]].label) : null;
          return (
            <button
              key={ticker.assetId}
              className={`ticker-card ${ticker.assetId === selectedAssetId ? "active" : ""}`}
              type="button"
              onClick={() => onSelectAsset?.(ticker.assetId)}
            >
              <span className='textLeft' style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                <span>{profile ? profile.id : ticker.assetId}</span>
                {driverShortLabel && (
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>
                    {driverShortLabel}
                  </span>
                )}
              </span>
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
          <span className="status-pill accent">{asset?.marketType || "unknown"}</span>
        </div>
        <h2>{asset?.label || selectedAssetId}</h2>

        {/* Primary driver big display */}
        {driverKey && driverMeta && driverValue !== null && (
          <div style={{
            marginBottom: '16px',
            padding: '12px 14px',
            borderRadius: '8px',
            background: isBullish ? 'rgba(76,175,80,0.08)' : 'rgba(255,77,77,0.08)',
            border: `1px solid ${isBullish ? 'rgba(76,175,80,0.3)' : 'rgba(255,77,77,0.3)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between'
          }}>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '2px' }}>
                {driverMeta.label}
              </div>
              <div style={{ fontSize: '1.6rem', fontWeight: 'bold', lineHeight: 1, color: isBullish ? '#4caf50' : '#ff4d4d' }}>
                {driverValue.toFixed(1)}{driverMeta.unit}
              </div>
            </div>
            <div style={{
              fontSize: '0.8rem', fontWeight: 'bold',
              color: isBullish ? '#4caf50' : '#ff4d4d',
              textAlign: 'right'
            }}>
              <div style={{ fontSize: '1.2rem' }}>{isBullish ? '▲' : '▼'} {isBullish ? 'ABOVE' : 'BELOW'} {driverRef.toFixed(1)}{driverMeta.unit}</div>

            </div>
          </div>
        )}

        <div className="trading-controls" style={{ display: 'flex', flexDirection: 'column', gap: '8px', margin: '16px 0' }}>
          <div>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block' }}>Owned</span>
            <strong style={{ fontSize: '1.2rem' }}>{currentHoldings}</strong>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            {([1, 10, 100] as const).map((qty) => (
              <button
                key={qty}
                className="action-btn buy-btn"
                onClick={() => handleBuy(qty)}
                disabled={cash < currentPrice * qty || isTrading || !mycStatus.allOk}
                style={{
                  flex: 1, padding: '8px 4px', background: 'var(--accent)', color: 'white',
                  border: 'none', borderRadius: '4px', fontWeight: 'bold',
                  cursor: (cash >= currentPrice * qty && !isTrading && mycStatus.allOk) ? 'pointer' : 'not-allowed',
                  opacity: (cash >= currentPrice * qty && !isTrading && mycStatus.allOk) ? 1 : 0.5
                }}
              >
                {isTrading ? "..." : `BUY ${qty}`}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            {([1, 10, 100] as const).map((qty) => (
              <button
                key={qty}
                className="action-btn sell-btn"
                onClick={() => handleSell(qty)}
                disabled={currentHoldings < qty || isTrading || !mycStatus.allOk}
                style={{
                  flex: 1, padding: '8px 4px', background: 'transparent', color: 'var(--accent)',
                  border: '1px solid var(--accent)', borderRadius: '4px', fontWeight: 'bold',
                  cursor: (currentHoldings >= qty && !isTrading && mycStatus.allOk) ? 'pointer' : 'not-allowed',
                  opacity: (currentHoldings >= qty && !isTrading && mycStatus.allOk) ? 1 : 0.5
                }}
              >
                {isTrading ? "..." : `SELL ${qty}`}
              </button>
            ))}
          </div>
        </div>

        {tradeError && (
          <p style={{ color: '#ff4d4d', fontSize: '0.85rem', marginBottom: '16px' }}>
            {tradeError}
          </p>
        )}

        {citySignal && (
          <div className="ecological-factors">
            {/* Weather signals that drive prices */}
            <span className="eyebrow" style={{ display: 'block', marginBottom: '8px', marginTop: '16px' }}>
              Weather Conditions
            </span>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
              These drive token prices. The starred signal affects this token.
            </p>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px',
              marginBottom: '16px', background: 'var(--panel-bg)',
              padding: '12px', borderRadius: '8px', border: '1px solid var(--border)'
            }}>
              {(['temperature', 'airQuality', 'rain', 'wind'] as SignalKey[]).map((key) => {
                const meta = SIGNAL_META[key];
                const val = citySignal[key];
                const isDriver = driverKey === key;
                return (
                  <div key={key} style={{
                    display: 'flex', justifyContent: 'space-between',
                    fontSize: '0.875rem', opacity: isDriver ? 1 : 0.4
                  }}>
                    <span>{meta.label}{isDriver ? " ★" : ""}</span>
                    <strong>{val.toFixed(1)}{meta.unit}</strong>
                  </div>
                );
              })}
            </div>

            {/* Mycelium signals that block trading — displayed in the dashboard header */}

          </div>
        )}
      </section>
    </aside>
  );
}
