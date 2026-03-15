import { cityIndex } from "../../shared/data";
import type { OracleNotification } from "../../shared/types";
import { renderCurrencyText } from "./currency";

type FeedPanelProps = {
  feed: OracleNotification[];
};

const formatGBPCompact = (value: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1000 ? 1 : 0
  }).format(value);

const categoryLabel: Record<OracleNotification["category"], string> = {
  storm: "Storm",
  driver: "Driver",
  opportunity: "Signal",
  access: "Access",
  flight: "Flight",
  recovery: "Recovery"
};

export function FeedPanel({ feed }: FeedPanelProps) {
  return (
    <aside className="panel feed-panel">
      <div className="panel-topline">
        <span className="eyebrow">Feed</span>
      </div>
      <h2>Oracle Feed</h2>
      <div className="feed-list">
        {feed.length === 0 ? (
          <p className="muted">Waiting for the next useful move.</p>
        ) : (
          feed.map((item) => (
            <article
              key={item.id}
              className={`feed-card severity-${item.severity}${item.spokenAt ? " is-spoken" : ""}`}
            >
              <div className="feed-meta">
                <span className={`feed-kind kind-${item.category}`}>{categoryLabel[item.category]}</span>
                <span className={`status-pill ${item.state === "resolved" ? "" : "live"}`}>
                  {item.state === "resolved" ? "resolved" : "live"}
                </span>
                <span>
                  {item.cityIds.length > 0
                    ? item.cityIds.map((cityId) => cityIndex[cityId]?.name ?? cityId).join(" • ")
                    : "System"}
                </span>
              </div>
              <h3>{item.title}</h3>
              <p>{renderCurrencyText(item.body)}</p>
              <div className="feed-meta">
                <span>{item.assetIds.length > 0 ? item.assetIds.join(" • ") : "portfolio-wide"}</span>
                {item.affectedPortfolioShare > 0 ? (
                  <span>{item.affectedPortfolioShare.toFixed(1)}% exposure</span>
                ) : null}
                {item.affectedValue > 0 ? (
                  <span>{renderCurrencyText(formatGBPCompact(item.affectedValue))}</span>
                ) : null}
                {item.spokenAt ? <span className="status-pill accent">spoken</span> : null}
              </div>
            </article>
          ))
        )}
      </div>
    </aside>
  );
}
