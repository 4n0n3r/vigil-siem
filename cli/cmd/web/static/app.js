/* Vigil SIEM — Single-Page App
 * Hash router: #/ → Dashboard, #/alerts → Alerts,
 *              #/alerts/:id → Alert detail, #/detections → Detections
 *              #/agents → Agents, #/agents/:id → Agent detail
 *              #/connectors → Connectors, #/feed → Live Feed
 */
'use strict';

// ---------------------------------------------------------------------------
// API client + short-lived GET cache
// ---------------------------------------------------------------------------

const _cache = new Map();
const CACHE_TTL = 20_000;

async function api(path, opts = {}) {
  const isGet = !opts.method || opts.method === 'GET';

  if (isGet) {
    const hit = _cache.get(path);
    if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data;
  }

  const resp = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  if (!resp.ok) {
    let msg = resp.statusText;
    try { const e = await resp.json(); msg = e.message || e.error_code || msg; } catch (_) {}
    throw new Error(msg);
  }
  const data = await resp.json();
  if (isGet) _cache.set(path, { data, ts: Date.now() });
  return data;
}

async function apiDelete(path) {
  const resp = await fetch('/api' + path, { method: 'DELETE' });
  if (!resp.ok && resp.status !== 204) {
    let msg = resp.statusText;
    try { const e = await resp.json(); msg = e.message || e.error_code || msg; } catch (_) {}
    throw new Error(msg);
  }
  invalidateCache();
}

