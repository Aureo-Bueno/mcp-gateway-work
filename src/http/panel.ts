export const panelHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MCP Gateway - Panel</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: #0f1115; color: #e6e6e6; }
  header { display: flex; gap: 12px; align-items: center; padding: 14px 20px; background: #161a22; border-bottom: 1px solid #232a36; position: sticky; top: 0; }
  header h1 { font-size: 16px; margin: 0 12px 0 0; }
  header .grow { flex: 1; }
  input, select, button, textarea { font: inherit; background: #0f1115; color: #e6e6e6; border: 1px solid #2c3444; border-radius: 8px; padding: 7px 10px; }
  button { cursor: pointer; background: #2563eb; border-color: #2563eb; }
  button.ghost { background: transparent; border-color: #2c3444; }
  button.danger { background: #b91c1c; border-color: #b91c1c; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  button.loading { color: transparent !important; position: relative; }
  button.loading::after { content: ''; position: absolute; top: 50%; left: 50%; width: 14px; height: 14px; margin: -7px 0 0 -7px; border: 2px solid rgba(255,255,255,.35); border-top-color: #fff; border-radius: 50%; animation: spin .6s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  nav { display: flex; gap: 6px; padding: 12px 20px 0; flex-wrap: wrap; }
  nav button { background: #161a22; border-color: #232a36; color: #cbd5e1; }
  nav button.active { background: #2563eb; border-color: #2563eb; color: #fff; }
  main { padding: 16px 20px 40px; }
  section { display: none; }
  section.active { display: block; }
  .card { background: #161a22; border: 1px solid #232a36; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; }
  .row .field { display: flex; flex-direction: column; gap: 4px; }
  .row label { font-size: 12px; color: #94a3b8; }
  .form-grid { display: grid; grid-template-columns: repeat(2, minmax(200px, 1fr)); gap: 12px; max-width: 760px; }
  .form-grid .field { display: flex; flex-direction: column; gap: 4px; }
  .form-grid .field.span-2 { grid-column: 1 / -1; }
  .form-grid label { font-size: 12px; color: #94a3b8; }
  .form-grid input, .form-grid select, .form-grid textarea { width: 100%; }
  .form-grid textarea { resize: vertical; min-height: 42px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .actions { margin-top: 14px; }
  input:focus, select:focus, textarea:focus { outline: 2px solid #2563eb; outline-offset: 0; }
  .hint { font-size: 12px; color: #94a3b8; margin: 8px 0 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #232a36; font-size: 13px; }
  th { color: #94a3b8; font-weight: 600; }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px; }
  .ok { background: #064e3b; color: #6ee7b7; }
  .bad { background: #7f1d1d; color: #fca5a5; }
  .muted { color: #94a3b8; }
  #status { font-size: 12px; }
  #status.ok { color: #6ee7b7; }
  #status.bad { color: #fca5a5; }
  code { background: #0f1115; padding: 1px 6px; border-radius: 6px; }
  h2 { font-size: 14px; margin: 0 0 12px; color: #cbd5e1; }
  #gate { max-width: 480px; margin: 56px auto; text-align: center; }
  #gate h2 { font-size: 16px; }
  #gate p { margin: 0; }
</style>
</head>
<body>
<header>
  <h1>MCP Gateway</h1>
  <input id="key" type="password" placeholder="Admin API key" style="width:320px" />
  <button id="connect">Connect</button>
  <span class="grow"></span>
  <span id="status" class="muted">not connected</span>
</header>

<div id="gate" class="card">
  <h2>Admin token required</h2>
  <p class="muted">Enter your admin API key in the field above and click <strong>Connect</strong> to open the panel.</p>
</div>

<nav style="display:none">
  <button data-tab="servers" class="active">Servers</button>
  <button data-tab="keys">API Keys</button>
  <button data-tab="users">Users</button>
  <button data-tab="profiles">Profiles</button>
  <button data-tab="audit">Audit</button>
  <button data-tab="approvals">Approvals</button>
  <button data-tab="metrics">Metrics</button>
</nav>

<main style="display:none">
  <section id="tab-servers" class="active">
    <div class="card">
      <h2>Register server</h2>
      <div class="form-grid">
        <div class="field"><label>Name</label><input id="s-name" placeholder="filesystem" /></div>
        <div class="field"><label>Type</label>
          <select id="s-type"><option value="stdio">stdio</option><option value="http">http</option></select>
        </div>
        <div class="field span-2" id="s-command-field"><label>Command</label><input id="s-command" placeholder="npx" /></div>
        <div class="field span-2" id="s-args-field"><label>Args <span class="muted">(space separated; use "quotes" for spaces)</span></label><input id="s-args" placeholder='-y @modelcontextprotocol/server-filesystem /home/user/Desktop' /></div>
        <div class="field span-2" id="s-env-field"><label>Env <span class="muted">(optional, KEY=VALUE per line — stdio only)</span></label><textarea id="s-env" rows="2" placeholder="GITHUB_TOKEN=ghp_xxx"></textarea></div>
        <div class="field span-2" id="s-url-field" style="display:none"><label>URL <span class="muted">(http only)</span></label><input id="s-url" placeholder="http://host:port/mcp" /></div>
        <div class="field span-2" id="s-headers-field" style="display:none"><label>Headers <span class="muted">(optional, KEY=VALUE per line — http only)</span></label><textarea id="s-headers" rows="2" placeholder="Authorization=Bearer ghp_xxx"></textarea></div>
      </div>
      <div class="actions"><button id="s-add">Add server</button></div>
    </div>
    <div class="card">
      <h2>Servers</h2>
      <button class="ghost" id="servers-refresh">Reload</button>
      <table><thead><tr><th>Name</th><th>Type</th><th>Connected</th><th>Health</th><th>Tools</th><th></th></tr></thead><tbody id="servers-body"></tbody></table>
    </div>
  </section>

  <section id="tab-keys">
    <div class="card">
      <h2>Create API key</h2>
      <div class="form-grid">
        <div class="field"><label>User</label><select id="k-user"></select></div>
        <div class="field"><label>Expires in days</label><input id="k-days" type="number" value="365" /></div>
      </div>
      <div class="actions"><button id="k-create">Create key</button></div>
      <p id="k-created" class="muted"></p>
    </div>
    <div class="card">
      <h2>API keys</h2>
      <button class="ghost" id="keys-refresh">Reload</button>
      <table><thead><tr><th>ID</th><th>User</th><th>Prefix</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody id="keys-body"></tbody></table>
    </div>
  </section>

  <section id="tab-users">
    <div class="card">
      <h2>Create user</h2>
      <div class="form-grid">
        <div class="field"><label>Name</label><input id="u-name" placeholder="alice" /></div>
        <div class="field"><label>Profile</label><input id="u-profile" placeholder="readonly" /></div>
      </div>
      <div class="actions"><button id="u-create">Create user</button></div>
    </div>
    <div class="card">
      <h2>Users</h2>
      <table><thead><tr><th>ID</th><th>Name</th><th>Profile</th></tr></thead><tbody id="users-body"></tbody></table>
    </div>
  </section>

  <section id="tab-profiles">
    <div class="card">
      <h2>Create profile</h2>
      <div class="form-grid">
        <div class="field"><label>Name</label><input id="p-name" placeholder="analyst" /></div>
        <div class="field"><label>Patterns <span class="muted">(comma separated)</span></label><input id="p-patterns" placeholder="github__*,filesystem__*" /></div>
      </div>
      <div class="actions"><button id="p-create">Create profile</button></div>
    </div>
    <div class="card">
      <h2>Profiles</h2>
      <table><thead><tr><th>Name</th><th>Tool patterns</th><th></th></tr></thead><tbody id="profiles-body"></tbody></table>
    </div>
  </section>

  <section id="tab-audit">
    <div class="card">
      <h2>Audit log <span class="muted">(auto-refresh 5s)</span></h2>
      <button class="ghost" id="audit-refresh">Reload</button>
      <table><thead><tr><th>Time</th><th>User</th><th>Method</th><th>Server</th><th>Target</th><th>Status</th><th>Latency</th></tr></thead><tbody id="audit-body"></tbody></table>
    </div>
  </section>

  <section id="tab-approvals">
    <div class="card">
      <h2>Approvals <span class="muted">(auto-refresh 3s)</span></h2>
      <button class="ghost" id="approvals-refresh">Reload</button>
      <table><thead><tr><th>ID</th><th>Time</th><th>User</th><th>Tool</th><th>Arguments</th><th>Status</th><th></th></tr></thead><tbody id="approvals-body"></tbody></table>
    </div>
    <div class="card">
      <h2>Approval rules <span class="muted">(tool patterns that require human approval)</span></h2>
      <div class="form-grid">
        <div class="field span-2"><label>Tool pattern</label><input id="ar-pattern" placeholder="*__delete_*" /></div>
      </div>
      <div class="actions"><button id="ar-add">Add rule</button></div>
      <table><thead><tr><th>ID</th><th>Pattern</th><th>Enabled</th><th></th></tr></thead><tbody id="rules-body"></tbody></table>
    </div>
  </section>

  <section id="tab-metrics">
    <div class="card">
      <h2>Metrics <span class="muted">(auto-refresh 5s)</span></h2>
      <button class="ghost" id="metrics-refresh">Reload</button>
      <table><thead><tr><th>Metric</th><th>Labels</th><th>Value</th></tr></thead><tbody id="metrics-body"></tbody></table>
    </div>
  </section>
</main>

<script>
(function () {
  'use strict';
  var key = localStorage.getItem('mcpAdminKey') || '';
  var statusEl = document.getElementById('status');
  var keyEl = document.getElementById('key');
  keyEl.value = key;

  function setStatus(text, ok) {
    statusEl.textContent = text;
    statusEl.className = ok === true ? 'ok' : (ok === false ? 'bad' : 'muted');
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  async function api(path, opts) {
    opts = opts || {};
    var res = await fetch(path, {
      method: opts.method || 'GET',
      headers: Object.assign({ 'content-type': 'application/json', 'x-api-key': key }, opts.headers || {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    var text = await res.text();
    var data;
    try { data = JSON.parse(text); } catch (e) { data = text; }
    if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
    return data;
  }

  async function withLoading(btn, task) {
    if (!btn || btn.disabled) return undefined;
    btn.disabled = true;
    btn.classList.add('loading');
    try {
      return await task();
    } finally {
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  }

  // --- tabs ---
  var loaders = {};
  document.querySelectorAll('nav button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('nav button').forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('section').forEach(function (s) { s.classList.remove('active'); });
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      if (loaders[btn.dataset.tab]) loaders[btn.dataset.tab]();
    });
  });

  // --- servers ---
  async function loadServers() {
    var list = await api('/admin/servers');
    document.getElementById('servers-body').innerHTML = list.map(function (s) {
      var health = s.healthy === null || s.connected === false
        ? '<span class="pill muted">–</span>'
        : (s.healthy ? '<span class="pill ok">ok</span>' : '<span class="pill bad">down</span>');
      var latency = s.lastPingMs === null ? '' : ' (' + esc(s.lastPingMs) + ' ms)';
      return '<tr><td>' + esc(s.name) + '</td><td>' + esc(s.type) + '</td>' +
        '<td>' + (s.connected ? '<span class="pill ok">yes</span>' : '<span class="pill bad" title="' + esc(s.lastError || '') + '">no</span>' + (s.connectAttempts ? ' <span class="muted">(' + esc(s.connectAttempts) + ' tries)</span>' : '')) + '</td>' +
        '<td>' + health + latency + '</td>' +
        '<td>' + esc(s.toolCount) + '</td>' +
        '<td><button class="ghost" data-ping="' + esc(s.name) + '"' + (s.connected ? '' : ' disabled') + '>Ping</button> ' +
        '<button class="ghost" data-refresh="' + esc(s.name) + '">Refresh</button> ' +
        '<button class="danger" data-del="' + esc(s.name) + '">Delete</button></td></tr>';
    }).join('') || '<tr><td colspan="6" class="muted">none</td></tr>';
    document.querySelectorAll('#servers-body [data-del]').forEach(function (b) {
      b.onclick = function () { withLoading(b, async function () { await api('/admin/servers/' + encodeURIComponent(b.dataset.del), { method: 'DELETE' }); await loadServers(); }); };
    });
    document.querySelectorAll('#servers-body [data-refresh]').forEach(function (b) {
      b.onclick = function () { withLoading(b, async function () { await api('/admin/servers/' + encodeURIComponent(b.dataset.refresh) + '/refresh', { method: 'POST' }); await loadServers(); }); };
    });
    document.querySelectorAll('#servers-body [data-ping]').forEach(function (b) {
      b.onclick = function () {
        withLoading(b, async function () {
          try {
            var r = await api('/admin/servers/' + encodeURIComponent(b.dataset.ping) + '/ping', { method: 'POST' });
            setStatus('ping ' + r.name + ' ok (' + r.latencyMs + ' ms)', true);
          } catch (e) {
            setStatus('ping ' + b.dataset.ping + ' failed: ' + e.message, false);
          }
        });
      };
    });
  }
  loaders.servers = loadServers;
  document.getElementById('servers-refresh').onclick = function () { withLoading(this, loadServers); };
  setInterval(function () {
    var section = document.getElementById('tab-servers');
    if (connected && section && section.classList.contains('active')) loadServers().catch(function () {});
  }, 15000);
  function syncServerType() {
    var isHttp = document.getElementById('s-type').value === 'http';
    document.getElementById('s-command-field').style.display = isHttp ? 'none' : '';
    document.getElementById('s-args-field').style.display = isHttp ? 'none' : '';
    document.getElementById('s-env-field').style.display = isHttp ? 'none' : '';
    document.getElementById('s-url-field').style.display = isHttp ? '' : 'none';
    document.getElementById('s-headers-field').style.display = isHttp ? '' : 'none';
  }
  document.getElementById('s-type').onchange = syncServerType;
  syncServerType();
  function parseArgs(str) {
    var out = [], cur = '', quote = null;
    for (var i = 0; i < str.length; i++) {
      var c = str[i];
      if (quote) {
        if (c === quote) { quote = null; } else { cur += c; }
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === ' ' || c === '\\t') {
        if (cur) { out.push(cur); cur = ''; }
      } else {
        cur += c;
      }
    }
    if (cur) { out.push(cur); }
    return out;
  }
  function parseEnv(str) {
    var env = {};
    str.split(/\\r?\\n/).forEach(function (line) {
      var t = line.trim();
      if (!t || t[0] === '#') return;
      var idx = t.indexOf('=');
      if (idx === -1) return;
      var k = t.slice(0, idx).trim();
      if (k) env[k] = t.slice(idx + 1).trim();
    });
    return env;
  }
  document.getElementById('s-add').onclick = function () {
    var btn = this;
    withLoading(btn, async function () {
      var type = document.getElementById('s-type').value;
      var name = document.getElementById('s-name').value.trim();
      var body;
      if (type === 'http') {
        body = { name: name, type: 'http', url: document.getElementById('s-url').value.trim() };
        var headers = parseEnv(document.getElementById('s-headers').value);
        if (Object.keys(headers).length) { body.headers = headers; }
      } else {
        body = { name: name, type: 'stdio', command: document.getElementById('s-command').value.trim(),
          args: parseArgs(document.getElementById('s-args').value) };
        var env = parseEnv(document.getElementById('s-env').value);
        if (Object.keys(env).length) { body.env = env; }
      }
      try { await api('/admin/servers', { method: 'POST', body: body }); setStatus('server added', true); await loadServers(); }
      catch (e) { setStatus('add failed: ' + e.message, false); }
    });
  };

  // --- keys ---
  async function loadUsersInto(select) {
    var list = await api('/admin/users');
    select.innerHTML = list.map(function (u) { return '<option>' + esc(u.name) + '</option>'; }).join('');
  }
  async function loadKeys() {
    var list = await api('/admin/api-keys');
    document.getElementById('keys-body').innerHTML = list.map(function (k) {
      var status = k.revokedAt ? '<span class="pill bad">revoked</span>' : '<span class="pill ok">active</span>';
      return '<tr><td>' + esc(k.id) + '</td><td>' + esc(k.userName) + '</td><td><code>' + esc(k.prefix) + '...</code></td>' +
        '<td>' + esc(new Date(k.expiresAt).toLocaleString()) + '</td><td>' + status + '</td>' +
        '<td>' + (k.revokedAt ? '' : '<button class="danger" data-revoke="' + esc(k.id) + '">Revoke</button>') + '</td></tr>';
    }).join('') || '<tr><td colspan="6" class="muted">none</td></tr>';
    document.querySelectorAll('#keys-body [data-revoke]').forEach(function (b) {
      b.onclick = function () { withLoading(b, async function () { await api('/admin/api-keys/' + encodeURIComponent(b.dataset.revoke), { method: 'DELETE' }); await loadKeys(); }); };
    });
  }
  loaders.keys = async function () { await loadUsersInto(document.getElementById('k-user')); await loadKeys(); };
  document.getElementById('keys-refresh').onclick = function () { withLoading(this, loadKeys); };
  document.getElementById('k-create').onclick = function () {
    var btn = this;
    withLoading(btn, async function () {
      var body = { userName: document.getElementById('k-user').value, expiresInDays: Number(document.getElementById('k-days').value) || 365 };
      try {
        var created = await api('/admin/api-keys', { method: 'POST', body: body });
        document.getElementById('k-created').innerHTML = 'New key (copy now): <code>' + esc(created.apiKey) + '</code>';
        await loadKeys();
      } catch (e) { setStatus('create key failed: ' + e.message, false); }
    });
  };

  // --- users ---
  async function loadUsers() {
    var list = await api('/admin/users');
    document.getElementById('users-body').innerHTML = list.map(function (u) {
      return '<tr><td>' + esc(u.id) + '</td><td>' + esc(u.name) + '</td><td>' + esc(u.profile) + '</td></tr>';
    }).join('') || '<tr><td colspan="3" class="muted">none</td></tr>';
  }
  loaders.users = loadUsers;
  document.getElementById('u-create').onclick = function () {
    var btn = this;
    withLoading(btn, async function () {
      try {
        await api('/admin/users', { method: 'POST', body: { name: document.getElementById('u-name').value.trim(), profile: document.getElementById('u-profile').value.trim() } });
        setStatus('user created', true); await loadUsers();
      } catch (e) { setStatus('create user failed: ' + e.message, false); }
    });
  };

  // --- profiles ---
  async function loadProfiles() {
    var list = await api('/admin/profiles');
    document.getElementById('profiles-body').innerHTML = list.map(function (p) {
      return '<tr><td>' + esc(p.name) + '</td><td><code>' + esc((p.patterns || []).join(', ')) + '</code></td>' +
        '<td><button class="ghost" data-edit="' + esc(p.name) + '">Edit patterns</button></td></tr>';
    }).join('') || '<tr><td colspan="3" class="muted">none</td></tr>';
    document.querySelectorAll('#profiles-body [data-edit]').forEach(function (b) {
      b.onclick = function () {
        var current = (list.find(function (p) { return p.name === b.dataset.edit; }).patterns || []).join(',');
        var input = prompt('Patterns (comma separated):', current);
        if (input == null) return;
        withLoading(b, async function () {
          try { await api('/admin/profiles/' + encodeURIComponent(b.dataset.edit) + '/tools', { method: 'PUT', body: { patterns: input.split(',').map(function (s) { return s.trim(); }).filter(Boolean) } }); await loadProfiles(); }
          catch (e) { setStatus('update failed: ' + e.message, false); }
        });
      };
    });
  }
  loaders.profiles = loadProfiles;
  document.getElementById('p-create').onclick = function () {
    var btn = this;
    withLoading(btn, async function () {
      var patterns = document.getElementById('p-patterns').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      try { await api('/admin/profiles', { method: 'POST', body: { name: document.getElementById('p-name').value.trim(), patterns: patterns } }); setStatus('profile created', true); await loadProfiles(); }
      catch (e) { setStatus('create profile failed: ' + e.message, false); }
    });
  };

  // --- audit ---
  async function loadAudit() {
    var list = await api('/admin/audit?limit=50');
    document.getElementById('audit-body').innerHTML = list.map(function (a) {
      return '<tr><td>' + esc(new Date(a.createdAt).toLocaleTimeString()) + '</td><td>' + esc(a.userId) + '</td><td>' + esc(a.method) + '</td><td>' + esc(a.serverName) + '</td>' +
        '<td>' + esc(a.toolName) + '</td><td>' + (a.status === 'success' ? '<span class="pill ok">ok</span>' : '<span class="pill bad">' + esc(a.status) + '</span>') + '</td>' +
        '<td>' + esc(a.latencyMs) + ' ms</td></tr>';
    }).join('') || '<tr><td colspan="7" class="muted">none</td></tr>';
  }
  loaders.audit = loadAudit;
  document.getElementById('audit-refresh').onclick = function () { withLoading(this, loadAudit); };

  // --- metrics ---
  function fmtLabels(labels) {
    if (!labels) return '';
    return Object.keys(labels).map(function (k) { return k + '=' + labels[k]; }).join(', ');
  }
  async function loadMetrics() {
    var data = await api('/admin/metrics');
    var rows = [];
    data.forEach(function (metric) {
      if (!metric.values) return;
      if (metric.name.indexOf('nodejs_') === 0) return;
      metric.values.forEach(function (v) {
        if (typeof v.value !== 'number') return;
        rows.push('<tr><td>' + esc(metric.name) + '</td><td><code>' + esc(fmtLabels(v.labels)) + '</code></td><td>' + esc(v.value) + '</td></tr>');
      });
    });
    document.getElementById('metrics-body').innerHTML = rows.join('') || '<tr><td colspan="3" class="muted">no metric values yet</td></tr>';
  }
  loaders.metrics = loadMetrics;
  document.getElementById('metrics-refresh').onclick = function () { withLoading(this, loadMetrics); };

  // --- approvals ---
  async function loadApprovals() {
    var list = await api('/admin/approvals?limit=50');
    document.getElementById('approvals-body').innerHTML = list.map(function (a) {
      var args = JSON.stringify(a.arguments);
      if (args.length > 60) args = args.slice(0, 57) + '...';
      var actions = a.status === 'pending'
        ? '<button class="ghost" data-approve="' + esc(a.id) + '">Approve</button> <button class="danger" data-reject="' + esc(a.id) + '">Reject</button>'
        : '';
      var pill = a.status === 'approved' ? 'ok' : (a.status === 'pending' ? '' : 'bad');
      return '<tr><td>' + esc(a.id) + '</td><td>' + esc(new Date(a.createdAt).toLocaleTimeString()) + '</td>' +
        '<td>' + esc(a.userName) + '</td><td>' + esc(a.toolName) + '</td><td><code>' + esc(args) + '</code></td>' +
        '<td><span class="pill ' + pill + '">' + esc(a.status) + '</span></td><td>' + actions + '</td></tr>';
    }).join('') || '<tr><td colspan="7" class="muted">none</td></tr>';
    document.querySelectorAll('#approvals-body [data-approve]').forEach(function (b) {
      b.onclick = function () { withLoading(b, async function () { await api('/admin/approvals/' + encodeURIComponent(b.dataset.approve) + '/approve', { method: 'POST' }); await loadApprovals(); }); };
    });
    document.querySelectorAll('#approvals-body [data-reject]').forEach(function (b) {
      b.onclick = function () { withLoading(b, async function () { await api('/admin/approvals/' + encodeURIComponent(b.dataset.reject) + '/reject', { method: 'POST' }); await loadApprovals(); }); };
    });
  }
  async function loadRules() {
    var list = await api('/admin/approval-rules');
    document.getElementById('rules-body').innerHTML = list.map(function (r) {
      return '<tr><td>' + esc(r.id) + '</td><td><code>' + esc(r.toolPattern) + '</code></td>' +
        '<td>' + (r.enabled ? '<span class="pill ok">yes</span>' : '<span class="pill bad">no</span>') + '</td>' +
        '<td><button class="danger" data-ruledel="' + esc(r.id) + '">Delete</button></td></tr>';
    }).join('') || '<tr><td colspan="4" class="muted">none</td></tr>';
    document.querySelectorAll('#rules-body [data-ruledel]').forEach(function (b) {
      b.onclick = function () { withLoading(b, async function () { await api('/admin/approval-rules/' + encodeURIComponent(b.dataset.ruledel), { method: 'DELETE' }); await loadRules(); }); };
    });
  }
  loaders.approvals = async function () { await loadApprovals(); await loadRules(); };
  document.getElementById('approvals-refresh').onclick = function () { withLoading(this, loaders.approvals); };
  document.getElementById('ar-add').onclick = function () {
    var btn = this;
    var pattern = document.getElementById('ar-pattern').value.trim();
    if (!pattern) return;
    withLoading(btn, async function () {
      try { await api('/admin/approval-rules', { method: 'POST', body: { pattern: pattern, enabled: true } }); setStatus('rule added', true); await loadRules(); }
      catch (e) { setStatus('add rule failed: ' + e.message, false); }
    });
  };

  // --- connect + auto refresh ---
  var connectBtn = document.getElementById('connect');
  var connected = false;

  function renderAuth() {
    connectBtn.textContent = connected ? 'Disconnect' : 'Connect';
    connectBtn.className = connected ? 'danger' : '';
    keyEl.disabled = connected;
    document.getElementById('gate').style.display = connected ? 'none' : '';
    document.querySelector('nav').style.display = connected ? '' : 'none';
    document.querySelector('main').style.display = connected ? '' : 'none';
  }

  function connect() {
    return withLoading(connectBtn, async function () {
      key = keyEl.value.trim();
      localStorage.setItem('mcpAdminKey', key);
      try {
        await api('/admin/servers');
        connected = true;
        setStatus('connected', true);
        renderAuth();
        await loadServers();
      } catch (e) {
        connected = false;
        setStatus('connect failed: ' + e.message, false);
        renderAuth();
      }
    });
  }

  function disconnect() {
    connected = false;
    key = '';
    keyEl.value = '';
    localStorage.removeItem('mcpAdminKey');
    setStatus('not connected', null);
    renderAuth();
  }

  connectBtn.onclick = function () { if (connected) { disconnect(); } else { void connect(); } };
  renderAuth();

  setInterval(function () {
    if (!connected) return;
    if (document.getElementById('tab-audit').classList.contains('active') && key) loadAudit().catch(function () {});
    if (document.getElementById('tab-metrics').classList.contains('active') && key) loadMetrics().catch(function () {});
    if (document.getElementById('tab-approvals').classList.contains('active') && key) loaders.approvals().catch(function () {});
  }, 3000);

  if (key) connect();
})();
</script>
</body>
</html>
`;
