import {
  CATALOG_COLLECTIONS,
  EVIDENCE_STATUSES,
  EVIDENCE_TYPES,
  CRITICAL_FIELDS,
  FIELD_DEFINITIONS,
  REFERENCE_RULES,
  SCHEMA_VERSION,
  TYPE_META,
  VERIFICATION_STATUSES,
  parseRecordRef,
  recordRef,
  validateDatabase
} from './schema.js';
import { APP_VERSION, RELEASE_DATE, RELEASE_NOTES } from './config.js';
import {
  createEvidenceRecord,
  createUserRecord,
  databaseStats,
  loadAppData,
  makeBackup,
  makeCsvTemplate,
  makeEvidenceBundle,
  mergeImportedData,
  parseCsvImport,
  parseImportPayload,
  reviewEvidence as applyEvidenceReview,
  saveDatabase,
  saveFavorites
} from './storage.js';

const app = document.querySelector('#app');

const state = {
  database: null,
  favorites: [],
  tab: 'home',
  kind: 'all',
  query: '',
  status: 'all',
  minLevel: '',
  maxLevel: '',
  sort: 'default',
  detail: null,
  dialog: null,
  edit: null,
  formKind: 'monsters',
  marketItem: 'all',
  marketServer: 'all',
  pendingImport: null,
  importReport: null,
  evidenceTarget: '',
  evidenceDraft: null,
  pendingEvidence: null,
  installPrompt: null,
  waitingWorker: null,
  datasetUpdatedAt: '',
  migration: null,
  fatalError: null
};

const NAV_ITEMS = [
  ['home', '🏠', '首頁'],
  ['catalog', '📚', '圖鑑'],
  ['guides', '🧭', '攻略'],
  ['market', '💰', '行情'],
  ['mine', '⭐', '我的']
];

const e = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

const n = (value) => value === null || value === undefined || value === ''
  ? '待驗證'
  : Number(value).toLocaleString('zh-TW');

function safeUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function notify(message, tone = 'normal') {
  document.querySelector('#toast')?.remove();
  const toast = document.createElement('div');
  toast.id = 'toast';
  toast.className = `toast ${tone}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 4200);
}

function getRecord(collection, id) {
  return state.database?.[collection]?.find((record) => record.id === id) || null;
}

function getName(collection, id) {
  return getRecord(collection, id)?.name || id;
}

function allCatalog() {
  if (!state.database) return [];
  return CATALOG_COLLECTIONS.flatMap((collection) => state.database[collection].map((record) => ({ collection, record })));
}

function getLevel(collection, record) {
  if (collection === 'items' || collection === 'quests') return record.requiredLevel;
  if (collection === 'maps') return record.recommendedLevel;
  if (collection === 'skills') return record.maxLevel;
  if (collection === 'guides') return record.levelRange?.min;
  return record.level;
}

function categoryText(collection, record) {
  if (collection === 'items') return record.category;
  if (collection === 'maps') return record.region;
  if (collection === 'guides') return record.guideType;
  if (collection === 'jobs') return record.weapons?.join('、');
  return TYPE_META[collection]?.short || collection;
}

function referenceNames(collection, record) {
  const rules = REFERENCE_RULES[collection] || {};
  const names = [];
  for (const [field, rule] of Object.entries(rules)) {
    const ids = rule.many ? record[field] || [] : [record[field]].filter(Boolean);
    for (const id of ids) names.push(getName(rule.collection, id));
  }
  return names;
}

function searchText(collection, record) {
  return [
    record.name,
    getLevel(collection, record),
    categoryText(collection, record),
    record.description,
    record.content,
    record.features,
    record.acquisition,
    record.tradeInfo,
    record.entryConditions,
    record.respawnOrLimits,
    record.rewardsText,
    record.recommendedBuild,
    record.verificationStatus,
    ...(record.legacyRelatedNames || []),
    ...referenceNames(collection, record)
  ].filter((value) => value !== null && value !== undefined).join(' ').toLocaleLowerCase('zh-Hant');
}

function filteredCatalog() {
  let rows = allCatalog();
  if (state.kind !== 'all') rows = rows.filter((row) => row.collection === state.kind);
  if (state.status !== 'all') rows = rows.filter((row) => row.record.verificationStatus === state.status);
  const query = state.query.trim().toLocaleLowerCase('zh-Hant');
  if (query) rows = rows.filter(({ collection, record }) => searchText(collection, record).includes(query));
  const min = state.minLevel === '' ? null : Number(state.minLevel);
  const max = state.maxLevel === '' ? null : Number(state.maxLevel);
  if (min !== null) rows = rows.filter(({ collection, record }) => getLevel(collection, record) !== null && Number(getLevel(collection, record)) >= min);
  if (max !== null) rows = rows.filter(({ collection, record }) => getLevel(collection, record) !== null && Number(getLevel(collection, record)) <= max);
  if (state.sort === 'name') rows.sort((a, b) => a.record.name.localeCompare(b.record.name, 'zh-Hant'));
  if (state.sort === 'level') rows.sort((a, b) => (getLevel(a.collection, a.record) ?? Number.MAX_SAFE_INTEGER) - (getLevel(b.collection, b.record) ?? Number.MAX_SAFE_INTEGER));
  if (state.sort === 'new') rows.sort((a, b) => String(b.record.createdAt || b.record.verifiedAt || '').localeCompare(String(a.record.createdAt || a.record.verifiedAt || '')));
  return rows;
}

function statusTag(record) {
  const status = record.testData ? '測試資料' : record.verificationStatus || '待驗證';
  const style = status === '官方已確認' ? 'verified' : status === '玩家證據已驗證' ? 'player' : status === '測試資料' ? 'test' : 'pending';
  return `<span class="tag ${style}">${e(status)}</span>`;
}

function navButton(tab, icon, label, className) {
  return `<button class="${className} ${state.tab === tab ? 'active' : ''}" data-tab="${tab}"><span>${icon}</span><span>${label}</span></button>`;
}

function scaffold() {
  const count = (collection) => state.database[collection].filter((record) => !record.testData).length;
  return `<div class="layout">
    <aside class="sidebar">
      <div class="brand"><div class="mark">🍁</div><div><strong>星圖鑑</strong><small>STARDEX · 楓星專用</small></div></div>
      <div class="sidebar-scroll">
        <div class="navgroup-title">探索</div>
        ${NAV_ITEMS.map(([tab, icon, label]) => navButton(tab, icon, label, 'snav')).join('')}
        <div class="navgroup-title">資料類別</div>
        ${CATALOG_COLLECTIONS.map((collection) => `<button class="snav ${state.tab === 'catalog' && state.kind === collection ? 'active' : ''}" data-kind="${collection}"><span>${TYPE_META[collection].icon}</span>${TYPE_META[collection].short}<span class="count">${count(collection)}</span></button>`).join('')}
      </div>
      <div class="sidebar-bottom"><strong>🧪 Public Beta v${APP_VERSION}</strong>無可靠來源的數值一律留白或標示待驗證；資料只保存在目前瀏覽器。<button class="mini-link beta-side-link" data-tab="beta">版本與安裝說明 →</button></div>
    </aside>
    <section class="main">
      <header class="topbar"><span class="crumb">楓星玩家百科 <span class="slash">／</span> ${e(pageTitle())}</span><div class="topbar-actions"><span class="date">Beta v${APP_VERSION} · Schema v${SCHEMA_VERSION} · ${e(state.database.meta.datasetVersion)}</span><button class="btn primary" data-dialog="entry">＋ 新增資料</button></div></header>
      <div class="mobile-bar"><div class="mini-brand"><div class="mark">🍁</div><span>星圖鑑 <small>Beta v${APP_VERSION}</small></span></div><button class="btn sm primary" data-dialog="entry">＋ 新增</button></div>
      <main class="content" id="content"></main>
    </section>
  </div>
  <nav class="mobile-nav">${NAV_ITEMS.map(([tab, icon, label]) => navButton(tab, icon, label, 'mnav')).join('')}</nav>
  <div id="modalHost"></div>`;
}

function pageTitle() {
  return ({ home: '探索首頁', catalog: '全站圖鑑', guides: '職業與攻略', market: '楓幣行情', mine: '收藏與資料管理', beta: 'Public Beta 說明' })[state.tab] || '星圖鑑';
}

function empty(title, message, action = '') {
  return `<div class="empty"><div class="illus">📭</div><h3>${e(title)}</h3><p>${e(message)}</p>${action}</div>`;
}

function card({ collection, record }) {
  const meta = TYPE_META[collection];
  const favorite = state.favorites.includes(recordRef(collection, record.id));
  const level = getLevel(collection, record);
  const summary = record.description || record.content || record.features || record.recommendedBuild || '尚未補充說明';
  return `<article class="entry ${record.testData ? 'test-entry' : ''}">
    <div class="upper"><span class="big-icon">${meta.icon}</span><button class="heart ${favorite ? 'on' : ''}" data-fav="${e(recordRef(collection, record.id))}" title="${favorite ? '取消收藏' : '加入收藏'}" aria-label="${favorite ? '取消收藏' : '加入收藏'}">${favorite ? '★' : '☆'}</button></div>
    <div><h3>${e(record.name)}</h3><div class="tags"><span class="tag gray">${e(meta.short)}</span>${statusTag(record)}${record.userCreated ? '<span class="tag user">自建</span>' : ''}</div></div>
    <div class="snippet">${e(summary)}</div>
    <div class="foot"><span>${level !== null && level !== undefined ? `Lv. ${e(level)}` : e(categoryText(collection, record) || '詳細資料待補')}</span><button class="mini-link" data-detail="${e(recordRef(collection, record.id))}">查看詳情 →</button></div>
  </article>`;
}

function homePage() {
  const stats = databaseStats(state.database);
  const categories = CATALOG_COLLECTIONS.map((collection) => `<button class="category" data-kind="${collection}"><span class="emoji">${TYPE_META[collection].icon}</span><strong>${TYPE_META[collection].label}</strong><span class="meta">${state.database[collection].filter((record) => !record.testData).length} 筆正式／待驗證資料</span></button>`).join('');
  const migrationNote = state.migration && (state.migration.schema || state.migration.entries || state.migration.prices)
    ? `<div class="notice success"><strong>舊資料已安全遷移</strong><span>${state.migration.schema ? `已由 schema v${state.migration.schema} 升級至 v${SCHEMA_VERSION}；` : ''}保留 ${state.migration.entries || 0} 筆舊版自建條目與 ${state.migration.prices || 0} 筆舊版價格紀錄；舊 localStorage key 未刪除。</span></div>`
    : '';
  return `${migrationNote}<div class="beta-alert"><div><span class="beta-badge">PUBLIC BETA · v${APP_VERSION}</span><strong>圖鑑資料仍在蒐集，待驗證內容不可視為確定資訊。</strong><small>內建資料更新：${e(new Date(state.datasetUpdatedAt || state.database.meta.updatedAt).toLocaleDateString('zh-TW'))} · 本機資料不會自動同步到其他網址或裝置</small></div><button class="btn sm soft" data-tab="beta">了解版本與安裝</button></div><section class="hero"><div class="eyebrow">MAPLESTAR KNOWLEDGE BASE</div><h1>楓星資料，關聯查得清楚。</h1><p>用穩定 ID 串起怪物、掉落物、地圖、NPC、職業技能、任務、BOSS、攻略與個人行情。未知數值保持空白，不把其他版本冒充為楓星。</p><div class="hero-actions"><button class="btn" data-tab="catalog">📖 搜尋全站</button><button class="btn ghost" data-tab="mine">🧰 管理資料</button><button class="btn ghost" data-install>📲 安裝 App</button></div></section>
    <div class="summary"><div class="stat"><div class="sticon">📚</div><div class="n">${stats.formalTotal}</div><div class="desc">圖鑑正式區條目</div></div><div class="stat"><div class="sticon">🛡️</div><div class="n">${stats.verificationRatio}%</div><div class="desc">已驗證比例</div></div><div class="stat"><div class="sticon">📷</div><div class="n">${stats.evidence.pending}</div><div class="desc">待審核玩家證據</div></div><div class="stat"><div class="sticon">⭐</div><div class="n">${state.favorites.length}</div><div class="desc">我的收藏</div></div></div>
    <div class="section-title"><div><h2>分類查詢</h2><p>沒有內容的欄位會誠實顯示空白狀態</p></div><button class="link-btn" data-tab="catalog">查看全部 →</button></div><div class="categories">${categories}</div>
    <div class="section-title"><div><h2>資料可信度</h2><p>來源存在，不代表所有欄位都已驗證</p></div></div>
    <div class="grid2"><div class="panel"><h3>🔁 可追蹤的雙向關聯</h3><div class="row-line"><strong>怪物 → 掉落物</strong><small>依 dropItemIds</small></div><div class="row-line"><strong>物品 → 怪物・BOSS・任務</strong><small>即時計算反向來源</small></div><div class="row-line"><strong>地圖 ↔ 怪物・NPC</strong><small>雙向合併穩定 ID</small></div><button class="btn soft sm" data-detail="monsters:monster-cloud-fox">查看雲狐範例 →</button></div><div class="panel"><h3>🛡️ 驗證狀態</h3><div class="row-line"><strong><span class="tag verified">官方已確認</span></strong><small>官方公開資訊直接確認</small></div><div class="row-line"><strong><span class="tag player">玩家證據已驗證</span></strong><small>證據經審核或交叉驗證</small></div><div class="row-line"><strong><span class="tag pending">待驗證</span></strong><small>不可當作確定數值</small></div><div class="row-line"><strong><span class="tag test">測試資料</span></strong><small>明確隔離、不冒充正式資料</small></div></div></div>`;
}

function betaPage() {
  const updated = new Date(state.datasetUpdatedAt || state.database.meta.updatedAt).toLocaleString('zh-TW');
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const installState = standalone ? '目前已用安裝模式開啟。' : state.installPrompt ? '此瀏覽器已提供安裝選項。' : '請依下方裝置步驟安裝。';
  return `<div class="page-h"><div><span class="beta-badge">PUBLIC BETA</span><h1>StarDex v${APP_VERSION}</h1><p>公開測試版仍有資料缺口；請以欄位狀態與原始來源判斷可信度。</p></div><button class="btn soft" data-tab="home">← 返回首頁</button></div>
    <div class="notice warning"><strong>資料不完整提醒</strong><span>「待驗證」與空白欄位都不是零，也不是已確認資訊。其他版本的楓之谷資料不會直接當成楓星資料。</span></div>
    <div class="beta-grid"><section class="panel"><h2>版本與資料</h2><div class="row-line"><strong>應用程式</strong><small>v${APP_VERSION} · ${e(RELEASE_DATE)}</small></div><div class="row-line"><strong>資料格式</strong><small>Schema v${SCHEMA_VERSION}</small></div><div class="row-line"><strong>資料集</strong><small>${e(state.database.meta.datasetVersion)}</small></div><div class="row-line"><strong>最後更新</strong><small>${e(updated)}</small></div><h3>本版更新</h3><ul class="plain-list">${RELEASE_NOTES.map((note) => `<li>${e(note)}</li>`).join('')}</ul></section>
    <section class="panel"><h2>可信度怎麼看</h2><div class="status-guide"><div><span class="tag verified">官方已確認</span><p>楓星官方公開頁面可直接確認的欄位；仍應查看來源日期。</p></div><div><span class="tag player">玩家證據已驗證</span><p>管理者人工對照截圖或證據後採用，不等於官方公告。</p></div><div><span class="tag pending">待驗證</span><p>候選資料或尚無足夠證據，不可當作確定資訊。</p></div><div><span class="tag test">測試資料</span><p>只用於測試功能，明確隔離於正式資料。</p></div></div></section></div>
    <section class="panel beta-section"><h2>資料來源與查證方式</h2><p>StarDex 優先引用楓星官方公告；官方未公開的欄位，採遊戲內截圖與玩家人工回報。每個關鍵欄位可分別記錄來源、日期與狀態。回報先留在本機待審核，審核通過後才更新圖鑑；系統沒有 OCR，也沒有假裝把資料送到雲端。</p><button class="btn soft" data-tab="mine">查看來源與證據管理 →</button></section>
    <section class="panel beta-section" id="install-guide"><h2>手機安裝與離線使用</h2><p>${e(installState)} 第一次必須在線開啟並完成快取；之後才能離線讀取已快取的介面與內建圖鑑。</p><div class="install-grid"><div><h3>iPhone / iPad Safari</h3><ol><li>用 Safari 開啟正式 HTTPS 網址。</li><li>點「分享」→「加入主畫面」。</li><li>確認名稱後點「新增」。</li></ol></div><div><h3>Android Chrome</h3><ol><li>用 Chrome 開啟正式 HTTPS 網址。</li><li>點瀏覽器的「安裝應用程式」或本頁按鈕。</li><li>依提示完成安裝。</li></ol><button class="btn primary sm" data-install>嘗試安裝</button></div></div><div class="notice"><strong>搬家前先備份</strong><span>Live Server、GitHub Pages、不同網域與不同瀏覽器各自使用獨立 localStorage；收藏、行情、證據與自建資料不會自動同步。請在「我的」匯出完整備份，再到新網址匯入。</span></div></section>
    <section class="panel beta-section"><h2>常見問題與回報</h2><details><summary>為什麼有名稱卻沒有數值？</summary><p>公開來源可能只確認名稱或活動存在；HP、經驗值、掉落率等未被可靠來源確認時會保持空白。</p></details><details><summary>如何回報錯誤？</summary><p>從任一圖鑑詳情點「回報這筆資料」，指定欄位、證據網址、觀察日期、代稱與可選截圖，預覽後保存；再匯出玩家回報 JSON 交給管理者。</p></details><details><summary>按下回報是否已送到網站管理者？</summary><p>沒有。Public Beta 尚無共用後端，所有回報只保存在目前瀏覽器；必須匯出 JSON 並用管理者公告的外部管道傳送。</p></details><details><summary>更新會刪除我的資料嗎？</summary><p>不會。v5 保持 schema v4 儲存鍵，Service Worker 更新只更換公開程式快取，不清除 localStorage。仍建議更新或換網址前先匯出備份。</p></details></section>`;
}

function catalogControls() {
  return `<div class="toolbar catalog-toolbar">
    <label class="searchbar">🔎 <input id="globalSearch" type="search" value="${e(state.query)}" placeholder="搜尋名稱、等級、分類、地圖、掉落物…" autocomplete="off"></label>
    <select id="statusFilter" class="select" aria-label="驗證狀態"><option value="all">全部狀態</option>${VERIFICATION_STATUSES.map((status) => `<option value="${e(status)}" ${state.status === status ? 'selected' : ''}>${e(status)}</option>`).join('')}</select>
    <select id="sort" class="select" aria-label="排序"><option value="default">預設排序</option><option value="name" ${state.sort === 'name' ? 'selected' : ''}>依名稱</option><option value="level" ${state.sort === 'level' ? 'selected' : ''}>依等級</option><option value="new" ${state.sort === 'new' ? 'selected' : ''}>最近建立</option></select>
    <div class="level-range"><input id="minLevel" type="number" min="0" max="9999" inputmode="numeric" value="${e(state.minLevel)}" placeholder="最低 Lv."><span>—</span><input id="maxLevel" type="number" min="0" max="9999" inputmode="numeric" value="${e(state.maxLevel)}" placeholder="最高 Lv."></div>
  </div>
  <div class="filters"><button class="filter ${state.kind === 'all' ? 'active' : ''}" data-filter="all">全部</button>${CATALOG_COLLECTIONS.map((collection) => `<button class="filter ${state.kind === collection ? 'active' : ''}" data-filter="${collection}">${TYPE_META[collection].icon} ${TYPE_META[collection].short}</button>`).join('')}</div>`;
}

function catalogResults() {
  const rows = filteredCatalog();
  return `<div class="result-meta"><span>符合條件：<strong>${rows.length}</strong> 筆</span><span>名稱、等級、分類與關聯資料皆可搜尋</span></div><div class="cards">${rows.length ? rows.map(card).join('') : empty('找不到符合的資料', '請調整關鍵字、類型、狀態或等級範圍。', '<button class="btn soft" data-reset-search>清除篩選</button>')}</div>`;
}

function catalogPage() {
  return `<div class="page-h"><div><h1>📚 楓星全站圖鑑</h1><p>搜尋所有正式、自建與明確隔離的測試資料；點選關聯可持續追查。</p></div><button class="btn primary" data-dialog="entry">＋ 新增條目</button></div>${catalogControls()}<div id="catalogResults">${catalogResults()}</div>`;
}

function guidesPage() {
  const collections = ['jobs', 'skills', 'quests', 'bosses', 'guides'];
  const sections = collections.map((collection) => {
    const rows = state.database[collection].map((record) => ({ collection, record }));
    return `<section><div class="section-title"><div><h2>${TYPE_META[collection].icon} ${TYPE_META[collection].label}</h2><p>${rows.length ? `${rows.length} 筆資料` : '尚無資料，歡迎依可靠來源建檔'}</p></div><button class="link-btn" data-kind="${collection}">在圖鑑中查看 →</button></div><div class="cards">${rows.length ? rows.map(card).join('') : empty(`尚無${TYPE_META[collection].short}資料`, `可新增自建資料或匯入符合 schema v${SCHEMA_VERSION} 的 JSON／CSV。`)}</div></section>`;
  }).join('');
  return `<div class="page-h"><div><h1>🧭 職業、任務與攻略</h1><p>配點、練等、裝備與任務資訊都保留來源和驗證狀態，不套用其他伺服器數值。</p></div><button class="btn primary" data-dialog="entry" data-kind-add="guides">＋ 新增攻略</button></div><div class="notice"><strong>資料不足時不會自動推薦</strong><span>需要等級、地圖與怪物經驗值等已驗證資料後，才適合產生練功排序。</span></div>${sections}`;
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function marketRows() {
  return state.database.prices
    .filter((price) => state.marketItem === 'all' || price.itemId === state.marketItem)
    .filter((price) => state.marketServer === 'all' || price.server === state.marketServer)
    .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
}

function priceLine(price) {
  const item = getRecord('items', price.itemId);
  return `<div class="report"><div><button class="text-button" data-detail="items:${e(price.itemId)}"><b>${e(item?.name || price.itemId)}</b></button><small>${e(price.server)}・${e(price.dataSource || '手動輸入')}・${e(price.notes || '無備註')}</small><small>${e(new Date(price.recordedAt).toLocaleString('zh-TW'))}</small></div><div class="right"><b>${n(price.price)} 楓幣</b><small><button class="mini-link danger-text" data-remove-price="${e(price.id)}">刪除</button></small></div></div>`;
}

function marketPage() {
  const rows = marketRows();
  const grouped = new Map();
  for (const price of state.database.prices) {
    const key = `${price.itemId}\u0000${price.server}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(price);
  }
  const summaries = [...grouped.values()].map((records) => ({
    itemId: records[0].itemId,
    server: records[0].server,
    count: records.length,
    median: median(records.map((record) => record.price)),
    latest: records.slice().sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt))[0].recordedAt
  }));
  const itemOptions = [...new Set(state.database.prices.map((price) => price.itemId))];
  const serverOptions = [...new Set(state.database.prices.map((price) => price.server))].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  return `<div class="page-h"><div><h1>💰 楓幣行情筆記</h1><p>所有價格都由使用者手動輸入，附伺服器、時間與資料來源；不冒充即時市場價格。</p></div><button class="btn primary" data-dialog="price">＋ 新增價格</button></div>
    <div class="notice"><strong>行情不是官方報價</strong><span>中位數只整理你輸入的樣本；筆數少、裝備狀態不同時不可直接視為市價。</span></div>
    ${summaries.length ? `<div class="section-title"><div><h2>物品價格摘要</h2><p>依物品與伺服器分組</p></div></div><div class="price-box">${summaries.map((summary) => `<div class="price-card"><h3>${e(getName('items', summary.itemId))}</h3><div class="amount">${n(summary.median)} <span>楓幣</span></div><p>${e(summary.server)}・${summary.count} 筆・最後 ${e(new Date(summary.latest).toLocaleDateString('zh-TW'))}</p><button class="mini-link" data-market-item="${e(summary.itemId)}" data-market-server="${e(summary.server)}">篩選紀錄 →</button></div>`).join('')}</div>` : ''}
    <div class="section-title"><div><h2>價格歷史</h2><p>${rows.length} 筆符合目前篩選</p></div></div>
    <div class="toolbar"><select id="marketItem" class="select"><option value="all">全部物品</option>${itemOptions.map((id) => `<option value="${e(id)}" ${state.marketItem === id ? 'selected' : ''}>${e(getName('items', id))}</option>`).join('')}</select><select id="marketServer" class="select"><option value="all">全部伺服器</option>${serverOptions.map((server) => `<option value="${e(server)}" ${state.marketServer === server ? 'selected' : ''}>${e(server)}</option>`).join('')}</select></div>
    ${rows.length ? `<div class="panel" id="priceReports">${rows.map(priceLine).join('')}</div>` : empty('尚無價格紀錄', '新增一筆實際觀察或成交資料後，這裡才會顯示歷史。', '<button class="btn primary" data-dialog="price">＋ 記錄第一筆價格</button>')}`;
}

