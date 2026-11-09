const PACKAGES = [
  { id: 'primary', name: '小学' },
  { id: 'junior', name: '初中' },
  { id: 'senior', name: '高中' }
];

const state = {
  token: localStorage.getItem('mocaAdminToken') || '',
  username: '',
  users: [],
  logs: [],
  stats: null,
  view: 'users',
  extendUserId: null
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const packageName = id => PACKAGES.find(item => item.id === id)?.name || id;

function formatDate(value) {
  if (!value) return '未开通';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(new Date(value));
  const get = type => parts.find(part => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function shortDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { element.hidden = true; }, 2800);
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (options.body) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch {
    throw new Error('无法连接服务器，请检查网络后重试');
  }
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : null;
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/admin/login') showLogin();
    throw new Error(data?.error || `请求失败（${response.status}）`);
  }
  return data;
}

function showLogin() {
  state.token = '';
  localStorage.removeItem('mocaAdminToken');
  $('#admin-view').hidden = true;
  $('#login-view').hidden = false;
  $('#password').value = '';
  $('#password').focus();
}

function showAdmin() {
  $('#login-view').hidden = true;
  $('#admin-view').hidden = false;
  $('#admin-name').textContent = state.username;
  setView('users');
}

async function loadUsers() {
  const data = await api(`/api/admin/users?query=${encodeURIComponent($('#query').value.trim())}`);
  state.users = data.users;
  renderUsers();
}

function renderUsers() {
  $('#users-total').textContent = `共 ${state.users.length} 位用户`;
  if (!state.users.length) {
    $('#users-body').innerHTML = '<tr><td class="empty-row" colspan="8">没有找到匹配的用户</td></tr>';
    return;
  }
  $('#users-body').innerHTML = state.users.map(user => `<tr data-user-id="${user.id}">
    <td>${user.id}</td>
    <td>${escapeHtml(user.loginName)}</td>
    <td>${formatDate(user.registeredAt)}</td>
    <td>${escapeHtml(user.username) || '—'}</td>
    <td>${escapeHtml(user.phone) || '—'}</td>
    <td>${formatDate(user.vipUntil)}</td>
    <td><div class="package-list">${PACKAGES.map(item => `<label><input type="checkbox" data-package="${item.id}" ${user.packages.includes(item.id) ? 'checked' : ''} aria-label="${user.id} 用户${item.name}套餐">${item.name}</label>`).join('')}</div></td>
    <td><div class="row-actions"><button type="button" data-action="extend">延长vip</button><button type="button" class="danger-button" data-action="cancel">取消vip</button></div></td>
  </tr>`).join('');
}

async function loadLogs() {
  const data = await api('/api/admin/recharges');
  state.logs = data.logs;
  renderLogs();
}

function stateDescription(log, key) {
  const value = log[key];
  const packages = (value?.packages || []).map(packageName).join(' / ') || '未开通';
  return value?.vipUntil ? `${packages}<br><small>${formatDate(value.vipUntil)}</small>` : packages;
}

function renderLogs() {
  if (!state.logs.length) {
    $('#logs-body').innerHTML = '<tr><td class="empty-row" colspan="7">暂无套餐调整记录</td></tr>';
    return;
  }
  $('#logs-body').innerHTML = state.logs.map(log => `<tr>
    <td>${formatDate(log.createdAt)}</td><td>${log.userId}</td><td>${escapeHtml(log.loginName)}</td>
    <td>${escapeHtml(log.action)}</td><td>${stateDescription(log, 'before')}</td><td>${stateDescription(log, 'after')}</td><td>${escapeHtml(log.actor)}</td>
  </tr>`).join('');
}

async function loadStats() {
  state.stats = await api('/api/admin/stats');
  renderStats();
}

function renderStats() {
  const stats = state.stats;
  const cards = [
    ['总用户数', stats.totalUsers],
    ['有效 VIP 用户', stats.activeVip],
    ['未开通 / 已到期', stats.inactiveVip],
    ['今日新增用户', stats.todayRegistrations]
  ];
  $('#stats-cards').innerHTML = cards.map(([label, value]) => `<article class="stat-card"><strong>${value}</strong><span>${label}</span></article>`).join('');
  const maximum = Math.max(1, ...stats.trend.map(item => item.count));
  $('#trend-chart').innerHTML = stats.trend.map(item => `<div class="trend-item"><span class="trend-value">${item.count}</span><span class="trend-bar" style="height:${Math.max(4, item.count / maximum * 160)}px"></span><span class="trend-date">${shortDate(item.date)}</span></div>`).join('');
  $('#package-stats').innerHTML = PACKAGES.map(item => `<div class="package-stat"><span>${item.name}套餐</span><strong>${stats.packageCounts[item.id] || 0}</strong></div>`).join('');
  $('#recent-list').innerHTML = stats.recentLogs.length ? stats.recentLogs.map(log => `<div class="recent-item"><time>${formatDate(log.createdAt)}</time><strong>${escapeHtml(log.action)}</strong><span>用户 ${log.userId} · ${escapeHtml(log.loginName)}</span></div>`).join('') : '<p class="empty-row">暂无操作记录</p>';
}

function setView(view) {
  state.view = view;
  const titles = { users: ['用户信息', '管理家长账号与套餐权益'], recharges: ['充值记录', '查看套餐调整与 VIP 操作历史'], stats: ['用户统计', '了解用户增长和套餐开通情况'] };
  $('#page-title').textContent = titles[view][0];
  $('#page-subtitle').textContent = titles[view][1];
  $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  $$('.view-section').forEach(section => { section.hidden = section.id !== `view-${view}`; });
  closeSidebar();
  if (view === 'users') loadUsers().catch(error => toast(error.message));
  if (view === 'recharges') loadLogs().catch(error => toast(error.message));
  if (view === 'stats') loadStats().catch(error => toast(error.message));
}

