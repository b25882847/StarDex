import {
  CATALOG_COLLECTIONS,
  COLLECTIONS,
  CRITICAL_FIELDS,
  FIELD_DEFINITIONS,
  SCHEMA_VERSION,
  createEmptyDatabase,
  fieldBase,
  fieldLabel,
  parseRecordRef,
  recordRef,
  validateDatabase
} from './schema.js';

export const DATABASE_KEY = 'stardex.database.v4';
export const FAVORITES_KEY = 'stardex.favorites.v4';
export const LEGACY_KEYS = {
  databaseV3: 'stardex.database.v3',
  favoritesV3: 'stardex.favorites.v3',
  databaseV2: 'stardex.database.v2',
  favoritesV2: 'stardex.favorites.v2',
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
    sourceType: '玩家證據',
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
    fieldVerifications: {},
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
    createdAt: new Date().toISOString(),
    fieldVerifications: {}
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

function migrateVerificationStatus(value, isOfficial = false) {
  if (value === '測試資料') return '測試資料';
  if (value === '官方已確認' || value === '玩家證據已驗證' || value === '待驗證') return value;
  if (value === '已驗證' && isOfficial) return '官方已確認';
  return '待驗證';
}

export function migrateV2Database(database) {
  const result = clone(database || {});
  result.schemaVersion = SCHEMA_VERSION;
  for (const collection of COLLECTIONS) {
    if (!Array.isArray(result[collection])) result[collection] = [];
  }
  for (const collection of CATALOG_COLLECTIONS) {
    result[collection] = result[collection].map((record) => ({
      ...record,
      verificationStatus: migrateVerificationStatus(record.verificationStatus, record.userCreated === false),
      fieldVerifications: normalizeFieldVerifications(collection, record)
    }));
  }
  result.sources = result.sources.map((source) => ({
    ...source,
    verificationStatus: migrateVerificationStatus(source.verificationStatus, source.userCreated === false),
    sourceType: source.sourceType || (source.userCreated === false ? '楓星官方' : '玩家證據'),
    userCreated: source.userCreated === true
  }));
  result.evidence = Array.isArray(result.evidence) ? result.evidence : [];
  result.meta = {
    ...(result.meta || {}),
    product: 'MapleStar',
    locale: result.meta?.locale || 'zh-Hant',
    migratedFromSchema: 2,
    migratedAt: new Date().toISOString()
  };
  return result;
}

function verificationEntry(status, sourceIds = [], verifiedAt = '', notes = '', evidenceIds = []) {
  return { status: migrateVerificationStatus(status), sourceIds: [...new Set(sourceIds || [])], evidenceIds: [...new Set(evidenceIds || [])], verifiedAt: text(verifiedAt, 40), notes: text(notes, 1000) };
}

function normalizeFieldVerifications(collection, record) {
  if (record?.fieldVerifications && typeof record.fieldVerifications === 'object' && !Array.isArray(record.fieldVerifications)) return clone(record.fieldVerifications);
  const result = {};
  if (text(record?.name, 100)) result.name = verificationEntry(record.verificationStatus, record.sourceIds, record.verifiedAt, '由舊版整筆狀態遷移；只保守套用於名稱。');
  return result;
}

function evidenceFieldKey(collection, evidence) {
  const supplied = text(evidence?.fieldKey, 120);
  if (FIELD_DEFINITIONS[collection]?.[fieldBase(supplied)]) return supplied;
  const label = text(evidence?.field, 120).toLocaleLowerCase('zh-Hant');
  return Object.entries(FIELD_DEFINITIONS[collection] || {}).find(([key, value]) => key.toLocaleLowerCase('zh-Hant') === label || value.toLocaleLowerCase('zh-Hant') === label)?.[0] || 'description';
}

export function migrateV3Database(database) {
  const result = clone(database || {});
  result.schemaVersion = SCHEMA_VERSION;
  for (const collection of COLLECTIONS) if (!Array.isArray(result[collection])) result[collection] = [];
  for (const collection of CATALOG_COLLECTIONS) {
    result[collection] = result[collection].map((record) => ({ ...record, fieldVerifications: normalizeFieldVerifications(collection, record) }));
  }
  result.evidence = result.evidence.map((record) => {
    const parsed = parseRecordRef(record.targetRef);
    const fieldKey = parsed ? evidenceFieldKey(parsed.collection, record) : 'description';
    return { ...record, fieldKey, field: record.field || (parsed ? fieldLabel(parsed.collection, fieldKey) : fieldKey) };
  });
  result.meta = { ...(result.meta || {}), product: 'MapleStar', locale: result.meta?.locale || 'zh-Hant', migratedFromSchema: 3, migratedAt: new Date().toISOString() };
  return result;
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
      const at = merged[collection].findIndex((candidate) => candidate.id === record.id);
      if (record?.userCreated === true) {
        if (at >= 0) merged[collection][at] = clone(record);
        else merged[collection].push(clone(record));
        continue;
      }
      if (at >= 0 && CATALOG_COLLECTIONS.includes(collection)) {
        const adopted = Object.entries(record.fieldVerifications || {}).filter(([, value]) => value?.evidenceIds?.length);
        for (const [fieldKey] of adopted) merged[collection][at][fieldBase(fieldKey)] = clone(record[fieldBase(fieldKey)]);
        merged[collection][at].fieldVerifications = { ...(merged[collection][at].fieldVerifications || {}), ...clone(record.fieldVerifications || {}) };
      }
    }
  }
  merged.meta = { ...merged.meta, ...stored.meta, datasetVersion: seed.meta.datasetVersion, updatedAt: seed.meta.updatedAt };
  return merged;
}

