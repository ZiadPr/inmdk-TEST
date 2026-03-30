// =============================================
// نظام إدارة المخزون - المنطق الرئيسي
// Inventory Management System - Core Logic
// =============================================

'use strict';

// ===== DB CONFIG =====
const DB_NAME = 'InventorySystemDB';
const DB_VERSION = 1;
let db = null;

// Object stores
const STORES = {
  ITEMS: 'items',
  INVENTORY: 'inventoryRecords',
  DISBURSEMENT: 'disbursementRecords',
  SETTINGS: 'settings',
  USERS: 'users'
};

const DEFAULT_WAREHOUSES = [
  'المخزن الرئيسي',
  'مخزن الإنتاج',
  'مخزن الفرع'
];

const SETTINGS_PASSWORD = '2005';
const EMERGENCY_BACKUP_KEY = 'inventory_emergency_backup';
const APP_VERSION = '2.9.5';
const DEFAULT_THEME = 'light';
const DEFAULT_PRIMARY_COLOR = '#2e5b52';
const DEFAULT_ACCENT_COLOR = '#d6a24f';
let deferredInstallPrompt = null;

// ===== INIT DB =====
function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      db = req.result;
      resolve(db);
    };

    req.onupgradeneeded = (e) => {
      const d = e.target.result;

      // Items store
      if (!d.objectStoreNames.contains(STORES.ITEMS)) {
        const s = d.createObjectStore(STORES.ITEMS, { keyPath: 'id', autoIncrement: true });
        s.createIndex('name', 'name', { unique: false });
        s.createIndex('type', 'type', { unique: false });
        s.createIndex('active', 'active', { unique: false });
      }

      // Inventory records
      if (!d.objectStoreNames.contains(STORES.INVENTORY)) {
        const s = d.createObjectStore(STORES.INVENTORY, { keyPath: 'id', autoIncrement: true });
        s.createIndex('date', 'date', { unique: false });
        s.createIndex('user', 'user', { unique: false });
        s.createIndex('dateUser', ['date', 'user'], { unique: false });
      }

      // Disbursement records
      if (!d.objectStoreNames.contains(STORES.DISBURSEMENT)) {
        const s = d.createObjectStore(STORES.DISBURSEMENT, { keyPath: 'id', autoIncrement: true });
        s.createIndex('date', 'date', { unique: false });
        s.createIndex('refNum', 'refNum', { unique: false });
      }

      // Settings
      if (!d.objectStoreNames.contains(STORES.SETTINGS)) {
        d.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
      }

      // Users
      if (!d.objectStoreNames.contains(STORES.USERS)) {
        const s = d.createObjectStore(STORES.USERS, { keyPath: 'id', autoIncrement: true });
        s.createIndex('name', 'name', { unique: true });
      }
    };
  });
}

// ===== DB HELPERS =====
function dbGet(storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbPut(storeName, data) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).put(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbAdd(storeName, data) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).add(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbDelete(storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function dbGetByIndex(storeName, indexName, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).index(indexName).getAll(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbClearStore(storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ===== STATE =====
let state = {
  currentPage: 'dashboard',
  currentUser: 'مستخدم النظام',
  items: [],
  settings: {
    fontSize: 15,
    fontFamily: 'Cairo',
    autoCarryForward: true,
    showZeroItems: true,
    theme: DEFAULT_THEME,
    primaryColor: DEFAULT_PRIMARY_COLOR,
    accentColor: DEFAULT_ACCENT_COLOR
  },
  settingsUnlocked: false,
  inventoryEntryData: [],
  editingItemId: null,
  archiveSearchTerm: '',
  archiveFilterDate: '',
  tableFontSize: 14
};

// ===== UTILS =====
function icon(name, className = '') {
  const cls = ['ui-icon', className].filter(Boolean).join(' ');
  return `<svg class="${cls}" aria-hidden="true"><use href="icons.svg#icon-${name}"></use></svg>`;
}

function normalizeTheme(theme) {
  return theme === 'dark' ? 'dark' : DEFAULT_THEME;
}

function normalizeHexColor(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized.toLowerCase() : fallback;
}

function hexToRgb(hex) {
  const normalized = normalizeHexColor(hex, '#000000').slice(1);
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16)
  };
}

function clampChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function mixHex(baseHex, targetHex, weight = 0.5) {
  const start = hexToRgb(baseHex);
  const end = hexToRgb(targetHex);
  const mix = (from, to) => clampChannel(from + (to - from) * weight);
  return `#${[mix(start.r, end.r), mix(start.g, end.g), mix(start.b, end.b)]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

function rgbaFromHex(hex, alpha = 1) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getReadableTextColor(hex) {
  const { r, g, b } = hexToRgb(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? '#2a1d0a' : '#ffffff';
}

function updateThemeMetaColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const styles = getComputedStyle(document.documentElement);
  const themeColor = (state.settings.theme === 'dark'
    ? styles.getPropertyValue('--sidebar-bg')
    : styles.getPropertyValue('--primary-mid')).trim();
  meta.setAttribute('content', themeColor || DEFAULT_PRIMARY_COLOR);
}

function applyThemeColors() {
  const root = document.documentElement;
  const theme = normalizeTheme(state.settings.theme);
  const primary = normalizeHexColor(state.settings.primaryColor, DEFAULT_PRIMARY_COLOR);
  const accent = normalizeHexColor(state.settings.accentColor, DEFAULT_ACCENT_COLOR);

  state.settings.theme = theme;
  state.settings.primaryColor = primary;
  state.settings.accentColor = accent;

  root.style.setProperty('--primary', primary);
  root.style.setProperty('--primary-mid', mixHex(primary, theme === 'dark' ? '#ffffff' : '#000000', theme === 'dark' ? 0.12 : 0.18));
  root.style.setProperty('--primary-light', mixHex(primary, '#ffffff', theme === 'dark' ? 0.20 : 0.14));
  root.style.setProperty('--primary-pale', rgbaFromHex(primary, theme === 'dark' ? 0.18 : 0.14));
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-light', rgbaFromHex(accent, theme === 'dark' ? 0.22 : 0.18));
  root.style.setProperty('--accent-ink', getReadableTextColor(accent));
  root.style.setProperty('--focus-ring', rgbaFromHex(primary, theme === 'dark' ? 0.28 : 0.18));
  root.style.setProperty('--hero-glow', rgbaFromHex(accent, theme === 'dark' ? 0.24 : 0.18));
  root.style.setProperty('--sidebar-active', primary);
  updateThemeMetaColor();
}

function previewAppearanceSettings() {
  const fontSizeInput = document.getElementById('setting-font-size');
  const fontFamilyInput = document.getElementById('setting-font-family');
  const themeInput = document.getElementById('setting-theme');
  const primaryColorInput = document.getElementById('setting-primary-color');
  const accentColorInput = document.getElementById('setting-accent-color');

  if (fontSizeInput) {
    state.settings.fontSize = parseInt(fontSizeInput.value, 10) || 15;
    document.getElementById('setting-font-size-display').textContent = `${state.settings.fontSize}px`;
  }

  if (fontFamilyInput) {
    state.settings.fontFamily = fontFamilyInput.value || 'Cairo';
  }

  if (themeInput) {
    state.settings.theme = normalizeTheme(themeInput.value);
  }

  if (primaryColorInput) {
    state.settings.primaryColor = normalizeHexColor(primaryColorInput.value, DEFAULT_PRIMARY_COLOR);
  }

  if (accentColorInput) {
    state.settings.accentColor = normalizeHexColor(accentColorInput.value, DEFAULT_ACCENT_COLOR);
  }

  applySettings();
}

function parseDateValue(dateStr) {
  if (!dateStr) return null;
  const [year, month, day] = String(dateStr).split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function today() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = parseDateValue(dateStr);
  if (!d) return '';
  return d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  return dateStr; // Already YYYY-MM-DD
}

function getDateSortValue(dateStr) {
  const d = parseDateValue(dateStr);
  return d ? d.getTime() : 0;
}

function formatMonthLabel(monthValue) {
  if (!monthValue) return '';
  const [year, month] = String(monthValue).split('-').map(Number);
  if (!year || !month) return monthValue;
  return new Date(year, month - 1, 1).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long' });
}

function formatNum(n) {
  if (n === null || n === undefined || n === '') return '-';
  const num = Number(n);
  if (isNaN(num)) return '-';
  if (num === 0) return '0';
  return num.toLocaleString('ar-EG', { maximumFractionDigits: 2 });
}

function getTypeLabel(type) {
  const map = {
    'تمري': { label: 'تمري', cls: 'tamr' },
    'دقهلية': { label: 'دقهلية', cls: 'daqhlia' },
    'استيكرات': { label: 'استيكرات', cls: 'sticker' },
    'الاطباق': { label: 'أطباق', cls: 'other' },
    'المتبل': { label: 'متبل', cls: 'other' },
  };
  return map[type] || { label: type || 'أخرى', cls: 'other' };
}

function showToast(msg, type = 'success') {
  const c = document.getElementById('toast-container');
  const iconMap = { success: 'check-circle', error: 'x-circle', warning: 'alert', info: 'info' };
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `${icon(iconMap[type] || 'info', 'toast-icon')}<span class="toast-msg"></span>`;
  t.querySelector('.toast-msg').textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function showLoading(show) {
  document.getElementById('loading-overlay').classList.toggle('hidden', !show);
}

function confirmDialog(msg) {
  return window.confirm(msg);
}

function escapeCsvValue(value) {
  const str = String(value ?? '');
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsv(rows) {
  return rows.map((row) => row.map((value) => escapeCsvValue(value)).join(',')).join('\n');
}

function updateCurrentUserAvatar(name = state.currentUser) {
  const avatar = document.getElementById('current-user-avatar');
  if (!avatar) return;
  const cleanName = String(name || '').trim();
  avatar.textContent = cleanName ? cleanName.charAt(0) : 'م';
}

function updateConnectivityStatus() {
  const badge = document.getElementById('connectivity-badge');
  const text = document.getElementById('connectivity-status-text');
  if (!badge || !text) return;

  const online = navigator.onLine;
  badge.classList.toggle('offline', !online);
  text.textContent = online ? 'جاهز دون اتصال' : 'أنت الآن دون اتصال';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadCSV(csvContent, filename) {
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, filename);
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if (char === '\n' && !inQuotes) {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    if (char !== '\r') {
      field += char;
    }
  }

  row.push(field);
  if (row.some((cell) => String(cell).trim() !== '')) {
    rows.push(row);
  }

  return rows;
}

// ===== BACKUP / RESTORE =====
async function legacyExportSystemBackup() {
  showLoading(true);
  try {
    const [items, inventoryRecords, disbursementRecords, settingsRecords, users] = await Promise.all([
      dbGetAll(STORES.ITEMS),
      dbGetAll(STORES.INVENTORY),
      dbGetAll(STORES.DISBURSEMENT),
      dbGetAll(STORES.SETTINGS),
      dbGetAll(STORES.USERS)
    ]);

    const payload = {
      meta: {
        app: 'Inventory Manager',
        schemaVersion: 1,
        exportedAt: new Date().toISOString()
      },
      data: {
        items,
        inventoryRecords,
        disbursementRecords,
        settings: settingsRecords,
        users
      }
    };

    const fileDate = today();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    downloadBlob(blob, `نسخة_احتياطية_المخزون_${fileDate}.json`);
    showToast('تم إنشاء النسخة الاحتياطية بنجاح');
  } catch (error) {
    console.error('Backup Export Error:', error);
    showToast('حدث خطأ أثناء إنشاء النسخة الاحتياطية', 'error');
  } finally {
    showLoading(false);
  }
}

async function legacyRestoreSystemBackup() {
  const input = document.getElementById('backup-restore-file');
  const file = input?.files?.[0];

  if (!file) {
    showToast('يرجى اختيار ملف النسخة الاحتياطية أولاً', 'error');
    return;
  }

  if (!confirmDialog('سيتم استبدال جميع البيانات الحالية بمحتوى النسخة الاحتياطية. هل تريد المتابعة؟')) return;
  if (!confirmDialog('تأكيد أخير: سيتم حذف البيانات الحالية نهائياً قبل الاستعادة.')) return;

  showLoading(true);
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const source = parsed?.data || parsed || {};

    const items = Array.isArray(source.items) ? source.items : [];
    const inventoryRecords = Array.isArray(source.inventoryRecords) ? source.inventoryRecords : [];
    const disbursementRecords = Array.isArray(source.disbursementRecords) ? source.disbursementRecords : [];
    const users = Array.isArray(source.users) ? source.users : [];
    const settings = Array.isArray(source.settings) ? source.settings : [];

    const hasKnownData =
      Array.isArray(source.items) ||
      Array.isArray(source.inventoryRecords) ||
      Array.isArray(source.disbursementRecords) ||
      Array.isArray(source.users) ||
      Array.isArray(source.settings);

    if (!hasKnownData) {
      showToast('ملف النسخة الاحتياطية غير صالح', 'error');
      return;
    }

    const storesOrder = [STORES.ITEMS, STORES.INVENTORY, STORES.DISBURSEMENT, STORES.USERS, STORES.SETTINGS];
    for (const storeName of storesOrder) {
      await dbClearStore(storeName);
    }

    for (const item of items) {
      if (item && typeof item === 'object') await dbPut(STORES.ITEMS, item);
    }
    for (const rec of inventoryRecords) {
      if (rec && typeof rec === 'object') await dbPut(STORES.INVENTORY, rec);
    }
    for (const rec of disbursementRecords) {
      if (rec && typeof rec === 'object') await dbPut(STORES.DISBURSEMENT, rec);
    }
    for (const user of users) {
      if (user && typeof user === 'object') await dbPut(STORES.USERS, user);
    }
    for (const s of settings) {
      if (s && typeof s === 'object' && s.key) await dbPut(STORES.SETTINGS, s);
    }

    // Ensure main settings always exist after restore.
    const mainSettings = await dbGet(STORES.SETTINGS, 'main');
    if (!mainSettings) {
      await dbPut(STORES.SETTINGS, { key: 'main', value: state.settings });
    }

    input.value = '';
    showToast('تمت استعادة النسخة الاحتياطية بنجاح. جارٍ تحديث الواجهة...');
    setTimeout(() => location.reload(), 700);
  } catch (error) {
    console.error('Backup Restore Error:', error);
    showToast('فشل استعادة النسخة الاحتياطية. تأكد من صحة الملف', 'error');
  } finally {
    showLoading(false);
  }
}

// ===== NAV =====
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const target = document.getElementById(`page-${page}`);
  if (target) target.classList.add('active');

  const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navItem) navItem.classList.add('active');

  state.currentPage = page;

  // Update header title
  const titles = {
    dashboard: 'لوحة التحكم',
    inventory: 'إدخال الجرد اليومي',
    disbursement: 'إذن الصرف',
    archive: 'أرشيف الجرود',
    items: 'إدارة الأصناف',
    settings: 'الإعدادات',
    about: 'عن البرنامج'
  };
  document.getElementById('header-page-title').textContent = titles[page] || page;

  // Load page data
  loadPageData(page);

  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('open');
  closeBackupMenu?.();
}

async function loadPageData(page) {
  switch (page) {
    case 'dashboard': await loadDashboard(); break;
    case 'inventory': await loadInventoryEntry(); break;
    case 'disbursement': await loadDisbursementPage(); break;
    case 'archive': await loadArchive(); break;
    case 'items': await loadItemsPage(); break;
    case 'settings': await loadSettings(); break;
  }
}

// ===== DASHBOARD =====
async function loadDashboard() {
  const items = await dbGetAll(STORES.ITEMS);
  const inventoryRecords = await dbGetAll(STORES.INVENTORY);
  const disbursements = await dbGetAll(STORES.DISBURSEMENT);

  // Stats
  document.getElementById('stat-items-count').textContent = items.filter(i => i.active !== false).length;
  document.getElementById('stat-records-count').textContent = inventoryRecords.length;
  document.getElementById('stat-disbursement-count').textContent = disbursements.length;

  // Recent inventory records
  const sortedRecords = [...inventoryRecords].sort((a, b) => getDateSortValue(b.date) - getDateSortValue(a.date));
  const recent = sortedRecords.slice(0, 5);

  const tbody = document.getElementById('recent-inventory-tbody');
  if (recent.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:24px; color:var(--text-muted);">لا توجد سجلات حتى الآن</td></tr>`;
    return;
  }

  tbody.innerHTML = recent.map(rec => {
    const itemCount = rec.entries ? rec.entries.length : 0;
    const totalQty = rec.entries ? rec.entries.reduce((s, e) => s + (Number(e.closingBalance) || 0), 0) : 0;
    return `
      <tr>
        <td>${formatDate(rec.date)}</td>
        <td>${rec.user || '-'}</td>
        <td class="num">${itemCount}</td>
        <td class="num">${formatNum(totalQty)}</td>
        <td><button class="btn btn-sm btn-outline" onclick="viewArchiveRecord(${rec.id})">${icon('clipboard')} عرض</button></td>
      </tr>
    `;
  }).join('');

  // Last record for today's date
  const todayDate = today();
  const todayRec = inventoryRecords.find(r => r.date === todayDate);
  document.getElementById('stat-today-status').textContent = todayRec ? 'تم الجرد' : 'لم يُسجل بعد';
}

// ===== ITEMS MANAGEMENT =====
async function loadItemsPage() {
  state.items = await dbGetAll(STORES.ITEMS);
  renderItemsTable();
}

function renderItemsTable() {
  const search = document.getElementById('items-search')?.value?.toLowerCase() || '';
  const filterType = document.getElementById('items-filter-type')?.value || '';

  let filtered = state.items.filter(i => {
    const matchSearch = !search || i.name.toLowerCase().includes(search) || (i.type || '').toLowerCase().includes(search);
    const matchType = !filterType || i.type === filterType;
    return matchSearch && matchType;
  });

  const tbody = document.getElementById('items-tbody');
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:28px;color:var(--text-muted);">لا توجد أصناف مطابقة</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((item, idx) => {
    const typeInfo = getTypeLabel(item.type);
    return `
      <tr>
        <td>${idx + 1}</td>
        <td class="row-name">${item.name}</td>
        <td><span class="type-tag ${typeInfo.cls}">${typeInfo.label}</span></td>
        <td><span class="badge ${item.active !== false ? 'badge-success' : 'badge-danger'}">${item.active !== false ? 'نشط' : 'معطل'}</span></td>
        <td>
          <button class="btn btn-sm btn-outline" onclick="openEditItem(${item.id})" title="تعديل">${icon('edit')}</button>
          <button class="btn btn-sm btn-danger btn-icon" onclick="deleteItem(${item.id})" title="حذف" style="margin-right:4px;">${icon('trash')}</button>
        </td>
      </tr>
    `;
  }).join('');

  document.getElementById('items-count-label').textContent = `${filtered.length} صنف`;
}