function closeSidebar() {
  $('#sidebar').classList.remove('open');
  $('#sidebar-scrim').hidden = true;
  $('#menu-button').setAttribute('aria-expanded', 'false');
}

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.target.querySelector('button[type="submit"]');
  const error = $('#login-error');
  error.hidden = true;
  button.disabled = true;
  button.textContent = '正在登录…';
  try {
    const data = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username: $('#username').value.trim(), password: $('#password').value })
    });
    state.token = data.token;
    state.username = data.username;
    localStorage.setItem('mocaAdminToken', state.token);
    showAdmin();
  } catch (exception) {
    error.textContent = exception.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = '登录后台';
  }
});

$('#toggle-password').addEventListener('click', () => {
  const visible = $('#password').type === 'text';
  $('#password').type = visible ? 'password' : 'text';
  $('#toggle-password').textContent = visible ? '显示' : '隐藏';
  $('#toggle-password').setAttribute('aria-pressed', String(!visible));
});

$('#logout-button').addEventListener('click', async () => {
  try { await api('/api/admin/logout', { method: 'POST' }); } catch { /* Local logout still proceeds. */ }
  showLogin();
});

$$('.nav-item').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
$('#menu-button').addEventListener('click', () => {
  $('#sidebar').classList.add('open');
  $('#sidebar-scrim').hidden = false;
  $('#menu-button').setAttribute('aria-expanded', 'true');
});
$('#sidebar-scrim').addEventListener('click', closeSidebar);
$('#search-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { await loadUsers(); } catch (error) { toast(error.message); }
});
$('#reset-search').addEventListener('click', () => {
  $('#query').value = '';
  loadUsers().catch(error => toast(error.message));
});
$('#refresh-users').addEventListener('click', () => loadUsers().then(() => toast('用户列表已刷新')).catch(error => toast(error.message)));
$('#refresh-logs').addEventListener('click', () => loadLogs().then(() => toast('记录已刷新')).catch(error => toast(error.message)));
$('#refresh-stats').addEventListener('click', () => loadStats().then(() => toast('统计已刷新')).catch(error => toast(error.message)));

$('#export-button').addEventListener('click', async () => {
  try {
    const response = await fetch('/api/admin/export', { headers: { Authorization: `Bearer ${state.token}` } });
    if (!response.ok) throw new Error('导出失败，请重新登录后重试');
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = 'moca-users.csv';
    link.click();
    URL.revokeObjectURL(url);
    toast('用户数据已导出');
  } catch (error) { toast(error.message); }
});

$('#users-body').addEventListener('change', async event => {
  const checkbox = event.target.closest('input[data-package]');
  if (!checkbox) return;
  const row = checkbox.closest('tr[data-user-id]');
  const user = state.users.find(item => item.id === Number(row.dataset.userId));
  const packages = $$('input[data-package]:checked').filter(input => input.closest('tr') === row).map(input => input.dataset.package);
  checkbox.disabled = true;
  try {
    await api(`/api/admin/users/${user.id}/packages`, { method: 'POST', body: JSON.stringify({ packages }) });
    toast('套餐已更新');
    await loadUsers();
  } catch (error) {
    toast(error.message);
    checkbox.disabled = false;
    await loadUsers();
  }
});

$('#users-body').addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const row = button.closest('tr[data-user-id]');
  const user = state.users.find(item => item.id === Number(row.dataset.userId));
  if (button.dataset.action === 'extend') {
    state.extendUserId = user.id;
    $('#extend-user').textContent = `${user.loginName} · 用户ID ${user.id}`;
    $('#extend-error').hidden = true;
    $('#extend-dialog').showModal();
    return;
  }
  if (button.dataset.action === 'cancel' && window.confirm(`确定取消 ${user.loginName} 的全部套餐和 VIP 吗？`)) {
    try {
      await api(`/api/admin/users/${user.id}/cancel`, { method: 'POST' });
      toast('VIP 已取消');
      await loadUsers();
    } catch (error) { toast(error.message); }
  }
});

$('#close-dialog').addEventListener('click', () => $('#extend-dialog').close());
$('#extend-dialog').addEventListener('click', event => {
  if (event.target === $('#extend-dialog')) $('#extend-dialog').close();
});
$('#extend-form').addEventListener('submit', async event => {
  event.preventDefault();
  const data = new FormData(event.target);
  const custom = data.get('days') === 'custom';
  const days = Number(custom ? data.get('customDays') : data.get('days'));
  const user = state.users.find(item => item.id === state.extendUserId);
  const row = $(`tr[data-user-id="${state.extendUserId}"]`);
  const packages = $$('input[data-package]:checked').filter(input => input.closest('tr') === row).map(input => input.dataset.package);
  const error = $('#extend-error');
  error.hidden = true;
  try {
    await api(`/api/admin/users/${state.extendUserId}/extend`, { method: 'POST', body: JSON.stringify({ days, packages }) });
    $('#extend-dialog').close();
    toast(`已为 ${user.loginName} 延长 ${days} 天`);
    await loadUsers();
  } catch (exception) {
    error.textContent = exception.message;
    error.hidden = false;
  }
});

(async function initialize() {
  if (!state.token) {
    showLogin();
    return;
  }
  try {
    const data = await api('/api/admin/session');
    state.username = data.username;
    showAdmin();
  } catch {
    showLogin();
  }
})();
