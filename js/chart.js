// chart.js: draws the comparison bar chart as an SVG string. It has no page code, so it can also be tested on its own.
// Bars grow from a zero line: left means the gas binds (negative energy), right means it does not (positive energy).

import { fmt } from './engine.js'; // the same number formatter as the rest of the tool, so signs always look the same

const W = 680; // total width of the drawing in SVG units, it scales to fit the screen
const ROW = 30; // height of each metal's row
const BAR = 18; // thickness of each bar, kept under 24 so bars never fill their row
const LEFT = 52; // space on the left for the element symbols
const RIGHT = 16; // space on the right so labels are never cut off
const TOP = 10; // space above the first row
const AXIS = 44; // space below the last row for the tick labels and the axis title

function niceStep(range) { // picks a tick spacing that gives about five to eight ticks
  for (const s of [0.1, 0.2, 0.25, 0.5, 1]) if (range / s <= 8) return s; // the smallest step that keeps the tick count readable
  return 1; // fallback for very wide ranges
}

function barPath(x0, x1, y, h, r = 4) { // a bar that is square at the zero line and rounded at its far end
  const top = y; // the top edge of the bar
  const bot = y + h; // the bottom edge of the bar
  if (Math.abs(x1 - x0) < 1) return `M${x0},${top}h1v${h}h-1z`; // a hairline bar for values that are almost zero
  const rr = Math.min(r, Math.abs(x1 - x0) / 2); // never let the rounding be bigger than half the bar
  if (x1 > x0) return `M${x0},${top}H${x1 - rr}a${rr},${rr} 0 0 1 ${rr},${rr}V${bot - rr}a${rr},${rr} 0 0 1 ${-rr},${rr}H${x0}z`; // rounded on the right end
  return `M${x0},${top}H${x1 + rr}a${rr},${rr} 0 0 0 ${-rr},${rr}V${bot - rr}a${rr},${rr} 0 0 0 ${rr},${rr}H${x0}z`; // rounded on the left end
}

export function barChart(rows, selected, gasLabel) { // rows are {symbol, value} already sorted, selected is the symbol to highlight
  const values = rows.map((r) => r.value); // just the numbers
  const lo = Math.min(0, ...values); // the most negative value, or zero if none are negative
  const hi = Math.max(0, ...values); // the most positive value, or zero if none are positive
  const pad = (hi - lo) * 0.2; // extra room at both ends for the value labels
  const d0 = lo - (lo < 0 ? pad : 0); // left end of the scale
  const d1 = hi + (hi > 0 ? pad : 0); // right end of the scale
  const plotW = W - LEFT - RIGHT; // width available to the bars
  const x = (v) => LEFT + ((v - d0) / (d1 - d0)) * plotW; // converts an energy to a horizontal position
  const H = TOP + rows.length * ROW + AXIS; // total height of the drawing
  const step = niceStep(d1 - d0); // the tick spacing
  const parts = []; // pieces of SVG text, joined at the end
  parts.push(`<svg viewBox="0 0 ${W} ${H}" role="group" aria-label="Adsorption energy of ${gasLabel} on each metal, in electronvolts" class="chart-svg">`); // the drawing element, labelled for screen readers
  for (let t = Math.ceil(d0 / step) * step; t <= d1 + 1e-9; t += step) { // one grid line per tick
    const tx = x(t); // horizontal position of this tick
    parts.push(`<line class="grid" x1="${tx}" x2="${tx}" y1="${TOP}" y2="${TOP + rows.length * ROW}"/>`); // a thin vertical line, quiet so the bars stay the focus
    parts.push(`<text class="tick" x="${tx}" y="${TOP + rows.length * ROW + 16}" text-anchor="middle">${Math.abs(t) < 1e-9 ? '0' : fmt(t, 2).replace('+', '')}</text>`); // the tick number under the line
  }
  parts.push(`<line class="zero" x1="${x(0)}" x2="${x(0)}" y1="${TOP}" y2="${TOP + rows.length * ROW}"/>`); // the zero line that all bars grow from
  parts.push(`<text class="axis-title" x="${LEFT + plotW / 2}" y="${H - 6}" text-anchor="middle">Adsorption energy (eV), more negative means stronger binding</text>`); // names the axis and says which way is better
  const extremes = new Set([rows[0].symbol, rows[rows.length - 1].symbol, selected]); // only label the strongest, the weakest and the chosen metal
  rows.forEach((r, i) => { // draw one row per metal
    const y = TOP + i * ROW; // top of this row
    const by = y + (ROW - BAR) / 2; // top of the bar, centred in the row
    const x1 = x(r.value); // the end of the bar
    const cls = r.value < 0 ? 'bind' : 'repel'; // colour class by sign, so direction is never carried by colour alone
    const dim = selected && r.symbol !== selected ? ' dim' : ''; // fade the other bars when one is chosen
    parts.push(`<g class="row${r.symbol === selected ? ' sel' : ''}" tabindex="0" data-sym="${r.symbol}" data-val="${r.value}" aria-label="${r.symbol}: ${fmt(r.value)} electronvolts">`); // a focusable group so keyboard users can reach each bar
    parts.push(`<rect class="hit" x="0" y="${y}" width="${W}" height="${ROW}"/>`); // an invisible target larger than the bar, easier to hover
    parts.push(`<text class="sym" x="${LEFT - 10}" y="${y + ROW / 2 + 4}" text-anchor="end">${r.symbol}</text>`); // the element symbol in normal text colour
    parts.push(`<path class="bar ${cls}${dim}" d="${barPath(x(0), x1, by, BAR)}"/>`); // the bar itself
    if (extremes.has(r.symbol)) { // a value label for the few bars that matter
      const left = r.value < 0; // negative bars point left, so their label goes on the left of the tip
      parts.push(`<text class="val" x="${x1 + (left ? -6 : 6)}" y="${y + ROW / 2 + 4}" text-anchor="${left ? 'end' : 'start'}">${fmt(r.value)}</text>`); // the label sits just past the end of the bar
    }
    parts.push('</g>'); // close the row group
  });
  parts.push('</svg>'); // close the drawing
  return parts.join(''); // the finished SVG text
}