function openAddItemModal() {
  state.editingItemId = null;
  document.getElementById('item-modal-title').textContent = 'إضافة صنف جديد';
  document.getElementById('item-name-input').value = '';
  document.getElementById('item-type-input').value = 'تمري';
  document.getElementById('item-modal').classList.add('open');
  document.getElementById('item-name-input').focus();
}

function openEditItem(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;
  state.editingItemId = id;
  document.getElementById('item-modal-title').textContent = 'تعديل الصنف';
  document.getElementById('item-name-input').value = item.name;
  document.getElementById('item-type-input').value = item.type || 'تمري';
  document.getElementById('item-modal').classList.add('open');
}

async function saveItem() {
  const name = document.getElementById('item-name-input').value.trim();
  const type = document.getElementById('item-type-input').value;
  if (!name) { showToast('يرجى إدخال اسم الصنف', 'error'); return; }

  if (state.editingItemId) {
    const existing = state.items.find(i => i.id === state.editingItemId);
    await dbPut(STORES.ITEMS, { ...existing, name, type });
    showToast('تم تحديث الصنف بنجاح');
  } else {
    // Check duplicate
    const dup = state.items.find(i => i.name === name && i.type === type);
    if (dup) { showToast('هذا الصنف موجود بالفعل', 'warning'); return; }
    await dbAdd(STORES.ITEMS, { name, type, active: true, createdAt: new Date().toISOString() });
    showToast('تمت إضافة الصنف بنجاح');
  }

  closeModal('item-modal');
  await loadItemsPage();
}

async function deleteItem(id) {
  if (!confirmDialog('هل تريد حذف هذا الصنف نهائياً؟')) return;
  await dbDelete(STORES.ITEMS, id);
  showToast('تم حذف الصنف', 'warning');
  await loadItemsPage();
}

// ===== BULK IMPORT =====
function parseBulkImport() {
  const text = document.getElementById('bulk-import-text').value.trim();
  if (!text) { showToast('الحقل فارغ', 'error'); return; }

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  document.getElementById('bulk-preview').innerHTML = '';
  let parsed = [];

  lines.forEach(line => {
    // Try to detect type from line or use default
    const parts = line.split('\t');
    let name = parts[0] || line;
    let type = parts[1] || detectType(name);
    name = name.trim();
    if (name) parsed.push({ name, type });
  });

  if (parsed.length === 0) { showToast('لم يتم التعرف على أي أصناف', 'error'); return; }

  const preview = document.getElementById('bulk-preview');
  preview.innerHTML = `
    <div class="alert alert-info">تم التعرف على <strong>${parsed.length}</strong> صنف. راجع القائمة قبل الاستيراد:</div>
    <div class="table-wrapper">
    <table>
      <thead><tr><th>#</th><th>اسم الصنف</th><th>النوع</th></tr></thead>
      <tbody>
        ${parsed.map((p, i) => `<tr><td>${i+1}</td><td>${p.name}</td><td><span class="type-tag ${getTypeLabel(p.type).cls}">${getTypeLabel(p.type).label}</span></td></tr>`).join('')}
      </tbody>
    </table>
    </div>
    <div style="margin-top:12px;">
      <button class="btn btn-success" onclick="confirmBulkImport(${JSON.stringify(parsed).replace(/"/g,'&quot;')})">${icon('check-circle')} تأكيد الاستيراد</button>
      <button class="btn btn-outline" onclick="document.getElementById('bulk-preview').innerHTML=''" style="margin-right:8px;">${icon('x-circle')} إلغاء</button>
    </div>
  `;
}

function detectType(name) {
  if (name.includes('دقهلية') || name.includes('دجاج') || name.includes('مفروم') || name.includes('فيلية')) return 'دقهلية';
  if (name.includes('استيكر') || name.includes('ستيكر')) return 'استيكرات';
  if (name.includes('طبق') || name.includes('أطباق') || name.includes('فوم')) return 'الاطباق';
  if (name.includes('متبل') || name.includes('بلاستيك')) return 'المتبل';
  return 'تمري';
}

async function confirmBulkImport(data) {
  showLoading(true);
  let added = 0, skipped = 0;
  const existing = await dbGetAll(STORES.ITEMS);
  const existingKeys = new Set(existing.map(i => `${i.name}::${i.type || ''}`));

  for (const item of data) {
    const itemKey = `${item.name}::${item.type || ''}`;
    if (existingKeys.has(itemKey)) { skipped++; continue; }
    await dbAdd(STORES.ITEMS, { name: item.name, type: item.type, active: true, createdAt: new Date().toISOString() });
    existingKeys.add(itemKey);
    added++;
  }
  showLoading(false);
  showToast(`تم استيراد ${added} صنف. تم تخطي ${skipped} مكرر.`);
  document.getElementById('bulk-import-text').value = '';
  document.getElementById('bulk-preview').innerHTML = '';
  await loadItemsPage();
}