function sourceRows() {
  return state.database.sources.map((source) => `<div class="source-row"><div><strong>${e(source.name)}</strong><small>${e(source.sourceType || '其他公開資訊')}・${e(source.version || '未註明版本')}・查證 ${e(source.checkedAt || '尚未查證')}・${e(source.verificationStatus || '待驗證')}</small></div><a class="btn sm" href="${e(safeUrl(source.url))}" target="_blank" rel="noopener noreferrer">開啟來源 ↗</a></div>`).join('');
}

function statisticsTable() {
  const stats = databaseStats(state.database);
  const rows = CATALOG_COLLECTIONS.map((collection) => {
    const current = stats.collections[collection];
    return `<tr><th>${TYPE_META[collection].icon} ${e(TYPE_META[collection].short)}</th><td>${current.total}</td><td>${current.statuses['官方已確認']}</td><td>${current.statuses['玩家證據已驗證']}</td><td>${current.statuses['待驗證']}</td><td>${current.critical.completenessRatio}%</td><td>${current.critical.verifiedRatio}%</td><td>${current.critical.missingSource}</td></tr>`;
  }).join('');
  const levels = stats.levelCoverage.map((row) => `<div class="coverage-cell"><strong>Lv.${row.min}–${row.max}</strong><span>${row.verified}/${row.total} 等級已驗證</span></div>`).join('');
  const priorities = stats.priorities.map((row) => `<button class="priority-row" data-detail="${e(recordRef(row.collection, row.id))}"><span>${TYPE_META[row.collection].icon} ${e(row.name)}</span><strong>缺 ${row.missing} 欄</strong></button>`).join('');
  return `<div class="stats-overview"><div><strong>${stats.formalTotal}</strong><span>正式區條目</span></div><div><strong>${stats.verified}</strong><span>整筆已驗證</span></div><div><strong>${stats.evidence.pending}</strong><span>證據待審</span></div><div><strong>${e(stats.latestUpdatedAt ? new Date(stats.latestUpdatedAt).toLocaleDateString('zh-TW') : '—')}</strong><span>最近更新</span></div></div><div class="table-scroll"><table class="stats-table"><thead><tr><th>分類</th><th>總數</th><th>官方</th><th>玩家</th><th>待驗證</th><th>欄位有值</th><th>欄位已驗證</th><th>有值無來源</th></tr></thead><tbody>${rows}</tbody></table></div><h3 class="quality-heading">Lv.1～60 怪物等級覆蓋</h3><div class="coverage-grid">${levels}</div><div class="quality-grid"><div><h3>掉落關聯</h3><p><strong>${stats.drops.verifiedRelations}/${stats.drops.totalRelations}</strong> 條關聯已有欄位級證據；${stats.drops.monstersWithDrops} 隻怪物已有掉落清單。</p></div><div><h3>最需要證據</h3><div class="priority-list">${priorities || '<p>目前沒有缺口</p>'}</div></div></div>`;
}

function evidenceFor(ref) {
  return state.database.evidence.filter((record) => record.targetRef === ref);
}

function evidenceCrossCount(record) {
  const normalizedClaim = String(record.claimValue || '').trim().toLocaleLowerCase('zh-Hant');
  return new Set(state.database.evidence.filter((candidate) => candidate.targetRef === record.targetRef && candidate.fieldKey === record.fieldKey && String(candidate.claimValue || '').trim().toLocaleLowerCase('zh-Hant') === normalizedClaim && candidate.reviewStatus !== '已拒絕').map((candidate) => String(candidate.reporterAlias || '').trim().toLocaleLowerCase('zh-Hant'))).size;
}

function evidenceCard(record, reviewTools = false) {
  const parsed = parseRecordRef(record.targetRef);
  const target = parsed ? getRecord(parsed.collection, parsed.id) : null;
  const statusStyle = record.reviewStatus === '已採用' ? 'verified' : record.reviewStatus === '已拒絕' ? 'test' : 'pending';
  const link = safeUrl(record.evidenceUrl);
  return `<article class="evidence-card"><div class="evidence-head"><div><strong>${e(target?.name || record.targetRef)}</strong><small>${e(record.field)}・${e(record.evidenceType)}</small></div><span class="tag ${statusStyle}">${e(record.reviewStatus)}</span></div><p>${e(record.claimValue)}</p><div class="evidence-meta"><span>回報者：${e(record.reporterAlias)}</span><span>觀察：${e(new Date(record.observedAt).toLocaleDateString('zh-TW'))}</span><span>相同主張 ${evidenceCrossCount(record)} 位回報者</span></div>${record.screenshotDataUrl ? `<img class="evidence-image" src="${e(record.screenshotDataUrl)}" alt="玩家證據截圖">` : ''}${link ? `<a class="mini-link" href="${e(link)}" target="_blank" rel="noopener noreferrer">開啟外部證據 ↗</a>` : ''}${record.reviewNotes ? `<p class="review-note">審核備註：${e(record.reviewNotes)}</p>` : ''}${reviewTools && record.reviewStatus === '待審核' ? `<div class="evidence-actions"><button class="btn sm soft" data-evidence-review="${e(record.id)}" data-review-status="已採用">採用證據</button><button class="btn sm danger" data-evidence-review="${e(record.id)}" data-review-status="已拒絕">拒絕</button></div>` : ''}</article>`;
}

