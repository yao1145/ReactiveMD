import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import '../../src/themes/default/tokens.css';
import './page.css';

type Kind = 'line' | 'area' | 'bar' | 'pie' | 'scatter';
type Active = { index: number; series: number | null; x: number; y: number };
const kinds: { id: Kind; name: string }[] = [
  { id: 'line', name: '折线图' }, { id: 'area', name: '面积图' },
  { id: 'bar', name: '柱状图' }, { id: 'pie', name: '饼图' }, { id: 'scatter', name: '散点图' },
];
const series = [
  { name: '实验组 A', color: 'var(--chart-1)', values: [28, 35, 31, 48, 43, 58, 54, 68, 61, 78, 72, 86] },
  { name: '实验组 B', color: 'var(--chart-2)', values: [18, 26, 35, 30, 43, 39, 52, 46, 58, 55, 68, 65] },
  { name: '对照组', color: 'var(--chart-3)', values: [36, 32, 42, 38, 45, 48, 42, 54, 49, 57, 53, 60] },
];
const round = (value: number) => Math.round(value * 10) / 10;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const totalOf = (values: number[]) => round(values.reduce((sum, value) => sum + value, 0));
function piePath(cx: number, cy: number, radius: number, start: number, end: number) {
  const finish = Math.min(end, start + Math.PI * 2 - 0.0001);
  const point = (angle: number) => `${cx + radius * Math.cos(angle)},${cy + radius * Math.sin(angle)}`;
  return `M ${cx},${cy} L ${point(start)} A ${radius},${radius} 0 ${finish - start > Math.PI ? 1 : 0} 1 ${point(finish)} Z`;
}

function PieSlice({ start, end, cx, cy, radius, position, color, emphasis, dimmed, onPointer }: {
  start: number; end: number; cx: number; cy: number; radius: number; position: number;
  color: string; emphasis: boolean; dimmed: boolean; onPointer(event: PointerEvent<SVGPathElement>): void;
}) {
  const from = useMotionValue(start), to = useMotionValue(end);
  const centerX = useMotionValue(cx), centerY = useMotionValue(cy), size = useMotionValue(radius);
  const reducedMotion = useReducedMotion();
  const d = useTransform([centerX, centerY, size, from, to], ([x, y, r, a, b]) => piePath(Number(x), Number(y), Number(r), Number(a), Number(b)));
  useEffect(() => {
    // Animate angles, then derive the path: SVG arc flags must stay integers.
    const controls = [[from, start], [to, end], [centerX, cx], [centerY, cy], [size, radius]].map(([value, target]) =>
      animate(value as typeof from, target as number, { duration: reducedMotion ? 0 : .2, ease: 'easeOut' }));
    return () => controls.forEach(control => control.stop());
  }, [start, end, cx, cy, radius, reducedMotion, from, to, centerX, centerY, size]);
  return <motion.path data-series={position} className="pie-slice" d={d} initial={false}
    animate={{ opacity: dimmed ? .22 : 1, scale: emphasis ? 1.035 : 1 }}
    transition={{ duration: reducedMotion ? 0 : .2, ease: 'easeOut' }}
    style={{ fill: color, transformOrigin: `${cx}px ${cy}px` }} onPointerEnter={onPointer} onPointerMove={onPointer} />;
}