// ===== INVENTORY ENTRY =====
async function getDisbursementTotalsByDate(date) {
  if (!date) return {};
  const disbursements = await dbGetByIndex(STORES.DISBURSEMENT, 'date', date);
  const totals = {};
  disbursements.forEach((rec) => {
    (rec.entries || []).forEach((entry) => {
      const itemId = Number(entry.itemId);
      const qty = Number(entry.qty) || 0;
      if (!itemId || qty <= 0) return;
      totals[itemId] = (totals[itemId] || 0) + qty;
    });
  });
  return totals;
}

function getCarryForwardSourceRecord(records, selectedDate, excludedId) {
  const selectedDateSort = getDateSortValue(selectedDate);
  if (!selectedDateSort) return null;

  return records
    .filter((rec) => rec.id !== excludedId && getDateSortValue(rec.date) < selectedDateSort)
    .sort((a, b) => {
      const dateDiff = getDateSortValue(b.date) - getDateSortValue(a.date);
      if (dateDiff !== 0) return dateDiff;

      const aTime = new Date(a.createdAt || 0).getTime();
      const bTime = new Date(b.createdAt || 0).getTime();
      if (aTime !== bTime) return bTime - aTime;

      return Number(b.id || 0) - Number(a.id || 0);
    })[0] || null;
}

function getRecordByDate(records, date) {
  return records.find((rec) => rec.date === date) || null;
}

function updateCarryForwardBanner({ sourceRecord, selectedDate, existingRecord }) {
  const banner = document.getElementById('carry-forward-banner');
  if (!banner) return;

  if (!state.settings.autoCarryForward) {
    banner.classList.add('hidden');
    banner.innerHTML = '';
    return;
  }

  if (existingRecord) {
    banner.classList.remove('hidden');
    banner.innerHTML = `تم تحميل الجرد المحفوظ بتاريخ <strong>${formatDate(selectedDate)}</strong>، وتظهر أرصدة أول الوردية كما تم حفظها لهذا اليوم.`;
    return;
  }

  if (sourceRecord) {
    const itemsCount = Array.isArray(sourceRecord.entries) ? sourceRecord.entries.length : 0;
    banner.classList.remove('hidden');
    banner.innerHTML = `تم ترحيل <strong>رصيد آخر الوردية</strong> من جرد <strong>${formatDate(sourceRecord.date)}</strong> تلقائياً إلى <strong>رصيد أول الوردية</strong> بتاريخ <strong>${formatDate(selectedDate)}</strong> لعدد <strong>${itemsCount}</strong> صنف.`;
    return;
  }

  banner.classList.remove('hidden');
  banner.innerHTML = `لا يوجد جرد سابق قبل <strong>${formatDate(selectedDate)}</strong>، لذلك يبدأ <strong>رصيد أول الوردية</strong> من الصفر حتى يتم حفظ أول جرد.`;
}

async function loadInventoryEntry() {
  state.items = await dbGetAll(STORES.ITEMS);
  const activeItems = state.items.filter(i => i.active !== false);

  // Set date
  const dateInput = document.getElementById('inv-date');
  if (!dateInput.value) dateInput.value = today();
  const selectedDate = dateInput.value;

  const allRecords = await dbGetAll(STORES.INVENTORY);
  const existingRecord = getRecordByDate(allRecords, selectedDate);
  const previousRecord = state.settings.autoCarryForward
    ? getCarryForwardSourceRecord(allRecords, selectedDate, existingRecord?.id)
    : null;

  // Load users
  const users = await dbGetAll(STORES.USERS);
  const userSelect = document.getElementById('inv-user');
  userSelect.innerHTML = `<option value="">-- اختر المستخدم --</option>` +
    users.map(u => `<option value="${u.name}">${u.name}</option>`).join('');
  userSelect.value = existingRecord?.user || state.currentUser || '';
  document.getElementById('inv-notes').value = existingRecord?.notes || '';

  const disbursementTotals = await getDisbursementTotalsByDate(selectedDate);

  // Build entry rows
  state.inventoryEntryData = activeItems.map(item => {
    const existingEntry = existingRecord?.entries?.find(e => Number(e.itemId) === Number(item.id));
    const prevEntry = previousRecord?.entries?.find(e => Number(e.itemId) === Number(item.id));

    const openingBalance = existingEntry
      ? (Number(existingEntry.openingBalance) || 0)
      : (Number(prevEntry?.closingBalance) || 0);
    const received = existingEntry ? (Number(existingEntry.received) || 0) : 0;
    const linkedDisbursed = Number(disbursementTotals[item.id]) || 0;
    const closing = openingBalance + received - linkedDisbursed;

    return {
      itemId: item.id,
      itemName: item.name,
      itemType: item.type,
      openingBalance,
      received,
      disbursed: linkedDisbursed,
      closing
    };
  });

  const finalExportDateInput = document.getElementById('final-export-date');
  if (finalExportDateInput) finalExportDateInput.value = selectedDate;

  updateCarryForwardBanner({
    sourceRecord: previousRecord,
    selectedDate,
    existingRecord
  });

  renderInventoryEntryTable();
}

function renderInventoryEntryTable() {
  const tbody = document.getElementById('inv-entry-tbody');
  const showZero = document.getElementById('inv-show-zero')?.checked !== false;
  const search = document.getElementById('inv-search')?.value?.toLowerCase() || '';
  const filterType = document.getElementById('inv-filter-type')?.value || '';

  let rows = state.inventoryEntryData;
  if (!showZero) rows = rows.filter(r => r.openingBalance > 0 || r.received > 0 || r.closing > 0);
  if (search) rows = rows.filter(r => r.itemName.toLowerCase().includes(search));
  if (filterType) rows = rows.filter(r => r.itemType === filterType);

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted);">لا توجد أصناف</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((row, i) => {
    const typeInfo = getTypeLabel(row.itemType);
    const calcClosing = (Number(row.openingBalance) + Number(row.received) - Number(row.disbursed));
    return `
      <tr data-item-id="${row.itemId}">
        <td>${i + 1}</td>
        <td class="row-name">${row.itemName}</td>
        <td class="row-type"><span class="type-tag ${typeInfo.cls}">${typeInfo.label}</span></td>
        <td class="row-opening">${formatNum(row.openingBalance)}</td>
        <td><input type="number" min="0" step="0.01" inputmode="decimal" enterkeyhint="next" value="${row.received || 0}" 
          onchange="updateEntryField(${row.itemId}, 'received', this.value)"
          oninput="updateEntryField(${row.itemId}, 'received', this.value)" /></td>
        <td><input type="number" min="0" step="0.01" value="${row.disbursed || 0}" readonly class="linked-disbursed-input" title="هذه الكمية مرتبطة بأذونات الصرف لنفس التاريخ" /></td>
        <td><input type="number" min="0" step="0.01" inputmode="decimal" enterkeyhint="next" value="${row.closing !== undefined ? row.closing : calcClosing}"
          onchange="updateEntryField(${row.itemId}, 'closing', this.value)"
          oninput="updateEntryField(${row.itemId}, 'closing', this.value)"
          style="font-weight:800; color:var(--success);" /></td>
      </tr>
    `;
  }).join('');
  setupQuickEntryInputs();
}

function updateEntryField(itemId, field, value) {
  const row = state.inventoryEntryData.find(r => r.itemId === itemId);
  if (!row) return;
  row[field] = parseFloat(value) || 0;
  // Auto-calculate closing if received or disbursed changed
  if (field === 'received' || field === 'disbursed') {
    const calc = Number(row.openingBalance) + Number(row.received) - Number(row.disbursed);
    row.closing = calc;
    // Update the closing input in the same row
    const tr = document.querySelector(`tr[data-item-id="${itemId}"]`);
    if (tr) {
      const inputs = tr.querySelectorAll('input');
      if (inputs[2]) inputs[2].value = calc.toFixed(2);
    }
  }
}

async function saveInventoryRecord() {
  const date = document.getElementById('inv-date').value;
  const user = document.getElementById('inv-user').value;
  const notes = document.getElementById('inv-notes').value;

  if (!date) { showToast('يرجى تحديد تاريخ الجرد', 'error'); return; }
  if (!user) { showToast('يرجى اختيار اسم المستخدم', 'error'); return; }

  // Check if a record for this date already exists
  const all = await dbGetAll(STORES.INVENTORY);
  const existing = all.find(r => r.date === date);
  if (existing) {
    if (!confirmDialog(`يوجد جرد مسجل بتاريخ ${formatDate(date)} بالفعل. هل تريد استبداله؟`)) return;
    await dbDelete(STORES.INVENTORY, existing.id);
  }

  const record = {
    date,
    user,
    notes,
    createdAt: new Date().toISOString(),
    entries: state.inventoryEntryData.map(r => ({
      itemId: r.itemId,
      itemName: r.itemName,
      itemType: r.itemType,
      openingBalance: Number(r.openingBalance) || 0,
      received: Number(r.received) || 0,
      disbursed: Number(r.disbursed) || 0,
      closingBalance: Number(r.closing) || 0
    }))
  };

  showLoading(true);
  await dbAdd(STORES.INVENTORY, record);
  showLoading(false);
  showToast(`تم حفظ جرد ${formatDate(date)} بنجاح`);
  state.currentUser = user;
  updateCurrentUserAvatar();
}

// ===== DISBURSEMENT =====
function renderWarehouseOptions() {
  const select = document.getElementById('disb-warehouse');
  if (!select) return;
  select.innerHTML = `<option value="">-- اختر المخزن --</option>` +
    DEFAULT_WAREHOUSES.map((name) => `<option value="${name}">${name}</option>`).join('');
}

async function loadDisbursementPage() {
  state.items = await dbGetAll(STORES.ITEMS);
  const activeItems = state.items.filter(i => i.active !== false);

  const dateInput = document.getElementById('disb-date');
  if (!dateInput.value) dateInput.value = today();

  const users = await dbGetAll(STORES.USERS);
  const userSelect = document.getElementById('disb-user');
  userSelect.innerHTML = `<option value="">-- اختر المستخدم --</option>` +
    users.map(u => `<option value="${u.name}">${u.name}</option>`).join('');
  renderWarehouseOptions();

  // Generate ref number
  const allDisb = await dbGetAll(STORES.DISBURSEMENT);
  const refNum = `صرف-${String(allDisb.length + 1).padStart(4, '0')}`;
  document.getElementById('disb-ref').value = refNum;
  document.getElementById('disb-request-num').value = '';
  document.getElementById('disb-warehouse').value = DEFAULT_WAREHOUSES[0] || '';
  document.getElementById('disb-destination').value = '';
  document.getElementById('disb-notes').value = '';

  // Build rows
  renderDisbursementRows(activeItems);

  // Load recent disbursements
  const recent = allDisb.sort((a, b) => getDateSortValue(b.date) - getDateSortValue(a.date)).slice(0, 10);
  const tbody = document.getElementById('disb-history-tbody');
  if (recent.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text-muted);">لا يوجد سجل صرف</td></tr>`;
    return;
  }
  tbody.innerHTML = recent.map(d => `
    <tr>
      <td><span class="issue-num">${d.refNum}</span></td>
      <td>${d.requestNum || '-'}</td>
      <td>${d.warehouse || '-'}</td>
      <td>${formatDate(d.date)}</td>
      <td>${d.user || '-'}</td>
      <td class="num">${d.entries ? d.entries.filter(e => Number(e.qty) > 0).length : 0}</td>
      <td>
        <button class="btn btn-sm btn-outline" onclick="viewDisbursement(${d.id})">${icon('clipboard')}</button>
        <button class="btn btn-sm btn-danger btn-icon" onclick="deleteDisbursement(${d.id})" style="margin-right:4px;">${icon('trash')}</button>
      </td>
    </tr>
  `).join('');
}

