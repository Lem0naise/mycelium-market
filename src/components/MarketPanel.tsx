import { useState } from "react";
import { assetIndex, cityIndex } from "../../shared/data";
import { useTradingStore } from "../store/tradingStore";
import type {
  MarketTicker,
  OracleComputation,
  RankedCity,
  ScenarioPreviewResponse
} from "../../shared/types";

type MarketPanelProps = {
  tickers: MarketTicker[];
  preview?: ScenarioPreviewResponse;
  selectedAssetId: string;
  selectedCityId: string;
  onSelectAsset?: (assetId: string) => void;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 1000 ? 0 : 2
  }).format(value);



function CityLeaderboard({ rankings }: { rankings: RankedCity[] }) {
  return (
    <div className="leaderboard">
      <div className="panel-topline">
        <span className="eyebrow">Travel</span>
        <span className="status-pill">RANKED</span>
      </div>
      {rankings.slice(0, 5).map((item, index) => (
        <div key={item.cityId} className="leader-row">
          <span>{String(index + 1).padStart(2, "0")}</span>
          <strong>{cityIndex[item.cityId]?.name ?? item.cityId}</strong>
          <span>{item.travelScore}</span>
        </div>
      ))}
    </div>
  );
}

export function MarketPanel({
  tickers,
  preview,
  selectedAssetId,
  selectedCityId,
  onSelectAsset
}: MarketPanelProps) {
  const { cash, holdings, prices, buyAsset, sellAsset, resetPortfolio } = useTradingStore();

  const asset = assetIndex[selectedAssetId];
  const primaryTicker = tickers.find((ticker) => ticker.assetId === selectedAssetId);
  const primaryCity = cityIndex[selectedCityId];

  const currentHoldings = holdings[selectedCityId]?.[selectedAssetId] || 0;
  const currentPrice = primaryTicker?.price ?? asset.basePrice;
  const currentHumidity = preview?.signals.find(s => s.cityId === selectedCityId)?.humidity ?? 50;

  const [isTrading, setIsTrading] = useState(false);
  const [tradeError, setTradeError] = useState<string | null>(null);

  const handleBuy = async () => {
    setIsTrading(true);
    setTradeError(null);
    const success = await buyAsset(selectedCityId, selectedAssetId, currentHumidity, 1);
    if (!success) {
      setTradeError("Trade failed due to ecological interference.");
    }
    setIsTrading(false);
  };

  const handleSell = async () => {
    setIsTrading(true);
    setTradeError(null);
    const success = await sellAsset(selectedCityId, selectedAssetId, currentHumidity, 1);
    if (!success) {
      setTradeError("Trade failed due to ecological interference.");
    }
    setIsTrading(false);
  };

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
              const currentPrice = prices[cityId]?.[id] ?? assetIndex[id].basePrice;
              return citySum + currentPrice * qty;
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
          return (
            <button
              key={ticker.assetId}
              className={`ticker-card ${ticker.assetId === selectedAssetId ? "active" : ""}`}
              type="button"
              onClick={() => onSelectAsset?.(ticker.assetId)}
            >
              <span className='textLeft'>{profile ? profile.id : ticker.assetId}</span>
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
        <div className="trading-controls" style={{ display: 'flex', gap: '8px', margin: '16px 0', alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block' }}>Owned</span>
            <strong style={{ fontSize: '1.2rem' }}>{currentHoldings}</strong>
          </div>
          <button
            className="action-btn buy-btn"
            onClick={handleBuy}
            disabled={cash < currentPrice || isTrading}
            style={{ padding: '8px 16px', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '4px', cursor: (cash >= currentPrice && !isTrading) ? 'pointer' : 'not-allowed', opacity: (cash >= currentPrice && !isTrading) ? 1 : 0.5, fontWeight: 'bold' }}
          >
            {isTrading ? "..." : "BUY 1"}
          </button>
          <button
            className="action-btn sell-btn"
            onClick={handleSell}
            disabled={currentHoldings <= 0 || isTrading}
            style={{ padding: '8px 16px', background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: '4px', cursor: (currentHoldings > 0 && !isTrading) ? 'pointer' : 'not-allowed', opacity: (currentHoldings > 0 && !isTrading) ? 1 : 0.5, fontWeight: 'bold' }}
          >
            {isTrading ? "..." : "SELL 1"}
          </button>
        </div>
        {tradeError && <p style={{ color: '#ff4d4d', fontSize: '0.85rem', marginBottom: '16px' }}>{tradeError}</p>}
        <div className="ecological-factors">
          <span className="eyebrow" style={{ display: 'block', marginBottom: '8px', marginTop: '16px' }}>Current City Conditions</span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px', background: 'var(--panel-bg)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
            {preview && preview.signals.find(s => s.cityId === selectedCityId) && Object.entries({
              humidity: preview.signals.find(s => s.cityId === selectedCityId)!.humidity,
              rain: preview.signals.find(s => s.cityId === selectedCityId)!.rain,
              temperature: preview.signals.find(s => s.cityId === selectedCityId)!.temperature,
              wind: preview.signals.find(s => s.cityId === selectedCityId)!.wind,
              airQuality: preview.signals.find(s => s.cityId === selectedCityId)!.airQuality,
            }).map(([key, val]) => (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                <span style={{ textTransform: 'capitalize' }}>{key}</span>
                <strong>{val.toFixed(1)}</strong>
              </div>
            ))}
          </div>

          <span className="eyebrow" style={{ display: 'block', marginBottom: '8px', marginTop: '16px' }}>Ecological Sensitivities</span>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
            Positive values mean the asset price increases when the environmental factor increases. Negative values suppress the price.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
            {asset && Object.entries(asset.ecologicalWeights).map(([key, weight]) => {
              if (weight === 0) return null;
              return (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                  <span style={{ textTransform: 'capitalize' }}>{key}</span>
                  <strong className={weight >= 0 ? "up" : "down"}>{weight > 0 ? "+" : ""}{weight}</strong>
                </div>
              );
            })}
          </div>
        </div>
        {preview ? (
          <>
            <div className="hero-metric">
              <div>
                <span>Earth Delta</span>
                <strong className={preview.primary.earthDelta >= 0 ? "up" : "down"}>
                  {preview.primary.earthDelta >= 0 ? "+" : ""}
                  {preview.primary.earthDelta}
                </strong>
              </div>

            </div>
          </>
        ) : (
          <p className="muted">Computing Planetary Spread...</p>
        )}
      </section>
    </aside>
  );
}
