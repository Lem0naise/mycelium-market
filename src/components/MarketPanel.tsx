import { assetIndex, cityIndex } from "../../shared/data";
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
  compareCityId: string | null;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 1000 ? 0 : 2
  }).format(value);

function InfluenceBars({ computation }: { computation: OracleComputation }) {
  return (
    <div className="influence-grid">
      {computation.rationaleTokens.map((token) => (
        <div key={token} className="influence-row">
          <span>{token}</span>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{ width: `${Math.min(100, 30 + computation.environmentalPressure * 2)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

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
  compareCityId
}: MarketPanelProps) {
  const asset = assetIndex[selectedAssetId];
  const primaryTicker = tickers.find((ticker) => ticker.assetId === selectedAssetId);
  const primaryCity = cityIndex[selectedCityId];
  const compareCity = compareCityId ? cityIndex[compareCityId] : null;

  return (
    <aside className="panel market-panel">
      <div className="panel-topline">
        <span className="eyebrow">Market Board</span>
        <span className="status-pill">{primaryTicker?.sourceMode ?? "fallback"}</span>
      </div>
      <div className="ticker-grid">
        {tickers.map((ticker) => {
          const profile = assetIndex[ticker.assetId];
          return (
            <button
              key={ticker.assetId}
              className={`ticker-card ${ticker.assetId === selectedAssetId ? "active" : ""}`}
              type="button"
            >
              <span>{profile.id}</span>
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
        <p>{asset.personalityTone}. The market listens to ecology where it absolutely should not.</p>
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
            <div className="oracle-summary">
              <strong>{primaryCity?.name}</strong>
              <p>{preview.oracleText}</p>
              {compareCity && preview.compare ? (
                <p className="muted">
                  {primaryCity?.name} is {preview.primary.cityAdvantage >= 0 ? "ahead of" : "behind"}{" "}
                  {compareCity.name} by {Math.abs(preview.primary.cityAdvantage)} Earth Delta.
                </p>
              ) : null}
            </div>
            <InfluenceBars computation={preview.primary} />
            <CityLeaderboard rankings={preview.rankings} />
          </>
        ) : (
          <p className="muted">Computing the planetary spread.</p>
        )}
      </section>
    </aside>
  );
}