function minePage() {
  const favorites = state.favorites.map(parseRecordRef).filter(Boolean).map((ref) => {
    const record = getRecord(ref.collection, ref.id);
    return record ? { collection: ref.collection, record } : null;
  }).filter(Boolean);
  const userRecords = allCatalog().filter(({ record }) => record.userCreated);
  return `<div class="page-h"><div><h1>⭐ 收藏與資料管理</h1><p>收藏、自建內容、備份、匯入驗證與來源清單都集中在這裡。</p></div></div>
    <div class="section-title"><div><h2>我的收藏 <span class="muted-count">${favorites.length}</span></h2></div></div><div class="cards">${favorites.length ? favorites.map(card).join('') : empty('還沒有收藏', '在任一圖鑑卡片點星星，重新整理後仍會保留。', '<button class="btn soft" data-tab="catalog">前往圖鑑 →</button>')}</div>
    <div class="section-title"><div><h2>資料完整度儀表板</h2><p>依關鍵欄位計算；只有名稱不算完整，測試資料不計入</p></div></div><div class="panel">${statisticsTable()}</div>
    <div class="section-title"><div><h2>資料工具</h2><p>匯入前會檢查 schema、重複 ID、欄位與所有外鍵</p></div></div>
    <div class="tools"><div class="panel"><h3>📤 JSON／CSV 匯入匯出</h3><p>完整備份含 schema v${SCHEMA_VERSION} 資料庫、欄位驗證、證據、價格與收藏；玩家回報 JSON 只含回報、相關來源與目標索引。所有檔案選取後都先預覽，不會立即寫入。</p><button class="btn primary" data-export>⬇ 匯出完整備份</button><button class="btn soft" data-export-evidence>📷 匯出玩家回報 JSON</button><button class="btn soft" data-import>⬆ 匯入備份／玩家回報／CSV</button><button class="btn soft" data-csv-template>下載 CSV 範本</button><input id="fileImport" type="file" accept=".json,.csv,application/json,text/csv" hidden><div class="notice compact"><strong>網址或裝置切換不會自動同步</strong><span>請先匯出完整備份；到新網址後再選擇該 JSON、檢查預覽並確認匯入。</span></div></div><div class="panel"><h3>🔧 管理自建內容</h3><p>目前有 ${userRecords.length} 筆自建圖鑑、${state.database.prices.length} 筆價格、${state.database.evidence.length} 筆玩家證據。清空時會保留內建資料與舊版備份 key。</p><button class="btn soft" data-dialog="entry">＋ 新增條目</button><button class="btn soft" data-dialog="evidence">📷 回報證據</button><button class="btn danger" data-action="clear-user">清空 v${SCHEMA_VERSION} 自建資料</button></div></div>
    <div class="section-title"><div><h2>玩家證據 <span class="muted-count">${state.database.evidence.length}</span></h2><p>本機人工審核：採用後才更新指定欄位；衝突回報全部保留。尚未連接 OCR 或雲端多人審核。</p></div><button class="btn soft" data-dialog="evidence">＋ 提交證據</button></div><div class="evidence-grid">${state.database.evidence.length ? state.database.evidence.slice().sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt)).map((record) => evidenceCard(record, true)).join('') : empty('尚無玩家證據', '可附遊戲內截圖、觀察日期、回報者代稱與外部證據網址。')}</div>
    <div class="section-title"><div><h2>我的自建條目</h2></div></div><div class="cards">${userRecords.length ? userRecords.map(card).join('') : empty('尚無自建條目', '新增內容時可附來源與驗證狀態。', '<button class="btn primary" data-dialog="entry">＋ 新增條目</button>')}</div>
    <div class="section-title"><div><h2>資料來源</h2><p>${state.database.sources.length} 筆；來源頁存在不等於所有內容已驗證</p></div></div><div class="panel source-list">${sourceRows()}</div>
    <p class="footnote">StarDex 是非官方玩家工具，與 Nexon、MapleStar 營運方無關。<br>資料只針對楓星 MapleStar；使用前請比對遊戲內最新資訊。</p>`;
}

function renderPage() {
  const content = document.querySelector('#content');
  if (!content) return;
  content.innerHTML = ({ home: homePage, catalog: catalogPage, guides: guidesPage, market: marketPage, mine: minePage, beta: betaPage })[state.tab]?.() || homePage();
}

function render() {
  if (state.fatalError) {
    app.innerHTML = `<main class="fatal"><div class="mark">🍁</div><h1>StarDex 無法安全開啟</h1><p>${e(state.fatalError)}</p><p>系統沒有刪除任何 localStorage。請先備份瀏覽器資料，再檢查 JSON。</p></main>`;
    return;
  }
  app.innerHTML = scaffold();
  renderPage();
  renderModal();
}

function relationButton(collection, id) {
  const record = getRecord(collection, id);
  return record ? `<button class="pill-link" data-detail="${e(recordRef(collection, id))}">${TYPE_META[collection].icon} ${e(record.name)} ↗</button>` : `<span class="pill-link broken">⚠ 找不到 ${e(id)}</span>`;
}

function relationSection(title, collection, ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) return `<section class="relation-block"><h3>${e(title)}</h3><p class="empty-inline">尚無已建立的關聯資料</p></section>`;
  return `<section class="relation-block"><h3>${e(title)}</h3><div class="related">${unique.map((id) => relationButton(collection, id)).join('')}</div></section>`;
}

function reverseMonsterIds(itemId) {
  return state.database.monsters.filter((monster) => monster.dropItemIds.includes(itemId)).map((monster) => monster.id);
}

function reverseBossIds(itemId) {
  return state.database.bosses.filter((boss) => boss.dropItemIds.includes(itemId)).map((boss) => boss.id);
}

function reverseQuestIds(itemId) {
  return state.database.quests.filter((quest) => quest.rewardItemIds.includes(itemId)).map((quest) => quest.id);
}

function reverseQuestRequirementIds(itemId) {
  return state.database.quests.filter((quest) => quest.requiredItemIds.includes(itemId)).map((quest) => quest.id);
}

function reverseMapIds(collection, id, field) {
  return state.database.maps.filter((map) => (map[field] || []).includes(id)).map((map) => map.id);
}

function mapMonsterIds(mapId) {
  return [...new Set([
    ...(getRecord('maps', mapId)?.monsterIds || []),
    ...state.database.monsters.filter((monster) => monster.mapIds.includes(mapId)).map((monster) => monster.id)
  ])];
}

function mapNpcIds(mapId) {
  return [...new Set([
    ...(getRecord('maps', mapId)?.npcIds || []),
    ...state.database.npcs.filter((npc) => npc.mapIds.includes(mapId)).map((npc) => npc.id)
  ])];
}

function detailData(collection, record) {
  const fields = [];
  const relations = [];
  const add = (label, value) => fields.push([label, value === null || value === undefined || value === '' ? '待驗證' : value]);
  const link = (title, target, ids) => relations.push(relationSection(title, target, ids));
  if (collection === 'monsters') {
    add('等級', record.level === null ? null : `Lv. ${record.level}`); add('HP', n(record.hp)); add('MP', n(record.mp)); add('經驗值', n(record.experience)); add('屬性', record.elements?.join('、') || null);
    link('出沒地圖', 'maps', [...new Set([...(record.mapIds || []), ...reverseMapIds('monsters', record.id, 'monsterIds')])]); link('掉落物', 'items', record.dropItemIds);
  } else if (collection === 'items') {
    add('分類', record.category); add('需求等級', record.requiredLevel === null ? null : `Lv. ${record.requiredLevel}`); add('能力值', Object.keys(record.stats || {}).length ? Object.entries(record.stats).map(([key, value]) => `${key} ${value}`).join('、') : null); add('交易資訊', record.tradeInfo);
    add('取得方式', record.acquisition); link('會掉落此物品的怪物', 'monsters', reverseMonsterIds(record.id)); link('會掉落此物品的 BOSS', 'bosses', reverseBossIds(record.id)); link('會獎勵此物品的任務', 'quests', reverseQuestIds(record.id)); link('需要此物品的任務', 'quests', reverseQuestRequirementIds(record.id));
  } else if (collection === 'maps') {
    add('區域', record.region); add('建議等級', record.recommendedLevel === null ? null : `Lv. ${record.recommendedLevel}`);
    link('相鄰地圖', 'maps', record.adjacentMapIds); link('地圖怪物', 'monsters', mapMonsterIds(record.id)); link('地圖 NPC', 'npcs', mapNpcIds(record.id));
  } else if (collection === 'npcs') {
    link('所在地圖', 'maps', [...new Set([...(record.mapIds || []), ...reverseMapIds('npcs', record.id, 'npcIds')])]);
  } else if (collection === 'jobs') {
    add('轉職階段', record.advancementStages?.join('、') || null); add('武器', record.weapons?.join('、') || null); add('特色', record.features);
    link('職業技能', 'skills', record.skillIds); link('推薦攻略', 'guides', record.trainingGuideIds);
  } else if (collection === 'skills') {
    add('技能等級上限', record.maxLevel); add('推薦配點', record.recommendedBuild);
    link('所屬職業', 'jobs', record.jobId ? [record.jobId] : []); link('前置技能', 'skills', record.prerequisiteSkillIds);
  } else if (collection === 'quests') {
    add('需求等級', record.requiredLevel === null ? null : `Lv. ${record.requiredLevel}`); add('獎勵說明', record.rewardsText);
    link('任務 NPC', 'npcs', record.npcIds); link('前置任務', 'quests', record.prerequisiteQuestIds); link('需求道具', 'items', record.requiredItemIds); link('獎勵道具', 'items', record.rewardItemIds);
  } else if (collection === 'bosses') {
    add('等級', record.level === null ? null : `Lv. ${record.level}`); add('進入條件', record.entryConditions); add('重生／限制', record.respawnOrLimits);
    link('進入地圖', 'maps', record.entryMapIds); link('前置任務', 'quests', record.requiredQuestIds); link('掉落物', 'items', record.dropItemIds);
  } else if (collection === 'guides') {
    add('攻略類型', record.guideType); add('適用等級', record.levelRange?.min || record.levelRange?.max ? `${record.levelRange?.min ?? '?'}–${record.levelRange?.max ?? '?'}` : null);
    link('相關職業', 'jobs', record.jobIds); link('相關地圖', 'maps', record.mapIds); link('相關物品', 'items', record.itemIds);
  }
  return { fields, relations };
}

function sourceBlock(record) {
  const sources = (record.sourceIds || []).map((id) => getRecord('sources', id)).filter(Boolean);
  if (!sources.length) return '<p class="empty-inline">尚未附上可核對來源</p>';
  return sources.map((source) => `<div class="source-detail"><a href="${e(safeUrl(source.url))}" target="_blank" rel="noopener noreferrer">${e(source.name)} ↗</a><small>${e(source.sourceType || '其他公開資訊')}・版本 ${e(source.version || '未註明')}・查證 ${e(source.checkedAt || '未查證')}・${e(source.verificationStatus || '待驗證')}</small></div>`).join('');
}

function fieldAuditBlock(collection, record) {
  const keys = [...new Set([...(CRITICAL_FIELDS[collection] || []), ...Object.keys(record.fieldVerifications || {})])];
  return keys.map((key) => {
    const verification = record.fieldVerifications?.[key];
    const label = FIELD_DEFINITIONS[collection]?.[key.split(':')[0]] || key;
    const member = key.includes(':') ? ` · ${getName(REFERENCE_RULES[collection]?.[key.split(':')[0]]?.collection || '', key.slice(key.indexOf(':') + 1))}` : '';
    const status = verification?.status || '待驗證';
    const style = status === '官方已確認' ? 'verified' : status === '玩家證據已驗證' ? 'player' : 'pending';
    const trace = [...(verification?.sourceIds || []), ...(verification?.evidenceIds || [])].join('、') || '尚無可追溯來源';
    return `<div class="field-audit"><div><strong>${e(label + member)}</strong><small>${e(trace)}${verification?.verifiedAt ? `・${e(verification.verifiedAt)}` : ''}</small></div><span class="tag ${style}">${e(status)}</span></div>`;
  }).join('');
}