function invalidateCache(prefix) {
  for (const key of _cache.keys()) {
    if (!prefix || key.startsWith(prefix)) _cache.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Toast notifications
// ---------------------------------------------------------------------------

function toast(msg, isErr = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (isErr ? ' err' : '');
  setTimeout(() => { el.className = 'toast hidden'; }, 3500);
}

// ---------------------------------------------------------------------------
// Sidebar — collapse toggle + init
// ---------------------------------------------------------------------------

(function initSidebar() {
  const sidebar = document.getElementById('sidebar');
  const main    = document.getElementById('main-area');
  const toggle  = document.getElementById('sidebar-toggle');

  // Restore persisted collapsed state.
  if (localStorage.getItem('sidebar-collapsed') === 'true') {
    sidebar.classList.add('collapsed');
    main.classList.add('sidebar-collapsed');
  }

  toggle.addEventListener('click', () => {
    const isNowCollapsed = sidebar.classList.toggle('collapsed');
    main.classList.toggle('sidebar-collapsed', isNowCollapsed);
    localStorage.setItem('sidebar-collapsed', isNowCollapsed);
  });
})();

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const app = document.getElementById('app');

const PAGE_TITLES = {
  '/':           'Dashboard',
  '/alerts':     'Alerts',
  '/agents':     'Agents',
  '/detections': 'Detection Rules',
  '/connectors': 'Connectors',
  '/feed':       'Live Feed',
};

function route() {
  const hash = location.hash.replace(/^#/, '') || '/';

  // Sidebar active link.
  document.querySelectorAll('.sidebar-link').forEach(a => {
    const r = a.dataset.route;
    a.classList.toggle('active',
      r === '/' ? hash === '/' : hash.startsWith(r));
  });

  // Topbar page title.
  const titleEl = document.getElementById('topbar-title');
  if (titleEl) {
    let title = 'Vigil';
    for (const [prefix, label] of Object.entries(PAGE_TITLES)) {
      if (prefix === '/' ? hash === '/' : hash.startsWith(prefix)) {
        title = label;
        break;
      }
    }
    titleEl.textContent = title;
  }

  if (hash === '/' || hash === '') return renderDashboard();
  const alertDetailMatch = hash.match(/^\/alerts\/([^?]+)$/);
  if (alertDetailMatch) return renderAlertDetail(alertDetailMatch[1]);
  if (hash.startsWith('/alerts')) return renderAlerts();
  if (hash.startsWith('/detections')) return renderDetections();
  const agentMatch = hash.match(/^\/agents\/(.+)$/);
  if (agentMatch) return renderAgentDetail(agentMatch[1]);
  if (hash.startsWith('/agents')) return renderAgents();
  if (hash.startsWith('/feed')) return renderFeed();
  if (hash.startsWith('/connectors')) return renderConnectors();
  app.innerHTML = '<div class="empty">Page not found.</div>';
}

window.addEventListener('hashchange', route);
window.addEventListener('load', route);

setInterval(refreshNavStatus, 30_000);
refreshNavStatus();

async function refreshNavStatus() {
  const dotEl    = document.getElementById('status-dot');
  const textEl   = document.getElementById('sidebar-status-text');
  const connEl   = document.getElementById('topbar-conn');
  const badgeEl  = document.getElementById('badge-alerts');

  try {
    const [status, alertsResp] = await Promise.allSettled([
      api('/v1/status'),
      api('/v1/alerts?limit=500&status=open&severity=critical'),
    ]);

    const ok = status.status === 'fulfilled' && status.value?.api_status === 'ok';
    const critCount = alertsResp.status === 'fulfilled'
      ? (alertsResp.value?.alerts || []).length : 0;

    if (dotEl)   { dotEl.className = 'status-dot ' + (ok ? 'ok' : 'err'); }
    if (textEl)  { textEl.textContent = ok ? 'Connected' : 'Degraded'; }
    if (connEl)  { connEl.textContent = ok ? '● Connected' : '● Degraded'; connEl.className = 'topbar-conn ' + (ok ? 'ok' : 'err'); }
    if (badgeEl) { badgeEl.textContent = critCount > 0 ? String(critCount) : ''; }
  } catch (_) {
    if (dotEl)  dotEl.className = 'status-dot err';
    if (textEl) textEl.textContent = 'Offline';
    if (connEl) { connEl.textContent = '● Offline'; connEl.className = 'topbar-conn err'; }
  }
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

let dashCharts = [];

async function renderDashboard() {
  app.innerHTML = '<div class="loading">Loading dashboard…</div>';
  dashCharts.forEach(c => c.destroy());
  dashCharts = [];

  try {
    const [status, alertsResp, endpointsResp] = await Promise.all([
      api('/v1/status'),
      api('/v1/alerts?limit=500&status=open'),
      api('/v1/endpoints?limit=500').catch(() => ({ endpoints: [], total: 0 })),
    ]);
    const alerts    = alertsResp.alerts || [];
    const endpoints = endpointsResp.endpoints || [];
    const now = Date.now();
    const onlineCount = endpoints.filter(ep =>
      ep.last_seen && (now - new Date(ep.last_seen).getTime()) < 5 * 60 * 1000
    ).length;

    // Severity counts.
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    alerts.forEach(a => { if (a.severity in counts) counts[a.severity]++; });

    // 7-day timeline.
    const dayMap = {};
    const labels = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      labels.push(key.slice(5));
      dayMap[key] = 0;
    }
    alerts.forEach(a => {
      const day = (a.matched_at || '').slice(0, 10);
      if (day in dayMap) dayMap[day]++;
    });
    const timelineData = Object.values(dayMap);

    // Top rules.
    const ruleCounts = {};
    alerts.forEach(a => { if (a.rule_name) ruleCounts[a.rule_name] = (ruleCounts[a.rule_name] || 0) + 1; });
    const topRules    = Object.entries(ruleCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const maxRuleCount = topRules[0]?.[1] || 1;

    // Top hosts.
    const hostCounts = {};
    alerts.forEach(a => {
      const snap = a.event_snapshot || {};
      const host = snap.computer || snap._HOSTNAME || '';
      if (host) hostCounts[host] = (hostCounts[host] || 0) + 1;
    });
    const topHosts    = Object.entries(hostCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const maxHostCount = topHosts[0]?.[1] || 1;

    app.innerHTML = `
      <!-- Stat cards -->
      <div class="stats-grid">
        <div class="stat-card stat-card-critical">
          <div class="stat-card-body">
            <div class="stat-label">Critical</div>
            <div class="stat-value c-critical">${counts.critical}</div>
            <div class="stat-sub">open alerts</div>
          </div>
          <div class="stat-icon-box stat-icon-critical">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.75 4a.75.75 0 011.5 0v3a.75.75 0 01-1.5 0V5zm.75 6a1 1 0 110-2 1 1 0 010 2z"/>
            </svg>
          </div>
        </div>
        <div class="stat-card stat-card-high">
          <div class="stat-card-body">
            <div class="stat-label">High</div>
            <div class="stat-value c-high">${counts.high}</div>
            <div class="stat-sub">open alerts</div>
          </div>
          <div class="stat-icon-box stat-icon-high">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8.866 2a1 1 0 00-1.732 0l-5.5 9.5A1 1 0 002.5 13h11a1 1 0 00.866-1.5L8.866 2zM7.25 7a.75.75 0 011.5 0v2a.75.75 0 01-1.5 0V7zm.75 4.5a.75.75 0 110-1.5.75.75 0 010 1.5z"/>
            </svg>
          </div>
        </div>
        <div class="stat-card stat-card-medium">
          <div class="stat-card-body">
            <div class="stat-label">Medium</div>
            <div class="stat-value c-medium">${counts.medium}</div>
            <div class="stat-sub">open alerts</div>
          </div>
          <div class="stat-icon-box stat-icon-medium">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
              <rect x="2" y="3" width="12" height="2" rx="1"/>
              <rect x="2" y="7" width="12" height="2" rx="1"/>
              <rect x="2" y="11" width="8"  height="2" rx="1"/>
            </svg>
          </div>
        </div>
        <div class="stat-card stat-card-low">
          <div class="stat-card-body">
            <div class="stat-label">Low</div>
            <div class="stat-value c-low">${counts.low}</div>
            <div class="stat-sub">open alerts</div>
          </div>
          <div class="stat-icon-box stat-icon-low">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.5 4.5h1V9h-1V5.5zm.5 5.5a.75.75 0 110-1.5.75.75 0 010 1.5z"/>
            </svg>
          </div>
        </div>
        <div class="stat-card stat-card-accent" onclick="location.hash='#/agents'" style="cursor:pointer">
          <div class="stat-card-body">
            <div class="stat-label">Agents Online</div>
            <div class="stat-value c-accent">${onlineCount}</div>
            <div class="stat-sub">/ ${endpoints.length} registered</div>
          </div>
          <div class="stat-icon-box stat-icon-accent">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
              <rect x="1" y="2" width="14" height="5" rx="1.5"/>
              <rect x="1" y="9" width="14" height="5" rx="1.5"/>
              <circle cx="12.5" cy="4.5" r="1" fill="#080B10"/>
              <circle cx="12.5" cy="11.5" r="1" fill="#080B10"/>
            </svg>
          </div>
        </div>
        <div class="stat-card stat-card-accent">
          <div class="stat-card-body">
            <div class="stat-label">Events 24h</div>
            <div class="stat-value c-accent">${(status.events_last_24h || 0).toLocaleString()}</div>
            <div class="stat-sub">${status.active_rules || 0} active rules</div>
          </div>
          <div class="stat-icon-box stat-icon-accent">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="1,8 3.5,4 6,11 8.5,6 11,9 13,7 15,8"/>
            </svg>
          </div>
        </div>
      </div>

      <!-- Charts row -->
      <div class="charts-row">
        <div class="card">
          <div class="card-title">Alert Volume — Last 7 Days</div>
          <canvas id="timeline-chart"></canvas>
        </div>
        <div class="card">
          <div class="card-title">Severity Breakdown</div>
          <canvas id="donut-chart"></canvas>
        </div>
      </div>

      <!-- Mini-bar widgets -->
      <div class="mini-widgets-row">
        <div class="card">
          <div class="card-title">Top Rules Firing</div>
          ${topRules.length ? renderMiniBarWidget(topRules, maxRuleCount, 'var(--accent)') : '<div class="empty" style="padding:16px;font-size:12px">No open alerts</div>'}
        </div>
        <div class="card">
          <div class="card-title">Top Hosts Affected</div>
          ${topHosts.length ? renderMiniBarWidget(topHosts, maxHostCount, 'var(--high)') : '<div class="empty" style="padding:16px;font-size:12px">No host data available</div>'}
        </div>
      </div>

      <!-- Recent alerts -->
      <div class="card">
        <div class="card-title">
          Recent Open Alerts
          <a href="#/alerts" class="btn-sm" style="margin-left:auto">View All</a>
        </div>
        ${renderAlertTable(alerts.slice(0, 15), false)}
      </div>`;

    // Charts
    const timeline = new Chart(document.getElementById('timeline-chart'), {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Alerts',
          data: timelineData,
          borderColor: '#00E5FF',
          backgroundColor: 'rgba(0,229,255,0.07)',
          tension: 0.4,
          fill: true,
          pointBackgroundColor: '#00E5FF',
          pointRadius: 3,
        }],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#64748b', font: { size: 11 } }, grid: { color: '#1E2633' } },
          y: { ticks: { color: '#64748b', stepSize: 1, font: { size: 11 } }, grid: { color: '#1E2633' }, beginAtZero: true },
        },
      },
    });

    const donut = new Chart(document.getElementById('donut-chart'), {
      type: 'doughnut',
      data: {
        labels: ['Critical', 'High', 'Medium', 'Low'],
        datasets: [{
          data: [counts.critical, counts.high, counts.medium, counts.low],
          backgroundColor: ['#F85149', '#FFB547', '#F0C929', '#3FB950'],
          borderWidth: 0,
          hoverBorderWidth: 2,
          hoverBorderColor: '#E2E8F0',
        }],
      },
      options: {
        cutout: '68%',
        plugins: {
          legend: { labels: { color: '#94a3b8', font: { size: 11 }, padding: 12 } },
        },
      },
    });

    dashCharts = [timeline, donut];

    app.querySelectorAll('tr[data-id]').forEach(tr => {
      tr.addEventListener('click', () => { location.hash = '#/alerts/' + tr.dataset.id; });
    });

  } catch (e) {
    app.innerHTML = `<div class="empty">Error loading dashboard: ${esc(e.message)}</div>`;
  }
}

function renderMiniBarWidget(items, maxCount, color) {
  return items.map(([name, count]) => `
    <div class="mini-bar-row">
      <span class="mini-bar-label" title="${esc(name)}">${esc(name.length > 30 ? name.slice(0, 28) + '…' : name)}</span>
      <div class="mini-bar-track">
        <div class="mini-bar-fill" style="width:${Math.round((count / maxCount) * 100)}%;background:${color}"></div>
      </div>
      <span class="mini-bar-count">${count}</span>
    </div>`
  ).join('');
}

// ---------------------------------------------------------------------------
// Alerts list
// ---------------------------------------------------------------------------

let alertsSort = { col: 'matched_at', dir: -1 };
let selectedIds = new Set();

async function renderAlerts() {
  app.innerHTML = '<div class="loading">Loading alerts…</div>';
  try {
    const hashQuery    = new URLSearchParams(location.hash.split('?')[1] || '');
    const statusFilter   = hashQuery.get('status') || 'open';
    const sevFilter      = hashQuery.get('severity') || '';
    const endpointFilter = hashQuery.get('endpoint_id') || '';

    const params = new URLSearchParams({
      limit: 500,
      ...(statusFilter && { status: statusFilter }),
      ...(sevFilter && { severity: sevFilter }),
      ...(endpointFilter && { endpoint_id: endpointFilter }),
    });
    const data   = await api('/v1/alerts?' + params.toString());
    const alerts = data.alerts || [];
    selectedIds  = new Set();

    let endpointName = endpointFilter;
    if (endpointFilter) {
      try {
        const ep = await api('/v1/endpoints/' + endpointFilter);
        endpointName = ep.name || endpointFilter;
      } catch (_) {}
    }

    app.innerHTML = `
      <div class="page-header">
        <span class="page-title">Alerts</span>
        <span class="page-sub">${data.total} total</span>
      </div>
      ${endpointFilter ? `
      <div class="filter-bar" style="background:rgba(0,229,255,0.05);border:1px solid var(--border);border-radius:6px;padding:8px 12px;margin-bottom:12px">
        Filtered by endpoint: <strong style="color:var(--accent);margin:0 6px">${esc(endpointName)}</strong>
        <a href="#/alerts" style="color:var(--text-dim);font-size:11px;margin-left:4px">✕ Clear</a>
      </div>` : ''}
      <div class="filter-bar">
        <select id="flt-status">
          ${['', 'open', 'acknowledged', 'suppressed', 'resolved'].map(s =>
            `<option value="${s}" ${s === statusFilter ? 'selected' : ''}>${s || 'All Statuses'}</option>`).join('')}
        </select>
        <select id="flt-severity">
          ${['', 'critical', 'high', 'medium', 'low'].map(s =>
            `<option value="${s}" ${s === sevFilter ? 'selected' : ''}>${s || 'All Severities'}</option>`).join('')}
        </select>
        <button class="btn btn-danger" id="btn-batch-ack" style="display:none">Acknowledge Selected</button>
        <button class="btn" id="btn-batch-sup" style="display:none">Suppress Selected</button>
        <button class="btn" id="btn-batch-resolve" style="display:none">Resolve Selected</button>
      </div>
      <div class="card table-wrap" id="alerts-table-wrap">
        ${renderAlertTable(alerts, true)}
      </div>`;

    document.getElementById('flt-status').addEventListener('change', applyAlertFilters);
    document.getElementById('flt-severity').addEventListener('change', applyAlertFilters);
    document.getElementById('btn-batch-ack').addEventListener('click', () => batchAction('acknowledge'));
    document.getElementById('btn-batch-sup').addEventListener('click', () => batchAction('suppress'));
    document.getElementById('btn-batch-resolve').addEventListener('click', () => batchAction('resolve'));
    wireAlertTable(alerts);
  } catch (e) { app.innerHTML = `<div class="empty">Error loading alerts: ${e.message}</div>`; }
}

function applyAlertFilters() {
  const status   = document.getElementById('flt-status').value;
  const severity = document.getElementById('flt-severity').value;
  const hashQuery   = new URLSearchParams(location.hash.split('?')[1] || '');
  const endpointId  = hashQuery.get('endpoint_id') || '';
  const q = new URLSearchParams({
    ...(status && { status }),
    ...(severity && { severity }),
    ...(endpointId && { endpoint_id: endpointId }),
  });
  location.hash = '#/alerts' + (q.toString() ? '?' + q.toString() : '');
}

async function batchAction(action) {
  if (!selectedIds.size) return;
  if (!confirm(`${action} ${selectedIds.size} alert(s)?`)) return;
  try {
    const resp = await api('/v1/alerts/batch', {
      method: 'POST',
      body: JSON.stringify({ action, ids: [...selectedIds] }),
    });
    invalidateCache('/v1/alerts');
    toast(`${resp.updated} alert(s) ${action}d`);
    location.hash = '#/alerts';
    renderAlerts();
  } catch (e) { toast(e.message, true); }
}

function wireAlertTable(alerts) {
  app.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      alertsSort = { col, dir: alertsSort.col === col ? -alertsSort.dir : -1 };
      const sorted = [...alerts].sort((a, b) => {
        const va = a[col] || '', vb = b[col] || '';
        return va < vb ? alertsSort.dir : va > vb ? -alertsSort.dir : 0;
      });
      document.getElementById('alerts-table-wrap').innerHTML = renderAlertTable(sorted, true);
      wireAlertTable(sorted);
    });
  });

  app.querySelectorAll('tr[data-id]').forEach(tr => {
    tr.addEventListener('click', (e) => {
      if (e.target.type === 'checkbox') return;
      location.hash = '#/alerts/' + tr.dataset.id;
    });
  });
  app.querySelectorAll('.row-check').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const id = e.target.dataset.id;
      if (e.target.checked) selectedIds.add(id); else selectedIds.delete(id);
      const hasSel = selectedIds.size > 0;
      document.getElementById('btn-batch-ack').style.display    = hasSel ? '' : 'none';
      document.getElementById('btn-batch-sup').style.display    = hasSel ? '' : 'none';
      document.getElementById('btn-batch-resolve').style.display = hasSel ? '' : 'none';
    });
  });
}

