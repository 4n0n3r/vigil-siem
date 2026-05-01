// ── Hunt View ───────────────────────────────────────────────────────────────
(function(){
const {useState, useRef} = React;

// ── History helpers ──────────────────────────────────────────────────────────
const HIST_KEY = 'vigil_hunt_history';
const MAX_HIST = 30;

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); }
  catch { return []; }
}

function addHistoryEntry(q, count, ms) {
  const prev = loadHistory();
  const existing = prev.find(e => e.q === q);
  const filtered = prev.filter(e => e.q !== q);
  const entry = { q, ts: Date.now(), count, ms, runs: (existing ? existing.runs : 0) + 1 };
  const next = [entry, ...filtered].slice(0, MAX_HIST);
  localStorage.setItem(HIST_KEY, JSON.stringify(next));
  return next;
}

function topQueries(entries) {
  return [...entries].sort((a, b) => b.runs - a.runs).slice(0, 10);
}

function relTimeMs(ts) {
  const d = Date.now() - ts;
  if (d < 60000) return 'just now';
  if (d < 3600000) return Math.floor(d / 60000) + 'm ago';
  if (d < 86400000) return Math.floor(d / 3600000) + 'h ago';
  return Math.floor(d / 86400000) + 'd ago';
}

// ── Builder definitions ───────────────────────────────────────────────────────
const BUILDER_FIELDS = [
  { label: 'Event ID',       hql: 'event_id' },
  { label: 'Source',         hql: 'source' },
  { label: 'Subject User',   hql: 'event_data.SubjectUserName' },
  { label: 'Target User',    hql: 'event_data.TargetUserName' },
  { label: 'IP Address',     hql: 'event_data.IpAddress' },
  { label: 'Process',        hql: 'event_data.NewProcessName' },
  { label: 'Parent Process', hql: 'event_data.ParentProcessName' },
  { label: 'Command Line',   hql: 'event_data.CommandLine' },
  { label: 'Logon Type',     hql: 'event_data.LogonType' },
  { label: 'Workstation',    hql: 'event_data.WorkstationName' },
  { label: 'Domain',         hql: 'event_data.SubjectDomainName' },
];

const BUILDER_OPS = [
  { label: '=',           apply: (f, v) => `${f}:${v}` },
  { label: '!=',          apply: (f, v) => `NOT ${f}:${v}` },
  { label: 'contains',    apply: (f, v) => `${f}:*${v}*` },
  { label: 'starts with', apply: (f, v) => `${f}:${v}*` },
  { label: 'ends with',   apply: (f, v) => `${f}:*${v}` },
];

const FIELD_HINTS = [
  'event_id:',
  'source:winlog:',
  'source:journald:',
  'source:syslog:',
  'event_data.SubjectUserName:',
  'event_data.TargetUserName:',
  'event_data.IpAddress:',
  'event_data.NewProcessName:',
  'event_data.CommandLine:',
  'event_data.LogonType:',
  'NOT ',
];

const QUICK_HUNTS = [
  { label: 'Failed Logon',       q: 'event_id:4625' },
  { label: 'Explicit Creds',     q: 'event_id:4648' },
  { label: 'Process Create',     q: 'event_id:4688' },
  { label: 'Brute Force',        q: 'event_id:(4625 OR 4771)' },
  { label: 'PowerShell',         q: 'event_data.NewProcessName:*powershell*' },
  { label: 'Cmd.exe',            q: 'event_data.NewProcessName:*cmd.exe*' },
  { label: 'Windows Security',   q: 'source:winlog:Security' },
  { label: 'Linux Auth',         q: 'source:journald' },
];

function clausesToHQL(clauses) {
  const parts = clauses
    .filter(c => c.value.trim())
    .map((c, i) => {
      const op = BUILDER_OPS[c.opIdx] || BUILDER_OPS[0];
      const expr = op.apply(c.field, c.value.trim());
      return i === 0 ? expr : `${c.conn} ${expr}`;
    });
  return parts.join(' ');
}

