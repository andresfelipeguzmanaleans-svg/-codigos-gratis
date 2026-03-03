import { useRef, useEffect, useState, useCallback } from 'react';

interface DataPoint {
  date: string;   // YYYY-MM-DD
  value: number;
}

interface Props {
  data: DataPoint[];
  color?: string;
  unit?: string;
}

const PAD = { top: 28, right: 16, bottom: 38, left: 52 };
const DOT_R = 4;
const HOVER_R = 6;

function shortDate(d: string) {
  const [, m, day] = d.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[+m - 1]} ${+day}`;
}

function fmtVal(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
  return String(n);
}

export default function PriceHistoryChart({ data, color = '#22d3ee', unit = 'ER' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number; pt: DataPoint } | null>(null);
  const [dims, setDims] = useState({ w: 600, h: 220 });

  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));

  // Responsive resize
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const cr = entries[0].contentRect;
      setDims({ w: Math.round(cr.width), h: Math.max(180, Math.min(260, Math.round(cr.width * 0.38))) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Draw chart
  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs || sorted.length < 2) return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    cvs.width = dims.w * dpr;
    cvs.height = dims.h * dpr;
    ctx.scale(dpr, dpr);

    const { w, h } = dims;
    ctx.clearRect(0, 0, w, h);

    const values = sorted.map(d => d.value);
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const rangeV = maxV - minV || 1;

    const plotW = w - PAD.left - PAD.right;
    const plotH = h - PAD.top - PAD.bottom;

    const toX = (i: number) => PAD.left + (i / (sorted.length - 1)) * plotW;
    const toY = (v: number) => PAD.top + plotH - ((v - minV) / rangeV) * plotH;

    // Grid lines
    ctx.strokeStyle = '#ffffff10';
    ctx.lineWidth = 1;
    const gridLines = 4;
    for (let i = 0; i <= gridLines; i++) {
      const y = PAD.top + (i / gridLines) * plotH;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(w - PAD.right, y);
      ctx.stroke();

      // Y labels
      const val = maxV - (i / gridLines) * rangeV;
      ctx.fillStyle = '#94a3b8';
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(fmtVal(Math.round(val)), PAD.left - 8, y);
    }

    // X labels
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const maxLabels = Math.min(sorted.length, Math.floor(plotW / 55));
    const step = Math.max(1, Math.floor(sorted.length / maxLabels));
    for (let i = 0; i < sorted.length; i += step) {
      ctx.fillText(shortDate(sorted[i].date), toX(i), h - PAD.bottom + 6);
    }
    // Always show last label
    if (sorted.length > 1) {
      ctx.fillText(shortDate(sorted[sorted.length - 1].date), toX(sorted.length - 1), h - PAD.bottom + 6);
    }

    // Gradient fill
    const grad = ctx.createLinearGradient(0, PAD.top, 0, h - PAD.bottom);
    grad.addColorStop(0, color + '30');
    grad.addColorStop(1, color + '05');
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(sorted[0].value));
    sorted.forEach((d, i) => ctx.lineTo(toX(i), toY(d.value)));
    ctx.lineTo(toX(sorted.length - 1), h - PAD.bottom);
    ctx.lineTo(toX(0), h - PAD.bottom);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(sorted[0].value));
    sorted.forEach((d, i) => ctx.lineTo(toX(i), toY(d.value)));
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Dots
    sorted.forEach((d, i) => {
      ctx.beginPath();
      ctx.arc(toX(i), toY(d.value), DOT_R, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }, [sorted, dims, color]);

  // Hover handler
  const onMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const cvs = canvasRef.current;
    if (!cvs || sorted.length < 2) return;
    const rect = cvs.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const values = sorted.map(d => d.value);
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const rangeV = maxV - minV || 1;

    const plotW = dims.w - PAD.left - PAD.right;
    const plotH = dims.h - PAD.top - PAD.bottom;
    const toX = (i: number) => PAD.left + (i / (sorted.length - 1)) * plotW;
    const toY = (v: number) => PAD.top + plotH - ((v - minV) / rangeV) * plotH;

    let closest = -1;
    let minDist = Infinity;
    sorted.forEach((d, i) => {
      const dx = mx - toX(i);
      const dy = my - toY(d.value);
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) { minDist = dist; closest = i; }
    });

    if (closest >= 0 && minDist < 40) {
      setHover({ x: toX(closest), y: toY(sorted[closest].value), pt: sorted[closest] });
    } else {
      setHover(null);
    }
  }, [sorted, dims]);

  if (sorted.length < 2) {
    return (
      <div style={{ padding: '1.5rem', textAlign: 'center', color: '#64748b', fontSize: '0.875rem' }}>
        Not enough data points for a chart yet. Price history will appear after a few days.
      </div>
    );
  }

  const change = sorted[sorted.length - 1].value - sorted[0].value;
  const pct = ((change / sorted[0].value) * 100).toFixed(1);
  const isUp = change > 0;
  const isFlat = change === 0;

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
      {/* Summary */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem', padding: '0 0.25rem' }}>
        <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
          {shortDate(sorted[0].date)} – {shortDate(sorted[sorted.length - 1].date)}
        </span>
        <span style={{
          fontSize: '0.8rem', fontWeight: 600,
          color: isFlat ? '#94a3b8' : isUp ? '#4ade80' : '#f87171',
        }}>
          {isFlat ? '—' : isUp ? '▲' : '▼'} {isFlat ? 'Stable' : `${Math.abs(change)} ${unit} (${isUp ? '+' : ''}${pct}%)`}
        </span>
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        style={{ width: dims.w, height: dims.h, display: 'block', cursor: 'crosshair' }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      />

      {/* Tooltip */}
      {hover && (
        <div style={{
          position: 'absolute',
          left: Math.min(hover.x, dims.w - 120),
          top: hover.y - 44,
          background: '#1e293b',
          border: '1px solid #334155',
          borderRadius: '6px',
          padding: '4px 10px',
          fontSize: '0.75rem',
          color: '#e2e8f0',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          zIndex: 10,
        }}>
          <div style={{ fontWeight: 600, color }}>{hover.pt.value.toLocaleString()} {unit}</div>
          <div style={{ color: '#94a3b8' }}>{shortDate(hover.pt.date)}</div>
        </div>
      )}
    </div>
  );
}
