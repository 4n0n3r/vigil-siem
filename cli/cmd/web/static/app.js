/* Vigil SIEM — Single-Page App
 * Hash router: #/ → Dashboard, #/alerts → Alerts list,
 *              #/alerts/:id → Alert detail, #/detections → Detections
 */
'use strict';

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

async function api(path, opts = {}) {
  const resp = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  if (!resp.ok) {
    let msg = resp.statusText;
    try { const e = await resp.json(); msg = e.message || e.error_code || msg; } catch (_) {}
    throw new Error(msg);
  }
  return resp.json();
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
// Router
// ---------------------------------------------------------------------------

const app = document.getElementById('app');

function route() {
  const hash = location.hash.replace(/^#/, '') || '/';
  // Highlight active nav link.
  document.querySelectorAll('.nav-link').forEach(a => {
    const r = a.dataset.route;
    a.classList.toggle('active',
      r === '/' ? hash === '/' : hash.startsWith(r));
  });

  if (hash === '/' || hash === '') return renderDashboard();
  const alertMatch = hash.match(/^\/alerts\/(.+)$/);
  if (alertMatch) return renderAlertDetail(alertMatch[1]);
  if (hash.startsWith('/alerts')) return renderAlerts();
  if (hash.startsWith('/detections')) return renderDetections();
  app.innerHTML = '<div class="empty">Page not found.</div>';
}

window.addEventListener('hashchange', route);
window.addEventListener('load', route);

// Periodically refresh nav status.
setInterval(refreshNavStatus, 30000);
refreshNavStatus();

async function refreshNavStatus() {
  const el = document.getElementById('nav-status');
  try {
    const s = await api('/v1/status');
    const ok = s.api_status === 'ok';
    el.textContent = ok ? '● Connected' : '● Degraded';
    el.className = 'nav-status ' + (ok ? 'ok' : 'err');
  } catch (_) {
    el.textContent = '● Offline';
    el.className = 'nav-status err';
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
    const [status, alertsResp] = await Promise.all([
      api('/v1/status'),
      api('/v1/alerts?limit=500&status=open'),
    ]);
    const alerts = alertsResp.alerts || [];

    // Severity counts.
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    alerts.forEach(a => { counts[a.severity] = (counts[a.severity] || 0) + 1; });

    // Timeline — last 7 days.
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
    const timelineData = labels.map((_, i) => {
      const key = Object.keys(dayMap)[i];
      return dayMap[key] || 0;
    });

    app.innerHTML = `
      <div class="page-header">
        <span class="page-title">Dashboard</span>
        <span class="page-sub">Events last 24h: ${status.events_last_24h || 0} &nbsp;·&nbsp; Active rules: ${status.active_rules || 0}</span>
      </div>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-label">Critical</div><div class="stat-value c-critical">${counts.critical}</div></div>
        <div class="stat-card"><div class="stat-label">High</div><div class="stat-value c-high">${counts.high}</div></div>
        <div class="stat-card"><div class="stat-label">Medium</div><div class="stat-value c-medium">${counts.medium}</div></div>
        <div class="stat-card"><div class="stat-label">Low</div><div class="stat-value c-low">${counts.low}</div></div>
      </div>
      <div class="charts-row">
        <div class="card"><div class="card-title">Severity Breakdown</div><canvas id="donut-chart"></canvas></div>
        <div class="card"><div class="card-title">Alert Timeline — Last 7 Days</div><canvas id="timeline-chart"></canvas></div>
      </div>
      <div class="card">
        <div class="card-title">Recent Open Alerts</div>
        ${renderAlertTable(alerts.slice(0, 20), false)}
      </div>`;

    const donut = new Chart(document.getElementById('donut-chart'), {
      type: 'doughnut',
      data: {
        labels: ['Critical', 'High', 'Medium', 'Low'],
        datasets: [{
          data: [counts.critical, counts.high, counts.medium, counts.low],
          backgroundColor: ['#ff4757', '#ff6b35', '#ffa502', '#2ed573'],
          borderWidth: 0,
        }],
      },
      options: { plugins: { legend: { labels: { color: '#e2e8f0', font: { size: 12 } } } }, cutout: '65%' },
    });
    const timeline = new Chart(document.getElementById('timeline-chart'), {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Alerts',
          data: timelineData,
          borderColor: '#00d4ff',
          backgroundColor: 'rgba(0,212,255,0.08)',
          tension: 0.4,
          fill: true,
          pointBackgroundColor: '#00d4ff',
        }],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#64748b' }, grid: { color: '#1e2d4a' } },
          y: { ticks: { color: '#64748b', stepSize: 1 }, grid: { color: '#1e2d4a' }, beginAtZero: true },
        },
      },
    });
    dashCharts = [donut, timeline];

    // Row click → alert detail.
    app.querySelectorAll('tr[data-id]').forEach(tr => {
      tr.addEventListener('click', () => { location.hash = '#/alerts/' + tr.dataset.id; });
    });
  } catch (e) { app.innerHTML = `<div class="empty">Error loading dashboard: ${e.message}</div>`; }
}