function renderDetail(ref) {
  const parsed = parseRecordRef(ref);
  if (!parsed) return '';
  const record = getRecord(parsed.collection, parsed.id);
  if (!record) return '';
  const { fields, relations } = detailData(parsed.collection, record);
  const favorite = state.favorites.includes(ref);
  const evidence = evidenceFor(ref);
  const description = record.description || record.content || record.features || '尚未補充說明';
  return `<div class="overlay" data-backdrop><div class="modal modal-wide" role="dialog" aria-modal="true" aria-label="條目詳情"><div class="modal-top"><div><span class="detail-icon">${TYPE_META[parsed.collection].icon}</span><h2>${e(record.name)}</h2><p class="detail-meta">${e(TYPE_META[parsed.collection].label)}　${statusTag(record)}${record.userCreated ? ' <span class="tag user">自建資料</span>' : ''}</p></div><button class="close" data-close aria-label="關閉">×</button></div>
    <div class="field-list">${fields.map(([label, value]) => `<div class="field"><label>${e(label)}</label><span>${e(value)}</span></div>`).join('')}</div>
    <h3 class="detail-heading">📖 詳細資訊</h3><div class="detail-text">${e(description)}</div>
    ${relations.join('')}
    <section class="relation-block"><h3>🧪 欄位級驗證</h3><div class="field-audit-list">${fieldAuditBlock(parsed.collection, record)}</div></section>
    <section class="relation-block"><h3>🔗 資料來源</h3>${sourceBlock(record)}${record.verifiedAt ? `<p class="checked-date">條目查證日期：${e(record.verifiedAt)}</p>` : ''}</section>
    <section class="relation-block"><div class="section-inline"><h3>📷 玩家證據（${evidence.length}）</h3><button class="mini-link" data-evidence-target="${e(ref)}">＋ 回報這筆資料</button></div>${evidence.length ? `<div class="evidence-grid compact">${evidence.map((item) => evidenceCard(item)).join('')}</div>` : '<p class="empty-inline">尚無玩家證據；官方未公開的欄位可由遊戲內截圖持續補充。</p>'}</section>
    <div class="form-actions split"><button class="btn soft" data-fav="${e(ref)}">${favorite ? '★ 已收藏' : '☆ 加入收藏'}</button><div class="two-actions">${record.userCreated ? `<button class="btn" data-edit="${e(ref)}">編輯</button><button class="btn danger" data-delete-entry="${e(ref)}">刪除</button>` : ''}<button class="btn" data-close>關閉</button></div></div>
  </div></div>`;
}

function options(collection, selected = [], excludeId = '') {
  const set = new Set(Array.isArray(selected) ? selected : [selected].filter(Boolean));
  return state.database[collection].filter((record) => record.id !== excludeId).map((record) => `<option value="${e(record.id)}" ${set.has(record.id) ? 'selected' : ''}>${e(record.name)} · ${e(record.id)}</option>`).join('');
}

function multiField(label, name, collection, selected, excludeId = '') {
  return `<div class="form-group"><label>${e(label)}</label><select name="${e(name)}" multiple size="4">${options(collection, selected, excludeId)}</select><div class="form-hint">桌面按 Ctrl／⌘ 可複選；手機可逐項點選。</div></div>`;
}

function relationFormFields(collection, record = {}) {
  if (collection === 'monsters') return multiField('出沒地圖', 'mapIds', 'maps', record.mapIds) + multiField('掉落物', 'dropItemIds', 'items', record.dropItemIds);
  if (collection === 'maps') return multiField('相鄰地圖', 'adjacentMapIds', 'maps', record.adjacentMapIds, record.id) + multiField('地圖怪物', 'monsterIds', 'monsters', record.monsterIds) + multiField('地圖 NPC', 'npcIds', 'npcs', record.npcIds);
  if (collection === 'npcs') return multiField('所在地圖', 'mapIds', 'maps', record.mapIds);
  if (collection === 'jobs') return multiField('職業技能', 'skillIds', 'skills', record.skillIds) + multiField('推薦攻略', 'trainingGuideIds', 'guides', record.trainingGuideIds);
  if (collection === 'skills') return `<div class="form-group"><label>所屬職業</label><select name="jobId"><option value="">待補</option>${options('jobs', record.jobId)}</select></div>` + multiField('前置技能', 'prerequisiteSkillIds', 'skills', record.prerequisiteSkillIds, record.id);
  if (collection === 'quests') return multiField('任務 NPC', 'npcIds', 'npcs', record.npcIds) + multiField('前置任務', 'prerequisiteQuestIds', 'quests', record.prerequisiteQuestIds, record.id) + multiField('需求道具', 'requiredItemIds', 'items', record.requiredItemIds) + multiField('獎勵道具', 'rewardItemIds', 'items', record.rewardItemIds);
  if (collection === 'bosses') return multiField('進入地圖', 'entryMapIds', 'maps', record.entryMapIds) + multiField('前置任務', 'requiredQuestIds', 'quests', record.requiredQuestIds) + multiField('掉落物', 'dropItemIds', 'items', record.dropItemIds);
  if (collection === 'guides') return multiField('相關職業', 'jobIds', 'jobs', record.jobIds) + multiField('相關地圖', 'mapIds', 'maps', record.mapIds) + multiField('相關物品', 'itemIds', 'items', record.itemIds);
  return '';
}

function specificFormFields(collection, record = {}) {
  const level = getLevel(collection, record) ?? '';
  const levelInput = `<div class="form-group"><label>等級／建議等級</label><input name="level" type="number" min="0" max="9999" inputmode="numeric" value="${e(level)}" placeholder="不確定請留空"></div>`;
  if (collection === 'monsters') return `${levelInput}<div class="form-grid three"><div class="form-group"><label>HP</label><input name="hp" type="number" min="0" value="${e(record.hp ?? '')}"></div><div class="form-group"><label>MP</label><input name="mp" type="number" min="0" value="${e(record.mp ?? '')}"></div><div class="form-group"><label>經驗值</label><input name="experience" type="number" min="0" value="${e(record.experience ?? '')}"></div></div><div class="form-group"><label>屬性（逗號分隔）</label><input name="elements" value="${e(record.elements?.join(', ') || '')}" placeholder="不確定請留空"></div>`;
  if (collection === 'items') return `${levelInput}<div class="form-group"><label>分類</label><input name="category" value="${e(record.category || '')}" required></div><div class="form-group"><label>能力值（JSON 物件）</label><input name="stats" value="${e(Object.keys(record.stats || {}).length ? JSON.stringify(record.stats) : '')}" placeholder='例如 {"力量": 3}'></div><div class="form-group"><label>取得方式</label><textarea name="acquisition">${e(record.acquisition || '')}</textarea></div><div class="form-group"><label>交易資訊</label><input name="tradeInfo" value="${e(record.tradeInfo || '')}"></div>`;
  if (collection === 'maps') return `${levelInput}<div class="form-group"><label>區域</label><input name="region" value="${e(record.region || '')}" required></div>`;
  if (collection === 'jobs') return `<div class="form-group"><label>轉職階段（逗號分隔）</label><input name="advancementStages" value="${e(record.advancementStages?.join(', ') || '')}"></div><div class="form-group"><label>武器（逗號分隔）</label><input name="weapons" value="${e(record.weapons?.join(', ') || '')}"></div><div class="form-group"><label>職業特色</label><textarea name="features">${e(record.features || '')}</textarea></div>`;
  if (collection === 'skills') return `${levelInput}<div class="form-group"><label>推薦配點</label><textarea name="recommendedBuild">${e(record.recommendedBuild || '')}</textarea></div>`;
  if (collection === 'quests') return `${levelInput}<div class="form-group"><label>獎勵說明</label><textarea name="rewardsText">${e(record.rewardsText || '')}</textarea></div>`;
  if (collection === 'bosses') return `${levelInput}<div class="form-group"><label>進入條件</label><textarea name="entryConditions">${e(record.entryConditions || '')}</textarea></div><div class="form-group"><label>重生／限制資訊</label><textarea name="respawnOrLimits">${e(record.respawnOrLimits || '')}</textarea></div>`;
  if (collection === 'guides') return `${levelInput}<div class="form-group"><label>攻略類型</label><input name="guideType" value="${e(record.guideType || '')}" placeholder="練等、裝備、打寶、楓幣…"></div><div class="form-group"><label>攻略內容</label><textarea name="content">${e(record.content || '')}</textarea></div>`;
  return '';
}

function entryDialog() {
  const parsed = state.edit ? parseRecordRef(state.edit) : null;
  const record = parsed ? getRecord(parsed.collection, parsed.id) : null;
  const collection = parsed?.collection || state.formKind;
  const allowedStatuses = record && evidenceFor(recordRef(collection, record.id)).some((item) => item.reviewStatus === '已採用') ? ['玩家證據已驗證', '待驗證'] : ['待驗證'];
  return `<div class="overlay" data-backdrop><div class="modal modal-wide" role="dialog" aria-modal="true" aria-label="${record ? '編輯資料' : '新增資料'}"><div class="modal-top"><div><h2>${record ? '✏️ 編輯資料' : '📝 新增圖鑑資料'}</h2><p class="explain">資料只存於本機；無法確認的數值請留空並選擇「待驗證」。</p></div><button class="close" data-close>×</button></div><form id="entryForm">
    <div class="form-grid"><div class="form-group"><label>資料類型 *</label><select id="entryKind" name="collection" ${record ? 'disabled' : ''}>${CATALOG_COLLECTIONS.map((type) => `<option value="${type}" ${collection === type ? 'selected' : ''}>${TYPE_META[type].label}</option>`).join('')}</select></div><div class="form-group"><label>名稱 *</label><input name="name" required maxlength="100" value="${e(record?.name || '')}"></div></div>
    ${specificFormFields(collection, record || {})}
    <div class="form-group"><label>詳細說明 *</label><textarea name="description" required maxlength="5000">${e(record?.description || '')}</textarea></div>
    ${relationFormFields(collection, record || {})}
    <div class="form-grid"><div class="form-group"><label>驗證狀態</label><select name="verificationStatus">${allowedStatuses.map((status) => `<option ${record?.verificationStatus === status ? 'selected' : ''}>${status}</option>`).join('')}</select><div class="form-hint">只有內建官方資料可標示「官方已確認」；採用至少一筆證據後，才可將自建條目標示為「玩家證據已驗證」。</div></div><div class="form-group"><label>查證日期</label><input name="verifiedAt" type="date" value="${e(record?.verifiedAt || '')}"></div></div>
    <div class="form-group"><label>來源網址（選填）</label><input name="sourceUrl" type="url" placeholder="https://…"><div class="form-hint">既有來源會保留；新網址會建立獨立 source ID。</div></div>
    <label class="check-row"><input name="testData" type="checkbox" ${record?.testData ? 'checked' : ''}> 這是測試資料（會與正式資料清楚區隔）</label>
    <div class="form-actions"><button class="btn" type="button" data-close>取消</button><button class="btn primary" type="submit">${record ? '儲存修改' : '新增資料'}</button></div>
  </form></div></div>`;
}

