import { useMemo, useRef, useEffect } from "react";
import { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler } from "chart.js";
import { renderCurrencyText } from "./currency";

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler);

const INITIAL_CASH = 100_000;
const H = 250;

type Props = { history: number[] };

function fmtGBP(v: number): string {
  return `£${new Intl.NumberFormat("en-GB", {
    notation: v >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: v >= 1_000_000 ? 2 : v >= 1000 ? 0 : 2,
  }).format(v)}`;
}

export function PortfolioChart({ history }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  const meta = useMemo(() => {
    if (history.length < 2) return null;
    const current = history[history.length - 1];
    const start = history[0];
    const pct = ((current - start) / start) * 100;
    const vsInitial = current >= INITIAL_CASH;
    return { current, start, pct, vsInitial };
  }, [history]);

  const color = meta?.vsInitial ? "#3ddc84" : "#ff5c5c";
  const gradRgb = meta?.vsInitial ? "61,220,132" : "255,92,92";

  useEffect(() => {
    if (!canvasRef.current || !meta) return;
    if (chartRef.current) chartRef.current.destroy();

    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, `rgba(${gradRgb},0.22)`);
    grad.addColorStop(1, `rgba(${gradRgb},0.01)`);

    chartRef.current = new Chart(ctx, {
      type: "line",
      data: {
        labels: history.map((_, i) => i),
        datasets: [{
          data: history,
          borderColor: color,
          borderWidth: 1.8,
          pointRadius: 0,
          fill: true,
          backgroundColor: grad,
          tension: 0.3,
        }],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false },
          y: { display: false },
        },
      },
    });

    return () => { chartRef.current?.destroy(); chartRef.current = null; };
  }, [history, color, gradRgb, meta]);

  if (!meta) {
    return (
      <div className="portfolio-chart-card">
        <span className="eyebrow">Portfolio History</span>
        <p style={{ margin: "8px 0 0", fontSize: "0.78rem", color: "rgba(255,255,255,0.3)" }}>
          Awaiting data…
        </p>
      </div>
    );
  }

  return (
    <div className="portfolio-chart-card">
      {/* Header row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "8px",
        }}
      >
        <span className="eyebrow">Portfolio History</span>
        <span
          style={{
            fontSize: "0.76rem",
            fontWeight: "bold",
            padding: "2px 7px",
            borderRadius: "4px",
            background: meta.vsInitial
              ? "rgba(61,220,132,0.13)"
              : "rgba(255,92,92,0.13)",
            color,
            border: `1px solid ${meta.vsInitial
              ? "rgba(61,220,132,0.3)"
              : "rgba(255,92,92,0.3)"
              }`,
          }}
        >
          {meta.pct >= 0 ? "+" : ""}
          {meta.pct.toFixed(2)}%
        </span>
      </div>

      {/* Chart.js canvas */}
      <div style={{ height: `${H}px`, position: "relative" }}>
        <canvas ref={canvasRef} />
      </div>

      {/* Min / current labels */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: "5px",
          fontSize: "0.68rem",
          color: "rgba(255,255,255,0.32)",
          fontFamily: "'IBM Plex Mono', monospace",
          letterSpacing: "0.02em",
        }}
      >
        <span>{renderCurrencyText(fmtGBP(meta.start))}</span>
        <span style={{ color }}>{renderCurrencyText(fmtGBP(meta.current))}</span>
      </div>
    </div>
  );
}