export function loadAppData(seed, storage = globalThis.localStorage) {
  const stored = read(storage, DATABASE_KEY, null);
  const v3Stored = read(storage, LEGACY_KEYS.databaseV3, null);
  const v2Stored = read(storage, LEGACY_KEYS.databaseV2, null);
  const savedFavorites = read(storage, FAVORITES_KEY, null) ?? read(storage, LEGACY_KEYS.favoritesV3, null) ?? read(storage, LEGACY_KEYS.favoritesV2, []);
  let database;
  let migration = { entries: 0, prices: 0, schema: null };
  let favorites = Array.isArray(savedFavorites) ? savedFavorites : [];

  if (stored && stored.schemaVersion === SCHEMA_VERSION) {
    const validation = validateDatabase(stored, { allowTestData: true });
    if (!validation.valid) {
      throw new Error(`本機資料庫格式損壞：${validation.errors.slice(0, 3).join('；')}`);
    }
    database = mergeSeedWithStored(seed, stored);
  } else if (v3Stored?.schemaVersion === 3) {
    const migratedV3 = migrateV3Database(v3Stored);
    const validation = validateDatabase(migratedV3, { allowTestData: true });
    if (!validation.valid) throw new Error(`v3 本機資料無法遷移：${validation.errors.slice(0, 3).join('；')}`);
    database = mergeSeedWithStored(seed, migratedV3);
    migration.schema = 3;
  } else if (v2Stored?.schemaVersion === 2) {
    const migratedV2 = migrateV2Database(v2Stored);
    const validation = validateDatabase(migratedV2, { allowTestData: true });
    if (!validation.valid) throw new Error(`v2 本機資料無法遷移：${validation.errors.slice(0, 3).join('；')}`);
    database = mergeSeedWithStored(seed, migratedV2);
    migration.schema = 2;
  } else {
    const legacyPayload = {
      entries: read(storage, LEGACY_KEYS.entries, []),
      prices: read(storage, LEGACY_KEYS.prices, []),
      favorites: read(storage, LEGACY_KEYS.favorites, [])
    };
    const migrated = migrateLegacyPayload(seed, legacyPayload);
    database = migrated.database;
    favorites = [...new Set([...favorites, ...migrated.favorites])];
    migration = { ...migrated.counts, schema: 1 };
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

export function makeEvidenceBundle(database) {
  const evidence = clone(database.evidence || []);
  const sourceIds = new Set(evidence.map((record) => record.sourceId).filter(Boolean));
  const targetRefs = [...new Set(evidence.map((record) => record.targetRef).filter(Boolean))];
  return {
    format: 'StarDexEvidenceBundle',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    notice: '本檔案是玩家本機回報，匯入後一律回到待審核，不代表官方確認。',
    evidence,
    sources: (database.sources || []).filter((source) => sourceIds.has(source.id)).map(clone),
    targets: targetRefs.map((ref) => {
      const parsed = parseRecordRef(ref);
      const record = parsed ? database[parsed.collection]?.find((entry) => entry.id === parsed.id) : null;
      return { ref, collection: parsed?.collection || '', id: parsed?.id || '', name: record?.name || '' };
    })
  };
}

export function parseEvidenceBundle(raw, currentDatabase) {
  const errors = [];
  const warnings = [];
  if (!raw || typeof raw !== 'object' || raw.format !== 'StarDexEvidenceBundle') {
    return { valid: false, errors: ['不是 StarDex 玩家回報 JSON'], warnings, format: '玩家回報 JSON' };
  }
  if (raw.schemaVersion !== SCHEMA_VERSION) errors.push(`玩家回報 schemaVersion 必須是 ${SCHEMA_VERSION}`);
  if (!Array.isArray(raw.evidence)) errors.push('evidence 必須是陣列');
  if (raw.sources !== undefined && !Array.isArray(raw.sources)) errors.push('sources 必須是陣列');
  if (errors.length) return { valid: false, errors, warnings, format: '玩家回報 JSON' };

  const candidate = clone(currentDatabase);
  const existingSources = new Map(candidate.sources.map((source) => [source.id, source]));
  const incomingSourceIds = new Set();
  for (const source of raw.sources || []) {
    if (!source || typeof source !== 'object') {
      errors.push('玩家回報來源必須是物件');
      continue;
    }
    const id = safeId(source.id, 'source-player');
    if (id !== source.id) errors.push(`玩家回報來源 ID 無效：「${String(source.id || '')}」`);
    if (incomingSourceIds.has(id)) errors.push(`玩家回報來源重複 ID：「${id}」`);
    incomingSourceIds.add(id);
    const url = safeUrl(source.url);
    if (!url) errors.push(`玩家回報來源 ${id} 缺少有效 http/https 網址`);
    const existing = existingSources.get(id);
    if (existing) {
      if (url && existing.url !== url) errors.push(`玩家回報來源 ${id} 與現有來源網址衝突`);
      continue;
    }
    const normalized = {
      id,
      name: text(source.name, 160) || `玩家證據來源 · ${url ? new URL(url).hostname : id}`,
      url,
      version: text(source.version, 120) || '玩家回報匯入',
      checkedAt: safeDate(source.checkedAt || Date.now()).slice(0, 10),
      verificationStatus: '待驗證',
      notes: text(source.notes, 1000) || '由玩家回報 JSON 匯入，尚未由 StarDex 管理者核對。',
      sourceType: '玩家證據',
      userCreated: true
    };
    candidate.sources.push(normalized);
    existingSources.set(id, normalized);
    if (source.verificationStatus === '官方已確認' || source.sourceType === '楓星官方') warnings.push(`來源 ${id} 的官方狀態未被採信，已改為待驗證玩家來源`);
  }

  const incomingEvidenceIds = new Set();
  const existingEvidenceIds = new Set(candidate.evidence.map((record) => record.id));
  const previewRows = [];
  for (const [index, incoming] of raw.evidence.entries()) {
    if (!incoming || typeof incoming !== 'object') {
      errors.push(`evidence[${index}] 必須是物件`);
      continue;
    }
    const id = safeId(incoming.id, 'evidence-player');
    if (id !== incoming.id) errors.push(`evidence[${index}].id 無效：「${String(incoming.id || '')}」`);
    if (incomingEvidenceIds.has(id)) errors.push(`玩家回報含重複證據 ID：「${id}」`);
    incomingEvidenceIds.add(id);
    const parsed = parseRecordRef(incoming.targetRef);
    if (!parsed || !candidate[parsed.collection]?.some((record) => record.id === parsed.id)) {
      errors.push(`evidence[${index}].targetRef 找不到圖鑑條目「${String(incoming.targetRef || '')}」`);
      continue;
    }
    if (incoming.sourceId && !existingSources.has(incoming.sourceId)) errors.push(`evidence[${index}].sourceId 找不到來源「${incoming.sourceId}」`);
    if (existingEvidenceIds.has(id)) {
      warnings.push(`略過已存在的玩家證據 ${id}`);
      previewRows.push({ line: index + 1, collection: 'evidence', id, name: incoming.field || incoming.fieldKey || '玩家證據', action: '略過重複' });
      continue;
    }
    let record;
    try {
      record = createEvidenceRecord({
        ...incoming,
        id,
        reviewStatus: '待審核',
        reviewNotes: text(incoming.reviewNotes, 1000),
        reviewedAt: '',
        sourceId: incoming.sourceId || null
      });
    } catch (error) {
      errors.push(`evidence[${index}]：${error.message}`);
      continue;
    }
    if (incoming.reviewStatus && incoming.reviewStatus !== '待審核') warnings.push(`證據 ${id} 的審核狀態已重設為待審核`);
    candidate.evidence.push(record);
    existingEvidenceIds.add(id);
    previewRows.push({ line: index + 1, collection: 'evidence', id, name: record.field, action: '新增待審核' });
  }

  const validation = validateDatabase(candidate, { allowTestData: true });
  errors.push(...validation.errors);
  warnings.push(...validation.warnings);
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    database: candidate,
    favorites: [],
    migrated: false,
    format: '玩家回報 JSON',
    previewRows,
    changes: summarizeImportChanges(currentDatabase, candidate)
  };
}

export function parseImportPayload(raw, currentDatabase) {
  if (raw?.format === 'StarDexEvidenceBundle') return parseEvidenceBundle(raw, currentDatabase);
  let candidate;
  let favorites = [];
  let migrated = false;
  let migratedFromSchema = null;
  if (raw?.format === 'StarDexBackup' && raw.version === 1) {
    const result = migrateLegacyPayload(currentDatabase, raw);
    candidate = result.database;
    favorites = result.favorites;
    migrated = true;
    migratedFromSchema = 1;
  } else if (raw?.format === 'StarDexBackup' && raw.schemaVersion === SCHEMA_VERSION) {
    candidate = raw.database;
    favorites = Array.isArray(raw.favorites) ? raw.favorites : [];
  } else if (raw?.format === 'StarDexBackup' && raw.schemaVersion === 3) {
    candidate = migrateV3Database(raw.database);
    favorites = Array.isArray(raw.favorites) ? raw.favorites : [];
    migrated = true;
    migratedFromSchema = 3;
  } else if (raw?.format === 'StarDexBackup' && raw.schemaVersion === 2) {
    candidate = migrateV2Database(raw.database);
    favorites = Array.isArray(raw.favorites) ? raw.favorites : [];
    migrated = true;
    migratedFromSchema = 2;
  } else if (raw?.schemaVersion === SCHEMA_VERSION) {
    candidate = raw;
    favorites = Array.isArray(raw.favorites) ? raw.favorites : [];
  } else if (raw?.schemaVersion === 3) {
    candidate = migrateV3Database(raw);
    favorites = Array.isArray(raw.favorites) ? raw.favorites : [];
    migrated = true;
    migratedFromSchema = 3;
  } else if (raw?.schemaVersion === 2) {
    candidate = migrateV2Database(raw);
    favorites = Array.isArray(raw.favorites) ? raw.favorites : [];
    migrated = true;
    migratedFromSchema = 2;
  } else {
    return {
      valid: false,
      errors: [`無法辨識的備份格式或 schema version；目前只接受 v1、schema v2／v3 舊資料與 schema v${SCHEMA_VERSION}`],
      warnings: []
    };
  }
  const validation = validateDatabase(candidate);
  return {
    ...validation,
    database: candidate,
    favorites,
    migrated,
    migratedFromSchema,
    format: 'JSON',
    changes: candidate ? summarizeImportChanges(currentDatabase, candidate) : null
  };
}

export function summarizeImportChanges(currentDatabase, candidate) {
  const collections = {};
  const totals = { added: 0, updated: 0, unchanged: 0, protected: 0 };
  for (const collection of COLLECTIONS) {
    const currentById = new Map((currentDatabase?.[collection] || []).map((record) => [record.id, record]));
    const summary = { added: 0, updated: 0, unchanged: 0, protected: 0 };
    for (const incoming of candidate?.[collection] || []) {
      const current = currentById.get(incoming.id);
      if (!current) summary.added += 1;
      else if (JSON.stringify(current) === JSON.stringify(incoming)) summary.unchanged += 1;
      else if (current.userCreated === false) summary.protected += 1;
      else summary.updated += 1;
    }
    collections[collection] = summary;
    for (const key of Object.keys(totals)) totals[key] += summary[key];
  }
  return { collections, totals };
}

export function mergeImportedData(currentDatabase, importedDatabase, currentFavorites = [], importedFavorites = []) {
  const result = clone(currentDatabase);
  const warnings = [];
  for (const collection of COLLECTIONS) {
    const byId = new Map(result[collection].map((record) => [record.id, record]));
    for (const incoming of importedDatabase[collection]) {
      const current = byId.get(incoming.id);
      if (current?.userCreated === false) {
        let restored = 0;
        if (CATALOG_COLLECTIONS.includes(collection)) {
          const acceptedIds = new Set((importedDatabase.evidence || []).filter((record) => record.reviewStatus === '已採用' && record.targetRef === recordRef(collection, incoming.id)).map((record) => record.id));
          const next = clone(current);
          for (const [fieldKey, verification] of Object.entries(incoming.fieldVerifications || {})) {
            if (!(verification.evidenceIds || []).some((id) => acceptedIds.has(id))) continue;
            next[fieldBase(fieldKey)] = clone(incoming[fieldBase(fieldKey)]);
            next.fieldVerifications = { ...(next.fieldVerifications || {}), [fieldKey]: clone(verification) };
            restored += 1;
          }
          if (restored) byId.set(incoming.id, next);
        }
        if (!restored && JSON.stringify(current) !== JSON.stringify(incoming)) warnings.push(`略過 ${collection}/${incoming.id}：匯入資料不可覆寫內建條目`);
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
    createdAt: values.createdAt || new Date().toISOString(),
    fieldVerifications: values.fieldVerifications || {}
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

export function createEvidenceRecord(values) {
  const rawUrl = text(values.evidenceUrl, 2000);
  const evidenceUrl = rawUrl ? safeUrl(rawUrl) : '';
  if (rawUrl && !evidenceUrl) throw new Error('證據網址只接受 http 或 https');
  const screenshotDataUrl = String(values.screenshotDataUrl || '');
  if (screenshotDataUrl.length > 2000000) throw new Error('截圖檔案過大，請壓縮至約 1.5 MB 以下');
  const requestedField = text(values.fieldKey || values.field, 120);
  const normalizedField = Object.values(FIELD_DEFINITIONS).flatMap((fields) => Object.entries(fields)).find(([key, label]) => key.toLocaleLowerCase('zh-Hant') === requestedField.toLocaleLowerCase('zh-Hant') || label.toLocaleLowerCase('zh-Hant') === requestedField.toLocaleLowerCase('zh-Hant'))?.[0] || requestedField;
  return {
    id: safeId(values.id || `evidence-${Date.now().toString(36)}-${hash(Math.random())}`, 'evidence'),
    targetRef: text(values.targetRef, 260),
    fieldKey: normalizedField,
    field: text(values.field, 120) || requestedField,
    claimValue: text(values.claimValue, 5000),
    evidenceType: text(values.evidenceType, 40) || '玩家填寫',
    evidenceUrl,
    screenshotDataUrl,
    reporterAlias: text(values.reporterAlias, 80),
    observedAt: safeDate(values.observedAt || Date.now()),
    submittedAt: safeDate(values.submittedAt || Date.now()),
    reviewStatus: text(values.reviewStatus, 20) || '待審核',
    reviewNotes: text(values.reviewNotes, 1000),
    reviewedAt: values.reviewedAt ? safeDate(values.reviewedAt) : '',
    sourceId: values.sourceId || null,
    userCreated: true
  };
}

function parseCsvRows(input) {
  const source = String(input || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (quoted) throw new Error('CSV 含有未結束的雙引號欄位');
  row.push(field.replace(/\r$/, ''));
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  return rows;
}

function csvList(value) {
  return text(value, 5000).split('|').map((entry) => entry.trim()).filter(Boolean);
}

function csvBoolean(value) {
  return ['1', 'true', 'yes', 'y', '是'].includes(String(value || '').trim().toLocaleLowerCase('zh-Hant'));
}

const CSV_ARRAY_FIELDS = [
  'elements', 'mapIds', 'dropItemIds', 'adjacentMapIds', 'monsterIds', 'npcIds',
  'advancementStages', 'weapons', 'skillIds', 'trainingGuideIds', 'prerequisiteSkillIds',
  'prerequisiteQuestIds', 'requiredItemIds', 'rewardItemIds', 'entryMapIds', 'requiredQuestIds',
  'jobIds', 'itemIds', 'sourceIds'
];

export function parseCsvImport(raw, currentDatabase) {
  const errors = [];
  const warnings = [];
  let rows;
  try {
    rows = parseCsvRows(raw);
  } catch (error) {
    return { valid: false, errors: [`CSV 解析失敗：${error.message}`], warnings, format: 'CSV' };
  }
  if (rows.length < 2) return { valid: false, errors: ['CSV 必須包含標題列及至少一筆資料'], warnings, format: 'CSV' };
  const headers = rows[0].map((value) => value.trim());
  if (!headers.includes('collection') || !headers.includes('id')) {
    return { valid: false, errors: ['CSV 標題列必須包含 collection 與 id'], warnings, format: 'CSV' };
  }
  const duplicateHeaders = headers.filter((header, index) => header && headers.indexOf(header) !== index);
  if (duplicateHeaders.length) errors.push(`CSV 標題重複：${[...new Set(duplicateHeaders)].join('、')}`);

  const candidate = clone(currentDatabase);
  const seen = new Set();
  const previewRows = [];
  const allowedHeaders = new Set([
    'collection', 'id', 'name', 'description', 'level', 'requiredLevel', 'recommendedLevel', 'maxLevel',
    'hp', 'mp', 'experience', 'elements', 'category', 'stats', 'acquisition', 'tradeInfo', 'region',
    'advancementStages', 'weapons', 'features', 'recommendedBuild', 'rewardsText', 'entryConditions',
    'respawnOrLimits', 'guideType', 'content', 'levelMax', 'jobId', 'verificationStatus', 'verifiedAt',
    'testData', 'sourceUrl', 'sourceName', ...CSV_ARRAY_FIELDS
  ]);
  for (const header of headers) if (header && !allowedHeaders.has(header)) warnings.push(`忽略未知 CSV 欄位「${header}」`);

  for (let offset = 1; offset < rows.length; offset += 1) {
    const line = offset + 1;
    const cells = rows[offset];
    const rowData = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
    const collection = text(rowData.collection, 40);
    const id = text(rowData.id, 120);
    if (!CATALOG_COLLECTIONS.includes(collection)) {
      errors.push(`CSV 第 ${line} 列：collection「${collection || '空白'}」不支援`);
      continue;
    }
    if (!/^[a-z0-9][a-z0-9._:-]{1,119}$/i.test(id)) {
      errors.push(`CSV 第 ${line} 列：id 必須是 2–120 字元的穩定 ID`);
      continue;
    }
    if (!text(rowData.name, 100)) {
      errors.push(`CSV 第 ${line} 列：name 不可空白`);
      continue;
    }
    const numericFields = ['level', 'requiredLevel', 'recommendedLevel', 'maxLevel', 'hp', 'mp', 'experience', 'levelMax'];
    const invalidNumber = numericFields.find((field) => rowData[field] !== undefined && String(rowData[field]).trim() !== '' && (!Number.isFinite(Number(rowData[field])) || Number(rowData[field]) < 0));
    if (invalidNumber) {
      errors.push(`CSV 第 ${line} 列：${invalidNumber} 必須是非負數或留空`);
      continue;
    }
    const booleanText = String(rowData.testData || '').trim().toLocaleLowerCase('zh-Hant');
    if (booleanText && !['0', '1', 'true', 'false', 'yes', 'no', 'y', 'n', '是', '否'].includes(booleanText)) {
      errors.push(`CSV 第 ${line} 列：testData 只接受 true／false、1／0、yes／no 或是／否`);
      continue;
    }
    const rowKey = `${collection}:${id}`;
    if (seen.has(rowKey)) {
      errors.push(`CSV 第 ${line} 列：檔案內重複 ID「${rowKey}」`);
      continue;
    }
    seen.add(rowKey);
    const current = candidate[collection].find((record) => record.id === id);
    if (current?.userCreated === false) {
      errors.push(`CSV 第 ${line} 列：不可覆寫內建條目「${rowKey}」`);
      continue;
    }

    const values = { ...rowData, id, name: rowData.name, description: rowData.description };
    values.level = rowData.level || rowData.requiredLevel || rowData.recommendedLevel || rowData.maxLevel || '';
    for (const field of CSV_ARRAY_FIELDS) values[field] = csvList(rowData[field]);
    values.testData = csvBoolean(rowData.testData);
    values.verificationStatus = values.testData ? '測試資料' : '待驗證';
    if (rowData.verificationStatus && !['待驗證', '測試資料'].includes(rowData.verificationStatus)) {
      warnings.push(`CSV 第 ${line} 列：玩家匯入資料不可自行標示「${rowData.verificationStatus}」，已改為待驗證`);
    }
    if (rowData.stats) {
      try {
        const stats = JSON.parse(rowData.stats);
        if (!stats || typeof stats !== 'object' || Array.isArray(stats)) throw new Error('必須是物件');
        values.stats = stats;
      } catch (error) {
        errors.push(`CSV 第 ${line} 列：stats 必須是 JSON 物件（${error.message}）`);
        continue;
      }
    } else values.stats = {};
    if (collection === 'guides') values.levelRange = { min: numberOrNull(values.level), max: numberOrNull(rowData.levelMax) };

    const rawSourceUrl = text(rowData.sourceUrl, 2000);
    if (rawSourceUrl) {
      const sourceUrl = safeUrl(rawSourceUrl);
      if (!sourceUrl) {
        errors.push(`CSV 第 ${line} 列：sourceUrl 只接受 http 或 https`);
        continue;
      }
      let source = candidate.sources.find((record) => record.url === sourceUrl);
      if (!source) {
        source = {
          id: `source-user-csv-${hash(sourceUrl)}`,
          name: text(rowData.sourceName, 160) || `CSV 玩家來源 ${new URL(sourceUrl).hostname}`,
          url: sourceUrl,
          version: '玩家回報',
          checkedAt: '',
          verificationStatus: '待驗證',
          notes: '由 CSV 匯入建立，尚待審核。',
          sourceType: '玩家證據',
          userCreated: true
        };
        candidate.sources.push(source);
      }
      values.sourceIds = [...new Set([...values.sourceIds, source.id])];
    }

    const record = createUserRecord(collection, values);
    const at = candidate[collection].findIndex((entry) => entry.id === id);
    if (at >= 0) candidate[collection][at] = record;
    else candidate[collection].push(record);
    previewRows.push({ line, collection, id, name: record.name, action: current ? '更新' : '新增' });
  }

  const validation = validateDatabase(candidate);
  errors.push(...validation.errors);
  warnings.push(...validation.warnings);
  return {
    valid: errors.length === 0,
    errors,
    warnings: [...new Set(warnings)],
    database: candidate,
    favorites: [],
    migrated: false,
    format: 'CSV',
    rowCount: rows.length - 1,
    previewRows,
    changes: summarizeImportChanges(currentDatabase, candidate)
  };
}

export function makeCsvTemplate() {
  const headers = ['collection', 'id', 'name', 'description', 'level', 'hp', 'mp', 'experience', 'category', 'stats', 'acquisition', 'tradeInfo', 'region', 'mapIds', 'dropItemIds', 'monsterIds', 'npcIds', 'adjacentMapIds', 'jobId', 'sourceIds', 'sourceUrl', 'sourceName', 'verificationStatus', 'verifiedAt', 'testData'];
  const rows = [
    { collection: 'monsters', id: 'monster-user-example', name: '範例怪物', description: '請填寫楓星實測說明', mapIds: 'map-user-example', dropItemIds: 'item-user-example', sourceUrl: 'https://example.com/evidence', sourceName: '遊戲內截圖', verificationStatus: '待驗證', testData: 'false' },
    { collection: 'maps', id: 'map-user-example', name: '範例地圖', description: '請填寫楓星實測說明', region: '待驗證區域', monsterIds: 'monster-user-example', verificationStatus: '待驗證', testData: 'false' },
    { collection: 'items', id: 'item-user-example', name: '範例裝備', description: '請填寫楓星實測說明', category: '裝備', stats: '{}', acquisition: '待驗證', tradeInfo: '待驗證', verificationStatus: '待驗證', testData: 'false' }
  ];
  const csvCell = (value) => {
    const raw = String(value ?? '');
    return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
  };
  return `\uFEFF${[headers, ...rows.map((row) => headers.map((header) => row[header] ?? ''))].map((row) => row.map(csvCell).join(',')).join('\n')}`;
}

function parseEvidenceClaim(record, fieldKey, claimValue) {
  const field = fieldBase(fieldKey);
  const current = record[field];
  if (['level', 'hp', 'mp', 'experience', 'requiredLevel', 'recommendedLevel', 'maxLevel'].includes(field)) {
    if (String(claimValue).trim() === '') return null;
    const value = Number(claimValue);
    if (!Number.isFinite(value) || value < 0) throw new Error('數值欄位必須是非負數');
    return value;
  }
  if (Array.isArray(current)) {
    const member = text(claimValue, 120);
    if (!member) throw new Error('關聯或清單欄位不可空白');
    return [...new Set([...current, member])];
  }
  if (current && typeof current === 'object') {
    let value;
    try { value = JSON.parse(claimValue); } catch { throw new Error('物件欄位請提供有效 JSON'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('物件欄位必須是 JSON 物件');
    return { ...current, ...value };
  }
  return text(claimValue, 5000);
}

export function reviewEvidence(database, evidenceId, reviewStatus, reviewNotes = '') {
  const result = clone(database);
  const evidence = result.evidence.find((record) => record.id === evidenceId);
  if (!evidence) throw new Error('找不到證據');
  if (!['已採用', '已拒絕'].includes(reviewStatus)) throw new Error('不支援的審核狀態');
  const parsed = parseRecordRef(evidence.targetRef);
  const target = parsed ? result[parsed.collection].find((record) => record.id === parsed.id) : null;
  if (!target) throw new Error('證據目標不存在');
  evidence.reviewStatus = reviewStatus;
  evidence.reviewNotes = text(reviewNotes, 1000);
  evidence.reviewedAt = new Date().toISOString();
  if (reviewStatus === '已採用') {
    const base = fieldBase(evidence.fieldKey);
    const value = parseEvidenceClaim(target, evidence.fieldKey, evidence.claimValue);
    target[base] = value;
    const member = Array.isArray(value) ? text(evidence.claimValue, 120) : '';
    const key = member ? `${base}:${member}` : base;
    const previous = target.fieldVerifications?.[key] || {};
    target.fieldVerifications = { ...(target.fieldVerifications || {}), [key]: verificationEntry('玩家證據已驗證', evidence.sourceId ? [evidence.sourceId] : previous.sourceIds, evidence.reviewedAt.slice(0, 10), evidence.reviewNotes, [...(previous.evidenceIds || []), evidence.id]) };
    if (target.userCreated) target.verificationStatus = '玩家證據已驗證';
  }
  const validation = validateDatabase(result, { allowTestData: true });
  if (!validation.valid) throw new Error(`採用後資料無效：${validation.errors[0]}`);
  return result;
}

function meaningful(value) {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return !['待驗證', '未知', '未分類'].includes(String(value).trim());
}

function fieldState(record, field) {
  const entries = Object.entries(record.fieldVerifications || {}).filter(([key]) => fieldBase(key) === field);
  const isVerified = (value) => ['官方已確認', '玩家證據已驗證'].includes(value?.status);
  const hasTrace = (value) => (value?.sourceIds?.length || 0) + (value?.evidenceIds?.length || 0) > 0;
  const base = record.fieldVerifications?.[field];
  let verified = isVerified(base);
  let sourced = hasTrace(base);
  if (Array.isArray(record[field]) && record[field].length) {
    const memberEntries = record[field].map((id) => record.fieldVerifications?.[`${field}:${id}`]);
    verified ||= memberEntries.every(isVerified);
    sourced ||= memberEntries.every(hasTrace);
  } else if (!Array.isArray(record[field])) {
    verified ||= entries.some(([, value]) => isVerified(value));
    sourced ||= entries.some(([, value]) => hasTrace(value));
  }
  return { filled: meaningful(record[field]), verified, sourced };
}

export function databaseStats(database) {
  const statuses = Object.fromEntries(['官方已確認', '玩家證據已驗證', '待驗證', '測試資料'].map((status) => [status, 0]));
  const collections = {};
  let total = 0;
  for (const collection of CATALOG_COLLECTIONS) {
    const collectionStatuses = Object.fromEntries(Object.keys(statuses).map((status) => [status, 0]));
    for (const record of database[collection] || []) {
      const status = record.testData ? '測試資料' : record.verificationStatus || '待驗證';
      if (collectionStatuses[status] !== undefined) collectionStatuses[status] += 1;
      if (statuses[status] !== undefined) statuses[status] += 1;
      total += 1;
    }
    const critical = { total: 0, filled: 0, verified: 0, missing: 0, missingSource: 0 };
    for (const record of (database[collection] || []).filter((entry) => !entry.testData)) {
      for (const field of CRITICAL_FIELDS[collection] || []) {
        const state = fieldState(record, field);
        critical.total += 1;
        if (state.filled) critical.filled += 1; else critical.missing += 1;
        if (state.filled && state.verified) critical.verified += 1;
        if (state.filled && !state.sourced) critical.missingSource += 1;
      }
    }
    critical.completenessRatio = critical.total ? Math.round(critical.filled / critical.total * 1000) / 10 : 0;
    critical.verifiedRatio = critical.total ? Math.round(critical.verified / critical.total * 1000) / 10 : 0;
    collections[collection] = { total: database[collection]?.length || 0, statuses: collectionStatuses, critical };
  }
  const verified = statuses['官方已確認'] + statuses['玩家證據已驗證'];
  const formalTotal = total - statuses['測試資料'];
  const evidence = { total: 0, pending: 0, accepted: 0, rejected: 0 };
  for (const record of database.evidence || []) {
    evidence.total += 1;
    if (record.reviewStatus === '待審核') evidence.pending += 1;
    if (record.reviewStatus === '已採用') evidence.accepted += 1;
    if (record.reviewStatus === '已拒絕') evidence.rejected += 1;
  }
  const levelCoverage = Array.from({ length: 6 }, (_, index) => {
    const min = index * 10 + 1;
    const max = min + 9;
    const rows = (database.monsters || []).filter((record) => record.level >= min && record.level <= max && !record.testData);
    return { min, max, total: rows.length, verified: rows.filter((record) => fieldState(record, 'level').verified).length };
  });
  const dropRelations = (database.monsters || []).flatMap((record) => (record.dropItemIds || []).map((id) => ({ record, id })));
  const verifiedDropRelations = dropRelations.filter(({ record, id }) => fieldState(record, `dropItemIds:${id}`).verified || record.fieldVerifications?.[`dropItemIds:${id}`]?.status === '官方已確認').length;
  const priorities = CATALOG_COLLECTIONS.flatMap((collection) => (database[collection] || []).filter((record) => !record.testData).map((record) => ({ collection, id: record.id, name: record.name, missing: (CRITICAL_FIELDS[collection] || []).filter((field) => !fieldState(record, field).verified).length }))).filter((row) => row.missing).sort((a, b) => b.missing - a.missing || a.name.localeCompare(b.name, 'zh-Hant')).slice(0, 12);
  return {
    total,
    formalTotal,
    verified,
    verificationRatio: formalTotal ? Math.round((verified / formalTotal) * 1000) / 10 : 0,
    statuses,
    collections,
    evidence,
    levelCoverage,
    drops: { totalRelations: dropRelations.length, verifiedRelations: verifiedDropRelations, monstersWithDrops: (database.monsters || []).filter((record) => record.dropItemIds?.length).length },
    priorities,
    latestUpdatedAt: database.meta?.updatedAt || '',
    rawCounts: Object.fromEntries(COLLECTIONS.map((collection) => [collection, database[collection]?.length || 0]))
  };
}

export { createEmptyDatabase };
