import { cityIndex } from "../../shared/data";
import type { OracleNotification, OracleSpeech } from "../../shared/types";

type FeedPanelProps = {
  feed: OracleNotification[];
  oracleHistory: OracleSpeech[];
};

const formatGBPCompact = (value: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1000 ? 1 : 0
  }).format(value);

export function FeedPanel({ feed, oracleHistory }: FeedPanelProps) {
  return (
    <aside className="panel feed-panel">
      <div className="panel-topline">
        <span className="eyebrow">Feed</span>
      </div>
      <h2>Oracle Feed</h2>
      <div className="feed-list">
        {feed.length === 0 ? (
          <p className="muted">The oracle is still building a useful picture of your portfolio.</p>
        ) : (
          feed.map((item) => (
            <article key={item.id} className={`feed-card severity-${item.severity}`}>
              <div className="feed-meta">
                <span className={`feed-kind kind-${item.category}`}>{item.category}</span>
                <span>{item.state === "resolved" ? "resolved" : "live"}</span>
                <span>
                  {item.cityIds.length > 0
                    ? item.cityIds.map((cityId) => cityIndex[cityId]?.name ?? cityId).join(" • ")
                    : "System"}
                </span>
              </div>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
              <div className="feed-meta">
                <span>{item.assetIds.length > 0 ? item.assetIds.join(" • ") : "portfolio-wide"}</span>
                {item.affectedPortfolioShare > 0 ? (
                  <span>{item.affectedPortfolioShare.toFixed(1)}% exposure</span>
                ) : null}
                {item.affectedValue > 0 ? (
                  <span>{formatGBPCompact(item.affectedValue)}</span>
                ) : null}
              </div>
            </article>
          ))
        )}
      </div>
      <div className="oracle-transcript">
        <div className="panel-topline">
          <span className="eyebrow">Voice</span>
          <span className="status-pill">ARCHIVE</span>
        </div>
        {oracleHistory.length === 0 ? (
          <p className="muted">The oracle is quiet until the market becomes dramatic.</p>
        ) : (
          oracleHistory.map((speech, index) => (
            <div key={`${speech.cooldownUntil}-${index}`} className="transcript-entry">
              <span>{speech.severity}</span>
              <p>{speech.text}</p>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
