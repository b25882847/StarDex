import {
  CATALOG_COLLECTIONS,
  COLLECTIONS,
  SCHEMA_VERSION,
  createEmptyDatabase,
  parseRecordRef,
  recordRef,
  validateDatabase
} from './schema.js';

export const DATABASE_KEY = 'stardex.database.v2';
export const FAVORITES_KEY = 'stardex.favorites.v2';
export const LEGACY_KEYS = {
  entries: 'stardex.user.v1',
  prices: 'stardex.prices.v1',
  favorites: 'stardex.fav.v1'
};

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function read(storage, key, fallback) {
  try {
    const raw = storage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function text(value, max = 5000) {
  return String(value ?? '').trim().slice(0, max);
}

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function safeDate(value) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function hash(value) {
  let result = 2166136261;
  for (const char of String(value)) {
    result ^= char.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function safeId(value, prefix = 'user') {
  const normalized = text(value, 120).replace(/[^a-z0-9._:-]+/gi, '-').replace(/^-+|-+$/g, '');
  if (/^[a-z0-9][a-z0-9._:-]{1,119}$/i.test(normalized)) return normalized;
  return `${prefix}-${hash(value || Date.now())}`;
}

function splitRelated(value) {
  return text(value, 1000).split(/[、,，]/).map((part) => part.trim()).filter(Boolean);
}

function sourceForLegacyUrl(database, url, date) {
  const normalized = safeUrl(url);
  if (!normalized) return [];
  const existing = database.sources.find((source) => source.url === normalized);
  if (existing) return [existing.id];
  const id = `source-user-${hash(normalized)}`;
  database.sources.push({
    id,
    name: `舊版自建資料來源 ${new URL(normalized).hostname}`,
    url: normalized,
    version: text(date, 20) || '未註明',
    checkedAt: text(date, 20) || new Date().toISOString().slice(0, 10),
    verificationStatus: '待驗證',
    notes: '由 StarDex v1 自建條目保留；內容未經系統審核。',
    userCreated: true
  });
  return [id];
}

function commonLegacy(entry, database) {
  return {
    id: safeId(entry.id, 'legacy'),
    name: text(entry.title || entry.name, 100) || '未命名舊資料',
    description: text(entry.note || entry.description, 5000),
    sourceIds: sourceForLegacyUrl(database, entry.source, entry.date),
    verificationStatus: '待驗證',
    verifiedAt: text(entry.date, 20) || null,
    testData: false,
    userCreated: true,
    createdAt: safeDate(entry.date || Date.now()),
    legacyRelatedNames: splitRelated(entry.related)
  };
}

function legacyEntryToRecord(entry, database) {
  const common = commonLegacy(entry, database);
  const level = numberOrNull(entry.level);
  switch (entry.kind) {
    case 'monster':
      return ['monsters', { ...common, level, hp: null, mp: null, experience: null, elements: [], mapIds: [], dropItemIds: [] }];
    case 'item':
      return ['items', { ...common, category: text(entry.region, 120) || '未分類', requiredLevel: level, stats: {}, acquisition: '', tradeInfo: '待驗證' }];
    case 'map':
      return ['maps', { ...common, region: text(entry.region, 120) || '待驗證', adjacentMapIds: [], monsterIds: [], npcIds: [], recommendedLevel: level }];
    case 'job':
      return ['jobs', { ...common, advancementStages: [], weapons: [], features: common.description, skillIds: [], trainingGuideIds: [] }];
    case 'quest':
      return ['quests', { ...common, requiredLevel: level, npcIds: [], prerequisiteQuestIds: [], requiredItemIds: [], rewardItemIds: [], rewardsText: '待驗證' }];
    case 'boss':
      return ['bosses', { ...common, level, entryConditions: '待驗證', entryMapIds: [], requiredQuestIds: [], dropItemIds: [], respawnOrLimits: '待驗證' }];
    case 'guide':
      return ['guides', { ...common, guideType: text(entry.region, 120) || '自建攻略', levelRange: { min: level, max: level }, jobIds: [], mapIds: [], itemIds: [], content: common.description }];
    default:
      return null;
  }
}

function findByName(database, collection, name) {
  const needle = String(name || '').trim().toLocaleLowerCase('zh-Hant');
  return database[collection].find((record) => String(record.name || '').trim().toLocaleLowerCase('zh-Hant') === needle);
}

function resolveLegacyRelationships(database, migratedEntries) {
  for (const { collection, record } of migratedEntries) {
    const names = record.legacyRelatedNames || [];
    if (collection === 'monsters') {
      record.dropItemIds = names.map((name) => findByName(database, 'items', name)?.id).filter(Boolean);
      record.mapIds = [record.description, ...names].flatMap((name) => {
        const match = database.maps.find((map) => String(name).includes(map.name));
        return match ? [match.id] : [];
      });
    }
    if (collection === 'maps') {
      record.monsterIds = names.map((name) => findByName(database, 'monsters', name)?.id).filter(Boolean);
      record.npcIds = names.map((name) => findByName(database, 'npcs', name)?.id).filter(Boolean);
    }
    if (collection === 'jobs') record.skillIds = names.map((name) => findByName(database, 'skills', name)?.id).filter(Boolean);
    if (collection === 'guides') {
      record.jobIds = names.map((name) => findByName(database, 'jobs', name)?.id).filter(Boolean);
      record.mapIds = names.map((name) => findByName(database, 'maps', name)?.id).filter(Boolean);
      record.itemIds = names.map((name) => findByName(database, 'items', name)?.id).filter(Boolean);
    }
  }
}

function ensurePriceItem(database, itemName) {
  const existing = findByName(database, 'items', itemName);
  if (existing) return existing.id;
  const id = `item-legacy-price-${hash(itemName)}`;
  database.items.push({
    id,
    name: text(itemName, 100) || '未命名物品',
    category: '價格紀錄建立的待分類物品',
    requiredLevel: null,
    stats: {},
    acquisition: '',
    tradeInfo: '待驗證',
    description: '為保留舊版價格紀錄而自動建立，請補充物品資料。',
    sourceIds: [],
    verificationStatus: '待驗證',
    verifiedAt: null,
    testData: false,
    userCreated: true,
    createdAt: new Date().toISOString()
  });
  return id;
}

export function migrateLegacyPayload(database, payload = {}) {
  const result = clone(database);
  const migratedEntries = [];
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  const prices = Array.isArray(payload.prices) ? payload.prices : [];
  const favoriteIds = Array.isArray(payload.favorites) ? payload.favorites : [];

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const converted = legacyEntryToRecord(entry, result);
    if (!converted) continue;
    const [collection, record] = converted;
    const at = result[collection].findIndex((candidate) => candidate.id === record.id);
    if (at >= 0 && result[collection][at].userCreated !== false) result[collection][at] = record;
    else if (at < 0) result[collection].push(record);
    migratedEntries.push({ collection, record });
  }
  resolveLegacyRelationships(result, migratedEntries);

  for (const price of prices) {
    if (!price || typeof price !== 'object' || !text(price.item, 100)) continue;
    const numericPrice = Number(price.price);
    if (!Number.isSafeInteger(numericPrice) || numericPrice <= 0) continue;
    const itemId = ensurePriceItem(result, price.item);
    const record = {
      id: safeId(price.id, 'price'),
      itemId,
      server: text(price.world, 80) || '未指定',
      price: numericPrice,
      recordedAt: safeDate(price.ts || Date.now()),
      dataSource: text(price.type, 80) || '舊版價格紀錄',
      notes: text(price.memo, 500),
      sourceId: null,
      userCreated: true
    };
    const at = result.prices.findIndex((candidate) => candidate.id === record.id);
    if (at >= 0) result.prices[at] = record;
    else result.prices.push(record);
  }

  const favorites = [];
  for (const legacyId of favoriteIds) {
    for (const collection of CATALOG_COLLECTIONS) {
      if (result[collection].some((record) => record.id === legacyId)) {
        favorites.push(recordRef(collection, legacyId));
        break;
      }
    }
  }
  result.meta = {
    ...result.meta,
    migratedFrom: 'StarDex v1',
    migratedAt: new Date().toISOString()
  };
  return { database: result, favorites: [...new Set(favorites)], counts: { entries: migratedEntries.length, prices: prices.length } };
}

function mergeSeedWithStored(seed, stored) {
  const merged = clone(seed);
  for (const collection of COLLECTIONS) {
    const incoming = Array.isArray(stored[collection]) ? stored[collection] : [];
    if (collection === 'prices') {
      merged.prices = clone(incoming);
      continue;
    }
    for (const record of incoming) {
      if (record?.userCreated !== true) continue;
      const at = merged[collection].findIndex((candidate) => candidate.id === record.id);
      if (at >= 0) merged[collection][at] = clone(record);
      else merged[collection].push(clone(record));
    }
  }
  merged.meta = { ...merged.meta, ...stored.meta, datasetVersion: seed.meta.datasetVersion, updatedAt: seed.meta.updatedAt };
  return merged;
}

export function loadAppData(seed, storage = globalThis.localStorage) {
  const stored = read(storage, DATABASE_KEY, null);
  const savedFavorites = read(storage, FAVORITES_KEY, []);
  let database;
  let migration = { entries: 0, prices: 0 };
  let favorites = Array.isArray(savedFavorites) ? savedFavorites : [];

  if (stored && stored.schemaVersion === SCHEMA_VERSION) {
    const validation = validateDatabase(stored, { allowTestData: true });
    if (!validation.valid) {
      throw new Error(`本機資料庫格式損壞：${validation.errors.slice(0, 3).join('；')}`);
    }
    database = mergeSeedWithStored(seed, stored);
  } else {
    const legacyPayload = {
      entries: read(storage, LEGACY_KEYS.entries, []),
      prices: read(storage, LEGACY_KEYS.prices, []),
      favorites: read(storage, LEGACY_KEYS.favorites, [])
    };
    const migrated = migrateLegacyPayload(seed, legacyPayload);
    database = migrated.database;
    favorites = [...new Set([...favorites, ...migrated.favorites])];
    migration = migrated.counts;
  }

  const existingRefs = new Set(CATALOG_COLLECTIONS.flatMap((collection) => database[collection].map((record) => recordRef(collection, record.id))));
  favorites = [...new Set(favorites.filter((favorite) => parseRecordRef(favorite) && existingRefs.has(favorite)))];
  saveDatabase(database, storage);
  saveFavorites(favorites, storage);
  return { database, favorites, migration };
}

export function saveDatabase(database, storage = globalThis.localStorage) {
  const validation = validateDatabase(database, { allowTestData: true });
  if (!validation.valid) throw new Error(`拒絕儲存無效資料：${validation.errors[0]}`);
  const next = clone(database);
  next.meta.updatedAt = new Date().toISOString();
  storage.setItem(DATABASE_KEY, JSON.stringify(next));
  return next;
}

export function saveFavorites(favorites, storage = globalThis.localStorage) {
  storage.setItem(FAVORITES_KEY, JSON.stringify([...new Set(favorites)]));
}

export function makeBackup(database, favorites) {
  return {
    format: 'StarDexBackup',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    database: clone(database),
    favorites: [...new Set(favorites)]
  };
}

export function parseImportPayload(raw, currentDatabase) {
  let candidate;
  let favorites = [];
  let migrated = false;
  if (raw?.format === 'StarDexBackup' && raw.version === 1) {
    const result = migrateLegacyPayload(currentDatabase, raw);
    candidate = result.database;
    favorites = result.favorites;
    migrated = true;
  } else if (raw?.format === 'StarDexBackup' && raw.schemaVersion === SCHEMA_VERSION) {
    candidate = raw.database;
    favorites = Array.isArray(raw.favorites) ? raw.favorites : [];
  } else if (raw?.schemaVersion === SCHEMA_VERSION) {
    candidate = raw;
    favorites = Array.isArray(raw.favorites) ? raw.favorites : [];
  } else {
    return {
      valid: false,
      errors: [`無法辨識的備份格式或 schema version；目前只接受 v1 舊備份與 schema v${SCHEMA_VERSION}`],
      warnings: []
    };
  }
  const validation = validateDatabase(candidate);
  return { ...validation, database: candidate, favorites, migrated };
}

export function mergeImportedData(currentDatabase, importedDatabase, currentFavorites = [], importedFavorites = []) {
  const result = clone(currentDatabase);
  const warnings = [];
  for (const collection of COLLECTIONS) {
    const byId = new Map(result[collection].map((record) => [record.id, record]));
    for (const incoming of importedDatabase[collection]) {
      const current = byId.get(incoming.id);
      if (current?.userCreated === false) {
        if (incoming.userCreated !== false) warnings.push(`略過 ${collection}/${incoming.id}：不可用匯入資料覆寫內建條目`);
        continue;
      }
      byId.set(incoming.id, clone(incoming));
    }
    result[collection] = [...byId.values()];
  }
  result.meta = { ...result.meta, importedAt: new Date().toISOString() };
  const validRefs = new Set(CATALOG_COLLECTIONS.flatMap((collection) => result[collection].map((record) => recordRef(collection, record.id))));
  const favorites = [...new Set([...currentFavorites, ...importedFavorites])].filter((favorite) => validRefs.has(favorite));
  const validation = validateDatabase(result, { allowTestData: true });
  if (!validation.valid) throw new Error(`合併後資料驗證失敗：${validation.errors[0]}`);
  return { database: result, favorites, warnings };
}

export function createUserRecord(collection, values) {
  const id = safeId(values.id || `${collection.slice(0, -1)}-${Date.now().toString(36)}-${hash(Math.random())}`, collection.slice(0, -1));
  const common = {
    id,
    name: text(values.name, 100),
    description: text(values.description, 5000),
    sourceIds: Array.isArray(values.sourceIds) ? values.sourceIds : [],
    verificationStatus: values.testData ? '測試資料' : text(values.verificationStatus, 20) || '待驗證',
    verifiedAt: text(values.verifiedAt, 20) || null,
    testData: Boolean(values.testData),
    userCreated: true,
    createdAt: values.createdAt || new Date().toISOString()
  };
  const level = numberOrNull(values.level);
  switch (collection) {
    case 'monsters': return { ...common, level, hp: numberOrNull(values.hp), mp: numberOrNull(values.mp), experience: numberOrNull(values.experience), elements: values.elements || [], mapIds: values.mapIds || [], dropItemIds: values.dropItemIds || [] };
    case 'items': return { ...common, category: text(values.category, 120) || '未分類', requiredLevel: level, stats: values.stats || {}, acquisition: text(values.acquisition, 1000), tradeInfo: text(values.tradeInfo, 1000) || '待驗證' };
    case 'maps': return { ...common, region: text(values.region, 120) || '待驗證', adjacentMapIds: values.adjacentMapIds || [], monsterIds: values.monsterIds || [], npcIds: values.npcIds || [], recommendedLevel: level };
    case 'npcs': return { ...common, mapIds: values.mapIds || [] };
    case 'jobs': return { ...common, advancementStages: values.advancementStages || [], weapons: values.weapons || [], features: text(values.features || values.description, 2000), skillIds: values.skillIds || [], trainingGuideIds: values.trainingGuideIds || [] };
    case 'skills': return { ...common, jobId: values.jobId || null, maxLevel: level, prerequisiteSkillIds: values.prerequisiteSkillIds || [], recommendedBuild: text(values.recommendedBuild, 2000) || '待驗證' };
    case 'quests': return { ...common, requiredLevel: level, npcIds: values.npcIds || [], prerequisiteQuestIds: values.prerequisiteQuestIds || [], requiredItemIds: values.requiredItemIds || [], rewardItemIds: values.rewardItemIds || [], rewardsText: text(values.rewardsText, 2000) || '待驗證' };
    case 'bosses': return { ...common, level, entryConditions: text(values.entryConditions, 2000) || '待驗證', entryMapIds: values.entryMapIds || [], requiredQuestIds: values.requiredQuestIds || [], dropItemIds: values.dropItemIds || [], respawnOrLimits: text(values.respawnOrLimits, 1000) || '待驗證' };
    case 'guides': return { ...common, guideType: text(values.guideType, 120) || '自建攻略', levelRange: values.levelRange || { min: level, max: level }, jobIds: values.jobIds || [], mapIds: values.mapIds || [], itemIds: values.itemIds || [], content: text(values.content || values.description, 5000) };
    default: throw new Error(`不支援的自建資料類型：${collection}`);
  }
}

export function databaseStats(database) {
  return Object.fromEntries(COLLECTIONS.map((collection) => [collection, database[collection]?.length || 0]));
}

export { createEmptyDatabase };
