// Vigil API client — wires window.VIGIL_DATA to the FastAPI backend
(function () {
  'use strict';

  // ── Pub/sub bus ──────────────────────────────────────────────────────────
  window.VIGIL_BUS = (function () {
    const ls = [];
    return {
      subscribe(fn) { ls.push(fn); return () => { const i = ls.indexOf(fn); if (i > -1) ls.splice(i, 1); }; },
      emit() { ls.forEach(fn => { try { fn(); } catch (_) {} }); }
    };
  })();

  // ── Live data store ──────────────────────────────────────────────────────
  window.VIGIL_DATA = {
    ALERTS: [], AGENTS: [], CONNECTORS: [], RULES: [], SUPPRESSIONS: [],
    FEED: [], STATUS: null,
    HUNT_EVENTS: [], HUNT_TIMELINE: [], HUNT_AGGS: { top_processes: [], top_users: [], top_ips: [], top_hosts: [] },
    TIMELINE: [], TOP_RULES: [],
    _apiOk: false,
  };

  const BASE = '/api/v1';
  const H = { Accept: 'application/json' };
  const JH = { ...H, 'Content-Type': 'application/json' };

  // ── Normalizers ──────────────────────────────────────────────────────────
  function normalizeAlert(a) {
    const snap = a.event_snapshot || {};
    return {
      ...a,
      matched_at: new Date(a.matched_at),
      endpoint_id: a.endpoint_id || snap.host || '—',
      event_snapshot: {
        src_ip: '—', dst_ip: '', process: '—', user: '—',
        tactic: '—', cmdline: '', pid: 0,
        ...snap,
        host: a.endpoint_id || snap.host || '—',
      },
    };
  }

  function normalizeAgent(e) {
    const now = Date.now();
    const lastSeen = e.last_seen ? new Date(e.last_seen) : null;
    const secsAgo = lastSeen ? (now - lastSeen.getTime()) / 1000 : Infinity;
    const status = secsAgo < 300 ? 'online' : secsAgo < 3600 ? 'stale' : 'offline';
    const meta = e.metadata || {};
    const si = meta.sys_info || {};
    return {
      id: e.id, name: e.name, hostname: e.hostname, os: e.os || '—',
      ip: e.ip_address || '—',
      ip_history: (e.ip_history || []).map(h => ({
        ip: h.ip_address, first_seen: new Date(h.first_seen), last_seen: new Date(h.last_seen),
      })),
      status, last_seen: lastSeen || new Date(0),
      version: meta.version || meta.agent_version || '—',
      alerts: 0, cpu: si.cpu_usage_pct || 0, ram: si.ram_usage_pct || 0,
      disk_free_gb: si.disk_free_gb || 0,
    };
  }

  function normalizeConnector(c) {
    return {
      ...c,
      last_polled: c.last_polled ? new Date(c.last_polled) : null,
      latency_ms: c.latency_ms || null,
      alerts_imported: c.alerts_imported || 0,
      events_today: c.events_today || 0,
      poll_interval: c.poll_interval || 60,
      created_at: c.created_at ? new Date(c.created_at) : new Date(),
    };
  }

  function normalizeRule(r) {
    return {
      ...r,
      created_at: r.created_at ? new Date(r.created_at) : new Date(),
      updated_at: r.updated_at ? new Date(r.updated_at) : new Date(),
      hits: r.hits || 0,
    };
  }

  function normalizeSuppression(s) {
    return {
      ...s,
      last_hit_at: s.last_hit_at ? new Date(s.last_hit_at) : null,
      created_at: s.created_at ? new Date(s.created_at) : new Date(),
    };
  }

  function computeDerived() {
    const D = window.VIGIL_DATA;

    // Alert counts per agent hostname
    const agentAlertCounts = {};
    D.ALERTS.forEach(a => {
      if (a.endpoint_id && a.status === 'open') {
        agentAlertCounts[a.endpoint_id] = (agentAlertCounts[a.endpoint_id] || 0) + 1;
      }
    });
    D.AGENTS = D.AGENTS.map(a => ({
      ...a,
      alerts: agentAlertCounts[a.hostname] || agentAlertCounts[a.name] || agentAlertCounts[a.id] || 0,
    }));

    // Top rules firing
    const ruleCounts = {};
    D.ALERTS.filter(a => a.status === 'open').forEach(a => {
      if (!ruleCounts[a.rule_name]) ruleCounts[a.rule_name] = { name: a.rule_name, count: 0, sev: a.severity };
      ruleCounts[a.rule_name].count++;
    });
    D.TOP_RULES = Object.values(ruleCounts).sort((a, b) => b.count - a.count).slice(0, 5);

    // 7-day timeline derived from alert timestamps
    const now = new Date();
    const pts = [];
    for (let d = 6; d >= 0; d--) {
      const base = new Date(now);
      base.setDate(base.getDate() - d);
      for (let h = 0; h < 24; h += 3) {
        const slotStart = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h);
        const slotEnd = new Date(slotStart.getTime() + 3 * 3600000);
        const alertsInSlot = D.ALERTS.filter(a =>
          a.matched_at >= slotStart && a.matched_at < slotEnd
        ).length;
        pts.push({ t: slotStart, v: Math.max(alertsInSlot * 50, 10), alerts: alertsInSlot });
      }
    }
    if (pts.length > 0) D.TIMELINE = pts;

    // Default Hunt timeline if empty
    if (D.HUNT_TIMELINE.length === 0) {
      D.HUNT_TIMELINE = Array.from({ length: 24 }, (_, i) => ({
        ts: new Date(Date.now() - (23 - i) * 3600000),
        count: 0
      }));
    }
  }

  // ── Fetch functions ──────────────────────────────────────────────────────
  async function fetchAlerts() {
    try {
      const r = await fetch(`${BASE}/alerts?limit=500`, { headers: H });
      if (r.ok) { const j = await r.json(); window.VIGIL_DATA.ALERTS = (j.alerts || []).map(normalizeAlert); window.VIGIL_DATA._apiOk = true; }
    } catch (e) { console.warn('fetchAlerts:', e); }
  }

  async function fetchAgents() {
    try {
      const r = await fetch(`${BASE}/endpoints`, { headers: H });
      if (r.ok) { const j = await r.json(); window.VIGIL_DATA.AGENTS = (j.endpoints || []).map(normalizeAgent); }
    } catch (e) { console.warn('fetchAgents:', e); }
  }

  async function fetchConnectors() {
    try {
      const r = await fetch(`${BASE}/connectors`, { headers: H });
      if (r.ok) { const j = await r.json(); window.VIGIL_DATA.CONNECTORS = (j.connectors || []).map(normalizeConnector); }
    } catch (e) { console.warn('fetchConnectors:', e); }
  }

  async function fetchRules() {
    try {
      const r = await fetch(`${BASE}/detections`, { headers: H });
      if (r.ok) { const j = await r.json(); window.VIGIL_DATA.RULES = (j.rules || []).map(normalizeRule); }
    } catch (e) { console.warn('fetchRules:', e); }
  }

  async function fetchSuppressions() {
    try {
      const r = await fetch(`${BASE}/suppressions?include_disabled=true`, { headers: H });
      if (r.ok) { const j = await r.json(); window.VIGIL_DATA.SUPPRESSIONS = (j.suppressions || []).map(normalizeSuppression); }
    } catch (e) { console.warn('fetchSuppressions:', e); }
  }

  async function fetchFeed() {
    try {
      const r = await fetch(`${BASE}/feed/alerts?limit=100`, { headers: H });
      if (r.ok) {
        const j = await r.json();
        const incoming = (j.alerts || []).map(a => ({ ...a, detected_at: new Date(a.detected_at) }));
        // Merge with existing feed — dedupe by native_id
        const existing = window.VIGIL_DATA.FEED;
        const ids = new Set(incoming.map(a => a.native_id));
        const merged = [...incoming, ...existing.filter(a => !ids.has(a.native_id))].slice(0, 300);
        window.VIGIL_DATA.FEED = merged;
      }
    } catch (e) { console.warn('fetchFeed:', e); }
  }

  async function fetchStatus() {
    try {
      const r = await fetch(`${BASE}/status`, { headers: H });
      if (r.ok) { window.VIGIL_DATA.STATUS = await r.json(); window.VIGIL_DATA._apiOk = true; }
    } catch (e) { console.warn('fetchStatus:', e); window.VIGIL_DATA._apiOk = false; }
  }

  async function refreshAll() {
    await Promise.all([fetchAlerts(), fetchAgents(), fetchConnectors(), fetchRules(), fetchSuppressions(), fetchFeed(), fetchStatus()]);
    computeDerived();
    window.VIGIL_BUS.emit();
  }

  // ── Mutation API ─────────────────────────────────────────────────────────
  window.VIGIL_API = {
    refreshAll, fetchAlerts, fetchAgents, fetchConnectors, fetchRules, fetchSuppressions, fetchFeed,

    async acknowledgeAlert(id, note) {
      const r = await fetch(`${BASE}/alerts/${id}/acknowledge`, { method: 'POST', headers: JH, body: JSON.stringify({ note: note || null }) });
      if (r.ok) { await fetchAlerts(); computeDerived(); window.VIGIL_BUS.emit(); }
      return r.ok;
    },

    async batchAlerts(ids, action, note) {
      const r = await fetch(`${BASE}/alerts/batch`, { method: 'POST', headers: JH, body: JSON.stringify({ ids, action, note: note || null }) });
      if (r.ok) { await fetchAlerts(); computeDerived(); window.VIGIL_BUS.emit(); }
      return r.ok;
    },

    async toggleRule(id, enabled) {
      // Optimistic
      window.VIGIL_DATA.RULES = window.VIGIL_DATA.RULES.map(r => r.id === id ? { ...r, enabled } : r);
      window.VIGIL_BUS.emit();
      const r = await fetch(`${BASE}/detections/${id}`, { method: 'PATCH', headers: JH, body: JSON.stringify({ enabled }) });
      if (!r.ok) { await fetchRules(); window.VIGIL_BUS.emit(); }
      return r.ok;
    },

    async createSuppression(body) {
      const r = await fetch(`${BASE}/suppressions`, { method: 'POST', headers: JH, body: JSON.stringify(body) });
      if (r.ok) { const s = normalizeSuppression(await r.json()); window.VIGIL_DATA.SUPPRESSIONS = [s, ...window.VIGIL_DATA.SUPPRESSIONS]; window.VIGIL_BUS.emit(); return s; }
      return null;
    },

    async toggleSuppression(id, enabled) {
      window.VIGIL_DATA.SUPPRESSIONS = window.VIGIL_DATA.SUPPRESSIONS.map(s => s.id === id ? { ...s, enabled } : s);
      window.VIGIL_BUS.emit();
      const r = await fetch(`${BASE}/suppressions/${id}`, { method: 'PATCH', headers: JH, body: JSON.stringify({ enabled }) });
      if (!r.ok) { await fetchSuppressions(); window.VIGIL_BUS.emit(); }
      return r.ok;
    },

    async deleteSuppression(id) {
      window.VIGIL_DATA.SUPPRESSIONS = window.VIGIL_DATA.SUPPRESSIONS.filter(s => s.id !== id);
      window.VIGIL_BUS.emit();
      const r = await fetch(`${BASE}/suppressions/${id}`, { method: 'DELETE', headers: H });
      if (!r.ok) { await fetchSuppressions(); window.VIGIL_BUS.emit(); }
      return r.ok;
    },

    async createConnector(body) {
      const r = await fetch(`${BASE}/connectors`, { method: 'POST', headers: JH, body: JSON.stringify(body) });
      if (r.ok) { const c = normalizeConnector(await r.json()); window.VIGIL_DATA.CONNECTORS = [...window.VIGIL_DATA.CONNECTORS, c]; window.VIGIL_BUS.emit(); return c; }
      return null;
    },

    async testConnector(id) {
      try {
        const r = await fetch(`${BASE}/connectors/${id}/test`, { method: 'POST', headers: H });
        if (r.ok) return await r.json();
      } catch {}
      return { ok: false, message: 'Test failed', connector_id: id, latency_ms: null };
    },

    async deleteConnector(id) {
      window.VIGIL_DATA.CONNECTORS = window.VIGIL_DATA.CONNECTORS.filter(c => c.id !== id);
      window.VIGIL_BUS.emit();
      await fetch(`${BASE}/connectors/${id}`, { method: 'DELETE', headers: H });
    },

    async queueCommand(endpointId, command) {
      const r = await fetch(`${BASE}/endpoints/${endpointId}/commands`, { method: 'POST', headers: JH, body: JSON.stringify({ command }) });
      return r.ok;
    },

    async hunt(q) {
      const from = new Date(Date.now() - 24 * 3600000).toISOString();
      const params = new URLSearchParams({ q: q || '', limit: 100, from_time: from });
      const r = await fetch(`${BASE}/hunt?${params}`, { headers: H });
      if (!r.ok) throw new Error('Hunt failed');
      const j = await r.json();
      if (j.timeline?.length) {
        window.VIGIL_DATA.HUNT_TIMELINE = j.timeline.map(t => ({ ...t, ts: new Date(t.ts) }));
      }
      // Client-side aggregations from returned events
      const evts = j.events || [];
      const countField = (fn) => {
        const map = {};
        evts.forEach(e => { const v = fn(e) || '—'; map[v] = (map[v] || 0) + 1; });
        return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([value, count]) => ({ value, count }));
      };
      window.VIGIL_DATA.HUNT_AGGS = {
        top_processes: countField(e => e.event?.process),
        top_users: countField(e => e.event?.user),
        top_ips: countField(e => e.event?.src_ip),
        top_hosts: countField(e => e.event?.host),
      };
      return { ...j, events: evts.map(e => ({ ...e, timestamp: new Date(e.timestamp) })) };
    },
  };

  // ── AI integration ───────────────────────────────────────────────────────
  window.vigilAI = async (prompt) => {
    const aiUrl = window.__vigilConfig && window.__vigilConfig.aiUrl;
    if (aiUrl) {
      try {
        const r = await fetch(`${aiUrl}/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) });
        if (r.ok) { const j = await r.json(); return j.response || j.text || j.content || ''; }
      } catch (_) {}
    }
    throw new Error('AI agent not configured — set VIGIL_AI_AGENT_URL');
  };
  window.claude = { complete: window.vigilAI };

  // ── Bootstrap + polling ──────────────────────────────────────────────────
  refreshAll();
  setInterval(() => Promise.all([fetchAlerts(), fetchAgents()]).then(() => { computeDerived(); window.VIGIL_BUS.emit(); }), 30000);
  setInterval(() => Promise.all([fetchConnectors(), fetchStatus()]).then(() => window.VIGIL_BUS.emit()), 60000);
  setInterval(() => fetchFeed().then(() => window.VIGIL_BUS.emit()), 10000);

})();
