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

  const currentHoldings = holdings[selectedAssetId] || 0;
  const currentPrice = primaryTicker?.price ?? asset.basePrice;

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
          <strong>{formatCurrency(cash + Object.entries(holdings).reduce((sum, [id, qty]) => {
            const currentPrice = prices[id] ?? assetIndex[id].basePrice;
            return sum + currentPrice * qty;
          }, 0))}</strong>
        </div>
      </div>

      <div className="panel-topline">
        <span className="eyebrow">Market Board</span>
        <span className="status-pill">{primaryTicker?.sourceMode ?? "live"}</span>
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
              <span>{profile ? profile.id : ticker.assetId}</span>
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
            onClick={() => buyAsset(selectedAssetId, 1)}
            disabled={cash < currentPrice}
            style={{ padding: '8px 16px', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '4px', cursor: cash >= currentPrice ? 'pointer' : 'not-allowed', opacity: cash >= currentPrice ? 1 : 0.5, fontWeight: 'bold' }}
          >
            BUY 1
          </button>
          <button
            className="action-btn sell-btn"
            onClick={() => sellAsset(selectedAssetId, 1)}
            disabled={currentHoldings <= 0}
            style={{ padding: '8px 16px', background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: '4px', cursor: currentHoldings > 0 ? 'pointer' : 'not-allowed', opacity: currentHoldings > 0 ? 1 : 0.5, fontWeight: 'bold' }}
          >
            SELL 1
          </button>
        </div>
        <div className="ecological-factors">
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
              <div>
                <span>Repriced Value</span>
                <strong>{formatCurrency(preview.primary.repricedValue)}</strong>
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