function renderDisbursementRows(items) {
  const tbody = document.getElementById('disb-items-tbody');
  tbody.innerHTML = items.map(item => {
    const typeInfo = getTypeLabel(item.type);
    return `
      <tr>
        <td class="row-name">${item.name}</td>
        <td class="row-type"><span class="type-tag ${typeInfo.cls}">${typeInfo.label}</span></td>
        <td><input type="number" min="0" step="0.01" inputmode="decimal" enterkeyhint="next" value="0" class="disb-qty" data-item-id="${item.id}" data-item-name="${item.name}" data-item-type="${item.type}" /></td>
        <td><input type="text" placeholder="ملاحظة..." class="disb-note" data-item-id="${item.id}" /></td>
      </tr>
    `;
  }).join('');
  setupQuickEntryInputs();
}

async function syncInventoryWithDisbursementDate(date) {
  if (!date) return false;
  const inventoryRecords = await dbGetByIndex(STORES.INVENTORY, 'date', date);
  const inventoryRecord = inventoryRecords[0];
  if (!inventoryRecord) return false;

  const disbursementTotals = await getDisbursementTotalsByDate(date);
  inventoryRecord.entries = (inventoryRecord.entries || []).map((entry) => {
    const itemId = Number(entry.itemId);
    const openingBalance = Number(entry.openingBalance) || 0;
    const received = Number(entry.received) || 0;
    const disbursed = Number(disbursementTotals[itemId]) || 0;
    return {
      ...entry,
      disbursed,
      closingBalance: openingBalance + received - disbursed
    };
  });

  await dbPut(STORES.INVENTORY, inventoryRecord);
  return true;
}

async function saveDisbursement() {
  const date = document.getElementById('disb-date').value;
  const user = document.getElementById('disb-user').value;
  const refNum = document.getElementById('disb-ref').value;
  const requestNum = document.getElementById('disb-request-num').value.trim();
  const warehouse = document.getElementById('disb-warehouse').value;
  const notes = document.getElementById('disb-notes').value;
  const dest = document.getElementById('disb-destination').value;

  if (!date) { showToast('يرجى تحديد تاريخ الصرف', 'error'); return; }
  if (!user) { showToast('يرجى اختيار اسم المستخدم', 'error'); return; }

  // Collect entries
  const qtyInputs = document.querySelectorAll('.disb-qty');
  const noteInputs = document.querySelectorAll('.disb-note');
  const entries = [];
  qtyInputs.forEach((inp, i) => {
    const qty = parseFloat(inp.value) || 0;
    if (qty > 0) {
      entries.push({
        itemId: parseInt(inp.dataset.itemId),
        itemName: inp.dataset.itemName,
        itemType: inp.dataset.itemType,
        qty,
        note: noteInputs[i]?.value || ''
      });
    }
  });

  if (entries.length === 0) { showToast('لم يتم إدخال أي كميات صرف', 'warning'); return; }

  const record = {
    date,
    user,
    refNum,
    requestNum,
    warehouse,
    notes,
    destination: dest,
    createdAt: new Date().toISOString(),
    entries
  };
  showLoading(true);
  await dbAdd(STORES.DISBURSEMENT, record);
  const wasLinked = await syncInventoryWithDisbursementDate(date);
  showLoading(false);
  showToast(wasLinked
    ? `تم حفظ إذن الصرف ${refNum} وربطه بالجرد تلقائياً`
    : `تم حفظ إذن الصرف ${refNum} بنجاح`);
  state.currentUser = user;
  updateCurrentUserAvatar();
  await loadDisbursementPage();
}

async function deleteDisbursement(id) {
  if (!confirmDialog('هل تريد حذف إذن الصرف هذا؟')) return;
  const rec = await dbGet(STORES.DISBURSEMENT, id);
  await dbDelete(STORES.DISBURSEMENT, id);
  if (rec?.date) await syncInventoryWithDisbursementDate(rec.date);
  showToast('تم حذف إذن الصرف', 'warning');
  await loadDisbursementPage();
}

async function viewDisbursement(id) {
  const rec = await dbGet(STORES.DISBURSEMENT, id);
  if (!rec) return;
  const modal = document.getElementById('view-modal');
  document.getElementById('view-modal-title').textContent = `إذن الصرف: ${rec.refNum}`;
  document.getElementById('view-modal-body').innerHTML = `
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:14px;">
      <div class="header-badge">${icon('calendar')} ${formatDate(rec.date)}</div>
      <div class="header-badge">${icon('user')} ${rec.user}</div>
      <div class="header-badge">${icon('tag')} ${rec.destination || 'غير محدد'}</div>
      <div class="header-badge">${icon('store')} ${rec.warehouse || 'غير محدد'}</div>
      <div class="header-badge">${icon('hash')} ${rec.requestNum || 'بدون رقم طلب'}</div>
    </div>
    ${rec.notes ? `<div class="alert alert-info">${icon('document')} ${rec.notes}</div>` : ''}
    <div class="table-wrapper">
    <table>
      <thead><tr><th>#</th><th>الصنف</th><th>النوع</th><th>الكمية</th><th>ملاحظة</th></tr></thead>
      <tbody>
        ${rec.entries.map((e, i) => `
          <tr>
            <td>${i+1}</td>
            <td>${e.itemName}</td>
            <td><span class="type-tag ${getTypeLabel(e.itemType).cls}">${getTypeLabel(e.itemType).label}</span></td>
            <td class="num">${formatNum(e.qty)}</td>
            <td>${e.note || '-'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    </div>
  `;
  modal.classList.add('open');
}

// ===== ARCHIVE =====
async function loadArchive() {
  const records = await dbGetAll(STORES.INVENTORY);
  const sorted = records.sort((a, b) => getDateSortValue(b.date) - getDateSortValue(a.date));
  renderArchiveCards(sorted);
}

function renderArchiveCards(records) {
  const search = state.archiveSearchTerm.toLowerCase();
  const dateFilter = state.archiveFilterDate;

  let filtered = records.filter(r => {
    const matchSearch = !search || (r.user || '').toLowerCase().includes(search) || r.date.includes(search);
    const matchDate = !dateFilter || r.date === dateFilter;
    return matchSearch && matchDate;
  });

  const grid = document.getElementById('archive-grid');
  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">${icon('folder-open')}<h3>لا توجد سجلات</h3><p>لم يتم العثور على جرود مطابقة</p></div>`;
    return;
  }

  grid.innerHTML = filtered.map(rec => {
    const entryCount = rec.entries ? rec.entries.length : 0;
    const totalClosing = rec.entries ? rec.entries.reduce((s, e) => s + (Number(e.closingBalance) || 0), 0) : 0;
    return `
      <div class="archive-card" onclick="viewArchiveRecord(${rec.id})">
        <div class="archive-card-date">${icon('calendar')} ${formatDate(rec.date)}</div>
        <div class="archive-card-user">${icon('user')} ${rec.user || 'غير محدد'}</div>
        <div class="archive-card-stats">
          <div class="archive-stat">
            <div class="archive-stat-val">${entryCount}</div>
            <div class="archive-stat-lbl">صنف</div>
          </div>
          <div class="archive-stat">
            <div class="archive-stat-val">${formatNum(Math.round(totalClosing))}</div>
            <div class="archive-stat-lbl">إجمالي الرصيد</div>
          </div>
        </div>
        ${rec.notes ? `<div style="margin-top:10px;font-size:0.78rem;color:var(--text-muted);">${icon('document')} ${rec.notes}</div>` : ''}
      </div>
    `;
  }).join('');
}

async function viewArchiveRecord(id) {
  const rec = await dbGet(STORES.INVENTORY, id);
  if (!rec) return;
  const modal = document.getElementById('view-modal');
  document.getElementById('view-modal-title').textContent = `جرد ${formatDate(rec.date)}`;

  const entriesByType = {};
  (rec.entries || []).forEach(e => {
    if (!entriesByType[e.itemType]) entriesByType[e.itemType] = [];
    entriesByType[e.itemType].push(e);
  });

  let tableRows = '';
  let globalIdx = 1;
  Object.entries(entriesByType).forEach(([type, entries]) => {
    const typeInfo = getTypeLabel(type);
    tableRows += `<tr style="background:rgba(26,58,92,0.05);"><td colspan="6" style="font-weight:800;padding:8px 14px;font-size:0.82rem;color:var(--primary);">${typeInfo.label}</td></tr>`;
    entries.forEach(e => {
      const diff = Number(e.closingBalance) - Number(e.openingBalance);
      tableRows += `
        <tr>
          <td>${globalIdx++}</td>
          <td>${e.itemName}</td>
          <td class="num">${formatNum(e.openingBalance)}</td>
          <td class="num positive-val">${formatNum(e.received)}</td>
          <td class="num negative-val">${formatNum(e.disbursed)}</td>
          <td class="num" style="font-weight:800;">${formatNum(e.closingBalance)}</td>
        </tr>
      `;
    });
  });

  document.getElementById('view-modal-body').innerHTML = `
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:14px;">
      <div class="header-badge">${icon('calendar')} ${formatDate(rec.date)}</div>
      <div class="header-badge">${icon('user')} ${rec.user || 'غير محدد'}</div>
      <div class="header-badge">${icon('clock')} ${new Date(rec.createdAt).toLocaleTimeString('ar-EG')}</div>
    </div>
    ${rec.notes ? `<div class="alert alert-info">${icon('document')} ${rec.notes}</div>` : ''}
    <div class="table-wrapper" id="archive-view-table">
    <table style="font-size:${state.tableFontSize}px;">
      <thead><tr><th>#</th><th>الصنف</th><th>رصيد أول</th><th>وارد</th><th>منصرف</th><th>رصيد آخر</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    </div>
    <div style="margin-top:14px;display:flex;gap:8px;">
      <button class="btn btn-outline btn-sm" onclick="printArchiveRecord(${id})">${icon('print')} طباعة</button>
      <button class="btn btn-outline btn-sm" onclick="exportArchiveCSV(${id})">${icon('download')} تصدير CSV</button>
    </div>
  `;
  modal.classList.add('open');
}