function priceDialog() {
  const local = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  return `<div class="overlay" data-backdrop><div class="modal" role="dialog" aria-modal="true" aria-label="新增價格"><div class="modal-top"><div><h2>💰 新增價格紀錄</h2><p class="explain">每筆價格會連到穩定的物品 ID，不只靠名稱。</p></div><button class="close" data-close>×</button></div><form id="priceForm"><div class="form-group"><label>物品 *</label><select name="itemId" required><option value="">請選擇</option>${options('items')}</select></div><div class="form-grid"><div class="form-group"><label>伺服器 *</label><input name="server" required maxlength="80"></div><div class="form-group"><label>價格（楓幣）*</label><input name="price" type="number" min="1" max="9007199254740991" step="1" required inputmode="numeric"></div></div><div class="form-group"><label>紀錄時間 *</label><input name="recordedAt" type="datetime-local" value="${local}" required></div><div class="form-group"><label>資料來源 *</label><input name="dataSource" required maxlength="120" placeholder="例如：自由市場觀察、實際成交"></div><div class="form-group"><label>來源網址（選填）</label><input name="sourceUrl" type="url" placeholder="https://…"></div><div class="form-group"><label>備註</label><textarea name="notes" maxlength="500" placeholder="裝備狀態、數量或交易條件"></textarea></div><div class="form-actions"><button class="btn" type="button" data-close>取消</button><button class="btn primary" type="submit">儲存價格</button></div></form></div></div>`;
}

function evidenceDialog() {
  const draft = state.evidenceDraft || {};
  const first = allCatalog()[0];
  const selectedTarget = state.evidenceTarget || draft.targetRef || (first ? recordRef(first.collection, first.record.id) : '');
  const selectedParsed = parseRecordRef(selectedTarget);
  const targetOptions = allCatalog().map(({ collection, record }) => {
    const ref = recordRef(collection, record.id);
    return `<option value="${e(ref)}" ${selectedTarget === ref ? 'selected' : ''}>${TYPE_META[collection].short}｜${e(record.name)} · ${e(record.id)}</option>`;
  }).join('');
  const fieldOptions = Object.entries(FIELD_DEFINITIONS[selectedParsed?.collection] || {}).map(([key, label]) => `<option value="${e(key)}" ${draft.fieldKey === key ? 'selected' : ''}>${e(label)}</option>`).join('');
  return `<div class="overlay" data-backdrop><div class="modal modal-wide" role="dialog" aria-modal="true" aria-label="提交玩家證據"><div class="modal-top"><div><h2>📷 建立本機玩家回報</h2><p class="explain">人工核對流程：先選明確欄位並附原始畫面，下一步預覽；確認後只寫入目前瀏覽器的待審核區，不會送到雲端，也不會自動 OCR。</p></div><button class="close" data-close>×</button></div><form id="evidenceForm"><div class="form-group"><label>圖鑑條目 *</label><select id="evidenceTargetSelect" name="targetRef" required>${targetOptions}</select></div><div class="form-grid"><div class="form-group"><label>查證欄位 *</label><select name="fieldKey" required>${fieldOptions}</select></div><div class="form-group"><label>證據類型 *</label><select name="evidenceType">${EVIDENCE_TYPES.map((type) => `<option ${draft.evidenceType === type ? 'selected' : ''}>${e(type)}</option>`).join('')}</select></div></div><div class="form-group"><label>觀察到的值／關聯 ID *</label><textarea name="claimValue" required maxlength="5000" placeholder="數值欄位填數字；掉落物、地圖等關聯填穩定 ID；物件欄位填 JSON。">${e(draft.claimValue || '')}</textarea><div class="form-hint">只填畫面可確認內容，不推算掉落率。關聯採用後會附加，不覆蓋既有清單。</div></div><div class="form-grid"><div class="form-group"><label>回報者代稱 *</label><input name="reporterAlias" required maxlength="80" autocomplete="nickname" value="${e(draft.reporterAlias || '')}"></div><div class="form-group"><label>遊戲內觀察日期 *</label><input name="observedAt" type="date" max="${new Date().toISOString().slice(0, 10)}" value="${e((draft.observedAt || new Date().toISOString()).slice(0, 10))}" required></div></div><div class="form-group"><label>遊戲內截圖（PNG／JPEG／WebP，建議 1.5 MB 以下）</label><input name="screenshot" type="file" accept="image/png,image/jpeg,image/webp"><div class="form-hint">截圖只存於此瀏覽器及匯出檔；請先遮蔽角色名、聊天與其他個人資訊。${draft.screenshotDataUrl ? ' 已保留上一個預覽的截圖；重新選檔才會取代。' : ''}</div>${draft.screenshotDataUrl ? `<img class="evidence-image draft-image" src="${e(draft.screenshotDataUrl)}" alt="待送出截圖預覽">` : ''}</div><div class="form-group"><label>外部證據網址（選填）</label><input name="evidenceUrl" type="url" placeholder="https://…" value="${e(draft.evidenceUrl || '')}"></div><div class="form-group"><label>補充說明</label><textarea name="reviewNotes" maxlength="1000" placeholder="畫面位置、伺服器或重現方式">${e(draft.reviewNotes || '')}</textarea></div><div class="form-actions"><button class="btn" type="button" data-close>取消</button><button class="btn primary" type="submit">下一步：預覽回報</button></div></form></div></div>`;
}

function evidencePreviewDialog() {
  const record = state.pendingEvidence;
  if (!record) return '';
  return `<div class="overlay" data-backdrop><div class="modal modal-wide" role="dialog" aria-modal="true" aria-label="預覽玩家回報"><div class="modal-top"><div><h2>🔎 送出前預覽</h2><p class="explain">請確認目標、欄位、內容、日期與截圖都正確。按下確認只會保存到這個瀏覽器的待審核區。</p></div><button class="close" data-close>×</button></div><div class="notice warning compact"><strong>尚未送出</strong><span>目前沒有共用後端；完成後仍需「匯出玩家回報 JSON」並透過管理者公告的外部管道傳送。</span></div><div class="evidence-preview">${evidenceCard(record)}</div><div class="form-actions"><button class="btn" data-edit-evidence>返回修改</button><button class="btn primary" data-confirm-evidence>確認存入待審核區</button></div></div></div>`;
}

function importDialog() {
  const report = state.importReport;
  if (!report) return '';
  const errors = report.errors || [];
  const warnings = report.warnings || [];
  const counts = report.database ? CATALOG_COLLECTIONS.map((collection) => `${TYPE_META[collection].short} ${report.database[collection].length}`).join('、') : '';
  const change = report.changes?.totals;
  const changes = change ? `<div class="import-summary"><span><strong>${change.added}</strong> 新增</span><span><strong>${change.updated}</strong> 更新</span><span><strong>${change.protected}</strong> 受保護</span><span><strong>${change.unchanged}</strong> 未變更</span></div>` : '';
  const preview = report.previewRows?.length ? `<div class="table-scroll"><table class="preview-table"><thead><tr><th>列</th><th>分類</th><th>ID</th><th>名稱</th><th>動作</th></tr></thead><tbody>${report.previewRows.slice(0, 100).map((row) => `<tr><td>${row.line}</td><td>${e(TYPE_META[row.collection]?.short || row.collection)}</td><td><code>${e(row.id)}</code></td><td>${e(row.name)}</td><td>${e(row.action)}</td></tr>`).join('')}</tbody></table></div>${report.previewRows.length > 100 ? `<p class="form-hint">只顯示前 100 筆；其餘 ${report.previewRows.length - 100} 筆仍會一併驗證。</p>` : ''}` : '';
  const migrationText = report.migrated ? `已先將 schema v${report.migratedFromSchema || 1} 資料轉換為 v${SCHEMA_VERSION}。` : `格式：${e(report.format || 'JSON')}；已檢查版本、重複 ID、欄位與外鍵。`;
  return `<div class="overlay" data-backdrop><div class="modal modal-wide" role="dialog" aria-modal="true" aria-label="匯入檢查結果"><div class="modal-top"><div><h2>${report.valid ? '✅ 匯入檔驗證通過' : '⛔ 匯入檔有錯誤'}</h2><p class="explain">${migrationText}</p></div><button class="close" data-close>×</button></div>${counts ? `<p class="import-counts">${e(counts)}</p>` : ''}${changes}${preview}${errors.length ? `<div class="validation-list error-list"><strong>必須修正；目前不允許匯入</strong><ul>${errors.slice(0, 30).map((error) => `<li>${e(error)}</li>`).join('')}</ul>${errors.length > 30 ? `<p>另有 ${errors.length - 30} 個錯誤未顯示。</p>` : ''}</div>` : ''}${warnings.length ? `<div class="validation-list warning-list"><strong>提醒</strong><ul>${warnings.slice(0, 30).map((warning) => `<li>${e(warning)}</li>`).join('')}</ul></div>` : ''}<div class="form-actions"><button class="btn" data-close>取消</button>${report.valid ? '<button class="btn primary" data-apply-import>確認合併匯入</button>' : ''}</div></div></div>`;
}

function renderModal() {
  const host = document.querySelector('#modalHost');
  if (!host) return;
  if (state.detail) host.innerHTML = renderDetail(state.detail);
  else if (state.dialog === 'entry') host.innerHTML = entryDialog();
  else if (state.dialog === 'price') host.innerHTML = priceDialog();
  else if (state.dialog === 'evidence') host.innerHTML = evidenceDialog();
  else if (state.dialog === 'evidence-preview') host.innerHTML = evidencePreviewDialog();
  else if (state.dialog === 'import') host.innerHTML = importDialog();
  else host.innerHTML = '';
}

function closeModal() {
  state.detail = null;
  state.dialog = null;
  state.edit = null;
  state.pendingImport = null;
  state.importReport = null;
  state.evidenceTarget = '';
  state.evidenceDraft = null;
  state.pendingEvidence = null;
  renderModal();
}

function navigate(tab, kind) {
  state.tab = tab;
  if (kind !== undefined) state.kind = kind;
  state.detail = null;
  state.dialog = null;
  window.scrollTo({ top: 0, behavior: 'instant' });
  render();
}

function persistDatabase() {
  state.database = saveDatabase(state.database);
}

function toggleFavorite(ref) {
  if (!parseRecordRef(ref)) return;
  state.favorites = state.favorites.includes(ref) ? state.favorites.filter((value) => value !== ref) : [...state.favorites, ref];
  saveFavorites(state.favorites);
  if (state.detail) renderModal(); else render();
}

function removeReferences(collection, id) {
  for (const [ownerCollection, rules] of Object.entries(REFERENCE_RULES)) {
    for (const record of state.database[ownerCollection]) {
      for (const [field, rule] of Object.entries(rules)) {
        if (rule.collection !== collection) continue;
        if (rule.many) record[field] = (record[field] || []).filter((value) => value !== id);
        else if (record[field] === id && rule.optional) record[field] = null;
      }
    }
  }
}

