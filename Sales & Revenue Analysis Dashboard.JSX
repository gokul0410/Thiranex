import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  Upload, RotateCcw, TrendingUp, TrendingDown, DollarSign,
  ShoppingCart, Award, Tag,
} from 'lucide-react';
import Papa from 'papaparse';

/* ----------------------------------------------------------------
   Design tokens — "ledger" theme: ink background, paper text,
   gold for revenue, sage for growth, rust for decline.
-------------------------------------------------------------------*/
const T = {
  ink: '#13171D',
  panel: '#1B222B',
  panelAlt: '#212A35',
  line: '#2B3540',
  paper: '#F3EEE3',
  muted: '#8C99A8',
  gold: '#D9A65B',
  sage: '#7FAE8C',
  rust: '#C2604A',
  blue: '#6F9CC9',
};

const CATEGORY_COLORS = {
  Furniture: T.gold,
  Lighting: T.sage,
  Electronics: T.blue,
  Stationery: T.rust,
};

const PRODUCTS = [
  { name: 'Atlas Desk', category: 'Furniture', price: 320, base: 18 },
  { name: 'Nimbus Chair', category: 'Furniture', price: 180, base: 35 },
  { name: 'Solace Lamp', category: 'Lighting', price: 65, base: 60 },
  { name: 'Vertex Monitor', category: 'Electronics', price: 240, base: 28 },
  { name: 'Pulse Speaker', category: 'Electronics', price: 90, base: 50 },
  { name: 'Quill Notebook', category: 'Stationery', price: 12, base: 200 },
];

const REGIONS = ['North', 'South', 'East', 'West'];
const REGION_FACTORS = { North: 1.2, South: 0.9, East: 1.05, West: 0.85 };
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ----------------------------------------------------------------
   Helpers
-------------------------------------------------------------------*/
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateSampleData() {
  const rng = mulberry32(42);
  const data = [];
  for (let m = 0; m < 24; m++) {
    const year = 2024 + Math.floor(m / 12);
    const month = m % 12;
    const seasonal = 1 + 0.28 * Math.sin((month / 12) * 2 * Math.PI - Math.PI / 2);
    const growth = 1 + m * 0.012;
    PRODUCTS.forEach((p) => {
      REGIONS.forEach((r) => {
        const noise = 0.85 + rng() * 0.3;
        const units = Math.max(0, Math.round(p.base * seasonal * growth * REGION_FACTORS[r] * noise));
        const revenue = Math.round(units * p.price * (0.95 + rng() * 0.1));
        data.push({
          date: `${year}-${String(month + 1).padStart(2, '0')}`,
          product: p.name,
          category: p.category,
          region: r,
          units,
          revenue,
        });
      });
    });
  }
  return data;
}

function fmtCurrency(v, compact = false) {
  const n = Number(v) || 0;
  if (compact) {
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  }
  return '$' + Math.round(n).toLocaleString();
}

function fmtNumber(v) {
  return Math.round(Number(v) || 0).toLocaleString();
}

function monthLabel(dateStr) {
  const parts = String(dateStr).split('-');
  const idx = parseInt(parts[1], 10) - 1;
  const name = MONTH_NAMES[idx] || parts[1] || dateStr;
  return `${name} '${(parts[0] || '').slice(2)}`;
}

/* ----------------------------------------------------------------
   Small UI bits
-------------------------------------------------------------------*/
function GrowthBadge({ value }) {
  const positive = value >= 0;
  const color = positive ? T.sage : T.rust;
  const Icon = positive ? TrendingUp : TrendingDown;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      color, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, fontWeight: 500,
    }}>
      <Icon size={13} strokeWidth={2.5} />
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

function KpiCard({ icon: Icon, label, value, sub, accent }) {
  return (
    <div style={{
      background: T.panel, border: `1px solid ${T.line}`, borderRadius: 6,
      padding: '18px 20px', flex: '1 1 200px', minWidth: 180,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: '0.12em',
          textTransform: 'uppercase', color: T.muted,
        }}>{label}</span>
        <Icon size={16} color={accent || T.gold} strokeWidth={1.8} />
      </div>
      <div style={{
        fontFamily: "'Source Serif 4', serif", fontSize: 30, fontWeight: 600,
        color: T.paper, lineHeight: 1,
      }}>{value}</div>
      {sub && <div style={{ fontSize: 12.5, color: T.muted }}>{sub}</div>}
    </div>
  );
}