function buildArchivePrintHtml(rec) {
  const grouped = {};
  (rec.entries || []).forEach((entry) => {
    const key = entry.itemType || 'other';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(entry);
  });

  let idx = 1;
  let rows = '';
  Object.entries(grouped).forEach(([type, entries]) => {
    const typeInfo = getTypeLabel(type);
    rows += `<tr class="group-row"><td colspan="6">${typeInfo.label}</td></tr>`;
    entries.forEach((entry) => {
      rows += `
        <tr>
          <td>${idx++}</td>
          <td>${entry.itemName || '-'}</td>
          <td>${formatNum(entry.openingBalance)}</td>
          <td>${formatNum(entry.received)}</td>
          <td>${formatNum(entry.disbursed)}</td>
          <td>${formatNum(entry.closingBalance)}</td>
        </tr>
      `;
    });
  });

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>تقرير جرد ${rec.date}</title>
  <style>
    body { font-family: Tahoma, Arial, sans-serif; direction: rtl; margin: 24px; color: #111; }
    .head { margin-bottom: 18px; }
    .head h1 { margin: 0 0 8px; font-size: 24px; }
    .meta { display: flex; gap: 16px; flex-wrap: wrap; font-size: 14px; }
    .note { margin-top: 8px; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid #b4b4b4; padding: 8px; text-align: right; }
    thead th { background: #1b4332; color: #fff; }
    .group-row td { background: #e9f7eb; font-weight: 700; }
    @page { size: A4 landscape; margin: 10mm; }
  </style>
</head>
<body>
  <div class="head">
    <h1>تقرير الجرد اليومي</h1>
    <div class="meta">
      <div><strong>التاريخ:</strong> ${formatDate(rec.date)}</div>
      <div><strong>المستخدم:</strong> ${rec.user || 'غير محدد'}</div>
      <div><strong>وقت الإنشاء:</strong> ${new Date(rec.createdAt).toLocaleTimeString('ar-EG')}</div>
    </div>
    ${rec.notes ? `<div class="note"><strong>ملاحظات:</strong> ${rec.notes}</div>` : ''}
  </div>
  <table>
    <thead>
      <tr><th>#</th><th>الصنف</th><th>رصيد أول</th><th>وارد</th><th>منصرف</th><th>رصيد آخر</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

async function legacyPrintArchiveRecord(id) {
  const rec = await dbGet(STORES.INVENTORY, id);
  if (!rec) {
    showToast('تعذر تحميل سجل الجرد للطباعة', 'error');
    return;
  }

  const printWindow = window.open('', '_blank', 'width=1200,height=900');
  if (!printWindow) {
    showToast('يرجى السماح بفتح نافذة الطباعة من المتصفح', 'warning');
    return;
  }

  printWindow.document.open();
  printWindow.document.write(buildArchivePrintHtml(rec));
  printWindow.document.close();
  printWindow.focus();
  printWindow.onload = () => {
    printWindow.print();
    printWindow.close();
  };
}

async function exportArchiveCSV(id) {
  const rec = await dbGet(STORES.INVENTORY, id);
  if (!rec || !rec.entries) return;
  const header = ['#', 'الصنف', 'النوع', 'رصيد أول', 'وارد', 'منصرف', 'رصيد آخر'];
  const rows = rec.entries.map((e, i) => [i+1, e.itemName, e.itemType, e.openingBalance, e.received, e.disbursed, e.closingBalance]);
  const csv = buildCsv([header, ...rows]);
  downloadCSV(csv, `جرد_${rec.date}.csv`);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function exportInventoryOnlyCSV() {
  const selectedDate = document.getElementById('inv-date')?.value;
  if (!selectedDate) {
    showToast('يرجى اختيار تاريخ الجرد أولاً', 'error');
    return;
  }

  const records = await dbGetByIndex(STORES.INVENTORY, 'date', selectedDate);
  const record = records[0];
  if (!record) {
    showToast('لا يوجد جرد محفوظ بهذا التاريخ', 'warning');
    return;
  }

  const header = [
    'record_date',
    'record_user',
    'record_notes',
    'item_id',
    'item_name',
    'item_type',
    'opening_balance',
    'received',
    'disbursed',
    'closing_balance'
  ];
  const rows = (record.entries || []).map((entry) => [
    record.date,
    record.user || '',
    record.notes || '',
    entry.itemId,
    entry.itemName,
    entry.itemType,
    Number(entry.openingBalance) || 0,
    Number(entry.received) || 0,
    Number(entry.disbursed) || 0,
    Number(entry.closingBalance) || 0
  ]);

  if (rows.length === 0) {
    showToast('لا توجد أصناف داخل هذا الجرد للتصدير', 'warning');
    return;
  }

  const csv = buildCsv([header, ...rows]);
  downloadCSV(csv, `جرد_مؤقت_${record.date}.csv`);
  showToast('تم تصدير ملف الجرد المؤقت بنجاح');
}

async function importInventoryCSV() {
  const fileInput = document.getElementById('inventory-import-file');
  const file = fileInput?.files?.[0];
  if (!file) {
    showToast('يرجى اختيار ملف CSV أولاً', 'error');
    return;
  }

  showLoading(true);
  try {
    const text = await file.text();
    const rows = parseCSV(text);
    if (rows.length < 2) {
      showToast('الملف فارغ أو لا يحتوي صفوف بيانات', 'error');
      showLoading(false);
      return;
    }

    const header = rows[0].map((cell, idx) => {
      const cleaned = String(cell || '').trim();
      return idx === 0 ? cleaned.replace(/^\uFEFF/, '') : cleaned;
    });
    const index = {
      date: header.indexOf('record_date'),
      user: header.indexOf('record_user'),
      notes: header.indexOf('record_notes'),
      itemId: header.indexOf('item_id'),
      itemName: header.indexOf('item_name'),
      itemType: header.indexOf('item_type'),
      opening: header.indexOf('opening_balance'),
      received: header.indexOf('received'),
      disbursed: header.indexOf('disbursed'),
      closing: header.indexOf('closing_balance')
    };

    const required = ['date', 'itemName', 'opening', 'received', 'disbursed', 'closing'];
    const missingField = required.find((field) => index[field] === -1);
    if (missingField) {
      showToast('صيغة الملف غير مدعومة. استخدم ملف التصدير المؤقت من النظام.', 'error');
      showLoading(false);
      return;
    }

    const groupedRecords = new Map();
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const date = String(row[index.date] || '').trim();
      const itemName = String(row[index.itemName] || '').trim();
      if (!date || !itemName) continue;

      if (!groupedRecords.has(date)) {
        groupedRecords.set(date, {
          date,
          user: String(row[index.user] || '').trim() || state.currentUser || 'مستخدم النظام',
          notes: String(row[index.notes] || '').trim(),
          entries: []
        });
      }

      const rec = groupedRecords.get(date);
      const itemType = String(row[index.itemType] || '').trim() || 'تمري';
      const itemId = Number(row[index.itemId]);
      rec.entries.push({
        itemId: Number.isFinite(itemId) && itemId > 0 ? itemId : null,
        itemName,
        itemType,
        openingBalance: Number(row[index.opening]) || 0,
        received: Number(row[index.received]) || 0,
        disbursed: Number(row[index.disbursed]) || 0,
        closingBalance: Number(row[index.closing]) || 0
      });
    }

    if (groupedRecords.size === 0) {
      showToast('لم يتم العثور على بيانات صالحة داخل الملف', 'error');
      showLoading(false);
      return;
    }

    const existingItems = await dbGetAll(STORES.ITEMS);
    const itemMap = new Map(existingItems.map((item) => [`${item.name}::${item.type || ''}`, item]));

    let addedItems = 0;
    for (const rec of groupedRecords.values()) {
      for (const entry of rec.entries) {
        const key = `${entry.itemName}::${entry.itemType || ''}`;
        if (itemMap.has(key)) continue;
        const newItemId = await dbAdd(STORES.ITEMS, {
          name: entry.itemName,
          type: entry.itemType,
          active: true,
          createdAt: new Date().toISOString()
        });
        const newItem = { id: newItemId, name: entry.itemName, type: entry.itemType, active: true };
        itemMap.set(key, newItem);
        addedItems++;
      }
    }

    let replacedRecords = 0;
    let importedRecords = 0;
    for (const rec of groupedRecords.values()) {
      const existing = (await dbGetByIndex(STORES.INVENTORY, 'date', rec.date))[0];
      if (existing) {
        await dbDelete(STORES.INVENTORY, existing.id);
        replacedRecords++;
      }

      const normalizedEntries = rec.entries.map((entry) => {
        const key = `${entry.itemName}::${entry.itemType || ''}`;
        const linkedItem = itemMap.get(key);
        return {
          ...entry,
          itemId: linkedItem?.id || entry.itemId || null
        };
      });

      await dbAdd(STORES.INVENTORY, {
        date: rec.date,
        user: rec.user,
        notes: rec.notes,
        createdAt: new Date().toISOString(),
        importedAt: new Date().toISOString(),
        source: 'inventory_csv_import',
        entries: normalizedEntries
      });
      importedRecords++;
    }

    const latestDate = Array.from(groupedRecords.keys()).sort().slice(-1)[0];
    if (latestDate) {
      const invDate = document.getElementById('inv-date');
      const finalDate = document.getElementById('final-export-date');
      if (invDate) invDate.value = latestDate;
      if (finalDate) finalDate.value = latestDate;
    }
    if (fileInput) fileInput.value = '';

    await loadInventoryEntry();
  showToast(`تم استيراد ${importedRecords} جرد، وتحديث ${replacedRecords} سجل، وإضافة ${addedItems} صنف`);
  } catch (error) {
    console.error('Import CSV Error:', error);
    showToast('حدث خطأ أثناء استيراد الملف', 'error');
  } finally {
    showLoading(false);
  }
}

async function exportFinalReport(format = 'csv') {
  const dateInput = document.getElementById('final-export-date');
  const selectedDate = dateInput?.value || document.getElementById('inv-date')?.value || today();
  if (!selectedDate) {
    showToast('يرجى اختيار تاريخ التقرير النهائي', 'error');
    return;
  }

  const inventoryRecord = (await dbGetByIndex(STORES.INVENTORY, 'date', selectedDate))[0];
  if (!inventoryRecord) {
    showToast('لا يوجد جرد محفوظ في التاريخ المحدد', 'warning');
    return;
  }

  const disbursements = await dbGetByIndex(STORES.DISBURSEMENT, 'date', selectedDate);

  if (format === 'excel') {
    const inventoryRowsHtml = (inventoryRecord.entries || []).map((entry, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${escapeHtml(entry.itemName)}</td>
        <td>${escapeHtml(entry.itemType)}</td>
        <td>${Number(entry.openingBalance) || 0}</td>
        <td>${Number(entry.received) || 0}</td>
        <td>${Number(entry.disbursed) || 0}</td>
        <td>${Number(entry.closingBalance) || 0}</td>
      </tr>
    `).join('');

    let disbursementRowsHtml = '';
    let rowIndex = 1;
    disbursements.forEach((disb) => {
      (disb.entries || []).forEach((entry) => {
        disbursementRowsHtml += `
          <tr>
            <td>${rowIndex++}</td>
            <td>${escapeHtml(disb.refNum || '')}</td>
            <td>${escapeHtml(disb.requestNum || '')}</td>
            <td>${escapeHtml(disb.warehouse || '')}</td>
            <td>${escapeHtml(disb.user || '')}</td>
            <td>${escapeHtml(disb.destination || '')}</td>
            <td>${escapeHtml(entry.itemName || '')}</td>
            <td>${escapeHtml(entry.itemType || '')}</td>
            <td>${Number(entry.qty) || 0}</td>
            <td>${escapeHtml(entry.note || '')}</td>
          </tr>
        `;
      });
    });

    if (!disbursementRowsHtml) {
      disbursementRowsHtml = `<tr><td colspan="10" style="text-align:center;">لا توجد بيانات صرف لهذا التاريخ</td></tr>`;
    }

    const excelHtml = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>التقرير النهائي ${selectedDate}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 18px; direction: rtl; }
    h2 { margin: 0 0 8px; }
    .meta { margin-bottom: 14px; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 12px; }
    th, td { border: 1px solid #bbb; padding: 6px; text-align: right; }
    th { background: #eef3f7; }
  </style>
</head>
<body>
  <h2>التقرير النهائي (الجرد + الصرف)</h2>
  <div class="meta">
    <div><strong>التاريخ:</strong> ${escapeHtml(formatDate(selectedDate))}</div>
    <div><strong>مدخل الجرد:</strong> ${escapeHtml(inventoryRecord.user || '-')}</div>
  </div>

  <h3>بيانات الجرد</h3>
  <table>
    <thead>
      <tr><th>#</th><th>الصنف</th><th>النوع</th><th>رصيد أول</th><th>وارد</th><th>منصرف</th><th>رصيد آخر</th></tr>
    </thead>
    <tbody>${inventoryRowsHtml}</tbody>
  </table>

  <h3>بيانات الصرف</h3>
  <table>
    <thead>
      <tr><th>#</th><th>رقم الإذن</th><th>رقم طلب الصرف</th><th>المخزن</th><th>المستخدم</th><th>جهة الصرف</th><th>الصنف</th><th>النوع</th><th>الكمية</th><th>ملاحظة</th></tr>
    </thead>
    <tbody>${disbursementRowsHtml}</tbody>
  </table>
</body>
</html>`;

    const blob = new Blob([excelHtml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    downloadBlob(blob, `تقرير_نهائي_${selectedDate}.xls`);
    showToast('تم تصدير التقرير النهائي بصيغة Excel');
    return;
  }

  const rows = [];
  rows.push(['report_type', 'date', 'user', 'notes', 'ref_num', 'request_num', 'warehouse', 'destination', 'item_name', 'item_type', 'opening_balance', 'received', 'disbursed', 'closing_balance', 'disbursed_qty', 'item_note']);
  (inventoryRecord.entries || []).forEach((entry) => {
    rows.push([
      'inventory',
      inventoryRecord.date,
      inventoryRecord.user || '',
      inventoryRecord.notes || '',
      '',
      '',
      '',
      '',
      entry.itemName || '',
      entry.itemType || '',
      Number(entry.openingBalance) || 0,
      Number(entry.received) || 0,
      Number(entry.disbursed) || 0,
      Number(entry.closingBalance) || 0,
      '',
      ''
    ]);
  });
  disbursements.forEach((disb) => {
    (disb.entries || []).forEach((entry) => {
      rows.push([
        'disbursement',
        disb.date,
        disb.user || '',
        disb.notes || '',
        disb.refNum || '',
        disb.requestNum || '',
        disb.warehouse || '',
        disb.destination || '',
        entry.itemName || '',
        entry.itemType || '',
        '',
        '',
        '',
        '',
        Number(entry.qty) || 0,
        entry.note || ''
      ]);
    });
  });

  const csv = buildCsv(rows);
  downloadCSV(csv, `تقرير_نهائي_${selectedDate}.csv`);
  showToast('تم تصدير التقرير النهائي بصيغة CSV');
}

// ===== USERS =====
async function loadUsersInSettings() {
  const users = await dbGetAll(STORES.USERS);
  const list = document.getElementById('users-list');
  if (users.length === 0) {
    list.innerHTML = `<div class="empty-state">${icon('users')}<h3>لا يوجد مستخدمون</h3><p>أضف مستخدمين لتسجيل الجرد</p></div>`;
    return;
  }
  list.innerHTML = users.map(u => `
    <div class="setting-item">
      <div>
        <div class="setting-label">${icon('user')} ${u.name}</div>
        <div class="setting-desc">أضيف في: ${formatDate(u.createdAt?.split('T')[0])}</div>
      </div>
      <button class="btn btn-sm btn-danger btn-icon" onclick="deleteUser(${u.id})">${icon('trash')}</button>
    </div>
  `).join('');
}

async function addUser() {
  const nameInput = document.getElementById('new-user-name');
  const name = nameInput.value.trim();
  if (!name) { showToast('يرجى إدخال اسم المستخدم', 'error'); return; }
  const users = await dbGetAll(STORES.USERS);
  if (users.find(u => u.name === name)) { showToast('المستخدم موجود بالفعل', 'warning'); return; }
  await dbAdd(STORES.USERS, { name, createdAt: new Date().toISOString() });
  nameInput.value = '';
  showToast('تمت إضافة المستخدم');
  await loadUsersInSettings();
}

async function deleteUser(id) {
  if (!confirmDialog('هل تريد حذف هذا المستخدم؟')) return;
  await dbDelete(STORES.USERS, id);
  showToast('تم حذف المستخدم', 'warning');
  await loadUsersInSettings();
}

// ===== SETTINGS =====
async function legacyLoadSettings() {
  const s = await dbGet(STORES.SETTINGS, 'main');
  if (s) {
    state.settings = { ...state.settings, ...s.value };
  }

  document.getElementById('setting-font-size').value = state.settings.fontSize;
  document.getElementById('setting-font-size-display').textContent = state.settings.fontSize + 'px';
  document.getElementById('setting-font-family').value = state.settings.fontFamily;
  document.getElementById('setting-auto-carry').classList.toggle('on', state.settings.autoCarryForward);
  document.getElementById('setting-show-zero').classList.toggle('on', state.settings.showZeroItems);

  applySettings();
  await loadUsersInSettings();
}

function legacyApplySettings() {
  const fontStack = `'${state.settings.fontFamily}', 'Cairo', sans-serif`;
  document.documentElement.style.setProperty('--font', fontStack);
  document.documentElement.style.setProperty('--font-main', `'${state.settings.fontFamily}', 'Cairo', sans-serif`);
  document.documentElement.style.fontSize = state.settings.fontSize + 'px';
}

async function legacySaveSettings() {
  state.settings.fontSize = parseInt(document.getElementById('setting-font-size').value) || 15;
  state.settings.fontFamily = document.getElementById('setting-font-family').value;
  await dbPut(STORES.SETTINGS, { key: 'main', value: state.settings });
  applySettings();
  showToast('تم حفظ الإعدادات');
}

// ===== RESET DB =====
async function legacyResetDatabase() {
  if (!confirmDialog('تحذير: سيتم حذف جميع البيانات نهائياً! هل أنت متأكد؟')) return;
  if (!confirmDialog('هذا الإجراء لا يمكن التراجع عنه. أكد مجدداً؟')) return;
  indexedDB.deleteDatabase(DB_NAME);
  showToast('تم حذف قاعدة البيانات. سيتم إعادة التشغيل...', 'warning');
  setTimeout(() => location.reload(), 1500);
}

// ===== MODAL HELPERS =====
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

// ===== SEED DEMO DATA =====
async function seedDemoData() {
  if (!confirmDialog('هل تريد إضافة بيانات تجريبية؟ (أصناف ومستخدمون نموذجيون)')) return;
  showLoading(true);

  const sampleItems = [
    // تمري
    { name: 'كيس تمري مجمد فرخة 750-800', type: 'تمري' },
    { name: 'كيس تمري مجمد فرخة 800-850', type: 'تمري' },
    { name: 'كيس تمري مجمد فرخة 850-900', type: 'تمري' },
    { name: 'كيس تمري مجمد فرخة 950-1000', type: 'تمري' },
    { name: 'أكياس تمري ديوس 1 كجم m', type: 'تمري' },
    { name: 'أكياس تمري شيش 1 كجم m', type: 'تمري' },
    { name: 'أكياس تمري افخاذ 1 كجم m', type: 'تمري' },
    { name: 'أكياس تمري أوراك 1 كجم m', type: 'تمري' },
    { name: 'أكياس تمري اجنحة 1 كجم m', type: 'تمري' },
    { name: 'أكياس تمري كبد 1 كجم m', type: 'تمري' },
    { name: 'أكياس تمري فيلية 1 كجم m', type: 'تمري' },
    { name: 'أكياس تمري كبد وقوانص 1 كجم m', type: 'تمري' },
    // دقهلية
    { name: 'كيس الدقهلية للمجازر دجاج محمد 900-950جم', type: 'دقهلية' },
    { name: 'كيس الدقهلية للمجازر دجاج محمد 950-1000جم', type: 'دقهلية' },
    { name: 'كيس الدقهلية للمجازر دجاج محمد 1100-1200جم', type: 'دقهلية' },
    { name: 'أكياس دجاج محمد قطع دقهلية (9 قطع) أخضر', type: 'دقهلية' },
    { name: 'كيس مفروم الدقهلية للمجازر محمد 5كجم', type: 'دقهلية' },
    { name: 'كيس مفروم دجاج محمد 1 كجم أحمر', type: 'دقهلية' },
    { name: 'أكياس الدقهلية حسب الوزن فرخة كاملة (20×35) الشوايه', type: 'دقهلية' },
    { name: 'أكياس بلاستك شفافة 35*50 سم', type: 'دقهلية' },
    { name: 'أكياس اجزاء اوراك دقهلية كبير', type: 'دقهلية' },
    { name: 'أكياس فيلية دقهلية 1ك محمد', type: 'دقهلية' },
    // استيكرات
    { name: 'ستيكر تمري فرش فرخه كاملة 850-900', type: 'استيكرات' },
    { name: 'ستيكر تمري فرش فرخه كاملة 900-950', type: 'استيكرات' },
    { name: 'ستيكر تمري فرش فرخه كاملة 1000-950', type: 'استيكرات' },
    { name: 'ستيكر تمري فرخ فرخه كاملة 1000-1100', type: 'استيكرات' },
    { name: 'ستيكر تمري فرش فربة كاملة 1100-1200', type: 'استيكرات' },
    { name: 'ستيكر تمري فرش فيليه 1 كيلو', type: 'استيكرات' },
    { name: 'ستيكر تمري فرش ديوس 1كيلو', type: 'استيكرات' },
    { name: 'ستيكر تمري فرش كبد وقوانص 1 كيلو', type: 'استيكرات' },
    { name: 'استيكر احمر', type: 'استيكرات' },
    { name: 'فلتو 1ك استيكر', type: 'استيكرات' },
    // أطباق
    { name: 'أطباق فوم زرقاء ممتص1كجم', type: 'الاطباق' },
    { name: 'أطباق فوم زرقاء ممتص2/1كجم', type: 'الاطباق' },
    { name: 'طبق فوم أبيض 1كجم', type: 'الاطباق' },
    { name: 'طبق فرخة كامل', type: 'الاطباق' },
    { name: 'أطباق فوم % كجم', type: 'الاطباق' },
    // متبل
    { name: 'طبق بلاستيك شفاف متبل', type: 'المتبل' },
  ];

  const existing = await dbGetAll(STORES.ITEMS);
  const existingNames = new Set(existing.map(i => i.name));
  let added = 0;
  for (const item of sampleItems) {
    if (!existingNames.has(item.name)) {
      await dbAdd(STORES.ITEMS, { ...item, active: true, createdAt: new Date().toISOString() });
      added++;
    }
  }

  // Sample users
  const sampleUsers = ['أحمد محمد', 'محمد علي', 'مصطفى السيد', 'عمر خالد'];
  const existingUsers = await dbGetAll(STORES.USERS);
  const existingUserNames = new Set(existingUsers.map(u => u.name));
  let addedUsers = 0;
  for (const name of sampleUsers) {
    if (!existingUserNames.has(name)) {
      await dbAdd(STORES.USERS, { name, createdAt: new Date().toISOString() });
      addedUsers++;
    }
  }

  showLoading(false);
  showToast(`تمت إضافة ${added} صنف و ${addedUsers} مستخدم`);
  await loadPageData(state.currentPage);
}

async function buildSystemBackupPayload(reason = 'manual_export') {
  const [items, inventoryRecords, disbursementRecords, settingsRecords, users] = await Promise.all([
    dbGetAll(STORES.ITEMS),
    dbGetAll(STORES.INVENTORY),
    dbGetAll(STORES.DISBURSEMENT),
    dbGetAll(STORES.SETTINGS),
    dbGetAll(STORES.USERS)
  ]);

  return {
    meta: {
      app: 'Inventory Manager',
      version: APP_VERSION,
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      reason
    },
    data: {
      items,
      inventoryRecords,
      disbursementRecords,
      settings: settingsRecords,
      users
    }
  };
}

async function exportSystemBackup(options = {}) {
  const {
    filenamePrefix = 'نسخة_احتياطية_المخزون',
    silent = false,
    reason = 'manual_export'
  } = options;

  showLoading(true);
  try {
    const payload = await buildSystemBackupPayload(reason);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    downloadBlob(blob, `${filenamePrefix}_${today()}.json`);
    if (!silent) showToast('تم إنشاء النسخة الاحتياطية بنجاح');
    return payload;
  } catch (error) {
    console.error('Backup Export Error:', error);
    if (!silent) showToast('حدث خطأ أثناء إنشاء النسخة الاحتياطية', 'error');
    return null;
  } finally {
    showLoading(false);
  }
}

async function saveEmergencyBackupSnapshot(reason = 'emergency_backup') {
  try {
    const payload = await buildSystemBackupPayload(reason);
    localStorage.setItem(EMERGENCY_BACKUP_KEY, JSON.stringify(payload));
    return payload;
  } catch (error) {
    console.error('Emergency Backup Error:', error);
    return null;
  }
}

function downloadEmergencyBackup() {
  const raw = localStorage.getItem(EMERGENCY_BACKUP_KEY);
  if (!raw) {
    showToast('لا توجد نقطة إنقاذ محفوظة على هذا الجهاز', 'warning');
    return;
  }

  const blob = new Blob([raw], { type: 'application/json;charset=utf-8' });
  downloadBlob(blob, `نقطة_إنقاذ_${today()}.json`);
  showToast('تم تنزيل نقطة الإنقاذ المحلية');
}

function syncSettingsAccessUI() {
  const lockPanel = document.getElementById('settings-lock-panel');
  const content = document.getElementById('settings-content');
  if (lockPanel && content) {
    lockPanel.classList.toggle('hidden', state.settingsUnlocked);
    content.classList.toggle('hidden', !state.settingsUnlocked);
  }
}

async function requestSettingsAccess(actionLabel = 'الدخول إلى الإعدادات') {
  if (state.settingsUnlocked) return true;

  const provided = window.prompt(`أدخل كلمة مرور المطور لإتمام ${actionLabel}`);
  if (provided === null) return false;

  if (String(provided).trim() !== SETTINGS_PASSWORD) {
    showToast('كلمة المرور غير صحيحة', 'error');
    return false;
  }

  state.settingsUnlocked = true;
  syncSettingsAccessUI();
  showToast('تم فتح الإعدادات لهذه الجلسة');
  return true;
}

function unlockSettings() {
  const input = document.getElementById('settings-password-input');
  const value = input?.value?.trim() || '';
  if (value !== SETTINGS_PASSWORD) {
    showToast('كلمة المرور غير صحيحة', 'error');
    input?.focus();
    input?.select();
    return;
  }

  state.settingsUnlocked = true;
  if (input) input.value = '';
  syncSettingsAccessUI();
  loadSettings();
  showToast('تم فتح الإعدادات');
}

function triggerBackupRestore() {
  const input = document.getElementById('backup-restore-file');
  if (!input) return;
  input.value = '';
  input.click();
  closeBackupMenu();
}

async function restoreSystemBackup() {
  if (!(await requestSettingsAccess('استعادة النسخة الاحتياطية'))) return;

  const input = document.getElementById('backup-restore-file');
  const file = input?.files?.[0];
  if (!file) {
    showToast('يرجى اختيار ملف النسخة الاحتياطية أولاً', 'error');
    return;
  }

  if (!confirmDialog('سيتم استبدال جميع البيانات الحالية بمحتوى النسخة الاحتياطية. هل تريد المتابعة؟')) return;
  if (!confirmDialog('تأكيد أخير: سيتم حذف البيانات الحالية نهائياً قبل الاستعادة.')) return;

  showLoading(true);
  try {
    await saveEmergencyBackupSnapshot('before_restore');

    const text = await file.text();
    const parsed = JSON.parse(text);
    const source = parsed?.data || parsed || {};

    const items = Array.isArray(source.items) ? source.items : [];
    const inventoryRecords = Array.isArray(source.inventoryRecords) ? source.inventoryRecords : [];
    const disbursementRecords = Array.isArray(source.disbursementRecords) ? source.disbursementRecords : [];
    const users = Array.isArray(source.users) ? source.users : [];
    const settings = Array.isArray(source.settings) ? source.settings : [];

    const hasKnownData =
      Array.isArray(source.items) ||
      Array.isArray(source.inventoryRecords) ||
      Array.isArray(source.disbursementRecords) ||
      Array.isArray(source.users) ||
      Array.isArray(source.settings);

    if (!hasKnownData) {
      showToast('ملف النسخة الاحتياطية غير صالح', 'error');
      return;
    }

    const storesOrder = [STORES.ITEMS, STORES.INVENTORY, STORES.DISBURSEMENT, STORES.USERS, STORES.SETTINGS];
    for (const storeName of storesOrder) {
      await dbClearStore(storeName);
    }

    for (const item of items) {
      if (item && typeof item === 'object') await dbPut(STORES.ITEMS, item);
    }
    for (const rec of inventoryRecords) {
      if (rec && typeof rec === 'object') await dbPut(STORES.INVENTORY, rec);
    }
    for (const rec of disbursementRecords) {
      if (rec && typeof rec === 'object') await dbPut(STORES.DISBURSEMENT, rec);
    }
    for (const user of users) {
      if (user && typeof user === 'object') await dbPut(STORES.USERS, user);
    }
    for (const s of settings) {
      if (s && typeof s === 'object' && s.key) await dbPut(STORES.SETTINGS, s);
    }

    const mainSettings = await dbGet(STORES.SETTINGS, 'main');
    if (!mainSettings) {
      await dbPut(STORES.SETTINGS, { key: 'main', value: state.settings });
    }

    input.value = '';
    showToast('تمت استعادة النسخة الاحتياطية بنجاح. جارٍ تحديث الواجهة...');
    setTimeout(() => location.reload(), 700);
  } catch (error) {
    console.error('Backup Restore Error:', error);
    showToast('فشل استعادة النسخة الاحتياطية. تأكد من صحة الملف', 'error');
  } finally {
    showLoading(false);
  }
}

async function loadSettings() {
  const s = await dbGet(STORES.SETTINGS, 'main');
  if (s) {
    state.settings = { ...state.settings, ...s.value };
  }

  state.settings.theme = normalizeTheme(state.settings.theme);
  state.settings.primaryColor = normalizeHexColor(state.settings.primaryColor, DEFAULT_PRIMARY_COLOR);
  state.settings.accentColor = normalizeHexColor(state.settings.accentColor, DEFAULT_ACCENT_COLOR);

  syncSettingsAccessUI();
  applySettings();
  if (!state.settingsUnlocked) return;

  document.getElementById('setting-font-size').value = state.settings.fontSize;
  document.getElementById('setting-font-size-display').textContent = state.settings.fontSize + 'px';
  document.getElementById('setting-font-family').value = state.settings.fontFamily;
  document.getElementById('setting-theme').value = state.settings.theme || DEFAULT_THEME;
  document.getElementById('setting-primary-color').value = state.settings.primaryColor;
  document.getElementById('setting-accent-color').value = state.settings.accentColor;
  document.getElementById('setting-auto-carry').classList.toggle('on', state.settings.autoCarryForward);
  document.getElementById('setting-show-zero').classList.toggle('on', state.settings.showZeroItems);

  await loadUsersInSettings();
}

function applySettings() {
  state.settings.theme = normalizeTheme(state.settings.theme);
  state.settings.primaryColor = normalizeHexColor(state.settings.primaryColor, DEFAULT_PRIMARY_COLOR);
  state.settings.accentColor = normalizeHexColor(state.settings.accentColor, DEFAULT_ACCENT_COLOR);

  const fontStack = `'${state.settings.fontFamily}', 'Cairo', sans-serif`;
  document.documentElement.style.setProperty('--font', fontStack);
  document.documentElement.style.setProperty('--font-main', fontStack);
  document.documentElement.style.fontSize = `${state.settings.fontSize}px`;
  document.documentElement.dataset.theme = state.settings.theme || DEFAULT_THEME;
  applyThemeColors();
  updateCurrentUserAvatar();
}

async function saveSettings() {
  if (!(await requestSettingsAccess('حفظ الإعدادات'))) return;

  state.settings.fontSize = parseInt(document.getElementById('setting-font-size').value, 10) || 15;
  state.settings.fontFamily = document.getElementById('setting-font-family').value;
  state.settings.theme = normalizeTheme(document.getElementById('setting-theme').value);
  state.settings.primaryColor = normalizeHexColor(document.getElementById('setting-primary-color').value, DEFAULT_PRIMARY_COLOR);
  state.settings.accentColor = normalizeHexColor(document.getElementById('setting-accent-color').value, DEFAULT_ACCENT_COLOR);
  await dbPut(STORES.SETTINGS, { key: 'main', value: state.settings });
  applySettings();
  showToast('تم حفظ الإعدادات');
}

async function resetDatabase() {
  if (!(await requestSettingsAccess('مسح قاعدة البيانات'))) return;
  if (!confirmDialog('تحذير: سيتم حذف جميع البيانات نهائياً! هل أنت متأكد؟')) return;
  if (!confirmDialog('هذا الإجراء لا يمكن التراجع عنه. أكد مجدداً.')) return;

  await saveEmergencyBackupSnapshot('before_reset');
  indexedDB.deleteDatabase(DB_NAME);
  showToast('تم حذف قاعدة البيانات. سيتم إعادة التشغيل...', 'warning');
  setTimeout(() => location.reload(), 1500);
}

function printHtmlDocument(html) {
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.width = '1px';
  frame.style.height = '1px';
  frame.style.opacity = '0';
  frame.style.pointerEvents = 'none';
  frame.style.bottom = '0';
  document.body.appendChild(frame);

  let printed = false;
  const runPrint = () => {
    if (printed || !frame.contentWindow) return;
    printed = true;
    frame.contentWindow.focus();
    setTimeout(() => {
      frame.contentWindow.print();
      setTimeout(() => frame.remove(), 1200);
    }, 180);
  };

  frame.onload = runPrint;
  frame.contentWindow.document.open();
  frame.contentWindow.document.write(html);
  frame.contentWindow.document.close();
  setTimeout(runPrint, 500);
}

async function printArchiveRecord(id) {
  const rec = await dbGet(STORES.INVENTORY, id);
  if (!rec) {
    showToast('تعذر تحميل سجل الجرد للطباعة', 'error');
    return;
  }

  printHtmlDocument(buildArchivePrintHtml(rec));
}

async function exportMonthlyInventoryReport(format = 'csv') {
  const monthInput = document.getElementById('archive-export-month');
  const monthValue = monthInput?.value || today().slice(0, 7);
  if (!monthValue) {
    showToast('يرجى اختيار الشهر أولاً', 'error');
    return;
  }

  const records = (await dbGetAll(STORES.INVENTORY))
    .filter((rec) => String(rec.date || '').startsWith(monthValue))
    .sort((a, b) => getDateSortValue(a.date) - getDateSortValue(b.date));

  if (records.length === 0) {
    showToast('لا توجد سجلات جرد لهذا الشهر', 'warning');
    return;
  }

  const summaryRows = records.map((rec) => {
    const entryCount = (rec.entries || []).length;
    const totalOpening = (rec.entries || []).reduce((sum, entry) => sum + (Number(entry.openingBalance) || 0), 0);
    const totalReceived = (rec.entries || []).reduce((sum, entry) => sum + (Number(entry.received) || 0), 0);
    const totalDisbursed = (rec.entries || []).reduce((sum, entry) => sum + (Number(entry.disbursed) || 0), 0);
    const totalClosing = (rec.entries || []).reduce((sum, entry) => sum + (Number(entry.closingBalance) || 0), 0);
    return {
      date: rec.date,
      user: rec.user || '',
      notes: rec.notes || '',
      entryCount,
      totalOpening,
      totalReceived,
      totalDisbursed,
      totalClosing
    };
  });

  const detailRows = [];
  records.forEach((rec) => {
    (rec.entries || []).forEach((entry) => {
      detailRows.push({
        date: rec.date,
        user: rec.user || '',
        itemName: entry.itemName || '',
        itemType: entry.itemType || '',
        openingBalance: Number(entry.openingBalance) || 0,
        received: Number(entry.received) || 0,
        disbursed: Number(entry.disbursed) || 0,
        closingBalance: Number(entry.closingBalance) || 0
      });
    });
  });

  if (format === 'excel') {
    const summaryRowsHtml = summaryRows.map((row, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(formatDate(row.date))}</td>
        <td>${escapeHtml(row.user || '-')}</td>
        <td>${row.entryCount}</td>
        <td>${row.totalOpening}</td>
        <td>${row.totalReceived}</td>
        <td>${row.totalDisbursed}</td>
        <td>${row.totalClosing}</td>
        <td>${escapeHtml(row.notes || '-')}</td>
      </tr>
    `).join('');

    const detailRowsHtml = detailRows.map((row, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(formatDate(row.date))}</td>
        <td>${escapeHtml(row.user || '-')}</td>
        <td>${escapeHtml(row.itemName)}</td>
        <td>${escapeHtml(row.itemType)}</td>
        <td>${row.openingBalance}</td>
        <td>${row.received}</td>
        <td>${row.disbursed}</td>
        <td>${row.closingBalance}</td>
      </tr>
    `).join('');

    const excelHtml = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>الجرد الشهري ${monthValue}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 18px; direction: rtl; }
    h2, h3 { margin: 0 0 10px; }
    p { margin: 0 0 16px; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 18px; font-size: 12px; }
    th, td { border: 1px solid #bbb; padding: 6px; text-align: right; }
    th { background: #eef3f7; }
  </style>
</head>
<body>
  <h2>استخراج الجرد الشهري</h2>
  <p>الشهر: ${escapeHtml(formatMonthLabel(monthValue))}</p>
  <h3>ملخص الأيام</h3>
  <table>
    <thead>
      <tr><th>#</th><th>التاريخ</th><th>المستخدم</th><th>عدد الأصناف</th><th>رصيد أول</th><th>وارد</th><th>منصرف</th><th>رصيد آخر</th><th>ملاحظات</th></tr>
    </thead>
    <tbody>${summaryRowsHtml}</tbody>
  </table>
  <h3>التفاصيل</h3>
  <table>
    <thead>
      <tr><th>#</th><th>التاريخ</th><th>المستخدم</th><th>الصنف</th><th>النوع</th><th>رصيد أول</th><th>وارد</th><th>منصرف</th><th>رصيد آخر</th></tr>
    </thead>
    <tbody>${detailRowsHtml}</tbody>
  </table>
</body>
</html>`;

    downloadBlob(new Blob([excelHtml], { type: 'application/vnd.ms-excel;charset=utf-8;' }), `جرد_شهري_${monthValue}.xls`);
    showToast(`تم تصدير الجرد الشهري لشهر ${formatMonthLabel(monthValue)} بصيغة Excel`);
    return;
  }

  const csvRows = [
    ['نوع_السطر', 'التاريخ', 'المستخدم', 'عدد_الأصناف', 'رصيد_أول', 'وارد', 'منصرف', 'رصيد_آخر', 'ملاحظات', 'الصنف', 'النوع']
  ];

  summaryRows.forEach((row) => {
    csvRows.push([
      'summary',
      row.date,
      row.user,
      row.entryCount,
      row.totalOpening,
      row.totalReceived,
      row.totalDisbursed,
      row.totalClosing,
      row.notes,
      '',
      ''
    ]);
  });

  detailRows.forEach((row) => {
    csvRows.push([
      'detail',
      row.date,
      row.user,
      '',
      row.openingBalance,
      row.received,
      row.disbursed,
      row.closingBalance,
      '',
      row.itemName,
      row.itemType
    ]);
  });

  downloadCSV(buildCsv(csvRows), `جرد_شهري_${monthValue}.csv`);
  showToast(`تم تصدير الجرد الشهري لشهر ${formatMonthLabel(monthValue)} بصيغة CSV`);
}

function closeBackupMenu() {
  const dropdown = document.getElementById('backup-dropdown');
  const button = document.getElementById('backup-menu-btn');
  if (!dropdown || !button) return;
  dropdown.classList.remove('open');
  button.setAttribute('aria-expanded', 'false');
}

function setupBackupDropdown() {
  const dropdown = document.getElementById('backup-dropdown');
  const button = document.getElementById('backup-menu-btn');
  const downloadBtn = document.getElementById('backup-download-btn');
  const uploadBtn = document.getElementById('backup-upload-btn');

  if (!dropdown || !button || button.dataset.bound === 'true') return;
  button.dataset.bound = 'true';

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = dropdown.classList.toggle('open');
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  downloadBtn?.addEventListener('click', () => {
    exportSystemBackup();
    closeBackupMenu();
  });

  uploadBtn?.addEventListener('click', () => triggerBackupRestore());

  document.addEventListener('click', (event) => {
    if (!dropdown.contains(event.target)) closeBackupMenu();
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').catch((error) => {
    console.error('Service worker registration failed:', error);
  });
}

function setupInstallPrompt() {
  const button = document.getElementById('install-app-btn');
  if (!button || button.dataset.bound === 'true') return;
  button.dataset.bound = 'true';

  button.addEventListener('click', async () => {
    if (!deferredInstallPrompt) {
      showToast('استخدم خيار التثبيت من المتصفح إذا لم يظهر الزر تلقائياً', 'info');
      return;
    }

    deferredInstallPrompt.prompt();
    const result = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    button.hidden = true;

    if (result.outcome === 'accepted') {
      showToast('تم بدء تثبيت التطبيق');
    }
  });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    button.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    button.hidden = true;
    showToast('تم تثبيت التطبيق بنجاح');
  });
}

function setupQuickEntryInputs() {
  document.querySelectorAll('input[type="number"]:not([readonly])').forEach((input) => {
    input.classList.add('quick-entry-input');
    input.setAttribute('inputmode', 'decimal');
    input.setAttribute('enterkeyhint', 'next');
  });
}

// ===== MAIN INIT =====
async function legacyMain() {
  showLoading(true);
  try {
    await initDB();
    // Load default settings
    const s = await dbGet(STORES.SETTINGS, 'main');
    if (s) { state.settings = { ...state.settings, ...s.value }; applySettings(); }
  } catch (e) {
    console.error('DB Init Error:', e);
    showToast('خطأ في تهيئة قاعدة البيانات', 'error');
  }
  showLoading(false);

  // Nav events
  document.querySelectorAll('.nav-item[data-page]').forEach(item => {
    item.addEventListener('click', () => navigate(item.dataset.page));
  });

  // Mobile menu
  document.getElementById('mobile-menu-btn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  // Modal close on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });

  // Escape key closes modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
    }
  });

  // Font size range
  const fontRange = document.getElementById('setting-font-size');
  if (fontRange) {
    fontRange.addEventListener('input', previewAppearanceSettings);
  }

  document.getElementById('setting-font-family')?.addEventListener('change', previewAppearanceSettings);
  document.getElementById('setting-theme')?.addEventListener('change', previewAppearanceSettings);
  document.getElementById('setting-primary-color')?.addEventListener('input', previewAppearanceSettings);
  document.getElementById('setting-accent-color')?.addEventListener('input', previewAppearanceSettings);

  // Toggle switches
  document.getElementById('setting-auto-carry')?.addEventListener('click', function() {
    this.classList.toggle('on');
    state.settings.autoCarryForward = this.classList.contains('on');
  });
  document.getElementById('setting-show-zero')?.addEventListener('click', function() {
    this.classList.toggle('on');
    state.settings.showZeroItems = this.classList.contains('on');
  });

  // Archive search/filter
  document.getElementById('archive-search')?.addEventListener('input', async function() {
    state.archiveSearchTerm = this.value;
    await loadArchive();
  });
  document.getElementById('archive-filter-date')?.addEventListener('change', async function() {
    state.archiveFilterDate = this.value;
    await loadArchive();
  });

  // Items search/filter
  document.getElementById('items-search')?.addEventListener('input', renderItemsTable);
  document.getElementById('items-filter-type')?.addEventListener('change', renderItemsTable);

  // Inventory search/filter
  document.getElementById('inv-date')?.addEventListener('change', async () => {
    await loadInventoryEntry();
  });
  document.getElementById('inv-search')?.addEventListener('input', renderInventoryEntryTable);
  document.getElementById('inv-filter-type')?.addEventListener('change', renderInventoryEntryTable);
  document.getElementById('inv-show-zero')?.addEventListener('change', renderInventoryEntryTable);

  // Navigate to dashboard
  navigate('dashboard');
}

async function main() {
  showLoading(true);
  try {
    await initDB();
    const s = await dbGet(STORES.SETTINGS, 'main');
    if (s) {
      state.settings = { ...state.settings, ...s.value };
      applySettings();
    }
  } catch (e) {
    console.error('DB Init Error:', e);
    showToast('خطأ في تهيئة قاعدة البيانات', 'error');
  }
  showLoading(false);

  const todayBadge = document.getElementById('today-date-display');
  if (todayBadge) {
    todayBadge.textContent = new Date().toLocaleDateString('ar-EG', {
      weekday: 'short',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  const archiveMonthInput = document.getElementById('archive-export-month');
  if (archiveMonthInput && !archiveMonthInput.value) {
    archiveMonthInput.value = today().slice(0, 7);
  }

  updateCurrentUserAvatar();
  updateConnectivityStatus();
  registerServiceWorker();
  setupInstallPrompt();
  setupBackupDropdown();

  document.querySelectorAll('.nav-item[data-page]').forEach((item) => {
    item.addEventListener('click', () => navigate(item.dataset.page));
  });

  document.getElementById('mobile-menu-btn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });

  document.getElementById('backup-restore-file')?.addEventListener('change', () => {
    if (document.getElementById('backup-restore-file')?.files?.length) {
      restoreSystemBackup();
    }
  });

  window.addEventListener('online', updateConnectivityStatus);
  window.addEventListener('offline', updateConnectivityStatus);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.open').forEach((m) => m.classList.remove('open'));
      closeBackupMenu();
    }

    if (e.key === 'Enter' && e.target.matches('.quick-entry-input')) {
      e.preventDefault();
      const inputs = Array.from(document.querySelectorAll('.quick-entry-input')).filter((input) => !input.disabled && input.offsetParent !== null);
      const currentIndex = inputs.indexOf(e.target);
      const nextInput = inputs[currentIndex + 1];
      if (nextInput) {
        nextInput.focus();
        nextInput.select?.();
      }
    }
  });

  document.addEventListener('focusin', (e) => {
    if (e.target.matches('.quick-entry-input')) {
      setTimeout(() => e.target.select?.(), 0);
    }
  });

  const fontRange = document.getElementById('setting-font-size');
  if (fontRange) {
    fontRange.addEventListener('input', function() {
      document.getElementById('setting-font-size-display').textContent = this.value + 'px';
    });
  }

  document.getElementById('settings-password-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') unlockSettings();
  });

  document.getElementById('setting-auto-carry')?.addEventListener('click', function() {
    this.classList.toggle('on');
    state.settings.autoCarryForward = this.classList.contains('on');
  });
  document.getElementById('setting-show-zero')?.addEventListener('click', function() {
    this.classList.toggle('on');
    state.settings.showZeroItems = this.classList.contains('on');
  });

  document.getElementById('archive-search')?.addEventListener('input', async function() {
    state.archiveSearchTerm = this.value;
    await loadArchive();
  });
  document.getElementById('archive-filter-date')?.addEventListener('change', async function() {
    state.archiveFilterDate = this.value;
    await loadArchive();
  });

  document.getElementById('items-search')?.addEventListener('input', renderItemsTable);
  document.getElementById('items-filter-type')?.addEventListener('change', renderItemsTable);

  document.getElementById('inv-date')?.addEventListener('change', async () => {
    await loadInventoryEntry();
  });
  document.getElementById('inv-search')?.addEventListener('input', renderInventoryEntryTable);
  document.getElementById('inv-filter-type')?.addEventListener('change', renderInventoryEntryTable);
  document.getElementById('inv-show-zero')?.addEventListener('change', renderInventoryEntryTable);

  navigate('dashboard');
}

// Start app when DOM is ready
document.addEventListener('DOMContentLoaded', main);