function deleteEntry(ref) {
  const parsed = parseRecordRef(ref);
  const record = parsed && getRecord(parsed.collection, parsed.id);
  if (!record?.userCreated) return;
  if (parsed.collection === 'items' && state.database.prices.some((price) => price.itemId === parsed.id)) {
    notify('此物品仍有價格歷史，請先刪除相關價格紀錄', 'error');
    return;
  }
  if (!window.confirm(`確定刪除「${record.name}」？相關收藏與外鍵會一併清理。`)) return;
  state.database[parsed.collection] = state.database[parsed.collection].filter((candidate) => candidate.id !== parsed.id);
  state.database.evidence = state.database.evidence.filter((candidate) => candidate.targetRef !== ref);
  removeReferences(parsed.collection, parsed.id);
  state.favorites = state.favorites.filter((favorite) => favorite !== ref);
  persistDatabase();
  saveFavorites(state.favorites);
  closeModal();
  render();
  notify('已刪除自建資料');
}

function createSource(url, namePrefix = '使用者提供來源') {
  const normalized = safeUrl(url);
  if (!normalized) return null;
  const existing = state.database.sources.find((source) => source.url === normalized);
  if (existing) return existing.id;
  const id = `source-user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  state.database.sources.push({ id, name: `${namePrefix} · ${new URL(normalized).hostname}`, url: normalized, version: '使用者輸入', checkedAt: new Date().toISOString().slice(0, 10), verificationStatus: '待驗證', notes: '尚未由 StarDex 審核。', sourceType: '玩家證據', userCreated: true });
  return id;
}

function arrayText(form, name) {
  return String(form.get(name) || '').split(/[,，、]/).map((value) => value.trim()).filter(Boolean);
}

function formValues(form, collection, original) {
  let stats = {};
  const rawStats = String(form.get('stats') || '').trim();
  if (rawStats) {
    try {
      stats = JSON.parse(rawStats);
      if (!stats || Array.isArray(stats) || typeof stats !== 'object') throw new Error();
    } catch {
      throw new Error('能力值必須是 JSON 物件，例如 {"力量": 3}');
    }
  }
  const sourceUrl = String(form.get('sourceUrl') || '').trim();
  if (sourceUrl && !safeUrl(sourceUrl)) throw new Error('來源網址只接受 http 或 https');
  const sourceId = sourceUrl ? createSource(sourceUrl) : null;
  const selected = (name) => form.getAll(name).map(String);
  const level = String(form.get('level') || '');
  return {
    id: original?.id,
    name: String(form.get('name') || '').trim(),
    description: String(form.get('description') || '').trim(),
    level,
    hp: form.get('hp'), mp: form.get('mp'), experience: form.get('experience'),
    elements: arrayText(form, 'elements'),
    category: form.get('category'), stats, acquisition: form.get('acquisition'), tradeInfo: form.get('tradeInfo'),
    region: form.get('region'),
    advancementStages: arrayText(form, 'advancementStages'), weapons: arrayText(form, 'weapons'), features: form.get('features'),
    jobId: form.get('jobId'), prerequisiteSkillIds: selected('prerequisiteSkillIds'), recommendedBuild: form.get('recommendedBuild'),
    rewardsText: form.get('rewardsText'), entryConditions: form.get('entryConditions'), respawnOrLimits: form.get('respawnOrLimits'),
    guideType: form.get('guideType'), content: form.get('content'),
    mapIds: selected('mapIds'), dropItemIds: selected('dropItemIds'), adjacentMapIds: selected('adjacentMapIds'), monsterIds: selected('monsterIds'), npcIds: selected('npcIds'),
    skillIds: selected('skillIds'), trainingGuideIds: selected('trainingGuideIds'), prerequisiteQuestIds: selected('prerequisiteQuestIds'), requiredItemIds: selected('requiredItemIds'), rewardItemIds: selected('rewardItemIds'), entryMapIds: selected('entryMapIds'), requiredQuestIds: selected('requiredQuestIds'), jobIds: selected('jobIds'), itemIds: selected('itemIds'),
    sourceIds: [...new Set([...(original?.sourceIds || []), ...(sourceId ? [sourceId] : [])])],
    verificationStatus: String(form.get('verificationStatus') || '待驗證'),
    verifiedAt: String(form.get('verifiedAt') || ''),
    testData: form.get('testData') === 'on',
    createdAt: original?.createdAt
  };
}

function saveEntry(formElement) {
  const form = new FormData(formElement);
  const parsed = state.edit ? parseRecordRef(state.edit) : null;
  const collection = parsed?.collection || String(form.get('collection') || state.formKind);
  const original = parsed ? getRecord(parsed.collection, parsed.id) : null;
  if (!CATALOG_COLLECTIONS.includes(collection)) throw new Error('不支援的資料類型');
  const values = formValues(form, collection, original);
  if (!values.name || !values.description) throw new Error('名稱與詳細說明不可空白');
  const record = createUserRecord(collection, values);
  const at = state.database[collection].findIndex((candidate) => candidate.id === record.id);
  if (at >= 0) state.database[collection][at] = record;
  else state.database[collection].unshift(record);
  persistDatabase();
  closeModal();
  render();
  notify(original ? '已更新圖鑑資料' : '已新增圖鑑資料');
}

function savePrice(formElement) {
  const form = new FormData(formElement);
  const price = Number(form.get('price'));
  if (!Number.isSafeInteger(price) || price <= 0) throw new Error('價格必須是大於 0 的整數');
  const itemId = String(form.get('itemId') || '');
  if (!getRecord('items', itemId)) throw new Error('請選擇有效物品');
  const server = String(form.get('server') || '').trim();
  const dataSource = String(form.get('dataSource') || '').trim();
  const date = new Date(String(form.get('recordedAt') || ''));
  if (!server || !dataSource || Number.isNaN(date.getTime())) throw new Error('請填寫伺服器、時間與資料來源');
  const sourceUrl = String(form.get('sourceUrl') || '').trim();
  if (sourceUrl && !safeUrl(sourceUrl)) throw new Error('來源網址只接受 http 或 https');
  const sourceId = sourceUrl ? createSource(sourceUrl, '價格資料來源') : null;
  state.database.prices.unshift({
    id: `price-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    itemId, server: server.slice(0, 80), price,
    recordedAt: date.toISOString(), dataSource: dataSource.slice(0, 120),
    notes: String(form.get('notes') || '').trim().slice(0, 500), sourceId, userCreated: true
  });
  persistDatabase();
  closeModal();
  state.tab = 'market';
  render();
  notify('價格紀錄已儲存');
}

function readScreenshot(file) {
  if (!file || !file.size) return Promise.resolve('');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return Promise.reject(new Error('截圖只接受 PNG、JPEG 或 WebP'));
  if (file.size > 1_500_000) return Promise.reject(new Error('截圖超過 1.5 MB，請先壓縮再提交'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result || '')));
    reader.addEventListener('error', () => reject(new Error('截圖讀取失敗')));
    reader.readAsDataURL(file);
  });
}

async function prepareEvidence(formElement) {
  const form = new FormData(formElement);
  const targetRef = String(form.get('targetRef') || '');
  const parsed = parseRecordRef(targetRef);
  if (!parsed || !getRecord(parsed.collection, parsed.id)) throw new Error('請選擇有效的圖鑑條目');
  const screenshot = form.get('screenshot');
  const screenshotDataUrl = screenshot instanceof File && screenshot.size ? await readScreenshot(screenshot) : state.evidenceDraft?.screenshotDataUrl || '';
  const evidenceUrl = String(form.get('evidenceUrl') || '').trim();
  if (evidenceUrl && !safeUrl(evidenceUrl)) throw new Error('證據網址只接受 http 或 https');
  const record = createEvidenceRecord({
    targetRef,
    fieldKey: form.get('fieldKey'),
    field: FIELD_DEFINITIONS[parsed.collection]?.[String(form.get('fieldKey'))] || String(form.get('fieldKey')),
    claimValue: form.get('claimValue'),
    evidenceType: form.get('evidenceType'),
    evidenceUrl,
    screenshotDataUrl,
    reporterAlias: form.get('reporterAlias'),
    observedAt: form.get('observedAt'),
    reviewNotes: form.get('reviewNotes'),
    sourceId: null
  });
  state.evidenceDraft = { ...record, evidenceUrl };
  state.pendingEvidence = record;
  state.dialog = 'evidence-preview';
  renderModal();
}

function confirmEvidence() {
  if (!state.pendingEvidence) return;
  const before = JSON.stringify(state.database);
  try {
    const record = { ...state.pendingEvidence };
    record.sourceId = record.evidenceUrl ? createSource(record.evidenceUrl, '玩家證據來源') : null;
    state.database.evidence.unshift(record);
    persistDatabase();
  } catch (error) {
    state.database = JSON.parse(before);
    throw error;
  }
  state.evidenceTarget = '';
  closeModal();
  state.tab = 'mine';
  render();
  notify('回報已保存於本機待審核區；尚未傳送到雲端');
}

function reviewEvidence(id, reviewStatus) {
  if (!EVIDENCE_STATUSES.includes(reviewStatus) || reviewStatus === '待審核') return;
  const record = state.database.evidence.find((candidate) => candidate.id === id);
  if (!record) return;
  const note = window.prompt(reviewStatus === '已採用' ? '採用理由或交叉驗證備註（可留空）' : '拒絕理由（建議填寫）', record.reviewNotes || '');
  if (note === null) return;
  try {
    state.database = applyEvidenceReview(state.database, id, reviewStatus, note);
    persistDatabase();
    renderPage();
    notify(reviewStatus === '已採用' ? '證據已採用，指定欄位與欄位級來源已更新' : '證據已標示拒絕，原始紀錄仍保留');
  } catch (error) { notify(error.message, 'error'); }
}

function downloadJson(payload, filename, message) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  notify(message);
}

function exportData() {
  downloadJson(
    makeBackup(state.database, state.favorites),
    `stardex-maplestar-app-v${APP_VERSION}-schema-v${SCHEMA_VERSION}-${new Date().toISOString().slice(0, 10)}.json`,
    '完整備份檔已產生'
  );
}

function exportEvidenceData() {
  if (!state.database.evidence.length) {
    notify('目前沒有玩家回報可匯出', 'error');
    return;
  }
  downloadJson(
    makeEvidenceBundle(state.database),
    `stardex-player-reports-${new Date().toISOString().slice(0, 10)}.json`,
    '玩家回報 JSON 已產生；請透過管理者指定管道傳送'
  );
}