function renderAlertTable(alerts, showCheck) {
  if (!alerts.length) return '<div class="empty">No alerts found.</div>';
  return `<table>
    <thead><tr>
      ${showCheck ? '<th style="width:32px"></th>' : ''}
      <th data-sort="matched_at">Time</th>
      <th data-sort="rule_name">Rule</th>
      <th data-sort="severity">Severity</th>
      <th>Host</th>
      <th data-sort="status">Status</th>
    </tr></thead>
    <tbody>
      ${alerts.map(a => {
        const snap = a.event_snapshot || {};
        const host = snap.computer || snap._HOSTNAME || '—';
        return `
        <tr data-id="${a.id}">
          ${showCheck ? `<td><input type="checkbox" class="row-check" data-id="${a.id}"></td>` : ''}
          <td class="mono" style="white-space:nowrap">${relTime(a.matched_at)}</td>
          <td>${esc(a.rule_name)}</td>
          <td><span class="badge badge-${a.severity}">${a.severity}</span></td>
          <td class="mono" style="color:var(--text-dim)">${esc(host)}</td>
          <td><span class="badge badge-${a.status}">${a.status}</span></td>
        </tr>`;
      }).join('')}
    </tbody></table>`;
}

// ---------------------------------------------------------------------------
// Alert Detail
// ---------------------------------------------------------------------------

async function renderAlertDetail(id) {
  app.innerHTML = '<div class="loading">Loading alert…</div>';
  try {
    const alert = await api('/v1/alerts/' + id);
    const snap  = alert.event_snapshot || {};
    const host  = snap.computer || snap._HOSTNAME || '';

    // Parallel secondary fetches — don't block on failures.
    const [evRes, alertsRes, rulesRes] = await Promise.allSettled([
      host
        ? api('/v1/events/search?query=' + encodeURIComponent(host) + '&limit=20')
        : Promise.resolve({ events: [] }),
      api('/v1/alerts?limit=200&status=open'),
      api('/v1/detections'),
    ]);

    const relatedEvents = evRes.status === 'fulfilled'
      ? (evRes.value?.events || []) : [];
    const allAlerts  = alertsRes.status === 'fulfilled'
      ? (alertsRes.value?.alerts || []) : [];
    const similarAlerts = allAlerts.filter(a =>
      a.id !== id && (
        a.rule_name === alert.rule_name ||
        (host && (a.event_snapshot?.computer || '') === host)
      )
    );
    const rule = (rulesRes.status === 'fulfilled' ? (rulesRes.value?.rules || []) : [])
      .find(r => r.name === alert.rule_name);

    app.innerHTML = `
      <div class="page-header">
        <a href="#/alerts" class="back-btn">← Back to Alerts</a>
        <span class="page-title">${esc(alert.rule_name)}</span>
        <span class="badge badge-${alert.severity} ml-auto">${alert.severity}</span>
        <span class="badge badge-${alert.status}">${alert.status}</span>
      </div>

      <div class="alert-detail-layout">

        <!-- Left: Summary -->
        <div class="card" style="align-self:start">
          <div class="card-title">Alert Summary</div>
          ${field('ID', alert.id.slice(0, 8) + '…')}
          ${field('Matched', relTime(alert.matched_at))}
          ${alert.acknowledged_at ? field('Acknowledged', relTime(alert.acknowledged_at)) : ''}
          ${alert.note ? field('Note', alert.note) : ''}
          ${field('Event ID', alert.event_id || '—')}

          ${rule && (rule.mitre_tactic || rule.description) ? `
            <div class="field-group" style="margin-top:18px">
              <div class="field-group-label">Detection Rule</div>
              ${rule.mitre_tactic ? field('Tactic', rule.mitre_tactic) : ''}
              ${rule.description  ? field('Description', rule.description) : ''}
            </div>` : ''}

          ${host ? `
            <div class="field-group" style="margin-top:18px">
              <div class="field-group-label">Host Context</div>
              ${field('Computer', host)}
              ${snap.channel ? field('Channel', snap.channel) : ''}
            </div>` : ''}

          <div style="margin-top:20px;display:flex;flex-direction:column;gap:8px">
            <button class="btn btn-primary" id="btn-ack" style="width:100%">Acknowledge</button>
            <div class="flex gap8">
              <button class="btn btn-danger" id="btn-sup" style="flex:1">Suppress</button>
              <button class="btn" id="btn-resolve" style="flex:1">Resolve</button>
            </div>
          </div>
        </div>

        <!-- Right: Investigation tabs -->
        <div class="card">
          <div class="tabs">
            <button class="tab-btn active" data-tab="0">Fields</button>
            <button class="tab-btn" data-tab="1">
              Timeline
              ${relatedEvents.length ? `<span class="tab-count">${relatedEvents.length}</span>` : ''}
            </button>
            <button class="tab-btn" data-tab="2">
              Similar
              ${similarAlerts.length ? `<span class="tab-count">${similarAlerts.length}</span>` : ''}
            </button>
            <button class="tab-btn" data-tab="3">Graph</button>
          </div>

          <!-- Tab 0: Parsed event fields -->
          <div class="tab-panel active" id="tab-0">
            ${renderParsedFields(snap)}
          </div>

          <!-- Tab 1: Related events timeline -->
          <div class="tab-panel" id="tab-1">
            ${relatedEvents.length
              ? renderTimelineTab(relatedEvents)
              : '<div class="empty" style="padding:24px">' + (host ? 'No related events found for this host in the last search window.' : 'No host information — cannot search related events.') + '</div>'}
          </div>

          <!-- Tab 2: Similar alerts -->
          <div class="tab-panel" id="tab-2">
            ${similarAlerts.length
              ? '<div class="table-wrap">' + renderAlertTable(similarAlerts.slice(0, 10), false) + '</div>'
              : '<div class="empty" style="padding:24px">No similar alerts found (same rule or same host).</div>'}
          </div>

          <!-- Tab 3: Entity graph -->
          <div class="tab-panel" id="tab-3">
            <div id="force-graph" style="min-height:420px;background:#04070D;border-radius:6px;border:1px solid var(--border);margin-top:8px;position:relative">
              <div class="empty" style="padding:32px;color:var(--text-dim)">Select this tab to render the entity graph.</div>
            </div>
            <div id="graph-tooltip" class="graph-tooltip" style="display:none"></div>
          </div>
        </div>

      </div>`;

    // Wire tab switching.
    let graphRendered = false;
    app.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        app.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        app.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const idx = btn.dataset.tab;
        document.getElementById('tab-' + idx).classList.add('active');
        if (idx === '3' && !graphRendered) {
          document.getElementById('force-graph').innerHTML = '';
          renderForceGraph(alert, relatedEvents);
          graphRendered = true;
        }
      });
    });

    // Row clicks in Similar tab.
    app.querySelectorAll('tr[data-id]').forEach(tr => {
      tr.addEventListener('click', () => { location.hash = '#/alerts/' + tr.dataset.id; });
    });

    document.getElementById('btn-ack').addEventListener('click',     () => alertAction(id, 'acknowledge'));
    document.getElementById('btn-sup').addEventListener('click',     () => alertAction(id, 'suppress'));
    document.getElementById('btn-resolve').addEventListener('click', () => alertAction(id, 'resolve'));

  } catch (e) { app.innerHTML = `<div class="empty">Error: ${e.message}</div>`; }
}

