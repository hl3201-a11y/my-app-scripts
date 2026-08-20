/* 食光盒 App —— 纯原生 JS，零依赖，IndexedDB 存储，体积小、启动快 */
(function () {
  'use strict';
  const DAY = 86400000;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const state = {
    view: 'home', filter: 'all', search: '', locations: [], settings: {},
    editId: null, pendingPhotos: [], camStream: null
  };

  /* ---------- 工具 ---------- */
  const pad = n => String(n).padStart(2, '0');
  function fmtDateTime(ms) { const d = new Date(ms); return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }
  function fmtDate(ms) { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function dateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function expireFromDateInput(v) { if (!v) return null; const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d, 23, 59, 59).getTime(); }
  function dateInputFromExpire(ms) { return ms ? fmtDate(ms) : ''; }

  function statusOf(it) {
    if (!it.expireAt) return { code: 0, label: '长期', cls: 'long' };
    const diff = it.expireAt - Date.now();
    if (diff < 0) return { code: 2, label: '已过期', cls: 'exp' };
    const days = Math.ceil(diff / DAY);
    const cls = days <= state.settings.advanceDays ? 'warn' : 'ok';
    return { code: days <= state.settings.advanceDays ? 1 : 0, label: '剩' + days + '天', cls };
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 1800);
  }

  function openModal(html, after) {
    $('#modalCard').innerHTML = html;
    $('#modal').classList.remove('hidden');
    if (after) after($('#modalCard'));
  }
  function closeModal() { $('#modal').classList.add('hidden'); $('#modalCard').innerHTML = ''; }

  /* ---------- 每日日切（数据库内快照） ---------- */
  async function dailyRoll() {
    const today = dateStr(new Date());
    const exist = await DB.get('daily_log', today);
    if (exist) return;
    const items = await DB.getAll('items');
    let total = 0, expiring = 0, expired = 0;
    const snap = [];
    for (const it of items) {
      const st = statusOf(it);
      if (st.code === 2) expired++; else if (st.code === 1) expiring++;
      total++;
      snap.push({ id: it.id, name: it.name, qty: it.qty, locationId: it.locationId, putTime: it.putTime, expireAt: it.expireAt, status: st.code });
    }
    await DB.put('daily_log', { date: today, summary: { total, expiring, expired }, snapshot: snap });
  }

  /* ---------- 通知 ---------- */
  function maybeNotify(items) {
    if (!state.settings.notify) return;
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    const expiring = items.filter(i => statusOf(i).code === 1).length;
    const expired = items.filter(i => statusOf(i).code === 2).length;
    if (expired) new Notification('食光盒 · 有物品已过期', { body: `共 ${expired} 件已过期，请及时处理` });
    else if (expiring) new Notification('食光盒 · 临期提醒', { body: `有 ${expiring} 件物品快到期了` });
  }

  /* ---------- 渲染：通用 ---------- */
  async function loadLocations() { state.locations = await DB.getAll('locations'); state.locations.sort((a, b) => a.sort - b.sort); }
  function locName(id) { const l = state.locations.find(x => x.id === id); return l ? l.name : '未分类'; }
  function avatar(name) { const m = { '奶': '🥛', '蛋': '🥚', '菜': '🥬', '肉': '🥩', '鱼': '🐟', '包': '🍞', '米': '🌾', '面': '🍜', '纸': '🧻', '液': '🧴', '药': '💊', '茶': '🍵' }; for (const k in m) if (name && name.includes(k)) return m[k]; return '📦'; }

  /* ---------- 首页 ---------- */
  async function renderHome() {
    const items = await DB.getAll('items');
    const expired = items.filter(i => statusOf(i).code === 2);
    const expiring = items.filter(i => statusOf(i).code === 1);
    const today0 = startOfToday();
    const todayAdded = items.filter(i => i.putTime >= today0).sort((a, b) => b.putTime - a.putTime);

    let banner = '';
    if (expired.length) {
      banner = `<div class="banner danger"><div class="bt">🔴 已过期 ${expired.length} 件</div>
        ${expired.slice(0, 3).map(i => `<div class="row"><span class="ic">${avatar(i.name)}</span><div class="meta"><div class="nm">${esc(i.name)}×${i.qty}</div><div class="sub">${locName(i.locationId)}</div></div></div>`).join('')}
        ${expired.length > 3 ? `<div class="muted" style="margin-top:4px">…还有 ${expired.length - 3} 件</div>` : ''}</div>`;
    } else if (expiring.length) {
      banner = `<div class="banner"><div class="bt">⚠️ 快到期 ${expiring.length} 件</div>
        ${expiring.slice(0, 3).map(i => `<div class="row"><span class="ic">${avatar(i.name)}</span><div class="meta"><div class="nm">${esc(i.name)}×${i.qty}</div><div class="sub">${locName(i.locationId)} · 剩${Math.ceil((i.expireAt - Date.now()) / DAY)}天</div></div></div>`).join('')}</div>`;
    }

    const ops = todayAdded.length
      ? todayAdded.map(i => `<div class="item"><span class="ic">${avatar(i.name)}</span><div class="meta"><div class="nm">${fmtDateTime(i.putTime)} 放入 ${esc(i.name)}×${i.qty}</div><div class="sub">→ ${locName(i.locationId)}</div></div></div>`).join('')
      : `<div class="empty">今天还没有记录，点下方「+录入」开始吧</div>`;

    $('#view').innerHTML = `
      ${banner}
      <div class="grid2" style="margin-bottom:12px">
        <div class="stat"><div class="num">${items.length}</div><div class="lbl">物品总数</div></div>
        <div class="stat"><div class="num" style="color:var(--warn)">${expiring.length}</div><div class="lbl">快到期</div></div>
        <div class="stat"><div class="num" style="color:var(--danger)">${expired.length}</div><div class="lbl">已过期</div></div>
        <div class="stat"><div class="num">${todayAdded.length}</div><div class="lbl">今日新增</div></div>
      </div>
      <div class="card"><h3>⚡ 快捷操作</h3>
        <div class="btn-row">
          <button class="btn" data-act="go-add">➕ 录入物品</button>
          <button class="btn ghost" data-act="go-scan">📷 拍照</button>
          <button class="btn ghost" data-act="go-list">📋 清单</button>
        </div>
      </div>
      <div class="card"><h3>🕒 今日操作</h3>${ops}</div>`;
  }

  /* ---------- 录入 ---------- */
  function itemFormHTML(it) {
    it = it || {};
    const locOpts = state.locations.map(l => `<option value="${l.id}" ${it.locationId === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')
      + `<option value="__new">＋ 新增位置…</option>`;
    const prev = (it._preview || []).map(p => `<img class="thumb" src="${p}">`).join('');
    return `
      <h3>${it.id ? '编辑物品' : '录入物品'}</h3>
      <label class="fld"><b>名称</b>
        <div class="row">
          <input id="f_name" placeholder="如：牛奶、抽纸、玉米须" value="${esc(it.name || '')}">
          <button class="btn sm ghost" data-act="voice" title="语音">🎤</button>
        </div>
      </label>
      <label class="fld"><b>数量</b>
        <div class="qtystep">
          <button data-act="qty" data-d="-1">−</button>
          <input id="f_qty" inputmode="numeric" value="${it.qty || 1}">
          <button data-act="qty" data-d="1">＋</button>
        </div>
      </label>
      <label class="fld"><b>存放位置</b>
        <select id="f_loc">${locOpts}</select>
      </label>
      <label class="fld"><b>放入时间</b>
        <input id="f_put" type="datetime-local" value="${it.putTime ? toLocalInput(it.putTime) : toLocalInput(Date.now())}">
      </label>
      <label class="fld"><b>到期日期（留空=长期/日用品）</b>
        <div class="row">
          <input id="f_exp" type="date" value="${dateInputFromExpire(it.expireAt)}">
          <button class="btn sm ghost" data-act="guess" title="智能建议">💡建议</button>
        </div>
        <div class="muted" id="guess_hint"></div>
      </label>
      <label class="fld"><b>照片（压缩存储，体积小）</b>
        <input id="f_photo" type="file" accept="image/*" capture="environment">
        <div class="photo-row" id="photoRow">${prev}</div>
      </label>
      <div class="btn-row" style="margin-top:6px">
        <button class="btn block" data-act="save-item">${it.id ? '保存修改' : '保存'}</button>
        ${it.id ? '<button class="btn ghost" data-act="close-modal">取消</button>' : ''}
      </div>`;
  }

  function toLocalInput(ms) { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }

  async function renderAdd() {
    state.editId = null;
    $('#view').innerHTML = `<div class="card">${itemFormHTML({})}</div>
      <div class="about">提示：录入后可到「我的 → 位置管理」添加任意自定义位置；拍照页可用相机取帧。</div>`;
    bindItemForm($('#view'));
    if (state.pendingPhotos.length) {
      const row = $('#photoRow'); if (row) row.innerHTML = state.pendingPhotos.map(b => `<img class="thumb" src="${URL.createObjectURL(b)}">`).join('') + `<span class="muted">已附带${state.pendingPhotos.length}张照片</span>`;
    }
  }

  function bindItemForm(root) {
    // 数量步进
    $$('[data-act="qty"]', root).forEach(b => b.onclick = () => {
      const inp = $('#f_qty', root); let v = parseInt(inp.value || '1', 10) + parseInt(b.dataset.d, 10);
      inp.value = Math.max(1, v);
    });
    // 新增位置
    const locSel = $('#f_loc', root);
    if (locSel) locSel.onchange = async () => {
      if (locSel.value === '__new') {
        const name = prompt('新位置名称（如：厨房·冷藏 / 阳台柜）');
        if (name) { const id = await DB.put('locations', { name, type: 1, sort: 100 + state.locations.length }); await loadLocations(); locSel.innerHTML = state.locations.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('') + `<option value="__new">＋ 新增位置…</option>`; locSel.value = id; }
        else locSel.value = state.locations[0]?.id || '';
      }
    };
    // 智能建议
    const guessBtn = $('[data-act="guess"]', root);
    if (guessBtn) guessBtn.onclick = () => {
      const name = $('#f_name', root).value;
      const g = SHELF.guess(name);
      if (!g) { $('#guess_hint', root).textContent = '未匹配到内置建议，可手动选择日期'; return; }
      const put = $('#f_put', root).value ? new Date($('#f_put', root).value).getTime() : Date.now();
      const exp = new Date(put + g.days * DAY);
      $('#f_exp', root).value = fmtDate(exp.getTime());
      $('#guess_hint', root).textContent = `建议按「${g.env}」约 ${g.days} 天`;
    };
    // 语音（Web Speech，可插拔，按用时加载）
    const voice = $('[data-act="voice"]', root);
    if (voice) voice.onclick = () => {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { toast('当前浏览器不支持语音'); return; }
      const r = new SR(); r.lang = 'zh-CN'; r.interimResults = false;
      r.onresult = e => { $('#f_name', root).value = e.results[0][0].transcript; toast('已识别'); };
      r.onerror = () => toast('语音识别失败');
      r.start();
    };
  }

  async function saveItemFrom(root, id) {
    const name = $('#f_name', root).value.trim();
    if (!name) { toast('请填写名称'); return; }
    const qty = Math.max(1, parseInt($('#f_qty', root).value || '1', 10));
    const locationId = parseInt($('#f_loc', root).value, 10);
    const putTime = $('#f_put', root).value ? new Date($('#f_put', root).value).getTime() : Date.now();
    const expireAt = expireFromDateInput($('#f_exp', root).value);
    // 收集新照片（文件输入或拍照页附带），统一压缩为 Blob 持久化
    const blobs = [];
    const fileInput = $('#f_photo', root);
    if (fileInput && fileInput.files && fileInput.files[0]) blobs.push(await compressImage(fileInput.files[0]));
    if (state.pendingPhotos.length) blobs.push(...state.pendingPhotos);
    let item;
    if (id) {
      item = await DB.get('items', id);
      Object.assign(item, { name, qty, locationId, putTime, expireAt });
      if (blobs.length) item.photoBlobs = blobs;
    } else {
      item = { name, qty, locationId, putTime, expireAt };
      if (blobs.length) item.photoBlobs = blobs;
    }
    if (item.photoBlobs && !item.photoBlobs.length) delete item.photoBlobs;
    state.pendingPhotos = []; state.editId = null;
    await DB.put('items', item);
    toast(id ? '已保存' : '已记录');
    closeModal();
    await renderHome(); setTab('home');
  }

  // 图片压缩：最大边 480px，JPEG 0.6，单张约 15–40KB
  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let { width: w, height: h } = img; const max = 480;
        if (w > h && w > max) { h = h * max / w; w = max; }
        else if (h > max) { w = w * max / h; h = max; }
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        c.toBlob(b => b ? resolve(b) : reject(new Error('compress fail')), 'image/jpeg', 0.6);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  /* ---------- 清单 ---------- */
  async function renderList() {
    const items = await DB.getAll('items');
    const q = state.search.trim().toLowerCase();
    let list = items.filter(i => {
      if (state.filter === 'expiring' && statusOf(i).code !== 1) return false;
      if (state.filter === 'expired' && statusOf(i).code !== 2) return false;
      if (state.filter === 'long' && i.expireAt) return false;
      if (q && !i.name.toLowerCase().includes(q)) return false;
      return true;
    });
    // 排序：过期/快到期优先，再按到期时间
    list.sort((a, b) => { const sa = statusOf(a).code, sb = statusOf(b).code; if (sa !== sb) return sb - sa; return (a.expireAt || 1e15) - (b.expireAt || 1e15); });

    const groups = {};
    for (const it of list) { const k = locName(it.locationId); (groups[k] = groups[k] || []).push(it); }

    const chips = [['all', '全部'], ['expiring', '快到期'], ['expired', '过期'], ['long', '长期']]
      .map(([k, t]) => `<div class="chip ${state.filter === k ? 'active' : ''}" data-act="filter" data-f="${k}">${t}</div>`).join('');

    let body;
    if (!list.length) body = `<div class="empty">没有符合条件的物品</div>`;
    else body = Object.keys(groups).sort().map(loc => `
      <div class="loc-group"><div class="loc-title">📍 ${esc(loc)} <span class="muted">(${groups[loc].length})</span></div>
      ${groups[loc].map(i => {
        const st = statusOf(i);
        return `<div class="item" data-act="detail" data-id="${i.id}">
          <span class="ic">${avatar(i.name)}</span>
          <div class="meta"><div class="nm">${esc(i.name)} ×${i.qty}</div>
          <div class="sub">${i.expireAt ? fmtDate(i.expireAt) : '长期'} · ${locName(i.locationId)}</div></div>
          <span class="tag ${st.cls}">${st.label}</span></div>`;
      }).join('')}
      </div>`).join('');

    $('#view').innerHTML = `
      <div class="search"><input id="search" placeholder="🔍 搜索物品名称" value="${esc(state.search)}"></div>
      <div class="filters">${chips}</div>
      ${body}`;
    const s = $('#search'); if (s) s.oninput = e => { state.search = e.target.value; renderList(); };
  }

  /* ---------- 详情 ---------- */
  async function openDetail(id) {
    const it = await DB.get('items', id);
    if (!it) return;
    const st = statusOf(it);
    const photos = (it.photoBlobs || []).map(b => `<img class="thumb" src="${URL.createObjectURL(b)}">`).join('');
    openModal(`
      <h3>${esc(it.name)} ×${it.qty}</h3>
      <div class="muted" style="margin-bottom:10px">${locName(it.locationId)} · 放入 ${fmtDateTime(it.putTime)}</div>
      <div class="row" style="margin-bottom:10px"><span class="tag ${st.cls}">${st.label}</span>${it.expireAt ? `<span class="muted">到期 ${fmtDate(it.expireAt)}</span>` : '<span class="muted">长期存放</span>'}</div>
      ${photos ? `<div class="photo-row" style="margin-bottom:10px">${photos}</div>` : ''}
      <div class="btn-row">
        <button class="btn" data-act="edit" data-id="${it.id}">✏️ 编辑</button>
        <button class="btn ghost" data-act="handled" data-id="${it.id}">✅ 已处理</button>
        <button class="btn danger" data-act="del-item" data-id="${it.id}">🗑 删除</button>
      </div>`, () => {});
  }

  async function handledItem(id) {
    const it = await DB.get('items', id);
    await DB.put('archive', { original: it, archivedAt: Date.now(), reason: 1 });
    await DB.del('items', id);
    toast('已移至回收桶'); closeModal(); await renderHome(); setTab('home');
  }
  async function deleteItem(id) {
    if (!confirm('确定删除该物品记录？')) return;
    await DB.del('items', id); toast('已删除'); closeModal(); await renderHome(); setTab('home');
  }
  async function editItem(id) {
    const it = await DB.get('items', id);
    await loadLocations();
    it._preview = (it.photoBlobs || []).map(b => URL.createObjectURL(b));
    state.editId = id;
    openModal(itemFormHTML(it), (root) => {
      bindItemForm(root);
      $$('[data-act="del-photo"]', root).forEach(b => b.onclick = async () => { const i = +b.dataset.i; if (it.photoBlobs) it.photoBlobs.splice(i, 1); await DB.put('items', it); editItem(id); });
      $('[data-act="save-item"]', root).onclick = () => saveItemFrom(root, id);
      $('[data-act="close-modal"]', root).onclick = closeModal;
    });
  }

  /* ---------- 拍照 ---------- */
  async function renderScan() {
    $('#view').innerHTML = `
      <div class="card">
        <h3>📷 拍照 / 选图</h3>
        <div class="cam-wrap"><video id="cam" autoplay playsinline muted></video>
          <button class="cam-shot" data-act="capture"></button></div>
        <div class="muted" id="camHint">正在打开相机…若无法打开，可用下方按钮选图</div>
        <input id="camFile" type="file" accept="image/*" capture="environment" style="margin-top:8px">
        <div class="photo-row" id="scanPhotos" style="margin-top:10px"></div>
        <div class="btn-row" style="margin-top:12px">
          <button class="btn block" data-act="scan-done">用这些照片去录入 →</button>
        </div>
      </div>`;
    startCamera();
    $('#camFile').onchange = async () => {
      const f = $('#camFile').files[0]; if (!f) return;
      const b = await compressImage(f); state.pendingPhotos.push(b); renderScanPhotos();
    };
  }
  function renderScanPhotos() {
    $('#scanPhotos').innerHTML = state.pendingPhotos.map((b, i) => `<img class="thumb" src="${URL.createObjectURL(b)}">`).join('');
  }
  async function startCamera() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      state.camStream = s; const v = $('#cam'); if (v) { v.srcObject = s; $('#camHint').textContent = '对准物品，点击下方圆钮拍照'; }
    } catch (e) { const h = $('#camHint'); if (h) h.textContent = '无法打开相机（权限或环境不支持），请直接用「选图」按钮'; }
  }
  function stopCamera() { if (state.camStream) { state.camStream.getTracks().forEach(t => t.stop()); state.camStream = null; } }
  function capturePhoto() {
    const v = $('#cam'); if (!v || !v.videoWidth) { toast('相机未就绪'); return; }
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    c.toBlob(async b => { if (b) { state.pendingPhotos.push(b); renderScanPhotos(); toast('已捕获'); } }, 'image/jpeg', 0.6);
  }

  /* ---------- 我的 ---------- */
  async function renderMore() {
    const items = await DB.getAll('items');
    const archived = (await DB.getAll('archive')).length;
    $('#view').innerHTML = `
      <div class="card">
        <div class="item" data-act="go-view" data-v="locations"><span class="ic">📍</span><div class="meta"><div class="nm">位置管理</div><div class="sub">${state.locations.length} 个位置</div></div><span>›</span></div>
        <div class="item" data-act="go-view" data-v="settings"><span class="ic">🔔</span><div class="meta"><div class="nm">提醒设置</div><div class="sub">提前 ${state.settings.advanceDays} 天提醒</div></div><span>›</span></div>
        <div class="item" data-act="go-view" data-v="backup"><span class="ic">💾</span><div class="meta"><div class="nm">备份与云</div><div class="sub">本地导出 / 导入</div></div><span>›</span></div>
        <div class="item" data-act="go-view" data-v="archive"><span class="ic">🗑</span><div class="meta"><div class="nm">回收桶</div><div class="sub">${archived} 件</div></div><span>›</span></div>
      </div>
      <div class="about">食光盒 v1.0 · 本地优先 · 零依赖 PWA<br>数据存储于本机 IndexedDB，卸载即清除</div>`;
  }

  async function renderLocations() {
    const rows = state.locations.map(l => `
      <div class="item">
        <span class="ic">${l.type === 0 ? '🏠' : '📌'}</span>
        <div class="meta"><div class="nm">${esc(l.name)}</div><div class="sub">${l.type === 0 ? '预置家庭区' : '自定义'}</div></div>
        <button class="btn sm ghost" data-act="rename-loc" data-id="${l.id}">重命名</button>
        ${l.type === 1 ? `<button class="btn sm danger" data-act="del-loc" data-id="${l.id}">删除</button>` : ''}
      </div>`).join('');
    $('#view').innerHTML = `
      <div class="card"><h3>📍 存放位置</h3>${rows || '<div class="empty">暂无</div>'}
        <button class="btn block ghost" data-act="add-loc" style="margin-top:10px">＋ 添加自定义位置</button></div>
      <div class="about">预置 8 个家庭分区，可任意添加子区（如「厨房·冷藏」）或新位置。</div>`;
  }
  async function renderSettings() {
    const s = state.settings;
    $('#view').innerHTML = `
      <div class="card">
        <h3>🔔 提醒设置</h3>
        <div class="set-row"><div><div>提前提醒天数</div><div class="muted">≤此天数视为「快到期」</div></div>
          <input id="set_adv" type="number" min="0" max="30" value="${s.advanceDays}" style="width:80px"></div>
        <div class="set-row"><div><div>到期通知</div><div class="muted">启动时有临期/过期时弹通知</div></div>
          <div class="toggle ${s.notify ? 'on' : ''}" data-act="toggle-notify"></div></div>
        <div class="set-row"><div><div>每日自动日切</div><div class="muted">每日首次启动生成快照</div></div>
          <div class="toggle ${s.daily ? 'on' : ''}" data-act="toggle-daily"></div></div>
        <div class="set-row"><div><div>深色模式</div><div class="muted">跟随系统/手动</div></div>
          <div class="toggle ${s.dark ? 'on' : ''}" data-act="toggle-dark"></div></div>
      </div>
      <button class="btn block ghost" data-act="save-settings" style="margin-bottom:12px">保存设置</button>`;
  }
  async function renderBackup() {
    $('#view').innerHTML = `
      <div class="card">
        <h3>💾 备份与云</h3>
        <p class="muted">数据全部存于本机。导出为 JSON 文件可长期留存；导入可恢复或换机迁移。</p>
        <div class="btn-row">
          <button class="btn" data-act="export">⬇️ 导出备份</button>
          <button class="btn ghost" data-act="import">⬆️ 导入备份</button>
        </div>
        <input id="importFile" type="file" accept="application/json" style="display:none">
      </div>
      <div class="card">
        <h3>☁️ 网盘 / WebDAV（可插拔）</h3>
        <p class="muted">百度网盘、WebDAV、自有云等适配器为「可插拔」设计，需联网与凭证，默认未启用以守住安装体积。后续可在本页接入。</p>
      </div>`;
  }
  async function renderArchive() {
    const list = (await DB.getAll('archive')).sort((a, b) => b.archivedAt - a.archivedAt);
    const rows = list.length ? list.map(a => {
      const o = a.original || {}; const reason = a.reason === 0 ? '过期' : '已处理';
      return `<div class="item"><span class="ic">${avatar(o.name)}</span>
        <div class="meta"><div class="nm">${esc(o.name || '')} ×${o.qty || 1}</div>
        <div class="sub">${locName(o.locationId)} · ${reason} · ${fmtDate(a.archivedAt)}</div></div>
        <button class="btn sm ghost" data-act="restore" data-id="${a.id}">恢复</button>
        <button class="btn sm danger" data-act="purge" data-id="${a.id}">彻底删</button></div>`;
    }).join('') : '<div class="empty">回收桶为空</div>';
    $('#view').innerHTML = `<div class="card"><h3>🗑 回收桶</h3>${rows}</div>
      <div class="about">过期/已处理物品在此暂存，可恢复或彻底删除。</div>`;
  }

  /* ---------- 备份实现 ---------- */
  async function exportBackup() {
    const data = {
      app: 'shiguanghe', version: 1, exportedAt: Date.now(),
      items: await DB.getAll('items'),
      locations: await DB.getAll('locations'),
      archive: await DB.getAll('archive'),
      daily_log: await DB.getAll('daily_log'),
      meta: await DB.getAll('meta')
    };
    // 照片 Blob 转为 base64 以便随 JSON 携带
    for (const it of data.items) {
      if (it.photoBlobs && it.photoBlobs.length) {
        it._photos = [];
        for (const b of it.photoBlobs) it._photos.push(await blobToB64(b));
      }
    }
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `食光盒备份_${dateStr(new Date())}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('已导出');
  }
  function blobToB64(b) { return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.readAsDataURL(b); }); }
  async function importBackup(file) {
    if (!confirm('导入将覆盖当前所有数据，确定继续？建议先导出备份。')) return;
    const text = await file.text();
    let data; try { data = JSON.parse(text); } catch (e) { toast('文件格式错误'); return; }
    for (const st of ['items', 'locations', 'archive', 'daily_log', 'meta']) { await DB.clear(st); }
    if (data.items) { for (const it of data.items) { if (it._photos) { it.photoBlobs = []; for (const s of it._photos) it.photoBlobs.push(b64ToBlob(s)); delete it._photos; } await DB.bulkPut('items', [it]); } }
    if (data.locations) await DB.bulkPut('locations', data.locations);
    if (data.archive) await DB.bulkPut('archive', data.archive);
    if (data.daily_log) await DB.bulkPut('daily_log', data.daily_log);
    if (data.meta) await DB.bulkPut('meta', data.meta);
    await loadLocations(); await renderMore(); setTab('more'); toast('导入完成');
  }
  function b64ToBlob(b64) { const bin = atob(b64); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); return new Blob([arr], { type: 'image/jpeg' }); }

  /* ---------- 导航 ---------- */
  const VIEWS = { home: renderHome, add: renderAdd, list: renderList, more: renderMore, scan: renderScan, locations: renderLocations, settings: renderSettings, backup: renderBackup, archive: renderArchive };
  async function go(view) {
    if (state.view === 'scan') stopCamera();
    state.view = view; state.search = ''; state.filter = 'all';
    await (VIEWS[view] || renderHome)();
    setTab(view);
    const v = $('#view'); v.classList.remove('switch'); void v.offsetWidth; v.classList.add('switch');
  }
  function setTab(view) {
    let hl = view;
    if (view === 'scan') hl = 'add';
    else if (['locations', 'settings', 'backup', 'archive'].includes(view)) hl = 'more';
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === hl));
  }

  /* ---------- 全局事件 ---------- */
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act]'); if (!t) return;
    const act = t.dataset.act;
    try {
      switch (act) {
        case 'go-add': await go('add'); break;
        case 'go-scan': await go('scan'); break;
        case 'go-list': await go('list'); break;
        case 'go-view': await go(t.dataset.v); break;
        case 'filter': state.filter = t.dataset.f; await renderList(); break;
        case 'detail': await openDetail(parseInt(t.dataset.id, 10)); break;
        case 'edit': await editItem(parseInt(t.dataset.id, 10)); break;
        case 'handled': await handledItem(parseInt(t.dataset.id, 10)); break;
        case 'del-item': await deleteItem(parseInt(t.dataset.id, 10)); break;
        case 'capture': capturePhoto(); break;
        case 'scan-done': stopCamera(); state.editId = null; await go('add'); break;
        case 'save-item': { const root = $('#modal').classList.contains('hidden') ? $('#view') : $('#modalCard'); await saveItemFrom(root, state.editId || null); break; }
        case 'close-modal': closeModal(); break;
        case 'add-loc': { const n = prompt('位置名称'); if (n) { await DB.put('locations', { name: n, type: 1, sort: 100 + state.locations.length }); await loadLocations(); await renderLocations(); } break; }
        case 'rename-loc': { const id = parseInt(t.dataset.id, 10); const l = state.locations.find(x => x.id === id); const n = prompt('新名称', l.name); if (n) { l.name = n; await DB.put('locations', l); await loadLocations(); await renderLocations(); } break; }
        case 'del-loc': { const id = parseInt(t.dataset.id, 10); if (confirm('删除该位置？其下物品将变为「未分类」')) { const its = await DB.getAll('items'); for (const it of its) if (it.locationId === id) { it.locationId = state.locations.find(x => x.id !== id)?.id || 0; await DB.put('items', it); } await DB.del('locations', id); await loadLocations(); await renderLocations(); } break; }
        case 'toggle-notify': { state.settings.notify = !state.settings.notify; if (state.settings.notify && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission(); await renderSettings(); break; }
        case 'toggle-daily': state.settings.daily = !state.settings.daily; await renderSettings(); break;
        case 'toggle-dark': state.settings.dark = !state.settings.dark; applyDark(); await renderSettings(); break;
        case 'save-settings': { state.settings.advanceDays = Math.max(0, parseInt($('#set_adv').value, 10) || 3); await DB.setMeta('settings', state.settings); toast('已保存'); await renderHome(); setTab('home'); break; }
        case 'export': await exportBackup(); break;
        case 'import': $('#importFile').click(); break;
        case 'restore': { const id = parseInt(t.dataset.id, 10); const a = await DB.get('archive', id); if (a && a.original) { const o = a.original; delete o.id; await DB.put('items', o); await DB.del('archive', id); await renderArchive(); toast('已恢复'); } break; }
        case 'purge': { const id = parseInt(t.dataset.id, 10); await DB.del('archive', id); await renderArchive(); break; }
      }
    } catch (err) { console.error(err); toast('操作失败：' + err.message); }
  });

  document.addEventListener('change', (e) => {
    if (e.target.id === 'importFile' && e.target.files[0]) importBackup(e.target.files[0]);
  });

  // 底部 tab
  $$('.tab').forEach(t => t.onclick = () => { if (t.dataset.view === 'add' && state.view !== 'scan') state.pendingPhotos = []; go(t.dataset.view); });

  function applyDark() {
    document.body.classList.toggle('dark', !!state.settings.dark);
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  /* ---------- 启动 ---------- */
  async function init() {
    await DB.open(); await DB.seedLocations(); await loadLocations();
    state.settings = await DB.getMeta('settings', { advanceDays: 3, notify: false, daily: true, dark: false });
    applyDark();
    $('#todayLabel').textContent = fmtDate(Date.now());
    if (state.settings.daily) await dailyRoll();
    const items = await DB.getAll('items'); maybeNotify(items);
    await go('home');
    // 注册 Service Worker（缓存应用壳，秒开 + 离线）。原生壳内跳过：资源已本地打包，且无谓耗电
    if ('serviceWorker' in navigator && !window.Capacitor) {
      try { await navigator.serviceWorker.register('./sw.js'); } catch (e) { console.warn('SW 注册失败', e); }
    }
  }
  document.addEventListener('DOMContentLoaded', init);
})();