function downloadCsvTemplate() {
  const blob = new Blob([makeCsvTemplate()], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'stardex-maplestar-import-template.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  notify('CSV 匯入範本已產生');
}

async function inspectImport(file) {
  if (!file) return;
  if (file.size > 10_000_000) {
    notify('檔案超過 10MB，請拆分後再匯入', 'error');
    return;
  }
  try {
    const content = await file.text();
    const isCsv = file.name.toLocaleLowerCase().endsWith('.csv') || file.type === 'text/csv';
    state.importReport = isCsv ? parseCsvImport(content, state.database) : parseImportPayload(JSON.parse(content), state.database);
    state.pendingImport = state.importReport.valid ? state.importReport : null;
    state.dialog = 'import';
    renderModal();
  } catch (error) {
    state.importReport = { valid: false, errors: [`檔案解析失敗：${error.message}`], warnings: [], format: file.name.toLocaleLowerCase().endsWith('.csv') ? 'CSV' : 'JSON' };
    state.pendingImport = null;
    state.dialog = 'import';
    renderModal();
  }
}

function applyImport() {
  if (!state.pendingImport?.valid) return;
  const merged = mergeImportedData(state.database, state.pendingImport.database, state.favorites, state.pendingImport.favorites);
  state.database = merged.database;
  state.favorites = merged.favorites;
  persistDatabase();
  saveFavorites(state.favorites);
  closeModal();
  render();
  notify(`匯入完成${merged.warnings.length ? `，${merged.warnings.length} 筆內建資料未覆寫` : ''}`);
}

function clearUserData() {
  if (!window.confirm(`確定清空 schema v${SCHEMA_VERSION} 的自建圖鑑、玩家證據、價格與自建來源？內建資料及舊版 localStorage 備份不會刪除。`)) return;
  for (const collection of CATALOG_COLLECTIONS) state.database[collection] = state.database[collection].filter((record) => !record.userCreated);
  state.database.prices = [];
  state.database.evidence = [];
  for (const collection of CATALOG_COLLECTIONS) {
    for (const record of state.database[collection]) {
      record.fieldVerifications = Object.fromEntries(Object.entries(record.fieldVerifications || {}).filter(([, value]) => !(value.evidenceIds || []).length));
    }
  }
  state.database.sources = state.database.sources.filter((record) => !record.userCreated);
  for (const collection of CATALOG_COLLECTIONS) {
    const valid = new Set(state.database[collection].map((record) => record.id));
    for (const favorite of state.favorites.slice()) {
      const parsed = parseRecordRef(favorite);
      if (parsed?.collection === collection && !valid.has(parsed.id)) state.favorites = state.favorites.filter((value) => value !== favorite);
    }
  }
  persistDatabase();
  saveFavorites(state.favorites);
  render();
  notify(`已清空 v${SCHEMA_VERSION} 自建資料；舊資料備份仍保留`);
}

function updateCatalogResults() {
  const results = document.querySelector('#catalogResults');
  if (results) results.innerHTML = catalogResults();
  document.querySelectorAll('[data-filter]').forEach((button) => button.classList.toggle('active', button.dataset.filter === state.kind));
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) {
    if (event.target.matches('[data-backdrop]')) closeModal();
    return;
  }
  if (button.dataset.tab) return navigate(button.dataset.tab);
  if (button.dataset.install !== undefined) { requestInstall(); return; }
  if (button.dataset.applyUpdate !== undefined) {
    state.waitingWorker?.postMessage({ type: 'SKIP_WAITING' });
    return;
  }
  if (button.dataset.kind) return navigate('catalog', button.dataset.kind);
  if (button.dataset.filter) { state.kind = button.dataset.filter; updateCatalogResults(); return; }
  if (button.dataset.detail) { state.detail = button.dataset.detail; state.dialog = null; renderModal(); return; }
  if (button.dataset.fav) { toggleFavorite(button.dataset.fav); return; }
  if (button.dataset.close !== undefined) { closeModal(); return; }
  if (button.dataset.dialog) {
    state.dialog = button.dataset.dialog; state.detail = null; state.edit = null;
    if (button.dataset.kindAdd) state.formKind = button.dataset.kindAdd;
    renderModal(); return;
  }
  if (button.dataset.edit) {
    const parsed = parseRecordRef(button.dataset.edit);
    if (!parsed) return;
    state.edit = button.dataset.edit; state.formKind = parsed.collection; state.detail = null; state.dialog = 'entry'; renderModal(); return;
  }
  if (button.dataset.deleteEntry) return deleteEntry(button.dataset.deleteEntry);
  if (button.dataset.export !== undefined) return exportData();
  if (button.dataset.exportEvidence !== undefined) return exportEvidenceData();
  if (button.dataset.csvTemplate !== undefined) return downloadCsvTemplate();
  if (button.dataset.import !== undefined) { document.querySelector('#fileImport')?.click(); return; }
  if (button.dataset.applyImport !== undefined) return applyImport();
  if (button.dataset.editEvidence !== undefined) {
    state.evidenceTarget = state.pendingEvidence?.targetRef || '';
    state.dialog = 'evidence';
    renderModal();
    return;
  }
  if (button.dataset.confirmEvidence !== undefined) {
    try { confirmEvidence(); } catch (error) { notify(error.message, 'error'); }
    return;
  }
  if (button.dataset.evidenceTarget) {
    state.evidenceTarget = button.dataset.evidenceTarget;
    state.detail = null;
    state.dialog = 'evidence';
    renderModal();
    return;
  }
  if (button.dataset.evidenceReview) return reviewEvidence(button.dataset.evidenceReview, button.dataset.reviewStatus);
  if (button.dataset.removePrice) {
    if (window.confirm('確定刪除這筆價格紀錄？')) {
      state.database.prices = state.database.prices.filter((price) => price.id !== button.dataset.removePrice);
      persistDatabase(); renderPage(); notify('已刪除價格紀錄');
    }
    return;
  }
  if (button.dataset.marketItem) {
    state.marketItem = button.dataset.marketItem; state.marketServer = button.dataset.marketServer || 'all'; renderPage(); document.querySelector('#priceReports')?.scrollIntoView({ behavior: 'smooth' }); return;
  }
  if (button.dataset.action === 'clear-user') return clearUserData();
  if (button.dataset.resetSearch !== undefined) {
    state.query = ''; state.kind = 'all'; state.status = 'all'; state.minLevel = ''; state.maxLevel = ''; state.sort = 'default'; renderPage();
  }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'globalSearch') { state.query = event.target.value; updateCatalogResults(); }
  if (event.target.id === 'minLevel') { state.minLevel = event.target.value; updateCatalogResults(); }
  if (event.target.id === 'maxLevel') { state.maxLevel = event.target.value; updateCatalogResults(); }
});

document.addEventListener('change', (event) => {
  if (event.target.id === 'sort') { state.sort = event.target.value; updateCatalogResults(); }
  if (event.target.id === 'statusFilter') { state.status = event.target.value; updateCatalogResults(); }
  if (event.target.id === 'entryKind') { state.formKind = event.target.value; renderModal(); }
  if (event.target.id === 'evidenceTargetSelect') { state.evidenceTarget = event.target.value; renderModal(); }
  if (event.target.id === 'fileImport') { inspectImport(event.target.files?.[0]); event.target.value = ''; }
  if (event.target.id === 'marketItem') { state.marketItem = event.target.value; renderPage(); }
  if (event.target.id === 'marketServer') { state.marketServer = event.target.value; renderPage(); }
});

document.addEventListener('submit', (event) => {
  event.preventDefault();
  if (event.target.id === 'evidenceForm') {
    prepareEvidence(event.target).catch((error) => notify(error.message, 'error'));
    return;
  }
  try {
    if (event.target.id === 'entryForm') saveEntry(event.target);
    if (event.target.id === 'priceForm') savePrice(event.target);
  } catch (error) {
    notify(error.message, 'error');
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeModal();
});

async function requestInstall() {
  if (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true) {
    notify('StarDex 已用安裝模式開啟');
    return;
  }
  if (state.installPrompt) {
    const promptEvent = state.installPrompt;
    state.installPrompt = null;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    notify(choice.outcome === 'accepted' ? '已接受安裝；請依瀏覽器提示完成' : '已取消安裝');
    if (state.tab === 'home' || state.tab === 'beta') renderPage();
    return;
  }
  navigate('beta');
  window.setTimeout(() => document.querySelector('#install-guide')?.scrollIntoView({ behavior: 'smooth' }), 0);
  notify(/iphone|ipad|ipod/i.test(navigator.userAgent) ? '請用 Safari 的分享選單選擇「加入主畫面」' : '請使用瀏覽器選單的「安裝應用程式」或「加入主畫面」');
}

function showUpdateBanner(worker) {
  if (!worker) return;
  state.waitingWorker = worker;
  const banner = document.querySelector('#updateBanner');
  if (banner) banner.hidden = false;
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
  try {
    const registration = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
    if (registration.waiting && navigator.serviceWorker.controller) showUpdateBanner(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(worker);
      });
    });
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update().catch(() => {});
    });
  } catch (error) {
    console.warn('[StarDex] Service Worker 註冊失敗；線上功能仍可使用', error);
  }
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  state.installPrompt = event;
  if (state.database && (state.tab === 'home' || state.tab === 'beta')) renderPage();
});

window.addEventListener('appinstalled', () => {
  state.installPrompt = null;
  notify('StarDex 已安裝到此裝置');
});

async function start() {
  try {
    const response = await fetch('./data/maplestar.seed.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`種子資料載入失敗（HTTP ${response.status}）`);
    const seed = await response.json();
    const seedValidation = validateDatabase(seed, { allowTestData: true });
    if (!seedValidation.valid) throw new Error(`內建資料驗證失敗：${seedValidation.errors[0]}`);
    const loaded = loadAppData(seed);
    state.database = loaded.database;
    state.datasetUpdatedAt = seed.meta.updatedAt;
    state.favorites = loaded.favorites;
    state.migration = loaded.migration;
    const requestedView = new URLSearchParams(location.search).get('view');
    if (['home', 'catalog', 'guides', 'market', 'mine', 'beta'].includes(requestedView)) state.tab = requestedView;
    render();
    window.__STARDEX_TEST__ = {
      getState: () => ({ database: state.database, favorites: state.favorites, tab: state.tab }),
      validateDatabase,
      filteredCatalog,
      databaseStats: () => databaseStats(state.database),
      reverseSources: (itemId) => ({ monsters: reverseMonsterIds(itemId), bosses: reverseBossIds(itemId), rewardQuests: reverseQuestIds(itemId), requiredByQuests: reverseQuestRequirementIds(itemId) }),
      openDetail: (collection, id) => { state.detail = recordRef(collection, id); renderModal(); },
      inspectImportObject: (object) => parseImportPayload(object, state.database),
      inspectCsv: (csv) => parseCsvImport(csv, state.database),
      evidenceBundle: () => makeEvidenceBundle(state.database),
      appVersion: APP_VERSION
    };
  } catch (error) {
    state.fatalError = error.message;
    render();
    console.error('[StarDex]', error);
  }
}

start();
window.addEventListener('load', registerServiceWorker);