function buildSummary(ev) {
  if (!ev) return '—';
  const ed = ev.event_data || {};
  const parts = [];
  const ok = v => v && v !== '-' && !String(v).endsWith('$');
  if (ok(ed.SubjectUserName)) parts.push(ed.SubjectUserName);
  if (ok(ed.TargetUserName))  parts.push('→' + ed.TargetUserName);
  if (ok(ed.IpAddress))       parts.push(ed.IpAddress);
  if (ok(ed.NewProcessName))  parts.push(String(ed.NewProcessName).split(/[/\\]/).pop());
  else if (ok(ed.CommandLine)) parts.push(String(ed.CommandLine).slice(0, 45));
  // flat fields from drain/connector events
  if (ok(ev.process)) parts.push(ev.process);
  if (ok(ev.user))    parts.push(ev.user);
  if (ok(ev.src_ip))  parts.push(ev.src_ip);
  const s = parts.slice(0, 3).join(' | ');
  return s.length > 80 ? s.slice(0, 77) + '…' : s || '—';
}

// ── Component ────────────────────────────────────────────────────────────────
function HuntView() {
  const T = useT();

  const [mode, setMode]             = useState('hql');
  const [query, setQuery]           = useState('');
  const [submitted, setSubmitted]   = useState('');
  const [results, setResults]       = useState(null);
  const [loading, setLoading]       = useState(false);
  const [expandedRow, setExpandedRow] = useState(null);
  const [hint, setHint]             = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory]       = useState(loadHistory);
  const inputRef = useRef(null);

  // Builder state
  const [clauses, setClauses] = useState([
    { id: 1, field: 'event_id', opIdx: 0, value: '', conn: 'AND' },
  ]);

  // AI state
  const [aiInput, setAiInput]       = useState('');
  const [aiLoading, setAiLoading]   = useState(false);
  const [aiGenerated, setAiGenerated] = useState('');

  const runSearch = async (q) => {
    const sq = (q !== undefined ? q : query).trim();
    if (!sq) return;
    setSubmitted(sq);
    setLoading(true);
    setResults(null);
    setExpandedRow(null);
    try {
      const r = await window.VIGIL_API.hunt(sq);
      setResults(r);
      const next = addHistoryEntry(sq, r.total || 0, r.query_time_ms || 0);
      setHistory(next);
    } catch {
      setResults({ events: [], total: 0, query_time_ms: 0, query: sq });
    }
    setLoading(false);
  };

  const runBuilderQuery = () => {
    const q = clausesToHQL(clauses);
    if (!q.trim()) return;
    setQuery(q);
    setMode('hql');
    runSearch(q);
  };

  const askAI = async () => {
    if (!aiInput.trim()) return;
    setAiLoading(true);
    setAiGenerated('');
    try {
      const r = await window.vigilAI(
        `You are a SIEM threat hunting expert. Convert the following request into a Vigil HQL query.\n\n` +
        `HQL syntax rules:\n` +
        `- field:value matches exactly (e.g. event_id:4625)\n` +
        `- Wildcards: event_data.IpAddress:10.0.*\n` +
        `- Implicit AND: adjacent terms (e.g. event_id:4625 event_data.LogonType:3)\n` +
        `- Explicit boolean: event_id:4625 AND event_data.LogonType:3\n` +
        `- OR: event_id:(4625 OR 4648)\n` +
        `- Negation: NOT event_data.SubjectUserName:SYSTEM\n\n` +
        `Available fields: event_id, source, event_data.SubjectUserName, event_data.TargetUserName, ` +
        `event_data.IpAddress, event_data.NewProcessName, event_data.ParentProcessName, ` +
        `event_data.CommandLine, event_data.LogonType, event_data.WorkstationName\n\n` +
        `Request: "${aiInput}"\n\nRespond with ONLY the HQL query string, no explanation.`
      );
      setAiGenerated(r.trim().replace(/^["'`]|["'`]$/g, '').trim());
    } catch {
      setAiGenerated('');
    }
    setAiLoading(false);
  };

  const handleInput = (e) => {
    const v = e.target.value;
    setQuery(v);
    const last = v.split(/\s+/).pop() || '';
    const match = FIELD_HINTS.find(h => h.startsWith(last) && last.length > 0 && h !== last);
    setHint(match || null);
  };

  const handleKey = (e) => {
    if (e.key === 'Enter') runSearch();
    if (e.key === 'Tab' && hint) {
      e.preventDefault();
      setQuery(q => q.replace(/\S*$/, hint));
      setHint(null);
    }
    if (e.key === 'Escape') setHint(null);
  };

  const fmtTime = d => new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  const tl = window.VIGIL_DATA.HUNT_TIMELINE || [];
  const tlMax = Math.max(...tl.map(t => t.count), 1);
  const top = topQueries(history);

  const modeBtn = (id, label) => ({
    onClick: () => setMode(id),
    style: {
      fontSize: 10, fontFamily: 'Space Grotesk', fontWeight: mode === id ? 600 : 400,
      color: mode === id ? T.bg : T.txm,
      background: mode === id ? T.cyan : 'transparent',
      border: `1px solid ${mode === id ? T.cyan : T.bd}`,
      borderRadius: 5, padding: '4px 12px', cursor: 'pointer', transition: 'all .12s',
    },
  });

  const inputStyle = {
    fontFamily: 'JetBrains Mono', fontSize: 11, background: T.bg,
    border: T.cardBorder, borderRadius: 5, color: T.tx, padding: '5px 10px', outline: 'none',
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 14, gap: 10 }}>

      {/* ── Query Card ── */}
      <Card style={{ padding: 16, flexShrink: 0 }}>

        {/* Mode tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          <button {...modeBtn('hql', 'HQL')}>HQL</button>
          <button {...modeBtn('builder', 'Builder')}>⊞ Query Builder</button>
          <button {...modeBtn('ai', 'AI')}>✦ AI Assist</button>
        </div>

        {/* ── HQL mode ── */}
        {mode === 'hql' && (<>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center',
            background: T.bg, border: `1px solid ${T.cyan}44`, borderRadius: 8, padding: '2px 4px 2px 12px',
            boxShadow: `0 0 0 3px ${T.cyan}08` }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.cyan} strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input ref={inputRef} value={query} onChange={handleInput} onKeyDown={handleKey}
              placeholder="event_id:4625   event_data.IpAddress:10.0.*   source:winlog:Security"
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: T.tx,
                fontFamily: 'JetBrains Mono', fontSize: 12, padding: '8px 0', lineHeight: 1 }}/>
            {hint && (
              <span style={{ fontSize: 10, color: T.txm, fontFamily: 'JetBrains Mono', flexShrink: 0 }}>
                Tab→ <span style={{ color: T.cyan }}>{hint}</span>
              </span>
            )}
            <button onClick={() => setShowHistory(h => !h)} title="Query history"
              style={{ background: showHistory ? T.cyan + '22' : 'transparent',
                border: `1px solid ${showHistory ? T.cyan + '44' : 'transparent'}`,
                borderRadius: 5, padding: '5px 8px', cursor: 'pointer',
                color: showHistory ? T.cyan : T.txm, fontSize: 13, lineHeight: 1 }}>⏱</button>
            <button onClick={() => runSearch()} disabled={loading}
              style={{ fontFamily: 'Space Grotesk', fontWeight: 600, fontSize: 12, color: T.bg,
                background: T.cyan, border: 'none', borderRadius: 6, padding: '7px 18px',
                cursor: 'pointer', flexShrink: 0, opacity: loading ? 0.6 : 1 }}>
              {loading ? 'Hunting…' : 'Hunt'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: T.txm, fontFamily: 'Space Grotesk', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '.09em', marginRight: 2 }}>Quick:</span>
            {QUICK_HUNTS.map(({ label, q }) => (
              <button key={label} onClick={() => { setQuery(q); runSearch(q); }}
                style={{ fontSize: 10, fontFamily: 'JetBrains Mono', color: T.txm,
                  background: T.el, border: T.cardBorder, borderRadius: 5, padding: '3px 9px',
                  cursor: 'pointer', transition: 'all .12s' }}
                onMouseEnter={e => { e.currentTarget.style.color = T.cyan; e.currentTarget.style.borderColor = T.cyan + '55'; }}
                onMouseLeave={e => { e.currentTarget.style.color = T.txm; e.currentTarget.style.borderColor = ''; }}>
                {label}
              </button>
            ))}
          </div>
        </>)}

        {/* ── Builder mode ── */}
        {mode === 'builder' && (
          <div>
            {clauses.map((cl, i) => (
              <div key={cl.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 7 }}>
                {i > 0 ? (
                  <select value={cl.conn}
                    onChange={e => setClauses(cs => cs.map(c => c.id === cl.id ? { ...c, conn: e.target.value } : c))}
                    style={{ ...inputStyle, width: 62, color: T.cyan, fontWeight: 600, textAlign: 'center' }}>
                    <option>AND</option><option>OR</option>
                  </select>
                ) : <div style={{ width: 62 }}/>}
                <select value={cl.field}
                  onChange={e => setClauses(cs => cs.map(c => c.id === cl.id ? { ...c, field: e.target.value } : c))}
                  style={{ ...inputStyle, flex: 1.5 }}>
                  {BUILDER_FIELDS.map(f => <option key={f.hql} value={f.hql}>{f.label}</option>)}
                </select>
                <select value={cl.opIdx}
                  onChange={e => setClauses(cs => cs.map(c => c.id === cl.id ? { ...c, opIdx: parseInt(e.target.value) } : c))}
                  style={{ ...inputStyle, width: 110 }}>
                  {BUILDER_OPS.map((op, idx) => <option key={idx} value={idx}>{op.label}</option>)}
                </select>
                <input value={cl.value} placeholder="value"
                  onChange={e => setClauses(cs => cs.map(c => c.id === cl.id ? { ...c, value: e.target.value } : c))}
                  onKeyDown={e => e.key === 'Enter' && runBuilderQuery()}
                  style={{ ...inputStyle, flex: 2 }}/>
                {clauses.length > 1 && (
                  <button onClick={() => setClauses(cs => cs.filter(c => c.id !== cl.id))}
                    style={{ background: 'none', border: 'none', color: T.txm, cursor: 'pointer', fontSize: 18, padding: '0 2px', lineHeight: 1 }}>×</button>
                )}
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
              <button
                onClick={() => setClauses(cs => [...cs, { id: Date.now(), field: 'event_id', opIdx: 0, value: '', conn: 'AND' }])}
                style={{ fontSize: 10, fontFamily: 'Space Grotesk', color: T.cyan,
                  background: T.cyan + '14', border: `1px solid ${T.cyan}33`,
                  borderRadius: 5, padding: '4px 12px', cursor: 'pointer' }}>+ clause</button>
              {clausesToHQL(clauses) && (
                <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono', color: T.txm,
                  flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  → <span style={{ color: T.cyan }}>{clausesToHQL(clauses)}</span>
                </span>
              )}
              <button onClick={runBuilderQuery} disabled={!clausesToHQL(clauses) || loading}
                style={{ fontFamily: 'Space Grotesk', fontWeight: 600, fontSize: 12, color: T.bg,
                  background: T.cyan, border: 'none', borderRadius: 6, padding: '7px 16px',
                  cursor: 'pointer', opacity: (!clausesToHQL(clauses) || loading) ? 0.6 : 1 }}>
                Hunt
              </button>
            </div>
          </div>
        )}

        {/* ── AI Assist mode ── */}
        {mode === 'ai' && (
          <div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={aiInput} onChange={e => setAiInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && aiInput.trim() && askAI()}
                placeholder="e.g. find lateral movement from external IPs, or brute force on admin accounts"
                style={{ ...inputStyle, flex: 1, padding: '8px 12px', fontFamily: 'Inter', fontSize: 12 }}/>
              <button onClick={askAI} disabled={!aiInput.trim() || aiLoading}
                style={{ fontFamily: 'Space Grotesk', fontWeight: 600, fontSize: 11, color: T.cyan,
                  background: T.cyan + '14', border: `1px solid ${T.cyan}33`, borderRadius: 6,
                  padding: '8px 16px', cursor: 'pointer', whiteSpace: 'nowrap',
                  opacity: (!aiInput.trim() || aiLoading) ? 0.5 : 1 }}>
                {aiLoading ? 'Thinking…' : 'Generate →'}
              </button>
            </div>
            {aiGenerated && (
              <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center',
                background: T.bg, border: `1px solid ${T.cyan}33`, borderRadius: 6, padding: '8px 12px' }}>
                <span style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: T.cyan, flex: 1 }}>{aiGenerated}</span>
                <button onClick={() => { setQuery(aiGenerated); setMode('hql'); runSearch(aiGenerated); }}
                  style={{ fontFamily: 'Space Grotesk', fontWeight: 600, fontSize: 11, color: T.bg,
                    background: T.cyan, border: 'none', borderRadius: 5, padding: '5px 14px', cursor: 'pointer' }}>
                  Run →
                </button>
              </div>
            )}
            {!aiGenerated && !aiLoading && (
              <p style={{ fontSize: 11, color: T.txm, marginTop: 8, fontFamily: 'Inter' }}>
                Describe what you want to hunt in plain English. Requires AI agent (set VIGIL_AI_AGENT_URL).
              </p>
            )}
          </div>
        )}
      </Card>

      {/* ── History + Timeline row ── */}
      <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>

        {/* History panel — shown when toggled or auto-shown if history exists */}
        {showHistory && (
          <Card style={{ width: 310, flexShrink: 0, padding: 14, maxHeight: 230, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexShrink: 0 }}>
              <span style={{ fontSize: 9, fontFamily: 'Space Grotesk', fontWeight: 700, color: T.txm,
                textTransform: 'uppercase', letterSpacing: '.1em' }}>Query History</span>
              {history.length > 0 && (
                <button onClick={() => { localStorage.removeItem(HIST_KEY); setHistory([]); }}
                  style={{ fontSize: 9, color: T.txm, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Clear</button>
              )}
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {history.length === 0 && (
                <p style={{ fontSize: 11, color: T.txm, fontFamily: 'Inter' }}>No queries yet.</p>
              )}
              {history.slice(0, 12).map((entry, i) => (
                <div key={i} onClick={() => { setQuery(entry.q); setMode('hql'); runSearch(entry.q); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 5px',
                    borderRadius: 5, cursor: 'pointer', marginBottom: 1 }}
                  onMouseEnter={e => e.currentTarget.style.background = T.el}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: T.tx,
                    flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.q}</span>
                  <span style={{ fontSize: 9, color: T.cyan, flexShrink: 0, fontFamily: 'JetBrains Mono' }}>{entry.count}</span>
                  <span style={{ fontSize: 9, color: T.txm, flexShrink: 0, fontFamily: 'Inter' }}>{relTimeMs(entry.ts)}</span>
                </div>
              ))}

              {top.length > 0 && (
                <>
                  <div style={{ fontSize: 9, fontFamily: 'Space Grotesk', fontWeight: 700, color: T.txm,
                    textTransform: 'uppercase', letterSpacing: '.1em', margin: '10px 0 5px' }}>Top Queries</div>
                  {top.slice(0, 5).map((entry, i) => (
                    <div key={i} onClick={() => { setQuery(entry.q); setMode('hql'); runSearch(entry.q); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 5px',
                        borderRadius: 5, cursor: 'pointer', marginBottom: 1 }}
                      onMouseEnter={e => e.currentTarget.style.background = T.el}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <span style={{ fontSize: 9, fontFamily: 'JetBrains Mono', color: T.cyan, width: 14, flexShrink: 0 }}>{i + 1}.</span>
                      <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: T.tx,
                        flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.q}</span>
                      <span style={{ fontSize: 9, color: T.txm, flexShrink: 0 }}>×{entry.runs}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </Card>
        )}

        {/* Event frequency timeline */}
        <Card style={{ flex: 1, padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontFamily: 'Space Grotesk', fontWeight: 600, fontSize: 12, color: T.tx }}>Event Frequency — Last 24h</span>
            <span style={{ fontSize: 10, color: T.txm, fontFamily: 'JetBrains Mono' }}>
              {tl.reduce((s, t) => s + t.count, 0).toLocaleString()} events
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 48 }}>
            {tl.map((h, i) => {
              const pct = (h.count / tlMax) * 100;
              const isHigh = pct > 70;
              return (
                <div key={i} title={`${h.count.toLocaleString()} events`}
                  style={{ flex: 1, height: `${Math.max(pct, 4)}%`, borderRadius: '2px 2px 0 0',
                    background: isHigh ? T.red : T.cyan, opacity: isHigh ? 0.9 : 0.5,
                    transition: 'all .2s', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                  onMouseLeave={e => e.currentTarget.style.opacity = isHigh ? '0.9' : '0.5'}/>
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            {[0, 4, 8, 12, 16, 20, 23].map(h => (
              <span key={h} style={{ fontSize: 8, color: T.txm, fontFamily: 'JetBrains Mono' }}>
                {String(h).padStart(2, '0')}:00
              </span>
            ))}
          </div>
        </Card>
      </div>

      {/* ── Results ── */}
      {(results || loading) && (
        <div style={{ display: 'flex', gap: 10, flex: 1, minHeight: 0 }}>
          <Card style={{ flex: 1, overflow: 'hidden', padding: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '10px 16px', borderBottom: T.cardBorder, flexShrink: 0, display: 'flex', gap: 10, alignItems: 'center' }}>
              {loading ? (
                <span style={{ fontSize: 12, color: T.txm, fontFamily: 'JetBrains Mono' }}>Hunting…</span>
              ) : (
                <>
                  <span style={{ fontFamily: 'Space Grotesk', fontWeight: 600, fontSize: 13, color: T.tx }}>Results</span>
                  <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: T.txm }}>
                    {results.total} events · {results.query_time_ms}ms
                  </span>
                  <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: T.cyan,
                    background: T.cyan + '10', border: `1px solid ${T.cyan}33`, borderRadius: 4,
                    padding: '2px 8px', marginLeft: 'auto', maxWidth: 400,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {submitted}
                  </span>
                </>
              )}
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {loading && (
                <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[1, 2, 3].map(i => <div key={i} className="shimmer-line" style={{ height: 36, borderRadius: 6 }}/>)}
                </div>
              )}
              {results && results.events.length === 0 && (
                <div style={{ padding: 40, textAlign: 'center', color: T.txm, fontSize: 12, fontFamily: 'Inter' }}>
                  No events matched <span style={{ fontFamily: 'JetBrains Mono', color: T.cyan }}>"{submitted}"</span>
                  <br/>
                  <span style={{ fontSize: 10, marginTop: 8, display: 'block', lineHeight: 1.8 }}>
                    HQL fields: <span style={{ fontFamily: 'JetBrains Mono', color: T.cyan }}>event_id:4625</span> &nbsp;
                    <span style={{ fontFamily: 'JetBrains Mono', color: T.cyan }}>event_data.IpAddress:10.0.*</span> &nbsp;
                    <span style={{ fontFamily: 'JetBrains Mono', color: T.cyan }}>source:winlog:Security</span>
                  </span>
                </div>
              )}
              {results && results.events.map((e, i) => (
                <div key={e.id || i}>
                  <div onClick={() => setExpandedRow(expandedRow === (e.id || i) ? null : (e.id || i))}
                    style={{ display: 'grid', gridTemplateColumns: '80px 110px 60px 1fr',
                      padding: '7px 16px', cursor: 'pointer', transition: 'background .1s',
                      borderBottom: T.cardBorder,
                      background: expandedRow === (e.id || i) ? T.el : 'transparent' }}
                    onMouseEnter={ev => ev.currentTarget.style.background = T.el}
                    onMouseLeave={ev => ev.currentTarget.style.background = expandedRow === (e.id || i) ? T.el : 'transparent'}>
                    <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: T.txm, alignSelf: 'center' }}>
                      {fmtTime(e.timestamp)}
                    </span>
                    <span style={{ fontSize: 10, color: T.txm, alignSelf: 'center',
                      fontFamily: 'JetBrains Mono', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.source}
                    </span>
                    <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: T.tx, alignSelf: 'center' }}>
                      {(e.event && (e.event.event_id || e.event.eventId)) || '—'}
                    </span>
                    <span style={{ fontSize: 11, color: T.txm, alignSelf: 'center',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      fontFamily: 'JetBrains Mono' }}>
                      {buildSummary(e.event)}
                    </span>
                  </div>
                  {expandedRow === (e.id || i) && (
                    <div style={{ padding: '10px 16px 12px', background: T.bg, borderBottom: T.cardBorder }}>
                      <pre style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: T.cyan,
                        background: T.card, border: T.cardBorder, borderRadius: 8, padding: 12,
                        overflow: 'auto', maxHeight: 200, lineHeight: 1.6, margin: 0 }}>
{JSON.stringify(e.event, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>

          {/* Aggregation sidebar */}
          <div style={{ width: 200, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>
            {[['Processes', 'top_processes'], ['Users', 'top_users'], ['IPs', 'top_ips'], ['Hosts', 'top_hosts']].map(([title, key]) => {
              const items = (window.VIGIL_DATA.HUNT_AGGS[key] || []).slice(0, 5);
              const max = items[0]?.count || 1;
              return (
                <Card key={key} style={{ padding: 10 }}>
                  <div style={{ fontFamily: 'Space Grotesk', fontWeight: 600, fontSize: 10, color: T.tx, marginBottom: 6 }}>{title}</div>
                  {items.length === 0 && <p style={{ fontSize: 9, color: T.txm, fontFamily: 'JetBrains Mono' }}>—</p>}
                  {items.map((item, i) => (
                    <div key={i} style={{ marginBottom: 5, cursor: 'pointer' }}
                      onClick={() => {
                        const f = key.replace('top_', '').replace(/s$/, '');
                        setQuery(q => (q + ' ' + f + ':' + item.value).trim());
                        setMode('hql');
                      }}
                      title="Click to add to query">
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                        <span style={{ fontSize: 9, fontFamily: 'JetBrains Mono', color: T.tx,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '75%' }}>{item.value}</span>
                        <span style={{ fontSize: 9, fontFamily: 'JetBrains Mono', color: T.cyan, flexShrink: 0 }}>{item.count}</span>
                      </div>
                      <div style={{ height: 2, background: T.bd, borderRadius: 1 }}>
                        <div style={{ width: `${(item.count / max) * 100}%`, height: '100%', background: T.cyan + '88', borderRadius: 1 }}/>
                      </div>
                    </div>
                  ))}
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

window.HuntView = HuntView;
})();