// ---------------------------------------------------------------------------
// Alerts list
// ---------------------------------------------------------------------------

let alertsSort = { col: 'matched_at', dir: -1 };
let selectedIds = new Set();

async function renderAlerts() {
  app.innerHTML = '<div class="loading">Loading alerts…</div>';
  try {
    const statusFilter = new URLSearchParams(location.hash.split('?')[1] || '').get('status') || 'open';
    const sevFilter    = new URLSearchParams(location.hash.split('?')[1] || '').get('severity') || '';
    const params = new URLSearchParams({ limit: 500, ...(statusFilter && { status: statusFilter }), ...(sevFilter && { severity: sevFilter }) });
    const data = await api('/v1/alerts?' + params.toString());
    const alerts = data.alerts || [];
    selectedIds = new Set();

    app.innerHTML = `
      <div class="page-header">
        <span class="page-title">Alerts</span>
        <span class="page-sub">${data.total} total</span>
      </div>
      <div class="filter-bar">
        <select id="flt-status">
          ${['', 'open', 'acknowledged', 'suppressed', 'resolved'].map(s =>
            `<option value="${s}" ${s===statusFilter?'selected':''}>${s||'All Statuses'}</option>`).join('')}
        </select>
        <select id="flt-severity">
          ${['', 'critical', 'high', 'medium', 'low'].map(s =>
            `<option value="${s}" ${s===sevFilter?'selected':''}>${s||'All Severities'}</option>`).join('')}
        </select>
        <button class="btn btn-danger" id="btn-batch-ack" style="display:none">Acknowledge Selected</button>
        <button class="btn" id="btn-batch-resolve" style="display:none">Resolve Selected</button>
      </div>
      <div class="card table-wrap" id="alerts-table-wrap">
        ${renderAlertTable(alerts, true)}
      </div>`;

    // Filter controls.
    document.getElementById('flt-status').addEventListener('change', applyAlertFilters);
    document.getElementById('flt-severity').addEventListener('change', applyAlertFilters);

    // Batch action buttons.
    document.getElementById('btn-batch-ack').addEventListener('click', () => batchAction('acknowledge'));
    document.getElementById('btn-batch-resolve').addEventListener('click', () => batchAction('resolve'));

    wireAlertTable(alerts);
  } catch (e) { app.innerHTML = `<div class="empty">Error loading alerts: ${e.message}</div>`; }
}

function applyAlertFilters() {
  const status = document.getElementById('flt-status').value;
  const severity = document.getElementById('flt-severity').value;
  const q = new URLSearchParams({ ...(status && { status }), ...(severity && { severity }) });
  location.hash = '#/alerts' + (q.toString() ? '?' + q.toString() : '');
}

async function batchAction(action) {
  if (!selectedIds.size) return;
  const confirmed = confirm(`${action} ${selectedIds.size} alert(s)?`);
  if (!confirmed) return;
  try {
    const resp = await api('/v1/alerts/batch', {
      method: 'POST',
      body: JSON.stringify({ action, ids: [...selectedIds] }),
    });
    toast(`${resp.updated} alert(s) ${action}d`);
    location.hash = '#/alerts';
    renderAlerts();
  } catch (e) { toast(e.message, true); }
}