// Parsed event fields — grouped by semantic category.
function renderParsedFields(snap) {
  if (!snap || Object.keys(snap).length === 0) {
    return '<div class="empty" style="padding:24px">No event data available.</div>';
  }

  const evData = snap.event_data || {};
  let html = '';

  // System fields (top-level on snapshot).
  const sysFields = [
    ['Event ID',  snap.event_id],
    ['Channel',   snap.channel],
    ['Computer',  snap.computer],
    ['Record ID', snap.record_id],
  ].filter(([, v]) => v != null && v !== '');

  if (sysFields.length) {
    html += `<div class="field-group"><div class="field-group-label">System</div>`;
    sysFields.forEach(([label, val]) => { html += field(label, String(val)); });
    html += `</div>`;
  }

  const cats = {
    Identity:       ['SubjectUserName','TargetUserName','SubjectDomainName','TargetDomainName','SubjectLogonId','TargetLogonId'],
    Process:        ['ProcessName','NewProcessName','ParentProcessName','CommandLine','ProcessId','NewProcessId','SubjectProcessId'],
    Network:        ['IpAddress','IpPort','WorkstationName','DestinationAddress','SourceAddress','DestPort','RemoteAddress'],
    Authentication: ['LogonType','LogonTypeName','AuthenticationPackageName','FailureReason','Status','SubStatus','KeyLength'],
  };

  const seen = new Set(['event_id', 'channel', 'computer', 'record_id', 'event_data']);

  Object.entries(cats).forEach(([cat, keys]) => {
    const items = keys.filter(k => {
      const v = evData[k];
      return v != null && v !== '' && v !== '-' && v !== '%%1842';
    });
    if (!items.length) return;
    html += `<div class="field-group"><div class="field-group-label">${cat}</div>`;
    items.forEach(k => {
      seen.add(k);
      html += field(k, String(evData[k]));
    });
    html += `</div>`;
  });

  // Remaining event_data fields not captured above.
  const other = Object.entries(evData).filter(([k, v]) =>
    !seen.has(k) && v != null && v !== '' && v !== '-'
  );
  if (other.length) {
    html += `<div class="field-group"><div class="field-group-label">Other</div>`;
    other.forEach(([k, v]) => { html += field(k, String(v)); });
    html += `</div>`;
  }

  // Top-level snap fields not in the Windows-specific set (e.g. Linux journald/syslog events).
  const knownTopLevel = new Set(['event_id', 'channel', 'computer', 'record_id', 'event_data']);
  const flatFields = Object.entries(snap).filter(([k, v]) =>
    !knownTopLevel.has(k) && v != null && v !== '' && v !== '-' && typeof v !== 'object'
  );
  if (flatFields.length) {
    html += `<div class="field-group"><div class="field-group-label">Event</div>`;
    flatFields.forEach(([k, v]) => { html += field(k, String(v)); });
    html += `</div>`;
  }

  return html || '<div class="empty" style="padding:24px">No structured fields found.</div>';
}

// Related events as an expandable timeline list.
function renderTimelineTab(events) {
  return events.map(ev => {
    const evObj   = ev.event || {};
    const evData  = evObj.event_data || {};
    const src     = (ev.source || '').split(':')[0] || 'unknown';
    const evId    = evObj.event_id;
    const preview = [
      evData.SubjectUserName ? `user:${evData.SubjectUserName}` : null,
      evData.TargetUserName  ? `→${evData.TargetUserName}`      : null,
      evData.NewProcessName  ? String(evData.NewProcessName).split(/[\\/]/).pop() : null,
      evData.CommandLine     ? String(evData.CommandLine).slice(0, 60) : null,
    ].filter(Boolean).slice(0, 2).join(' · ');

    const bodyFields = Object.entries(evData)
      .filter(([, v]) => v && v !== '-')
      .slice(0, 12)
      .map(([k, v]) => field(k, String(v)))
      .join('');

    return `<details class="timeline-event">
      <summary>
        <span class="timeline-ts">${relTime(ev.timestamp)}</span>
        <span class="badge badge-open" style="font-size:10px;padding:1px 6px;flex-shrink:0">${esc(src)}</span>
        ${evId ? `<span class="mono" style="font-size:10px;flex-shrink:0">EID:${evId}</span>` : ''}
        ${preview ? `<span class="timeline-preview">${esc(preview)}</span>` : ''}
      </summary>
      <div class="timeline-event-body">${bodyFields || '<span style="color:var(--text-dim);font-size:11px">No parsed fields</span>'}</div>
    </details>`;
  }).join('');
}

async function alertAction(id, action) {
  try {
    if (action === 'acknowledge') {
      await api('/v1/alerts/' + id + '/acknowledge', {
        method: 'POST', body: JSON.stringify({ note: null }),
      });
    } else {
      await api('/v1/alerts/batch', {
        method: 'POST', body: JSON.stringify({ action, ids: [id] }),
      });
    }
    invalidateCache('/v1/alerts');
    toast(`Alert ${action}d`);
    renderAlertDetail(id);
  } catch (e) { toast(e.message, true); }
}

// ---------------------------------------------------------------------------
// D3 Force Graph
// ---------------------------------------------------------------------------