function App() {
  const [scheme, setScheme] = useState<'light' | 'dark'>('light');
  const [kind, setKind] = useState<Kind>('line');
  const [dataset, setDataset] = useState(0);
  const [strength, setStrength] = useState(100);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [highlight, setHighlight] = useState<number | null>(null);
  const [active, setActive] = useState<Active | null>(null);
  const [keyboardReading, setKeyboardReading] = useState(false);
  const [width, setWidth] = useState(900);
  const chartRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tipSize, setTipSize] = useState({ width: 222, height: 160 });
  const description = useId();
  const reducedMotion = useReducedMotion();
  const transition = { duration: reducedMotion ? 0 : 0.2, ease: 'easeOut' as const };
  const height = width < 520 ? 292 : 330;
  const left = 40, right = width - 20, top = 24, bottom = height - 40;
  const step = (right - left) / 12;
  const x = (index: number) => left + step * (index + 0.5);
  const y = (value: number) => bottom - value / 100 * (bottom - top);
  const data = series.map((item, position) => ({ ...item, values: item.values.map((value, index) =>
    round(clamp((value + (dataset ? Math.sin(index * 1.3 + position * 2) * 13 + (position === 1 ? 8 : -3) : 0)) * strength / 100, 0, 98))) }));
  const visible = data.map((_, index) => index).filter(index => !hidden.has(index));
  const totals = data.map(item => totalOf(item.values));
  const sum = visible.reduce((value, index) => value + totals[index], 0);
  const focusedSeries = highlight ?? active?.series ?? null;
  const opacity = (index: number) => focusedSeries === null || focusedSeries === index ? 1 : 0.22;
  const clear = () => { setActive(null); setHighlight(null); setKeyboardReading(false); };
  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = tooltipRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setTipSize({ width: element.offsetWidth, height: element.offsetHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, [active !== null]);
  useEffect(() => {
    const dismiss = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') clear(); };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, []);

  const pointer = (event: PointerEvent<SVGSVGElement>) => {
    if (kind === 'pie') {
      if (!(event.target instanceof SVGElement) || !event.target.closest('.pie-slice')) setActive(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - rect.left) * width / rect.width;
    const py = (event.clientY - rect.top) * height / rect.height;
    if (px < left || px > right || py < top || py > bottom) { setActive(null); return; }
    setKeyboardReading(false);
    if (kind === 'bar') {
      const mark = event.target instanceof Element ? event.target.closest('[data-bar-index]') : null;
      if (!mark) { setActive(null); return; }
      const index = Number(mark.getAttribute('data-bar-index'));
      const position = Number(mark.getAttribute('data-bar-series'));
      const barCenter = x(index) - step * .36 + (visible.indexOf(position) + .5) * step * .72 / visible.length - 1;
      setActive({ index, series: position, x: barCenter, y: py });
      return;
    }
    const column = clamp(Math.round((px - left) / step - 0.5), 0, 11);
    let index = column, nearest = visible[0], distance = Infinity;
    for (const position of visible) {
      for (const pointIndex of kind === 'scatter' ? data[position].values.map((_, i) => i) : [column]) {
        const candidate = Math.hypot(x(pointIndex) - px, y(data[position].values[pointIndex]) - py);
        if (candidate < distance) { distance = candidate; nearest = position; index = pointIndex; }
      }
    }
    setActive({ index, series: kind === 'scatter' ? nearest : null, x: x(index), y: kind === 'scatter' ? y(data[nearest].values[index]) : py });
  };
  const keyboard = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key === 'Escape') { clear(); return; }
    if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); setKeyboardReading(true);
    const previousSeries = active?.series ?? visible[0];
    let position = visible.includes(previousSeries) ? previousSeries : visible[0];
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || kind === 'pie') {
      const direction = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1;
      position = visible[(visible.indexOf(position) + visible.length + direction) % visible.length];
    }
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? 11 : clamp((active?.index ?? 0) + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0), 0, 11);
    const barCenter = x(index) - step * .36 + (visible.indexOf(position) + .5) * step * .72 / visible.length - 1;
    setActive({ index, series: kind === 'pie' || kind === 'scatter' || kind === 'bar' ? position : null, x: kind === 'pie' ? width / 2 : kind === 'bar' ? barCenter : x(index), y: kind === 'pie' ? height / 2 : y(data[position].values[index]) });
  };
  const toggleSeries = (index: number) => {
    if (!hidden.has(index) && visible.length === 1) return;
    setHidden(current => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; });
    setActive(null); setHighlight(null);
  };
  const reset = () => { setDataset(0); setStrength(100); setHidden(new Set()); clear(); };
  const line = (values: number[]) => values.map((value, index) => `${index ? 'L' : 'M'} ${x(index)} ${y(value)}`).join(' ');
  const tipLeft = active ? clamp(active.x + 18 + tipSize.width > width - 8 ? active.x - tipSize.width - 18 : active.x + 18, 8, Math.max(8, width - tipSize.width - 8)) : 0;
  const tipTop = active ? clamp(active.y - tipSize.height / 2, 8, Math.max(8, height - tipSize.height - 8)) : 0;
  const selectedSeries = active?.series ?? visible[0];
  let angle = -Math.PI / 2;
  const slices = visible.map(position => { const start = angle; angle += totals[position] / sum * Math.PI * 2; return { position, start, end: angle }; });
  const tooltipRows = active ? (kind === 'pie' || kind === 'scatter' || kind === 'bar' ? [selectedSeries] : visible) : [];
  const activeText = active ? tooltipRows.map(position => `${data[position].name}，${kind === 'pie' ? `占比 ${round(totals[position] / sum * 100)}%，合计 ${totals[position]}` : `第 ${active.index + 1} 轮，${data[position].values[active.index]}`}`).join('；') : '';

  return <main className="chart-demo" data-rmd-theme="default" data-color-scheme={scheme}>
    <div className="demo-wrap">
      <header className="demo-header"><div><p className="eyebrow">REACTIVEMD / DEFAULT THEME</p><h1>图表交互预览<span className="preview-badge">Demo</span></h1><p className="intro">移动查看数值，聚焦比较系列，再切换一组数据。</p></div><button className="theme-button" onClick={() => setScheme(scheme === 'light' ? 'dark' : 'light')}>{scheme === 'light' ? '深色模式' : '浅色模式'}</button></header>
      <section className="chart-card" aria-label="图表预览">
        <div className="card-toolbar"><div className="kind-tabs" role="tablist" aria-label="图表类型">{kinds.map(item => <button key={item.id} role="tab" aria-selected={kind === item.id} aria-controls="chart-panel" id={`tab-${item.id}`} tabIndex={kind === item.id ? 0 : -1} onClick={() => { setKind(item.id); clear(); }} onKeyDown={event => { if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return; event.preventDefault(); const next = kinds[(kinds.findIndex(item => item.id === kind) + kinds.length + (event.key === 'ArrowRight' ? 1 : -1)) % kinds.length]; setKind(next.id); clear(); document.getElementById(`tab-${next.id}`)?.focus(); }}>{item.name}</button>)}</div><span className="sample-tag">12 轮实验 · 3 个系列</span></div>
        <div id="chart-panel" role="tabpanel" aria-labelledby={`tab-${kind}`}>
          <div className="chart-heading"><div><p className="section-label">{kind === 'pie' ? '各组累计读数占比' : kind === 'scatter' ? '实验轮次与响应值' : '实验响应趋势'}</p><div className="headline-number">{kind === 'pie' ? sum.toLocaleString('zh-CN', { maximumFractionDigits: 1 }) : round(visible.reduce((value, index) => value + data[index].values[11], 0) / visible.length)}<span>{kind === 'pie' ? '累计读数' : '末轮平均响应'}</span></div></div><span className="dataset-badge">数据 {dataset ? 'B' : 'A'}</span></div>
          <div className="legend" aria-label="系列图例">{data.map((item, index) => <button key={item.name} aria-pressed={!hidden.has(index)} disabled={!hidden.has(index) && visible.length === 1} onClick={() => toggleSeries(index)} onPointerEnter={() => !hidden.has(index) && setHighlight(index)} onPointerLeave={() => setHighlight(null)} onFocus={() => !hidden.has(index) && setHighlight(index)} onBlur={() => setHighlight(null)} className={hidden.has(index) ? 'is-hidden' : ''} style={{ '--series-color': item.color } as CSSProperties}><span className="swatch" />{item.name}<span className="legend-value">{kind === 'pie' ? hidden.has(index) ? '—' : `${round(totals[index] / sum * 100)}%` : data[index].values[11]}</span></button>)}</div>
          <div className="chart-stage" ref={chartRef}>
            <svg className="chart-svg" width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`${kinds.find(item => item.id === kind)!.name}，方向键读取数据，Escape 关闭提示`} aria-describedby={description} tabIndex={0} onKeyDown={keyboard} onPointerMove={pointer} onPointerLeave={() => { if (!keyboardReading) setActive(null); }} onBlur={() => { setActive(null); setKeyboardReading(false); }}>
              {kind !== 'pie' && <g className="axes" aria-hidden="true">{[0, 25, 50, 75, 100].map(value => <g key={value}><line x1={left} x2={right} y1={y(value)} y2={y(value)} /><text x={left - 12} y={y(value) + 4} textAnchor="end">{value}</text></g>)}{Array.from({ length: 12 }, (_, index) => index).filter(index => index % (width < 520 ? 3 : 2) === 0 || index === 11).map(index => <text key={index} x={x(index)} y={bottom + 25} textAnchor="middle">{index + 1}</text>)}<text x={right} y={height - 2} textAnchor="end">实验轮次</text></g>}
              {kind === 'pie' ? <g>{slices.map(({ position, start, end }) => <PieSlice key={position} start={start} end={end} cx={width / 2} cy={height / 2} radius={Math.min(124, width * 0.34)} position={position} color={data[position].color} emphasis={focusedSeries === position} dimmed={opacity(position) < 1} onPointer={event => { const rect = event.currentTarget.ownerSVGElement!.getBoundingClientRect(); setKeyboardReading(false); setActive({ index: 0, series: position, x: event.clientX - rect.left, y: event.clientY - rect.top }); }} />)}</g> : visible.map((position, seriesSlot) => {
                const values = data[position].values;
                return <motion.g key={`${kind}-${position}`} data-series={position} initial={false} animate={{ opacity: opacity(position) }} transition={transition} style={{ color: data[position].color }}>
                  {kind === 'line' || kind === 'area' ? <>{kind === 'area' && <motion.path initial={false} animate={{ d: `${line(values)} L ${x(11)} ${bottom} L ${x(0)} ${bottom} Z` }} transition={transition} fill="currentColor" fillOpacity=".09" />}<motion.path className="series-line" initial={false} animate={{ d: line(values) }} transition={transition} fill="none" stroke="currentColor" strokeWidth={focusedSeries === position ? 3 : 2.2} strokeLinejoin="round" /></> : values.map((value, index) => kind === 'bar' ? <motion.rect key={index} data-bar-index={index} data-bar-series={position} initial={false} animate={{ x: x(index) - step * .36 + seriesSlot * step * .72 / visible.length, y: y(value), height: bottom - y(value), width: Math.max(2, step * .72 / visible.length - 2) }} transition={transition} fill="currentColor" rx="2" /> : <motion.circle key={index} initial={false} animate={{ cx: x(index), cy: y(value), r: active?.index === index && active.series === position ? 6.5 : 4.5 }} transition={transition} fill="currentColor" fillOpacity=".8" stroke="var(--surface)" strokeWidth="1.5" />)}
                </motion.g>;
              })}
              {active && kind !== 'pie' && <g className="crosshair" aria-hidden="true"><line x1={kind === 'bar' ? active.x : x(active.index)} x2={kind === 'bar' ? active.x : x(active.index)} y1={top} y2={bottom} />{kind === 'scatter' && <line x1={left} x2={right} y1={y(data[selectedSeries].values[active.index])} y2={y(data[selectedSeries].values[active.index])} />}{kind === 'bar' ? null : (kind === 'scatter' ? [selectedSeries] : visible).map(position => <circle key={position} cx={x(active.index)} cy={y(data[position].values[active.index])} r="5" fill={data[position].color} stroke="var(--surface)" strokeWidth="2.5" />)}</g>}
            </svg>
            {active && <div ref={tooltipRef} className="chart-tooltip" role="tooltip" style={{ left: tipLeft, top: tipTop }}><div className="tooltip-heading">{kind === 'pie' ? '累计读数占比' : `第 ${active.index + 1} 轮实验`}</div>{tooltipRows.map(position => <div className="tooltip-row" key={position}><span className="tooltip-name"><i style={{ background: data[position].color }} />{data[position].name}</span><strong>{kind === 'pie' ? `${round(totals[position] / sum * 100)}%` : data[position].values[active.index]}</strong></div>)}{kind === 'pie' && <p className="tooltip-foot">合计 {totals[selectedSeries]} / {round(sum)}</p>}{kind === 'scatter' && <p className="tooltip-foot">x = {active.index + 1} · y = {data[selectedSeries].values[active.index]}</p>}</div>}
          </div>
          <div className="chart-caption"><span>{kind === 'pie' ? '悬浮扇区查看占比' : kind === 'scatter' ? '移动定位最近的数据点' : kind === 'bar' ? '悬浮单根柱，查看该条数据' : '在绘图区移动，并列读取各系列数值'}</span><span>图例悬浮高亮 · 点击隐藏</span></div>
          <p id={description} className="sr-only" aria-live={keyboardReading ? 'polite' : 'off'}>{activeText || '方向键读取数据，上下键切换系列，Escape 关闭提示。'}</p>
        </div>
        <div className="data-controls"><div className="dataset-controls"><button className="primary-button" onClick={() => setDataset(current => current ? 0 : 1)}>切换至数据 {dataset ? 'A' : 'B'}</button><button onClick={reset}>恢复默认</button></div><label className="strength-control"><span>响应强度 <output>{strength}%</output></span><input type="range" min="60" max="110" value={strength} onChange={event => setStrength(Number(event.target.value))} /></label></div>
      </section>
      <div className="acceptance-notes"><p><span>01</span>提示框与定位线</p><p><span>02</span>系列聚焦与淡化</p><p><span>03</span>数据变化短过渡</p></div>
      <p className="page-note">可切换五种图表与明暗模式。键盘聚焦图表后，用方向键读取数据，Esc 关闭提示。</p>
      <details className="source-data"><summary>查看当前数据</summary><div className="table-scroll"><table><caption>当前数据 {dataset ? 'B' : 'A'}</caption><thead><tr><th>轮次</th>{data.map(item => <th key={item.name}>{item.name}</th>)}</tr></thead><tbody>{Array.from({ length: 12 }, (_, index) => <tr key={index}><th>{index + 1}</th>{data.map(item => <td key={item.name}>{item.values[index]}</td>)}</tr>)}</tbody></table></div></details>
      <footer>交互探索 · 基于 RMD default theme 配色</footer>
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