function wireAlertTable(alerts) {
  // Sort headers.
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

  // Row click → detail; checkbox toggle selection.
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
      document.getElementById('btn-batch-ack').style.display = hasSel ? '' : 'none';
      document.getElementById('btn-batch-resolve').style.display = hasSel ? '' : 'none';
    });
  });
}

function renderAlertTable(alerts, showCheck) {
  if (!alerts.length) return '<div class="empty">No alerts found.</div>';
  const cols = ['matched_at', 'rule_name', 'severity', 'status', 'id'];
  const headers = { matched_at: 'Time', rule_name: 'Rule', severity: 'Severity', status: 'Status', id: 'ID' };
  return `<table>
    <thead><tr>
      ${showCheck ? '<th></th>' : ''}
      ${cols.map(c => `<th data-sort="${c}">${headers[c]}</th>`).join('')}
    </tr></thead>
    <tbody>
      ${alerts.map(a => `
      <tr data-id="${a.id}">
        ${showCheck ? `<td><input type="checkbox" class="row-check" data-id="${a.id}"></td>` : ''}
        <td>${fmtTime(a.matched_at)}</td>
        <td>${esc(a.rule_name)}</td>
        <td><span class="badge badge-${a.severity}">${a.severity}</span></td>
        <td><span class="badge badge-${a.status}">${a.status}</span></td>
        <td class="mono">${a.id.slice(0, 8)}</td>
      </tr>`).join('')}
    </tbody></table>`;
}

// ---------------------------------------------------------------------------
// Alert Detail
// ---------------------------------------------------------------------------

async function renderAlertDetail(id) {
  app.innerHTML = '<div class="loading">Loading alert…</div>';
  try {
    const alert = await api('/v1/alerts/' + id);
    const host = (alert.event_snapshot || {}).computer || '';
    let relatedEvents = [];
    if (host) {
      try {
        const r = await api('/v1/events/search?query=' + encodeURIComponent(host) + '&limit=20');
        relatedEvents = r.events || [];
      } catch (_) {}
    }

    app.innerHTML = `
      <div class="page-header">
        <a href="#/alerts" class="back-btn">← Back to Alerts</a>
        <span class="page-title">${esc(alert.rule_name)}</span>
        <span class="badge badge-${alert.severity} ml-auto">${alert.severity}</span>
        <span class="badge badge-${alert.status}">${alert.status}</span>
      </div>
      <div class="detail-grid">
        <div class="card">
          <div class="card-title">Alert Details</div>
          ${field('ID', alert.id)}
          ${field('Rule', alert.rule_name)}
          ${field('Matched At', fmtTime(alert.matched_at))}
          ${field('Acknowledged At', fmtTime(alert.acknowledged_at))}
          ${field('Note', alert.note || '—')}
          ${field('Event ID', alert.event_id)}
          <div class="flex gap8 mt16">
            <button class="btn btn-primary" id="btn-ack">Acknowledge</button>
            <button class="btn btn-danger" id="btn-sup">Suppress</button>
            <button class="btn" id="btn-resolve">Resolve</button>
          </div>
        </div>
        <div class="card">
          <div class="card-title">Event Snapshot</div>
          <div class="code-block">${esc(JSON.stringify(alert.event_snapshot, null, 2))}</div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Entity Graph — ${esc(host || 'no host')} · ${relatedEvents.length} related events</div>
        <div id="force-graph"></div>
        <div id="graph-tooltip" class="graph-tooltip" style="display:none"></div>
      </div>`;

    // Action buttons.
    document.getElementById('btn-ack').addEventListener('click', () => alertAction(id, 'acknowledge'));
    document.getElementById('btn-sup').addEventListener('click', () => alertAction(id, 'suppress'));
    document.getElementById('btn-resolve').addEventListener('click', () => alertAction(id, 'resolve'));

    renderForceGraph(alert, relatedEvents);
  } catch (e) { app.innerHTML = `<div class="empty">Error: ${e.message}</div>`; }
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
    toast(`Alert ${action}d`);
    renderAlertDetail(id);
  } catch (e) { toast(e.message, true); }
}

// ---------------------------------------------------------------------------
// D3 Force Graph
// ---------------------------------------------------------------------------