function renderForceGraph(alert, relatedEvents) {
  const container = document.getElementById('force-graph');
  const tooltip   = document.getElementById('graph-tooltip');
  if (!container) return;
  const W = container.clientWidth || 800;
  const H = 420;

  const svg = d3.select(container).append('svg')
    .attr('width', W).attr('height', H);

  const defs = svg.append('defs');
  const glow = defs.append('filter').attr('id', 'glow');
  glow.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'coloredBlur');
  const merge = glow.append('feMerge');
  merge.append('feMergeNode').attr('in', 'coloredBlur');
  merge.append('feMergeNode').attr('in', 'SourceGraphic');

  const snap   = alert.event_snapshot || {};
  const evData = snap.event_data || {};
  const eid    = snap.event_id ? `EID:${snap.event_id}` : '';
  const alertLabel = eid ? `${alert.rule_name} (${eid})` : alert.rule_name;
  const nodes  = [{ id: 'alert', type: 'alert', label: alertLabel, r: 18, snap }];
  const links  = [];

  relatedEvents.slice(0, 12).forEach((ev, i) => {
    const nid    = 'ev_' + i;
    const evId   = (ev.event || {}).event_id;
    const srcPfx = ev.source ? ev.source.split(':')[0] : '';
    const lbl    = evId ? `${srcPfx} EID:${evId}` : (ev.source || `event-${i}`);
    nodes.push({ id: nid, type: 'event', label: lbl, r: 12, ev });
    links.push({ source: 'alert', target: nid, label: 'related' });
  });

  const entityTypes = [
    { key: 'SubjectUserName',   type: 'user',    color: '#ffa502' },
    { key: 'TargetUserName',    type: 'user',    color: '#ffa502' },
    { key: 'computer',          type: 'host',    color: '#94a3b8' },
    { key: 'WorkstationName',   type: 'host',    color: '#94a3b8' },
    { key: 'ProcessName',       type: 'process', color: '#2ed573' },
    { key: 'ParentProcessName', type: 'process', color: '#2ed573' },
    { key: 'NewProcessName',    type: 'process', color: '#2ed573' },
    { key: 'CommandLine',       type: 'process', color: '#2ed573' },
    { key: 'TargetDomainName',  type: 'domain',  color: '#a78bfa' },
    { key: 'SubjectDomainName', type: 'domain',  color: '#a78bfa' },
    { key: 'IpAddress',         type: 'network', color: '#60a5fa' },
    { key: 'IpPort',            type: 'network', color: '#60a5fa' },
  ];
  const seenEntities = new Set();
  entityTypes.forEach(({ key, type, color }) => {
    const val = snap[key] || evData[key];
    if (!val || seenEntities.has(val)) return;
    seenEntities.add(val);
    const rawLabel = type === 'process' && String(val).length > 40
      ? String(val).slice(0, 38) + '…' : String(val);
    const nid = 'entity_' + nodes.length;
    nodes.push({ id: nid, type, color, label: `${type}: ${rawLabel}`, r: 10 });
    links.push({ source: 'alert', target: nid, label: key });
  });

  const nodeColor = n => {
    if (n.type === 'alert') return '#ff4757';
    if (n.type === 'event') return '#00d4ff';
    return n.color || '#94a3b8';
  };

  const linkGroup = svg.append('g').attr('class', 'links');
  const labelGroup = svg.append('g').attr('class', 'link-labels');
  const nodeGroup  = svg.append('g').attr('class', 'nodes');

  const linkSel = linkGroup.selectAll('line').data(links).join('line')
    .attr('stroke', '#1E2633').attr('stroke-width', 1.5);

  const labelSel = labelGroup.selectAll('text').data(links).join('text')
    .attr('fill', '#64748b').attr('font-size', 9).attr('text-anchor', 'middle')
    .text(d => d.label);

  const nodeSel = nodeGroup.selectAll('g').data(nodes).join('g')
    .attr('cursor', 'pointer')
    .call(d3.drag()
      .on('start', (event, d) => { if (!event.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag',  (event, d) => { d.fx = event.x; d.fy = event.y; })
      .on('end',   (event, d) => { if (!event.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));

  nodeSel.append('circle')
    .attr('r', d => d.r)
    .attr('fill', d => nodeColor(d))
    .attr('fill-opacity', 0.85)
    .attr('filter', d => d.type === 'alert' ? 'url(#glow)' : null)
    .attr('stroke', d => d.type === 'alert' ? '#ff4757' : nodeColor(d))
    .attr('stroke-width', 1.5);

  nodeSel.append('text')
    .attr('fill', '#e2e8f0').attr('font-size', 9).attr('text-anchor', 'middle')
    .attr('dy', d => d.r + 12)
    .text(d => d.label.length > 16 ? d.label.slice(0, 14) + '…' : d.label);

  nodeSel.on('mouseover', (event, d) => {
    let content = `<b>${esc(d.type)}</b>: ${esc(d.label)}`;
    if (d.ev) {
      const evObj = d.ev.event || {};
      content += `<br><span style="color:var(--text-dim)">source:</span> ${esc(d.ev.source)}`;
      content += `<br><span style="color:var(--text-dim)">ts:</span> ${relTime(d.ev.timestamp)}`;
      Object.entries(evObj.event_data || {}).slice(0, 6).forEach(([k, v]) => {
        if (v) content += `<br><span style="color:var(--text-dim)">${esc(k)}:</span> ${esc(String(v))}`;
      });
    } else if (d.snap) {
      ['event_id','channel','computer','record_id'].forEach(k => {
        if (d.snap[k]) content += `<br><span style="color:var(--text-dim)">${esc(k)}:</span> ${esc(String(d.snap[k]))}`;
      });
      Object.entries(d.snap.event_data || {}).slice(0, 8).forEach(([k, v]) => {
        if (v) content += `<br><span style="color:var(--text-dim)">${esc(k)}:</span> ${esc(String(v))}`;
      });
    }
    if (tooltip) {
      tooltip.innerHTML = content;
      tooltip.style.display = 'block';
    }
  }).on('mousemove', (event) => {
    if (!tooltip) return;
    const rect = container.getBoundingClientRect();
    tooltip.style.left = (event.clientX - rect.left + 12) + 'px';
    tooltip.style.top  = (event.clientY - rect.top  - 10) + 'px';
  }).on('mouseout', () => { if (tooltip) tooltip.style.display = 'none'; });

  const sim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(90))
    .force('charge', d3.forceManyBody().strength(-150))
    .force('center', d3.forceCenter(W / 2, H / 2))
    .force('collision', d3.forceCollide().radius(d => d.r + 12))
    .on('tick', () => {
      linkSel
        .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      labelSel
        .attr('x', d => (d.source.x + d.target.x) / 2)
        .attr('y', d => (d.source.y + d.target.y) / 2);
      nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
    });
}

// ---------------------------------------------------------------------------
// Agents (Endpoints)
// ---------------------------------------------------------------------------

function agentStatus(ep) {
  if (!ep.last_seen) return { label: 'Never seen', cls: 'badge-suppressed' };
  const age = Date.now() - new Date(ep.last_seen).getTime();
  if (age < 5 * 60 * 1000)        return { label: 'Online',  cls: 'badge-low' };
  if (age < 24 * 60 * 60 * 1000)  return { label: 'Idle',    cls: 'badge-medium' };
  return { label: 'Offline', cls: 'badge-critical' };
}

async function renderAgents() {
  app.innerHTML = '<div class="loading">Loading agents…</div>';
  try {
    const data      = await api('/v1/endpoints?limit=500');
    const endpoints = data.endpoints || [];
    const now       = Date.now();
    const onlineCount = endpoints.filter(ep =>
      ep.last_seen && (now - new Date(ep.last_seen).getTime()) < 5 * 60 * 1000
    ).length;

    app.innerHTML = `
      <div class="page-header">
        <span class="page-title">Agents</span>
        <span class="page-sub">${onlineCount} online · ${data.total} registered</span>
      </div>
      <div class="card table-wrap">
        ${endpoints.length === 0
          ? '<div class="empty">No agents registered yet.<br><br>Run <code class="mono">vigil agent register --name MY-HOST</code> on an endpoint to connect it.</div>'
          : `<table>
              <thead><tr>
                <th>Status</th><th>Name</th><th>Hostname</th>
                <th>IP Address</th><th>OS</th><th>Last Seen</th><th>Registered</th>
              </tr></thead>
              <tbody>
                ${endpoints.map(ep => {
                  const st = agentStatus(ep);
                  return `<tr data-id="${ep.id}" style="cursor:pointer">
                    <td><span class="badge ${st.cls}">${st.label}</span></td>
                    <td>${esc(ep.name)}</td>
                    <td class="mono">${esc(ep.hostname || ep.name)}</td>
                    <td class="mono">${esc(ep.ip_address || '—')}</td>
                    <td>${esc(ep.os || '—')}</td>
                    <td class="mono">${relTime(ep.last_seen)}</td>
                    <td class="mono">${fmtTime(ep.created_at)}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>`}
      </div>`;

    app.querySelectorAll('tr[data-id]').forEach(tr => {
      tr.addEventListener('click', () => { location.hash = '#/agents/' + tr.dataset.id; });
    });
  } catch (e) { app.innerHTML = `<div class="empty">Error loading agents: ${e.message}</div>`; }
}

function renderIPField(ep) {
  const ip = ep.ip_address || '—';
  const hist = ep.ip_history || [];
  if (hist.length <= 1) return field('IP Address', ip);
  return `
    <div class="field-row">
      <span class="field-label">IP Address</span>
      <span class="field-value mono">${esc(ip)}
        <button class="btn-inline" onclick="document.getElementById('ip-hist-${esc(ep.id)}').classList.toggle('hidden')">history</button>
      </span>
    </div>`;
}

function renderIPHistory(history) {
  if (!history || history.length === 0) return '';
  const id = 'ip-hist-main';
  return `
    <div class="card" style="margin-top:0">
      <div class="card-title">IP Address History
        <button class="btn-inline" style="margin-left:8px" onclick="document.getElementById('${id}').classList.toggle('hidden')">
          ${history.length} address${history.length !== 1 ? 'es' : ''}
        </button>
      </div>
      <div id="${id}">
        <table class="data-table">
          <thead><tr><th>IP Address</th><th>First Seen</th><th>Last Seen</th></tr></thead>
          <tbody>
            ${history.map(h => `
              <tr>
                <td class="mono">${esc(h.ip_address)}</td>
                <td class="mono">${fmtTime(h.first_seen)}</td>
                <td class="mono">${fmtTime(h.last_seen)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderSysInfo(meta) {
  const sysKeys = ['os_version','kernel','cpu_model','cpu_count','total_ram_mb','disk_total_gb','disk_free_gb'];
  const hasSys = sysKeys.some(k => meta[k]);
  if (!hasSys) return '<div class="empty" style="padding:16px">No system info yet.<br><small style="color:var(--text-dim)">Collected on first heartbeat after agent update.</small></div>';

  const fmt = (label, val) => val != null && val !== '' && val !== 0
    ? field(label, String(val))
    : '';

  const ramGB = meta.total_ram_mb ? (meta.total_ram_mb / 1024).toFixed(1) + ' GB' : null;
  const diskStr = (meta.disk_total_gb || meta.disk_free_gb)
    ? `${meta.disk_free_gb ?? '?'} GB free / ${meta.disk_total_gb ?? '?'} GB total`
    : null;

  return `
    ${fmt('Agent Version', meta.agent_version)}
    ${fmt('OS Version', meta.os_version)}
    ${fmt('Kernel', meta.kernel)}
    ${fmt('CPU', meta.cpu_model ? `${meta.cpu_model} (${meta.cpu_count} cores)` : (meta.cpu_count ? `${meta.cpu_count} cores` : null))}
    ${fmt('RAM', ramGB)}
    ${fmt('Disk (/)', diskStr)}`;
}

async function renderAgentDetail(id) {
  app.innerHTML = '<div class="loading">Loading agent…</div>';
  try {
    const [ep, alertsResp, eventsResp] = await Promise.all([
      api('/v1/endpoints/' + id),
      api('/v1/alerts?endpoint_id=' + encodeURIComponent(id) + '&limit=20').catch(() => ({ alerts: [], total: 0 })),
      api('/v1/events/search?endpoint_id=' + encodeURIComponent(id) + '&limit=5').catch(() => ({ events: [], total: 0 })),
    ]);

    const st     = agentStatus(ep);
    const alerts = alertsResp.alerts || [];
    const events = eventsResp.events || [];

    app.innerHTML = `
      <div class="page-header">
        <a href="#/agents" class="back-btn">← Back to Agents</a>
        <span class="page-title">${esc(ep.name)}</span>
        <span class="badge ${st.cls}">${st.label}</span>
        <button class="btn ml-auto" id="btn-view-alerts">View All Alerts</button>
        <button class="btn" id="btn-forensic">Collect Forensics</button>
        <button class="btn btn-danger" id="btn-delete-endpoint">Delete Agent</button>
      </div>
      <div class="detail-grid">
        <div class="card">
          <div class="card-title">Agent Details</div>
          ${field('ID', ep.id)}
          ${field('Name', ep.name)}
          ${field('Hostname', ep.hostname || ep.name)}
          ${renderIPField(ep)}
          ${field('OS', ep.os || '—')}
          ${field('Last Seen', relTime(ep.last_seen))}
          ${field('Registered', fmtTime(ep.created_at))}
        </div>
        <div class="card">
          <div class="card-title">System Info</div>
          ${renderSysInfo(ep.metadata || {})}
        </div>
      </div>
      ${renderIPHistory(ep.ip_history || [])}
      <div class="card" style="margin-top:0">
        <div class="card-title">Recent Alerts <span class="page-sub">(from this endpoint)</span></div>
        ${alerts.length === 0
          ? `<div class="empty" style="padding:16px">No alerts linked to this endpoint ID.<br><small style="color:var(--text-dim)">Alerts are only linked when the agent sends events with a valid API key. If the agent was started before registration, restart the service so future events are linked.</small></div>`
          : renderAlertTable(alerts, false)}
      </div>
      <div class="card" id="forensic-card" style="display:none">
        <div class="card-title">Forensic Results <span class="page-sub" id="forensic-status"></span></div>
        <div id="forensic-results"><div class="loading" style="padding:16px">Waiting for agent to respond…</div></div>
      </div>
      <div class="card">
        <div class="card-title">Recent Events <span class="page-sub">(last 5)</span></div>
        ${events.length === 0
          ? '<div class="empty" style="padding:16px">No events recorded for this endpoint.</div>'
          : `<div class="code-block">${events.map(ev =>
              esc(fmtTime(ev.timestamp) + '  [' + ev.source + ']\n' + JSON.stringify(ev.event, null, 2))
            ).join('\n\n')}</div>`}
      </div>`;

    app.querySelectorAll('tr[data-id]').forEach(tr => {
      tr.addEventListener('click', () => { location.hash = '#/alerts/' + tr.dataset.id; });
    });

    document.getElementById('btn-delete-endpoint')
      .addEventListener('click', () => confirmDeleteEndpoint(ep.id, ep.name));
    document.getElementById('btn-view-alerts')
      .addEventListener('click', () => { location.hash = '#/alerts?endpoint_id=' + ep.id; });
    document.getElementById('btn-forensic')
      .addEventListener('click', async () => {
        const btn = document.getElementById('btn-forensic');
        btn.disabled = true;
        btn.textContent = 'Queued…';
        try {
          await api('/v1/endpoints/' + id + '/commands', {
            method: 'POST',
            body: JSON.stringify({ command: 'forensic_collect' }),
          });
          toast('Forensic collection queued — results appear in ~30s.');
          const card = document.getElementById('forensic-card');
          if (card) card.style.display = '';
          setTimeout(() => loadForensicResults(id), 30_000);
        } catch (e) {
          toast(e.message, true);
          btn.disabled = false;
          btn.textContent = 'Collect Forensics';
        }
      });

  } catch (e) { app.innerHTML = `<div class="empty">Error: ${e.message}</div>`; }
}

async function loadForensicResults(endpointId) {
  const card      = document.getElementById('forensic-card');
  const resultsEl = document.getElementById('forensic-results');
  const statusEl  = document.getElementById('forensic-status');
  if (!card || !resultsEl) return;

  card.style.display = '';
  try {
    const r      = await api('/v1/events/search?query=forensic%3A&endpoint_id=' + encodeURIComponent(endpointId) + '&limit=50');
    const events = r.events || [];
    if (statusEl) statusEl.textContent = `(${events.length} artifacts)`;
    if (events.length === 0) {
      resultsEl.innerHTML = '<div class="empty" style="padding:16px">No forensic results yet.</div>';
    } else {
      resultsEl.innerHTML = `<div class="code-block">${
        events.map(ev => esc(fmtTime(ev.timestamp) + '  [' + ev.source + ']\n' + JSON.stringify(ev.event, null, 2))).join('\n\n')
      }</div>`;
    }
  } catch (e) {
    resultsEl.innerHTML = `<div class="empty" style="padding:16px;color:var(--critical)">Error: ${esc(e.message)}</div>`;
  }
}

// ---------------------------------------------------------------------------
// Endpoint delete confirmation
// ---------------------------------------------------------------------------

function confirmDeleteEndpoint(id, name) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:28px 32px;min-width:360px;max-width:480px;box-shadow:0 8px 32px rgba(0,0,0,0.5)">
      <div class="modal-title">Delete Agent</div>
      <div class="modal-body">
        Are you sure you want to delete <strong>${esc(name)}</strong>?<br><br>
        This will revoke the agent's API key immediately. The device will
        stop sending events and must be re-registered to reconnect.
      </div>
      <div class="modal-actions">
        <button class="btn" id="modal-cancel">Cancel</button>
        <button class="btn btn-danger" id="modal-confirm">Delete</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('#modal-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#modal-confirm').addEventListener('click', async () => {
    const confirmBtn = overlay.querySelector('#modal-confirm');
    confirmBtn.textContent = 'Deleting…';
    confirmBtn.disabled = true;
    try {
      await apiDelete('/v1/endpoints/' + id);
      overlay.remove();
      location.hash = '#/agents';
    } catch (e) {
      confirmBtn.textContent = 'Delete';
      confirmBtn.disabled = false;
      overlay.querySelector('.modal-body').innerHTML =
        `<span style="color:var(--critical)">Error: ${esc(e.message)}</span>`;
    }
  });
}

// ---------------------------------------------------------------------------
// Detections
// ---------------------------------------------------------------------------

async function renderDetections() {
  app.innerHTML = '<div class="loading">Loading detections…</div>';
  try {
    const data  = await api('/v1/detections');
    const rules = data.rules || [];

    app.innerHTML = `
      <div class="page-header">
        <span class="page-title">Detection Rules</span>
        <span class="page-sub">${data.total} rules</span>
      </div>
      <div class="card table-wrap">
        <table>
          <thead><tr>
            <th>Name</th><th>Severity</th><th>MITRE Tactic</th><th>Enabled</th><th>Updated</th>
          </tr></thead>
          <tbody>
            ${rules.map(r => `
            <tr data-id="${r.id}">
              <td>${esc(r.name)}</td>
              <td><span class="badge badge-${r.severity}">${r.severity}</span></td>
              <td class="mono">${esc(r.mitre_tactic || '—')}</td>
              <td>
                <label class="toggle">
                  <input type="checkbox" class="rule-toggle" data-id="${r.id}" ${r.enabled ? 'checked' : ''}>
                  <span class="toggle-slider"></span>
                </label>
              </td>
              <td class="mono">${fmtTime(r.updated_at)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    app.querySelectorAll('.rule-toggle').forEach(cb => {
      cb.addEventListener('change', async (e) => {
        const id      = e.target.dataset.id;
        const enabled = e.target.checked;
        try {
          await api('/v1/detections/' + id, { method: 'PATCH', body: JSON.stringify({ enabled }) });
          invalidateCache('/v1/detections');
          toast(`Rule ${enabled ? 'enabled' : 'disabled'}`);
        } catch (err) {
          toast(err.message, true);
          e.target.checked = !e.target.checked;
        }
      });
    });
  } catch (e) { app.innerHTML = `<div class="empty">Error: ${e.message}</div>`; }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function fmtTime(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'; }
  catch (_) { return ts; }
}

function relTime(ts) {
  if (!ts) return '—';
  try {
    const diff = Date.now() - new Date(ts).getTime();
    if (diff < 0)               return fmtTime(ts);
    if (diff < 60_000)          return 'just now';
    if (diff < 3_600_000)       return Math.floor(diff / 60_000) + 'm ago';
    if (diff < 86_400_000)      return Math.floor(diff / 3_600_000) + 'h ago';
    if (diff < 7 * 86_400_000)  return Math.floor(diff / 86_400_000) + 'd ago';
    return fmtTime(ts);
  } catch (_) { return ts; }
}

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function field(label, value) {
  return `<div class="field-row">
    <span class="field-label">${esc(label)}</span>
    <span class="field-value mono">${esc(value)}</span>
  </div>`;
}

// ---------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------

async function renderConnectors() {
  app.innerHTML = '<div class="loading">Loading connectors…</div>';
  try {
    const data       = await api('/v1/connectors');
    const connectors = data.connectors || [];

    app.innerHTML = `
      <div class="page-header">
        <span class="page-title">SIEM Connectors</span>
        <span class="page-sub">${data.total} configured</span>
        <button class="btn btn-primary ml-auto" id="add-connector-btn">+ Add Connector</button>
      </div>

      ${connectors.length === 0 ? `
        <div class="card empty-card">
          <p>No SIEM connectors configured.</p>
          <p>Connect Vigil to an existing Wazuh or Elastic deployment to start reading alerts.</p>
          <button class="btn btn-primary" id="add-connector-btn2" style="margin-top:16px">Add your first connector</button>
        </div>
      ` : `
        <div class="card table-wrap">
          <table>
            <thead><tr>
              <th>Name</th><th>Type</th><th>Enabled</th>
              <th>Last Polled</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              ${connectors.map(c => `
              <tr>
                <td><strong>${esc(c.name)}</strong></td>
                <td><span class="badge badge-medium">${esc(c.siem_type)}</span></td>
                <td>${c.enabled ? 'yes' : 'no'}</td>
                <td class="mono">${fmtTime(c.last_polled)}</td>
                <td class="mono" style="color:${c.last_error ? 'var(--critical)' : 'var(--low)'}">
                  ${c.last_error ? esc(c.last_error.slice(0, 50)) : 'ok'}
                </td>
                <td>
                  <div class="row-actions">
                    <button class="btn-sm" data-action="test"   data-id="${c.id}">Test</button>
                    <button class="btn-sm" data-action="remove" data-id="${c.id}" data-name="${esc(c.name)}">Remove</button>
                  </div>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      `}

      <div id="connector-modal" class="modal hidden">
        <div class="modal-box">
          <h2>Add SIEM Connector</h2>
          <div class="field-row"><label>Name</label>
            <input id="c-name" type="text" placeholder="prod-wazuh" class="input-field">
          </div>
          <div class="field-row"><label>Type</label>
            <select id="c-type" class="input-field">
              <option value="wazuh">Wazuh</option>
              <option value="elastic">Elastic Security</option>
            </select>
          </div>
          <div id="c-wazuh-fields">
            <div class="field-row"><label>OpenSearch URL</label>
              <input id="c-indexer-url" type="text" placeholder="https://wazuh-indexer:9200" class="input-field">
            </div>
            <div class="field-row"><label>OpenSearch User</label>
              <input id="c-indexer-user" type="text" placeholder="admin" class="input-field">
            </div>
            <div class="field-row"><label>OpenSearch Password</label>
              <input id="c-indexer-pass" type="password" class="input-field">
            </div>
          </div>
          <div id="c-elastic-fields" class="hidden">
            <div class="field-row"><label>Elasticsearch URL</label>
              <input id="c-url" type="text" placeholder="https://elastic:9200" class="input-field">
            </div>
            <div class="field-row"><label>API Key (base64)</label>
              <input id="c-api-key" type="password" class="input-field">
            </div>
          </div>
          <div class="field-row">
            <label><input id="c-no-verify" type="checkbox"> Skip TLS verification</label>
          </div>
          <div class="modal-actions">
            <button class="btn btn-primary" id="c-submit">Add Connector</button>
            <button class="btn-secondary" id="c-cancel">Cancel</button>
          </div>
        </div>
      </div>`;

    const typeSelect = app.querySelector('#c-type');
    function updateTypeFields() {
      const isWazuh = typeSelect.value === 'wazuh';
      app.querySelector('#c-wazuh-fields').classList.toggle('hidden', !isWazuh);
      app.querySelector('#c-elastic-fields').classList.toggle('hidden', isWazuh);
    }
    typeSelect.addEventListener('change', updateTypeFields);

    const openModal = () => app.querySelector('#connector-modal').classList.remove('hidden');
    app.querySelector('#add-connector-btn')?.addEventListener('click', openModal);
    app.querySelector('#add-connector-btn2')?.addEventListener('click', openModal);
    app.querySelector('#c-cancel').addEventListener('click', () => {
      app.querySelector('#connector-modal').classList.add('hidden');
    });

    app.querySelector('#c-submit').addEventListener('click', async () => {
      const name     = app.querySelector('#c-name').value.trim();
      const siemType = typeSelect.value;
      const noVerify = app.querySelector('#c-no-verify').checked;
      if (!name) { toast('Name is required', true); return; }

      let config = { verify_ssl: !noVerify };
      if (siemType === 'wazuh') {
        const iu = app.querySelector('#c-indexer-url').value.trim();
        const uu = app.querySelector('#c-indexer-user').value.trim();
        const up = app.querySelector('#c-indexer-pass').value;
        if (!iu || !uu || !up) { toast('All Wazuh fields are required', true); return; }
        config = { ...config, indexer_url: iu, indexer_user: uu, indexer_password: up };
      } else {
        const url = app.querySelector('#c-url').value.trim();
        const key = app.querySelector('#c-api-key').value.trim();
        if (!url || !key) { toast('URL and API Key are required', true); return; }
        config = { ...config, url, api_key: key };
      }

      try {
        await api('/v1/connectors', { method: 'POST', body: JSON.stringify({ name, siem_type: siemType, config }) });
        invalidateCache('/v1/connectors');
        toast(`Connector "${name}" added`);
        renderConnectors();
      } catch (err) { toast(err.message, true); }
    });

    app.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (btn.dataset.action === 'test') {
          btn.disabled = true;
          btn.textContent = 'Testing…';
          try {
            const r = await api('/v1/connectors/' + id + '/test', { method: 'POST', body: '{}' });
            toast(r.ok ? r.message : r.message, !r.ok);
          } catch (err) { toast(err.message, true); }
          btn.disabled = false;
          btn.textContent = 'Test';
        } else if (btn.dataset.action === 'remove') {
          if (!confirm(`Remove connector "${btn.dataset.name}"?`)) return;
          try {
            await apiDelete('/v1/connectors/' + id);
            invalidateCache('/v1/connectors');
            toast('Connector removed');
            renderConnectors();
          } catch (err) { toast(err.message, true); }
        }
      });
    });

  } catch (e) { app.innerHTML = `<div class="empty">Error: ${e.message}</div>`; }
}

// ---------------------------------------------------------------------------
// Feed (unified alert feed from connected SIEMs)
// ---------------------------------------------------------------------------

async function renderFeed() {
  const hash   = location.hash.replace(/^#/, '');
  const qidx   = hash.indexOf('?');
  const params = qidx === -1 ? {} : Object.fromEntries(new URLSearchParams(hash.slice(qidx + 1)));

  if (params.connector && params.alert) {
    return renderFeedContext(params.connector, params.alert, parseInt(params.window || '10', 10));
  }

  const since    = params.since || '60';
  const severity = params.severity || '';

  app.innerHTML = '<div class="loading">Loading feed…</div>';
  try {
    const qp = new URLSearchParams({ since_minutes: since, limit: '100' });
    if (severity) qp.set('severity', severity);
    const data   = await api('/v1/feed/alerts?' + qp.toString());
    const alerts = data.alerts || [];

    const severityBtns = ['', 'critical', 'high', 'medium', 'low'].map(s =>
      `<button class="btn-sm${severity === s ? ' active' : ''}" data-sev="${s}">${s || 'all'}</button>`
    ).join('');

    app.innerHTML = `
      <div class="page-header">
        <span class="page-title">Alert Feed</span>
        <span class="page-sub">${data.total} alert(s) from ${data.connectors_queried} connector(s)</span>
      </div>
      ${data.errors && data.errors.length > 0 ? `
        <div class="card" style="border-color:var(--critical);margin-bottom:16px">
          ${data.errors.map(e => `<div style="color:var(--critical);font-size:12px">${esc(e)}</div>`).join('')}
        </div>` : ''}
      <div class="filter-bar" style="margin-bottom:16px">
        <span style="font-size:12px;color:var(--text-dim)">Severity:</span>
        ${severityBtns}
        <span style="margin-left:auto;font-size:12px;color:var(--text-dim)">Last</span>
        ${['60','360','1440'].map(m =>
          `<button class="btn-sm${since === m ? ' active' : ''}" data-mins="${m}">${m === '60' ? '1h' : m === '360' ? '6h' : '24h'}</button>`
        ).join('')}
      </div>
      ${alerts.length === 0 ? `
        <div class="card empty-card">
          <p>No alerts in this time window.</p>
          <p>Add a connector at <a href="#/connectors">Connectors</a> if none are configured.</p>
        </div>` : `
        <div class="card table-wrap">
          <table>
            <thead><tr>
              <th>Connector</th><th>SIEM</th><th>Severity</th>
              <th>Title</th><th>Host</th><th>Time</th><th></th>
            </tr></thead>
            <tbody>
              ${alerts.map(a => `
              <tr>
                <td>${esc(a.connector_name)}</td>
                <td class="mono">${esc(a.source_siem)}</td>
                <td><span class="badge badge-${a.severity}">${a.severity}</span></td>
                <td>${esc(a.title.length > 50 ? a.title.slice(0, 47) + '…' : a.title)}</td>
                <td class="mono">${esc(a.hostname || a.source_ip || '—')}</td>
                <td class="mono">${relTime(a.detected_at)}</td>
                <td>
                  <a href="#/feed?connector=${encodeURIComponent(a.connector_id)}&alert=${encodeURIComponent(a.native_id)}" class="btn-sm">Context</a>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`}`;

    app.querySelectorAll('[data-sev]').forEach(btn => {
      btn.addEventListener('click', () => {
        const s    = btn.dataset.sev;
        const base = '#/feed?since=' + since;
        location.hash = s ? base + '&severity=' + s : base;
      });
    });
    app.querySelectorAll('[data-mins]').forEach(btn => {
      btn.addEventListener('click', () => {
        const m    = btn.dataset.mins;
        const base = '#/feed?since=' + m;
        location.hash = severity ? base + '&severity=' + severity : base;
      });
    });

  } catch (e) { app.innerHTML = `<div class="empty">Error: ${e.message}</div>`; }
}

async function renderFeedContext(connectorId, nativeAlertId, windowMinutes) {
  app.innerHTML = '<div class="loading">Fetching context…</div>';
  try {
    const qp   = new URLSearchParams({
      connector: connectorId,
      alert: nativeAlertId,
      window: String(windowMinutes || 10),
    });
    const data = await api('/v1/feed/context?' + qp.toString());
    const a    = data.alert;

    app.innerHTML = `
      <div class="page-header">
        <a href="#/feed" class="back-btn">← Back to Feed</a>
        <span class="page-title">Alert Context</span>
      </div>
      <div class="card" style="margin-bottom:16px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 24px">
          ${field('Title', a.title)}
          ${field('Severity', a.severity.toUpperCase())}
          ${field('Host', a.hostname || '—')}
          ${field('Source IP', a.source_ip || '—')}
          ${field('Detected', relTime(a.detected_at))}
          ${field('SIEM', a.connector_name + ' (' + a.source_siem + ')')}
          ${field('Native ID', a.native_id)}
        </div>
      </div>

      <div class="page-header">
        <span class="page-title">Log Context</span>
        <span class="page-sub">${data.total_events} events — ${data.window_minutes}m window</span>
      </div>

      ${data.total_events === 0 ? `
        <div class="card empty-card">
          <p>No log events found in the context window.</p>
          <p>Try a wider window: <a href="#/feed?connector=${encodeURIComponent(connectorId)}&alert=${encodeURIComponent(nativeAlertId)}&window=30">30 minutes</a></p>
          ${a.source_siem === 'wazuh' ? '<p>For richer context, enable wazuh-archives in ossec.conf.</p>' : ''}
        </div>` : `
        <div class="card">
          ${data.events.map((ev, i) => `
            <details style="margin-bottom:8px;border:1px solid var(--border);border-radius:6px">
              <summary style="padding:8px 12px;cursor:pointer;font-size:12px;color:var(--text-dim)">
                Event ${i + 1}
                ${ev.timestamp || ev['@timestamp'] ? ' — ' + relTime(ev.timestamp || ev['@timestamp']) : ''}
                ${ev.full_log ? ' — ' + esc(String(ev.full_log).slice(0, 80)) : ''}
              </summary>
              <pre style="margin:0;padding:12px;font-size:11px;overflow-x:auto;background:#04070D;border-radius:0 0 6px 6px">${esc(JSON.stringify(ev, null, 2))}</pre>
            </details>`).join('')}
        </div>`}`;

  } catch (e) { app.innerHTML = `<div class="empty">Error: ${e.message}</div>`; }
}
