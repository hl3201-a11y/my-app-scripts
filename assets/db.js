/* 食光盒 —— 轻量 IndexedDB 数据层（零依赖，结构化存储，体积小） */
const DB = (() => {
  const NAME = 'shiguanghe';
  const VER = 1;
  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VER);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('items')) {
          const s = db.createObjectStore('items', { keyPath: 'id', autoIncrement: true });
          s.createIndex('locationId', 'locationId', { unique: false });
          s.createIndex('expireAt', 'expireAt', { unique: false });
          s.createIndex('putTime', 'putTime', { unique: false });
        }
        if (!db.objectStoreNames.contains('locations')) {
          const s = db.createObjectStore('locations', { keyPath: 'id', autoIncrement: true });
          s.createIndex('type', 'type', { unique: false });
          s.createIndex('sort', 'sort', { unique: false });
        }
        if (!db.objectStoreNames.contains('archive')) {
          const s = db.createObjectStore('archive', { keyPath: 'id', autoIncrement: true });
          s.createIndex('archivedAt', 'archivedAt', { unique: false });
          s.createIndex('reason', 'reason', { unique: false });
        }
        if (!db.objectStoreNames.contains('daily_log')) {
          db.createObjectStore('daily_log', { keyPath: 'date' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  function tx(store, mode) {
    return open().then(db => db.transaction(store, mode).objectStore(store));
  }
  function done(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  function getAll(store) { return tx(store, 'readonly').then(s => done(s.getAll())); }
  function get(store, key) { return tx(store, 'readonly').then(s => done(s.get(key))); }
  function put(store, val) { return tx(store, 'readwrite').then(s => done(s.put(val))); }
  function del(store, key) { return tx(store, 'readwrite').then(s => done(s.delete(key))); }
  function clear(store) { return tx(store, 'readwrite').then(s => done(s.clear())); }

  // 批量写入（用于导入）
  async function bulkPut(store, list) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, 'readwrite');
      const s = t.objectStore(store);
      list.forEach(v => s.put(v));
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  // 预置家庭分区（原子事务：检查+插入在同一事务内，避免并发重复写入）
  async function seedLocations() {
    const db = await open();
    const names = ['厨房', '餐厅', '客厅', '主卧', '次卧一', '次卧二', '厕所', '储物间'];
    return new Promise((resolve, reject) => {
      const t = db.transaction('locations', 'readwrite');
      const store = t.objectStore('locations');
      const cnt = store.count();
      cnt.onsuccess = () => {
        if (cnt.result > 0) { t.oncomplete = resolve; return; }
        let pending = names.length;
        names.forEach((n, i) => {
          const r = store.put({ name: n, type: 0, sort: i });
          r.onsuccess = () => { if (--pending === 0) t.oncomplete = resolve; };
          r.onerror = () => reject(r.error);
        });
      };
      cnt.onerror = () => reject(cnt.error);
      t.onerror = () => reject(t.error);
    });
  }

  // 设置项读写
  async function getMeta(key, def) {
    const r = await get('meta', key);
    return r ? r.value : def;
  }
  async function setMeta(key, value) { return put('meta', { key, value }); }

  return { open, getAll, get, put, del, clear, bulkPut, seedLocations, getMeta, setMeta };
})();