function renderForceGraph(alert, relatedEvents) {
  const container = document.getElementById('force-graph');
  const tooltip = document.getElementById('graph-tooltip');
  const W = container.clientWidth || 800;
  const H = 400;

  const svg = d3.select(container).append('svg')
    .attr('width', W).attr('height', H);

  // Defs: glow filter.
  const defs = svg.append('defs');
  const glow = defs.append('filter').attr('id', 'glow');
  glow.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'coloredBlur');
  const merge = glow.append('feMerge');
  merge.append('feMergeNode').attr('in', 'coloredBlur');
  merge.append('feMergeNode').attr('in', 'SourceGraphic');

  // Build nodes.
  const snap = alert.event_snapshot || {};
  const nodes = [{ id: 'alert', type: 'alert', label: alert.rule_name, r: 18 }];
  const links = [];

  relatedEvents.slice(0, 12).forEach((ev, i) => {
    const nid = 'ev_' + i;
    const evId = (ev.event || {}).event_id || ev.source;
    nodes.push({ id: nid, type: 'event', label: String(evId), r: 12, ev });
    links.push({ source: 'alert', target: nid, label: 'related' });
  });

  // Extract entities from snapshot.
  const entityTypes = [
    { key: 'SubjectUserName', type: 'user', color: '#ffa502' },
    { key: 'TargetUserName', type: 'user', color: '#ffa502' },
    { key: 'computer', type: 'host', color: '#94a3b8' },
    { key: 'WorkstationName', type: 'host', color: '#94a3b8' },
    { key: 'ProcessName', type: 'process', color: '#2ed573' },
    { key: 'ParentProcessName', type: 'process', color: '#2ed573' },
  ];
  const seenEntities = new Set();
  entityTypes.forEach(({ key, type, color }) => {
    const val = snap[key] || (snap.event_data || {})[key];
    if (val && !seenEntities.has(val)) {
      seenEntities.add(val);
      const nid = 'entity_' + nodes.length;
      nodes.push({ id: nid, type, color, label: val, r: 10 });
      links.push({ source: 'alert', target: nid, label: type });
    }
  });

  const nodeColor = n => {
    if (n.type === 'alert') return '#ff4757';
    if (n.type === 'event') return '#00d4ff';
    return n.color || '#94a3b8';
  };

  // Edge label group.
  const linkGroup = svg.append('g').attr('class', 'links');
  const labelGroup = svg.append('g').attr('class', 'link-labels');
  const nodeGroup  = svg.append('g').attr('class', 'nodes');

  const linkSel = linkGroup.selectAll('line').data(links).join('line')
    .attr('stroke', '#1e2d4a').attr('stroke-width', 1.5);

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

  // Tooltip on hover.
  nodeSel.on('mouseover', (event, d) => {
    let content = `<b>${d.type}</b>: ${esc(d.label)}`;
    if (d.ev) content += `<br>source: ${esc(d.ev.source)}<br>ts: ${fmtTime(d.ev.timestamp)}`;
    tooltip.innerHTML = content;
    tooltip.style.display = 'block';
  }).on('mousemove', (event) => {
    const rect = container.getBoundingClientRect();
    tooltip.style.left = (event.clientX - rect.left + 12) + 'px';
    tooltip.style.top  = (event.clientY - rect.top  - 10) + 'px';
  }).on('mouseout', () => { tooltip.style.display = 'none'; });

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
// Detections
// ---------------------------------------------------------------------------

async function renderDetections() {
  app.innerHTML = '<div class="loading">Loading detections…</div>';
  try {
    const data = await api('/v1/detections');
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

    // Toggle enable/disable.
    app.querySelectorAll('.rule-toggle').forEach(cb => {
      cb.addEventListener('change', async (e) => {
        const id = e.target.dataset.id;
        const action = e.target.checked ? 'enable' : 'disable';
        try {
          await api('/v1/detections/' + id + '/' + action, { method: 'POST', body: '{}' });
          toast(`Rule ${action}d`);
        } catch (err) {
          toast(err.message, true);
          e.target.checked = !e.target.checked; // revert
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
    <span class="field-value">${esc(value)}</span>
  </div>`;
}