const CARD_STYLE = {
  background: T.panel, border: `1px solid ${T.line}`, borderRadius: 6, padding: '20px 22px',
};

const CARD_TITLE_STYLE = {
  fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: '0.14em',
  textTransform: 'uppercase', color: T.muted, marginBottom: 16,
};

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{
      background: T.panelAlt, border: `1px solid ${T.line}`, borderRadius: 4,
      padding: '8px 12px', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12,
    }}>
      <div style={{ color: T.muted, marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || T.paper }}>
          {p.name}: {p.dataKey === 'units' ? fmtNumber(p.value) : fmtCurrency(p.value)}
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------
   Main component
-------------------------------------------------------------------*/
export default function SalesRevenueDashboard() {
  const sampleData = useMemo(() => generateSampleData(), []);
  const [data, setData] = useState(sampleData);
  const [fileName, setFileName] = useState(null);
  const [parseError, setParseError] = useState(null);
  const fileInputRef = useRef(null);

  const allDates = useMemo(() => Array.from(new Set(data.map((d) => d.date))).sort(), [data]);
  const allRegions = useMemo(() => Array.from(new Set(data.map((d) => d.region))).sort(), [data]);
  const allCategories = useMemo(() => Array.from(new Set(data.map((d) => d.category))).sort(), [data]);

  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [selectedRegions, setSelectedRegions] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('revenue');
  const [sortDir, setSortDir] = useState('desc');

  // Reset filters whenever the underlying dataset changes (new upload / reset)
  useEffect(() => {
    setStartDate(null);
    setEndDate(null);
    setSelectedRegions(null);
    setSelectedCategory('All');
    setSearch('');
  }, [data]);

  const startEff = startDate ?? allDates[0];
  const endEff = endDate ?? allDates[allDates.length - 1];
  const regionsEff = selectedRegions ?? allRegions;

  const filteredData = useMemo(() => {
    return data.filter((d) => {
      if (d.date < startEff || d.date > endEff) return false;
      if (!regionsEff.includes(d.region)) return false;
      if (selectedCategory !== 'All' && d.category !== selectedCategory) return false;
      if (search && !String(d.product).toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [data, startEff, endEff, regionsEff, selectedCategory, search]);

  // KPIs
  const totals = useMemo(() => {
    let revenue = 0, units = 0;
    filteredData.forEach((d) => { revenue += Number(d.revenue) || 0; units += Number(d.units) || 0; });
    return { revenue, units };
  }, [filteredData]);

  // Trend (grouped by date)
  const trendData = useMemo(() => {
    const map = new Map();
    filteredData.forEach((d) => {
      if (!map.has(d.date)) map.set(d.date, { date: d.date, revenue: 0, units: 0 });
      const row = map.get(d.date);
      row.revenue += Number(d.revenue) || 0;
      row.units += Number(d.units) || 0;
    });
    return Array.from(map.values())
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((d) => ({ ...d, label: monthLabel(d.date) }));
  }, [filteredData]);

  const growthPct = useMemo(() => {
    if (trendData.length < 2) return 0;
    const mid = Math.ceil(trendData.length / 2);
    const first = trendData.slice(0, mid).reduce((s, d) => s + d.revenue, 0);
    const second = trendData.slice(mid).reduce((s, d) => s + d.revenue, 0);
    if (first === 0) return second > 0 ? 100 : 0;
    return ((second - first) / first) * 100;
  }, [trendData]);

  // Product aggregation
  const productAgg = useMemo(() => {
    const map = new Map();
    filteredData.forEach((d) => {
      if (!map.has(d.product)) map.set(d.product, { product: d.product, category: d.category, revenue: 0, units: 0 });
      const row = map.get(d.product);
      row.revenue += Number(d.revenue) || 0;
      row.units += Number(d.units) || 0;
    });
    const arr = Array.from(map.values());
    const total = arr.reduce((s, d) => s + d.revenue, 0);
    arr.forEach((d) => { d.share = total > 0 ? (d.revenue / total) * 100 : 0; });
    return arr;
  }, [filteredData]);

  const topProducts = useMemo(
    () => [...productAgg].sort((a, b) => b.revenue - a.revenue).slice(0, 6),
    [productAgg]
  );

  const sortedProducts = useMemo(() => {
    const arr = [...productAgg];
    arr.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (a[sortKey] < b[sortKey]) return -1 * dir;
      if (a[sortKey] > b[sortKey]) return 1 * dir;
      return 0;
    });
    return arr;
  }, [productAgg, sortKey, sortDir]);

  // Category share
  const categoryData = useMemo(() => {
    const map = new Map();
    filteredData.forEach((d) => {
      map.set(d.category, (map.get(d.category) || 0) + (Number(d.revenue) || 0));
    });
    const total = Array.from(map.values()).reduce((s, v) => s + v, 0);
    return Array.from(map.entries()).map(([category, revenue]) => ({
      category, revenue, pct: total > 0 ? (revenue / total) * 100 : 0,
    })).sort((a, b) => b.revenue - a.revenue);
  }, [filteredData]);

  // Region performance
  const regionData = useMemo(() => {
    const map = new Map();
    filteredData.forEach((d) => {
      map.set(d.region, (map.get(d.region) || 0) + (Number(d.revenue) || 0));
    });
    return Array.from(map.entries()).map(([region, revenue]) => ({ region, revenue }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [filteredData]);

  const topProduct = topProducts[0];

  /* -------------------------- handlers -------------------------- */
  function toggleRegion(r) {
    const current = selectedRegions ?? allRegions;
    let next;
    if (current.includes(r)) {
      next = current.filter((x) => x !== r);
      if (next.length === 0) return; // keep at least one selected
    } else {
      next = [...current, r];
    }
    setSelectedRegions(next.length === allRegions.length ? null : next);
  }

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setParseError(null);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      complete: (results) => {
        try {
          const rows = results.data
            .filter((r) => r.date && r.product)
            .map((r) => ({
              date: String(r.date).slice(0, 7),
              product: String(r.product),
              category: r.category ? String(r.category) : 'Other',
              region: r.region ? String(r.region) : 'Unknown',
              units: Number(r.units) || 0,
              revenue: Number(r.revenue) || 0,
            }));
          if (!rows.length) {
            setParseError('No usable rows found. Expected columns: date, product, category, region, units, revenue.');
            return;
          }
          setData(rows);
          setFileName(file.name);
        } catch (err) {
          setParseError('Could not read that file. Check the column names and try again.');
        }
      },
      error: () => setParseError('Could not read that file. Check the column names and try again.'),
    });
    e.target.value = '';
  }

  function handleReset() {
    setData(sampleData);
    setFileName(null);
    setParseError(null);
  }

  /* -------------------------------------------------------------- */

  return (
    <div style={{
      fontFamily: "'Inter', sans-serif", background: T.ink, color: T.paper,
      padding: '28px', borderRadius: 8, minHeight: '100%',
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,500;8..60,600;8..60,700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        .srd-select, .srd-input {
          background: ${T.panelAlt}; color: ${T.paper}; border: 1px solid ${T.line};
          border-radius: 4px; padding: 6px 10px; font-family: 'Inter', sans-serif;
          font-size: 13px; outline: none;
        }
        .srd-select:focus, .srd-input:focus { border-color: ${T.gold}; }
        .srd-chip {
          border: 1px solid ${T.line}; background: transparent; color: ${T.muted};
          border-radius: 999px; padding: 5px 14px; font-size: 12.5px; font-family: 'Inter', sans-serif;
          cursor: pointer; transition: all 0.15s ease;
        }
        .srd-chip.active { border-color: ${T.gold}; color: ${T.gold}; background: rgba(217,166,91,0.08); }
        .srd-btn {
          display: inline-flex; align-items: center; gap: 6px; border: 1px solid ${T.line};
          background: ${T.panelAlt}; color: ${T.paper}; border-radius: 4px; padding: 7px 14px;
          font-size: 12.5px; font-family: 'Inter', sans-serif; cursor: pointer; transition: border-color 0.15s ease;
        }
        .srd-btn:hover { border-color: ${T.gold}; }
        .srd-th { cursor: pointer; user-select: none; }
        .srd-th:hover { color: ${T.paper}; }
        .srd-row:hover { background: ${T.panelAlt}; }
      `}</style>

      {/* Header / masthead */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
        flexWrap: 'wrap', gap: 16, paddingBottom: 18, marginBottom: 22,
        borderBottom: `2px solid ${T.gold}`,
      }}>
        <div>
          <div style={{
            fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: '0.2em',
            color: T.gold, textTransform: 'uppercase', marginBottom: 6,
          }}>Sales &amp; Revenue Ledger</div>
          <h1 style={{
            fontFamily: "'Source Serif 4', serif", fontSize: 28, fontWeight: 600,
            margin: 0, color: T.paper,
          }}>Performance Dashboard</h1>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {fileName && (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: T.muted }}>
              {fileName}
            </span>
          )}
          <button className="srd-btn" onClick={() => fileInputRef.current && fileInputRef.current.click()}>
            <Upload size={14} /> Import CSV
          </button>
          <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFile} style={{ display: 'none' }} />
          <button className="srd-btn" onClick={handleReset}>
            <RotateCcw size={14} /> Reset to sample data
          </button>
        </div>
      </div>

      {parseError && (
        <div style={{
          background: 'rgba(194,96,74,0.12)', border: `1px solid ${T.rust}`, color: T.rust,
          borderRadius: 4, padding: '10px 14px', fontSize: 13, marginBottom: 18,
        }}>{parseError}</div>
      )}

      {/* KPI row */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 22 }}>
        <KpiCard icon={DollarSign} label="Total revenue" value={fmtCurrency(totals.revenue, true)}
          sub={<GrowthBadge value={growthPct} />} accent={T.gold} />
        <KpiCard icon={ShoppingCart} label="Units sold" value={fmtNumber(totals.units)}
          sub={`${productAgg.length} active product${productAgg.length === 1 ? '' : 's'}`} accent={T.blue} />
        <KpiCard icon={Tag} label="Avg. selling price" value={fmtCurrency(totals.units > 0 ? totals.revenue / totals.units : 0)}
          sub="Revenue per unit" accent={T.sage} />
        <KpiCard icon={Award} label="Top product" value={topProduct ? topProduct.product : '—'}
          sub={topProduct ? `${fmtCurrency(topProduct.revenue, true)} · ${topProduct.share.toFixed(1)}% of revenue` : 'No data'}
          accent={T.rust} />
      </div>

      {/* Filters / slicers */}
      <div style={{
        ...CARD_STYLE, display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center',
        marginBottom: 22,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, letterSpacing: '0.1em', color: T.muted, fontFamily: "'IBM Plex Mono', monospace" }}>FROM</span>
          <select className="srd-select" value={startEff} onChange={(e) => setStartDate(e.target.value)}>
            {allDates.map((d) => <option key={d} value={d}>{monthLabel(d)}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, letterSpacing: '0.1em', color: T.muted, fontFamily: "'IBM Plex Mono', monospace" }}>TO</span>
          <select className="srd-select" value={endEff} onChange={(e) => setEndDate(e.target.value)}>
            {allDates.map((d) => <option key={d} value={d}>{monthLabel(d)}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, letterSpacing: '0.1em', color: T.muted, fontFamily: "'IBM Plex Mono', monospace" }}>CATEGORY</span>
          <select className="srd-select" value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)}>
            <option value="All">All categories</option>
            {allCategories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, letterSpacing: '0.1em', color: T.muted, fontFamily: "'IBM Plex Mono', monospace" }}>SEARCH PRODUCT</span>
          <input className="srd-input" placeholder="Type a product name…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, letterSpacing: '0.1em', color: T.muted, fontFamily: "'IBM Plex Mono', monospace" }}>REGIONS</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {allRegions.map((r) => (
              <button
                key={r}
                className={`srd-chip ${regionsEff.includes(r) ? 'active' : ''}`}
                onClick={() => toggleRegion(r)}
              >{r}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Revenue trend */}
      <div style={{ ...CARD_STYLE, marginBottom: 18, borderLeft: `3px solid ${T.gold}`, borderRadius: '0 6px 6px 0' }}>
        <div style={CARD_TITLE_STYLE}>Revenue trend</div>
        <div style={{ width: '100%', height: 260 }}>
          <ResponsiveContainer>
            <AreaChart data={trendData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={T.gold} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={T.gold} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={T.line} strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="label" stroke={T.muted} fontSize={11} tickLine={false} axisLine={{ stroke: T.line }} />
              <YAxis stroke={T.muted} fontSize={11} tickLine={false} axisLine={false}
                tickFormatter={(v) => fmtCurrency(v, true)} width={60} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="revenue" name="Revenue" stroke={T.gold} fill="url(#revGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top products + category share */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)', gap: 18, marginBottom: 18 }}>
        <div style={CARD_STYLE}>
          <div style={CARD_TITLE_STYLE}>Top-performing products</div>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={topProducts} layout="vertical" margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={T.line} strokeDasharray="2 4" horizontal={false} />
                <XAxis type="number" stroke={T.muted} fontSize={11} tickLine={false} axisLine={{ stroke: T.line }}
                  tickFormatter={(v) => fmtCurrency(v, true)} />
                <YAxis type="category" dataKey="product" stroke={T.muted} fontSize={11.5}
                  tickLine={false} axisLine={false} width={110} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="revenue" name="Revenue" radius={[0, 3, 3, 0]}>
                  {topProducts.map((p, i) => (
                    <Cell key={i} fill={CATEGORY_COLORS[p.category] || T.gold} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div style={CARD_STYLE}>
          <div style={CARD_TITLE_STYLE}>Revenue by category</div>
          <div style={{ width: '100%', height: 200 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={categoryData} dataKey="revenue" nameKey="category" innerRadius={48} outerRadius={78} paddingAngle={2}>
                  {categoryData.map((c, i) => (
                    <Cell key={i} fill={CATEGORY_COLORS[c.category] || T.muted} stroke={T.panel} strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {categoryData.map((c, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: CATEGORY_COLORS[c.category] || T.muted }} />
                  {c.category}
                </span>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: T.muted }}>{c.pct.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Region performance */}
      <div style={{ ...CARD_STYLE, marginBottom: 18 }}>
        <div style={CARD_TITLE_STYLE}>Revenue by region</div>
        <div style={{ width: '100%', height: 180 }}>
          <ResponsiveContainer>
            <BarChart data={regionData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={T.line} strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="region" stroke={T.muted} fontSize={11.5} tickLine={false} axisLine={{ stroke: T.line }} />
              <YAxis stroke={T.muted} fontSize={11} tickLine={false} axisLine={false}
                tickFormatter={(v) => fmtCurrency(v, true)} width={60} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="revenue" name="Revenue" fill={T.blue} radius={[3, 3, 0, 0]} maxBarSize={64} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Product table */}
      <div style={CARD_STYLE}>
        <div style={CARD_TITLE_STYLE}>Product breakdown</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${T.line}` }}>
              <th className="srd-th" onClick={() => toggleSort('product')}
                style={{ textAlign: 'left', padding: '8px 6px', color: T.muted, fontWeight: 500 }}>
                Product {sortKey === 'product' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
              </th>
              <th style={{ textAlign: 'left', padding: '8px 6px', color: T.muted, fontWeight: 500 }}>Category</th>
              <th className="srd-th" onClick={() => toggleSort('units')}
                style={{ textAlign: 'right', padding: '8px 6px', color: T.muted, fontWeight: 500 }}>
                Units {sortKey === 'units' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
              </th>
              <th className="srd-th" onClick={() => toggleSort('revenue')}
                style={{ textAlign: 'right', padding: '8px 6px', color: T.muted, fontWeight: 500 }}>
                Revenue {sortKey === 'revenue' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
              </th>
              <th className="srd-th" onClick={() => toggleSort('share')}
                style={{ textAlign: 'right', padding: '8px 6px', color: T.muted, fontWeight: 500, width: 140 }}>
                Share {sortKey === 'share' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedProducts.map((p, i) => (
              <tr key={i} className="srd-row" style={{ borderBottom: `1px solid ${T.line}` }}>
                <td style={{ padding: '9px 6px', fontWeight: 500 }}>{p.product}</td>
                <td style={{ padding: '9px 6px', color: T.muted }}>{p.category}</td>
                <td style={{ padding: '9px 6px', textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace" }}>{fmtNumber(p.units)}</td>
                <td style={{ padding: '9px 6px', textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace" }}>{fmtCurrency(p.revenue)}</td>
                <td style={{ padding: '9px 6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                    <div style={{ width: 60, height: 5, background: T.panelAlt, borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(100, p.share)}%`, height: '100%', background: CATEGORY_COLORS[p.category] || T.gold }} />
                    </div>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: T.muted, width: 40, textAlign: 'right' }}>
                      {p.share.toFixed(1)}%
                    </span>
                  </div>
                </td>
              </tr>
            ))}
            {sortedProducts.length === 0 && (
              <tr><td colSpan={5} style={{ padding: '20px 6px', textAlign: 'center', color: T.muted }}>
                No rows match the current filters.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div style={{ marginTop: 18, fontSize: 12, color: T.muted, lineHeight: 1.6 }}>
        Showing {filteredData.length.toLocaleString()} records from {monthLabel(startEff)} to {monthLabel(endEff)}.
        {' '}Import a CSV with columns <code style={{ fontFamily: "'IBM Plex Mono', monospace" }}>date, product, category, region, units, revenue</code> (date as YYYY-MM) to analyze your own data.
      </div>
    </div>
  );
}