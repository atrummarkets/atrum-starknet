"use client";

/**
 * Clearing price over batches.
 *
 * FORM: change-over-time, one series. So a line, paired with the current price as the
 * headline — the number people actually want is "what is it now", and the line answers "how
 * did it get here". One series means NO legend box; the title names it.
 *
 * Choices the dataviz procedure forced, rather than taste:
 *
 *   The mark uses its own colour step. #EC796B is right for a button and sits at OKLCH L
 *   0.704, outside the 0.48–0.67 band a dark-mode data mark wants. #E2664A is at 0.48 and
 *   clears contrast against this surface. Computed, not eyeballed.
 *
 *   Only the last point is labelled. A number on every point is noise, and the endpoint is
 *   the one anybody reads.
 *
 *   The y axis is fixed 0–100, not fitted to the data. These are probabilities: a move from
 *   58 to 62 should look like four points, not like a cliff. Auto-fitting a probability
 *   series manufactures drama.
 *
 *   A table follows the chart, so the series is readable without seeing colour or shape.
 */
import { useState } from "react";
import type { Point } from "@/lib/atrum/usePriceHistory";

const W = 520;
const H = 132;
const PAD = { t: 14, r: 34, b: 20, l: 26 };

export function PriceHistory({ points }: { points: Point[] | null }) {
  const [hover, setHover] = useState<number | null>(null);

  if (!points) {
    return (
      <div className="panel">
        <p className="panel-label">Clearing price</p>
        <p className="msg-line">Reading the chain…</p>
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <div className="panel">
        <p className="panel-label">Clearing price</p>
        <p className="notice">
          No batch has cleared yet. The first price appears once one does.
        </p>
      </div>
    );
  }

  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  // Probability scale, fixed. See the note above.
  const x = (i: number) =>
    PAD.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (p: number) => PAD.t + ih - (p / 100) * ih;

  const path = points.map((pt, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(pt.price)}`).join(" ");
  const area =
    `M${x(0)},${PAD.t + ih} ` +
    points.map((pt, i) => `L${x(i)},${y(pt.price)}`).join(" ") +
    ` L${x(points.length - 1)},${PAD.t + ih} Z`;

  const last = points[points.length - 1];
  const first = points[0];
  const delta = last.price - first.price;
  const shown = hover !== null ? points[hover] : last;

  return (
    <div className="panel">
      <p className="panel-label">Clearing price · one per batch</p>

      {/* Hero number: what it is now. The chart answers how it got here. */}
      <div className="card-price" style={{ marginBottom: "0.2rem" }}>
        {/* Proportional figures on the hero. `tabular-nums` belongs where numbers align
            vertically -- the table below, the axis ticks -- not on a display-size number,
            where equal-width digits read loose. Mono is kept deliberately: this is a market
            readout and mono numerals are the idiom, not decoration. */}
        <b style={{ color: "var(--atrum-ivory)", fontVariantNumeric: "proportional-nums" }}>
          {shown.price}
        </b>
        <span>YES</span>
        <em>
          batch #{shown.batch}
          {points.length > 1 && hover === null && (
            <>
              {" · "}
              {delta === 0 ? "flat" : delta > 0 ? `+${delta}` : delta} since first clear
            </>
          )}
        </em>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`Clearing price by batch. Latest ${last.price} percent at batch ${last.batch}.`}
        style={{ display: "block", overflow: "visible" }}
        onMouseLeave={() => setHover(null)}
      >
        {/* Recessive grid: 25/50/75 only. 50 is meaningful here -- it is even odds. */}
        {[25, 50, 75].map((g) => (
          <g key={g}>
            {/* Solid hairlines. Dashing reads as a threshold or a projection when it is
                only a grid, so 50 is distinguished by opacity instead -- it is the one
                gridline that means something here, even odds. */}
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(g)}
              y2={y(g)}
              stroke="var(--viz-grid)"
              strokeWidth="1"
              strokeOpacity={g === 50 ? 1 : 0.55}
            />
            <text
              x={PAD.l - 6}
              y={y(g) + 3}
              textAnchor="end"
              fill="var(--atrum-ash)"
              style={{ font: "400 9px var(--font-mono)" }}
            >
              {g}
            </text>
          </g>
        ))}

        <defs>
          <linearGradient id="ph-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--viz-accent)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--viz-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {points.length > 1 && <path d={area} fill="url(#ph-fill)" />}
        {points.length > 1 && (
          <path d={path} fill="none" stroke="var(--viz-accent)" strokeWidth="2" strokeLinejoin="round" />
        )}

        {/* Hit targets are larger than the marks, per the interaction spec. */}
        {points.map((pt, i) => (
          <g key={pt.batch}>
            <circle
              cx={x(i)}
              cy={y(pt.price)}
              r="12"
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
            {(hover === i || i === points.length - 1) && (
              <circle
                cx={x(i)}
                cy={y(pt.price)}
                r="4"
                fill="var(--viz-accent)"
                stroke="var(--bg-panel)"
                strokeWidth="2"
              />
            )}
          </g>
        ))}

        {hover !== null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={PAD.t}
            y2={PAD.t + ih}
            stroke="var(--viz-accent)"
            strokeWidth="1"
            strokeOpacity="0.4"
          />
        )}

        {/* Only the endpoint carries a label. */}
        <text
          x={x(points.length - 1) + 8}
          y={y(last.price) + 3}
          fill="var(--atrum-bone)"
          style={{ font: "400 11px var(--font-mono)" }}
        >
          {last.price}
        </text>
      </svg>

      <details style={{ marginTop: "0.7rem" }}>
        <summary className="keeper-toggle">
          Read it as a table
          <span className="keeper-note">no colour needed</span>
        </summary>
        <table className="disclose" style={{ marginTop: "0.7rem" }}>
          <thead>
            <tr>
              <th>Batch</th>
              <th>Clearing price</th>
            </tr>
          </thead>
          <tbody>
            {points.map((pt) => (
              <tr key={pt.batch}>
                <td>#{pt.batch}</td>
                <td>{pt.price}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <p className="notice">
        One price per batch, and every trade in that batch happened at it. Batches that never
        cleared are left out rather than drawn as zero — a gap is honest, a 0% is not.
      </p>
    </div>
  );
}
