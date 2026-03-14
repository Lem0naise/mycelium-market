import { cityIndex } from "../../shared/data";
import type { EventFeedItem, OracleSpeech } from "../../shared/types";

type FeedPanelProps = {
  feed: EventFeedItem[];
  oracleHistory: OracleSpeech[];
};

export function FeedPanel({ feed, oracleHistory }: FeedPanelProps) {
  return (
    <aside className="panel feed-panel">
      <div className="panel-topline">
        <span className="eyebrow">Feed</span>
      </div>
      <h2>Oracle Feed</h2>
      <div className="feed-list">
        {feed.map((item) => (
          <article key={item.id} className={`feed-card severity-${item.severity}`}>
            <div className="feed-meta">
              <span className={`feed-kind kind-${item.kind}`}>{item.kind}</span>
              <span>{cityIndex[item.cityId ?? ""]?.name ?? "System"}</span>
            </div>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </article>
        ))}
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
