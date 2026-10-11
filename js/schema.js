export const SCHEMA_VERSION = 4;

export const COLLECTIONS = [
  'monsters',
  'items',
  'maps',
  'npcs',
  'jobs',
  'skills',
  'quests',
  'bosses',
  'guides',
  'prices',
  'evidence',
  'sources'
];

export const CATALOG_COLLECTIONS = [
  'monsters',
  'items',
  'maps',
  'npcs',
  'jobs',
  'skills',
  'quests',
  'bosses',
  'guides'
];

export const TYPE_META = {
  monsters: { label: '怪物圖鑑', short: '怪物', icon: '🐾', singular: '怪物' },
  items: { label: '裝備・道具', short: '道具', icon: '⚔️', singular: '物品' },
  maps: { label: '地圖圖鑑', short: '地圖', icon: '🗺️', singular: '地圖' },
  npcs: { label: 'NPC 索引', short: 'NPC', icon: '🧑‍🌾', singular: 'NPC' },
  jobs: { label: '職業圖鑑', short: '職業', icon: '🛡️', singular: '職業' },
  skills: { label: '技能圖鑑', short: '技能', icon: '✨', singular: '技能' },
  quests: { label: '任務查詢', short: '任務', icon: '📜', singular: '任務' },
  bosses: { label: 'BOSS 資料', short: 'BOSS', icon: '👑', singular: 'BOSS' },
  guides: { label: '練等・攻略', short: '攻略', icon: '🧭', singular: '攻略' },
  prices: { label: '楓幣行情', short: '價格', icon: '💰', singular: '價格' },
  evidence: { label: '玩家證據', short: '證據', icon: '📷', singular: '證據' },
  sources: { label: '資料來源', short: '來源', icon: '🔗', singular: '來源' }
};

export const VERIFICATION_STATUSES = ['官方已確認', '玩家證據已驗證', '待驗證', '測試資料'];
export const SOURCE_TYPES = ['楓星官方', '玩家證據', '其他公開資訊'];
export const EVIDENCE_TYPES = ['遊戲內截圖', '玩家填寫', '其他公開資料'];
export const EVIDENCE_STATUSES = ['待審核', '已採用', '已拒絕'];

export const FIELD_DEFINITIONS = {
  monsters: { name: '名稱', level: '等級', hp: 'HP', mp: 'MP', experience: '經驗值', elements: '屬性', mapIds: '出沒地圖', dropItemIds: '掉落物', description: '說明' },
  items: { name: '名稱', category: '分類', requiredLevel: '需求等級', stats: '能力值', acquisition: '取得方式', tradeInfo: '交易資訊', description: '說明' },
  maps: { name: '名稱', region: '區域', recommendedLevel: '建議等級', adjacentMapIds: '相鄰地圖', monsterIds: '怪物', npcIds: 'NPC', description: '說明' },
  npcs: { name: '名稱', mapIds: '所在地圖', description: '說明' },
  jobs: { name: '名稱', advancementStages: '轉職階段', weapons: '武器', features: '特色', skillIds: '技能', trainingGuideIds: '練功攻略' },
  skills: { name: '名稱', jobId: '所屬職業', description: '技能效果', maxLevel: '技能等級', prerequisiteSkillIds: '前置技能', recommendedBuild: '推薦配點' },
  quests: { name: '名稱', requiredLevel: '等級要求', npcIds: 'NPC', prerequisiteQuestIds: '前置任務', requiredItemIds: '需求道具', rewardItemIds: '獎勵道具', rewardsText: '獎勵說明', description: '流程／條件' },
  bosses: { name: '名稱', level: '等級', entryConditions: '進入條件', entryMapIds: '進入地圖', requiredQuestIds: '前置任務', dropItemIds: '掉落物', respawnOrLimits: '重生／限制', description: '說明' },
  guides: { name: '名稱', guideType: '攻略類型', levelRange: '等級範圍', jobIds: '職業', mapIds: '地圖', itemIds: '物品', content: '內容' }
};

export const CRITICAL_FIELDS = {
  monsters: ['name', 'level', 'mapIds', 'dropItemIds'],
  items: ['name', 'category', 'requiredLevel', 'acquisition'],
  maps: ['name', 'region', 'monsterIds', 'npcIds', 'adjacentMapIds'],
  npcs: ['name', 'mapIds'],
  jobs: ['name', 'advancementStages', 'weapons', 'skillIds'],
  skills: ['name', 'jobId', 'description', 'maxLevel', 'prerequisiteSkillIds'],
  quests: ['name', 'requiredLevel', 'npcIds', 'description', 'rewardItemIds'],
  bosses: ['name', 'level', 'entryConditions', 'entryMapIds', 'dropItemIds', 'respawnOrLimits'],
  guides: ['name', 'guideType', 'content']
};

export function fieldBase(fieldKey) {
  return String(fieldKey || '').split(':')[0];
}

export function fieldLabel(collection, fieldKey) {
  return FIELD_DEFINITIONS[collection]?.[fieldBase(fieldKey)] || fieldKey || '其他／待分類';
}

export const REFERENCE_RULES = {
  monsters: {
    mapIds: { collection: 'maps', many: true },
    dropItemIds: { collection: 'items', many: true },
    sourceIds: { collection: 'sources', many: true }
  },
  items: {
    sourceIds: { collection: 'sources', many: true }
  },
  maps: {
    adjacentMapIds: { collection: 'maps', many: true },
    monsterIds: { collection: 'monsters', many: true },
    npcIds: { collection: 'npcs', many: true },
    sourceIds: { collection: 'sources', many: true }
  },
  npcs: {
    mapIds: { collection: 'maps', many: true },
    sourceIds: { collection: 'sources', many: true }
  },
  jobs: {
    skillIds: { collection: 'skills', many: true },
    trainingGuideIds: { collection: 'guides', many: true },
    sourceIds: { collection: 'sources', many: true }
  },
  skills: {
    jobId: { collection: 'jobs', many: false, optional: true },
    prerequisiteSkillIds: { collection: 'skills', many: true },
    sourceIds: { collection: 'sources', many: true }
  },
  quests: {
    npcIds: { collection: 'npcs', many: true },
    prerequisiteQuestIds: { collection: 'quests', many: true },
    requiredItemIds: { collection: 'items', many: true },
    rewardItemIds: { collection: 'items', many: true },
    sourceIds: { collection: 'sources', many: true }
  },
  bosses: {
    entryMapIds: { collection: 'maps', many: true },
    requiredQuestIds: { collection: 'quests', many: true },
    dropItemIds: { collection: 'items', many: true },
    sourceIds: { collection: 'sources', many: true }
  },
  guides: {
    jobIds: { collection: 'jobs', many: true },
    mapIds: { collection: 'maps', many: true },
    itemIds: { collection: 'items', many: true },
    sourceIds: { collection: 'sources', many: true }
  },
  prices: {
    itemId: { collection: 'items', many: false },
    sourceId: { collection: 'sources', many: false, optional: true }
  },
  evidence: {
    sourceId: { collection: 'sources', many: false, optional: true }
  },
  sources: {}
};

const ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{1,119}$/i;

export function createEmptyDatabase() {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      product: 'MapleStar',
      locale: 'zh-Hant',
      datasetVersion: 'user',
      updatedAt: new Date().toISOString(),
      notice: '僅限楓星 MapleStar 資料。'
    },
    ...Object.fromEntries(COLLECTIONS.map((name) => [name, []]))
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function pushError(errors, path, message) {
  errors.push(`${path}：${message}`);
}

function isNullableNumber(value) {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

function validateStringArray(value, path, errors) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    pushError(errors, path, '必須是字串陣列');
  }
}

function validateRecordShape(collection, record, path, errors) {
  const nullableNumberFields = {
    monsters: ['level', 'hp', 'mp', 'experience'],
    items: ['requiredLevel'],
    maps: ['recommendedLevel'],
    skills: ['maxLevel'],
    quests: ['requiredLevel'],
    bosses: ['level']
  }[collection] || [];
  for (const field of nullableNumberFields) {
    if (!isNullableNumber(record[field])) pushError(errors, `${path}.${field}`, '必須是非負數或 null');
  }

  const stringFields = {
    monsters: ['description'],
    items: ['category', 'acquisition', 'tradeInfo', 'description'],
    maps: ['region', 'description'],
    npcs: ['description'],
    jobs: ['features'],
    skills: ['description', 'recommendedBuild'],
    quests: ['description', 'rewardsText'],
    bosses: ['description', 'entryConditions', 'respawnOrLimits'],
    guides: ['guideType', 'content'],
    prices: ['server', 'recordedAt', 'dataSource', 'notes'],
    evidence: ['targetRef', 'fieldKey', 'field', 'claimValue', 'evidenceType', 'evidenceUrl', 'screenshotDataUrl', 'reporterAlias', 'observedAt', 'submittedAt', 'reviewStatus', 'reviewNotes', 'reviewedAt'],
    sources: ['name', 'url', 'version', 'checkedAt', 'verificationStatus', 'notes', 'sourceType']
  }[collection] || [];
  for (const field of stringFields) {
    if (typeof record[field] !== 'string') pushError(errors, `${path}.${field}`, '必須是字串');
  }

  const stringArrayFields = {
    monsters: ['elements'],
    jobs: ['advancementStages', 'weapons']
  }[collection] || [];
  for (const field of stringArrayFields) validateStringArray(record[field], `${path}.${field}`, errors);

  if (collection === 'items' && !isPlainObject(record.stats)) pushError(errors, `${path}.stats`, '必須是物件');
  if (collection === 'guides') {
    if (!isPlainObject(record.levelRange)) {
      pushError(errors, `${path}.levelRange`, '必須是物件');
    } else {
      if (!isNullableNumber(record.levelRange.min)) pushError(errors, `${path}.levelRange.min`, '必須是非負數或 null');
      if (!isNullableNumber(record.levelRange.max)) pushError(errors, `${path}.levelRange.max`, '必須是非負數或 null');
    }
  }
  if (['prices', 'sources', 'evidence'].includes(collection) && typeof record.userCreated !== 'boolean') pushError(errors, `${path}.userCreated`, '必須是布林值');
  if (!['prices', 'sources', 'evidence'].includes(collection)) {
    if (typeof record.testData !== 'boolean') pushError(errors, `${path}.testData`, '必須是布林值');
    if (typeof record.userCreated !== 'boolean') pushError(errors, `${path}.userCreated`, '必須是布林值');
    if (record.fieldVerifications === undefined) {
      // schema v3 內建條目可在 v4 漸進補上欄位級狀態；缺少時視為尚未驗證。
    } else if (!isPlainObject(record.fieldVerifications)) {
      pushError(errors, `${path}.fieldVerifications`, '必須是物件');
    } else {
      for (const [fieldKey, verification] of Object.entries(record.fieldVerifications)) {
        const base = fieldBase(fieldKey);
        if (!FIELD_DEFINITIONS[collection]?.[base]) pushError(errors, `${path}.fieldVerifications.${fieldKey}`, '不是此分類可驗證的欄位');
        if (!isPlainObject(verification)) {
          pushError(errors, `${path}.fieldVerifications.${fieldKey}`, '必須是物件');
          continue;
        }
        if (!VERIFICATION_STATUSES.includes(verification.status)) pushError(errors, `${path}.fieldVerifications.${fieldKey}.status`, '驗證狀態無效');
        validateStringArray(verification.sourceIds, `${path}.fieldVerifications.${fieldKey}.sourceIds`, errors);
        validateStringArray(verification.evidenceIds, `${path}.fieldVerifications.${fieldKey}.evidenceIds`, errors);
        if (typeof verification.verifiedAt !== 'string') pushError(errors, `${path}.fieldVerifications.${fieldKey}.verifiedAt`, '必須是字串');
        if (typeof verification.notes !== 'string') pushError(errors, `${path}.fieldVerifications.${fieldKey}.notes`, '必須是字串');
      }
    }
  }
}

function validateBasicRecord(collection, record, index, errors) {
  const path = `${collection}[${index}]`;
  if (!isPlainObject(record)) {
    pushError(errors, path, '必須是物件');
    return;
  }
  if (!hasText(record.id) || !ID_PATTERN.test(record.id)) {
    pushError(errors, `${path}.id`, '必須是 2–120 字元的穩定 ID，只能使用英數、點、底線、冒號或連字號');
  }
  if (collection === 'prices') {
    if (!hasText(record.itemId)) pushError(errors, `${path}.itemId`, '價格紀錄必須指定物品 ID');
    if (!hasText(record.server)) pushError(errors, `${path}.server`, '價格紀錄必須指定伺服器');
    if (!Number.isSafeInteger(Number(record.price)) || Number(record.price) <= 0) {
      pushError(errors, `${path}.price`, '必須是大於 0 的安全整數');
    }
    if (!hasText(record.recordedAt) || Number.isNaN(Date.parse(record.recordedAt))) {
      pushError(errors, `${path}.recordedAt`, '必須是有效日期時間');
    }
  } else if (collection === 'sources') {
    if (!hasText(record.name)) pushError(errors, `${path}.name`, '來源名稱不可空白');
    if (!hasText(record.url)) pushError(errors, `${path}.url`, '來源 URL 不可空白');
    try {
      const url = new URL(record.url);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol');
    } catch {
      pushError(errors, `${path}.url`, '只接受 http 或 https 網址');
    }
    if (!SOURCE_TYPES.includes(record.sourceType)) {
      pushError(errors, `${path}.sourceType`, `只接受 ${SOURCE_TYPES.join('、')}`);
    }
  } else if (collection === 'evidence') {
    if (!hasText(record.targetRef)) pushError(errors, `${path}.targetRef`, '必須指定圖鑑條目');
    if (!hasText(record.fieldKey)) pushError(errors, `${path}.fieldKey`, '必須指定查證欄位鍵');
    if (!hasText(record.field)) pushError(errors, `${path}.field`, '必須指定查證欄位');
    if (!hasText(record.claimValue)) pushError(errors, `${path}.claimValue`, '主張內容不可空白');
    if (!hasText(record.reporterAlias)) pushError(errors, `${path}.reporterAlias`, '回報者代稱不可空白');
    if (!EVIDENCE_TYPES.includes(record.evidenceType)) pushError(errors, `${path}.evidenceType`, `只接受 ${EVIDENCE_TYPES.join('、')}`);
    if (!EVIDENCE_STATUSES.includes(record.reviewStatus)) pushError(errors, `${path}.reviewStatus`, `只接受 ${EVIDENCE_STATUSES.join('、')}`);
    if (record.evidenceUrl) {
      try {
        const url = new URL(record.evidenceUrl);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol');
      } catch {
        pushError(errors, `${path}.evidenceUrl`, '只接受 http、https 或空白');
      }
    }
    if (record.screenshotDataUrl && !/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(record.screenshotDataUrl)) {
      pushError(errors, `${path}.screenshotDataUrl`, '只接受 PNG、JPEG、WebP 圖片資料');
    }
    if (record.screenshotDataUrl?.length > 2000000) pushError(errors, `${path}.screenshotDataUrl`, '圖片不得超過 2,000,000 字元');
    for (const field of ['observedAt', 'submittedAt']) {
      if (!hasText(record[field]) || Number.isNaN(Date.parse(record[field]))) pushError(errors, `${path}.${field}`, '必須是有效日期');
    }
    if (record.reviewedAt && Number.isNaN(Date.parse(record.reviewedAt))) pushError(errors, `${path}.reviewedAt`, '必須是有效日期或空白');
  } else if (!hasText(record.name)) {
    pushError(errors, `${path}.name`, '名稱不可空白');
  }
  validateRecordShape(collection, record, path, errors);
  if (!['prices', 'evidence'].includes(collection) && record.verificationStatus !== undefined && !VERIFICATION_STATUSES.includes(record.verificationStatus)) {
    pushError(errors, `${path}.verificationStatus`, `只接受 ${VERIFICATION_STATUSES.join('、')}`);
  }
}

export function validateDatabase(database, options = {}) {
  const errors = [];
  const warnings = [];
  if (!isPlainObject(database)) {
    return { valid: false, errors: ['根節點：必須是 JSON 物件'], warnings };
  }
  if (database.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`schemaVersion：需要版本 ${SCHEMA_VERSION}，收到 ${String(database.schemaVersion ?? '未提供')}`);
  }
  if (!isPlainObject(database.meta)) errors.push('meta：必須是物件');

  const ids = {};
  const globalIds = new Map();
  for (const collection of COLLECTIONS) {
    const records = database[collection];
    if (!Array.isArray(records)) {
      errors.push(`${collection}：必須是陣列`);
      ids[collection] = new Set();
      continue;
    }
    ids[collection] = new Set();
    records.forEach((record, index) => {
      validateBasicRecord(collection, record, index, errors);
      if (!record || typeof record.id !== 'string') return;
      if (ids[collection].has(record.id)) errors.push(`${collection}：發現重複 ID「${record.id}」`);
      ids[collection].add(record.id);
      if (globalIds.has(record.id)) {
        warnings.push(`ID「${record.id}」同時存在於 ${globalIds.get(record.id)} 與 ${collection}；建議使用類型前綴`);
      } else {
        globalIds.set(record.id, collection);
      }
      if (record.testData === true && record.verificationStatus !== '測試資料') {
        errors.push(`${collection}.${record.id}：testData 為 true 時 verificationStatus 必須是「測試資料」`);
      }
      if (record.verificationStatus === '測試資料' && record.testData !== true) {
        errors.push(`${collection}.${record.id}：「測試資料」必須明確設定 testData: true`);
      }
    });
  }

  for (const [collection, fields] of Object.entries(REFERENCE_RULES)) {
    const records = Array.isArray(database[collection]) ? database[collection] : [];
    records.forEach((record, index) => {
      if (!isPlainObject(record)) return;
      for (const [field, rule] of Object.entries(fields)) {
        const value = record[field];
        const path = `${collection}[${index}].${field}`;
        if (rule.many) {
          if (!Array.isArray(value)) {
            pushError(errors, path, '必須是 ID 陣列');
            continue;
          }
          const seen = new Set();
          for (const targetId of value) {
            if (!hasText(targetId)) {
              pushError(errors, path, '包含空白或非字串 ID');
              continue;
            }
            if (seen.has(targetId)) pushError(errors, path, `包含重複關聯「${targetId}」`);
            seen.add(targetId);
            if (!ids[rule.collection]?.has(targetId)) {
              pushError(errors, path, `找不到 ${rule.collection} 的「${targetId}」`);
            }
          }
        } else {
          if ((value === null || value === undefined || value === '') && rule.optional) continue;
          if (!hasText(value)) {
            pushError(errors, path, '必須是有效 ID');
          } else if (!ids[rule.collection]?.has(value)) {
            pushError(errors, path, `找不到 ${rule.collection} 的「${value}」`);
          }
        }
      }
    });
  }

  for (const [index, record] of (database.evidence || []).entries()) {
    if (!isPlainObject(record)) continue;
    const separator = String(record.targetRef || '').indexOf(':');
    const collection = separator > 0 ? record.targetRef.slice(0, separator) : '';
    const id = separator > 0 ? record.targetRef.slice(separator + 1) : '';
    if (!CATALOG_COLLECTIONS.includes(collection) || !ids[collection]?.has(id)) {
      pushError(errors, `evidence[${index}].targetRef`, `找不到圖鑑條目「${record.targetRef || ''}」`);
    } else if (!FIELD_DEFINITIONS[collection]?.[fieldBase(record.fieldKey)]) {
      pushError(errors, `evidence[${index}].fieldKey`, `「${record.fieldKey || ''}」不是 ${collection} 可回報的欄位`);
    }
  }

  for (const collection of CATALOG_COLLECTIONS) {
    for (const [index, record] of (database[collection] || []).entries()) {
      for (const [fieldKey, verification] of Object.entries(record?.fieldVerifications || {})) {
        for (const sourceId of verification?.sourceIds || []) {
          if (!ids.sources?.has(sourceId)) pushError(errors, `${collection}[${index}].fieldVerifications.${fieldKey}.sourceIds`, `找不到 sources 的「${sourceId}」`);
        }
        for (const evidenceId of verification?.evidenceIds || []) {
          if (!ids.evidence?.has(evidenceId)) pushError(errors, `${collection}[${index}].fieldVerifications.${fieldKey}.evidenceIds`, `找不到 evidence 的「${evidenceId}」`);
        }
        const member = String(fieldKey).includes(':') ? String(fieldKey).slice(String(fieldKey).indexOf(':') + 1) : '';
        const base = fieldBase(fieldKey);
        if (member && Array.isArray(record?.[base]) && !record[base].includes(member)) pushError(errors, `${collection}[${index}].fieldVerifications.${fieldKey}`, `關聯成員「${member}」不存在於 ${base}`);
      }
    }
  }

  const acceptedEvidenceTargets = new Set((database.evidence || []).filter((record) => record?.reviewStatus === '已採用').map((record) => record.targetRef));
  for (const collection of CATALOG_COLLECTIONS) {
    for (const record of database[collection] || []) {
      if (record?.userCreated === true && record.verificationStatus === '官方已確認') {
        pushError(errors, `${collection}.${record.id}.verificationStatus`, '玩家自建資料不可標示為「官方已確認」');
      }
      if (record?.userCreated === true && record.verificationStatus === '玩家證據已驗證' && !acceptedEvidenceTargets.has(recordRef(collection, record.id))) {
        pushError(errors, `${collection}.${record.id}.verificationStatus`, '必須先有至少一筆已採用的玩家證據');
      }
    }
  }

  for (const collection of CATALOG_COLLECTIONS) {
    const names = new Map();
    for (const record of database[collection] || []) {
      const key = String(record?.name || '').trim().toLocaleLowerCase('zh-Hant');
      if (!key) continue;
      if (names.has(key) && names.get(key) !== record.id) warnings.push(`${collection}：名稱「${record.name}」同時使用於 ${names.get(key)} 與 ${record.id}`);
      else names.set(key, record.id);
    }
  }

  const evidenceClaims = new Set();
  for (const record of database.evidence || []) {
    const key = [record?.targetRef, record?.fieldKey, String(record?.claimValue || '').trim().toLocaleLowerCase('zh-Hant'), String(record?.reporterAlias || '').trim().toLocaleLowerCase('zh-Hant')].join('\u0000');
    if (evidenceClaims.has(key)) warnings.push(`玩家證據：${record.targetRef}/${record.field} 有同一回報者的重複主張`);
    evidenceClaims.add(key);
  }

  if (database.meta?.product && database.meta.product !== 'MapleStar') {
    errors.push('meta.product：本專案只接受「MapleStar」資料');
  }
  if (!options.allowTestData) {
    const count = COLLECTIONS.reduce((sum, collection) => sum + (database[collection] || []).filter((record) => record?.testData).length, 0);
    if (count) warnings.push(`匯入內容含 ${count} 筆明確標示的測試資料，介面會與正式資料分開標示`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function recordRef(collection, id) {
  return `${collection}:${id}`;
}

export function parseRecordRef(value) {
  const separator = String(value || '').indexOf(':');
  if (separator < 1) return null;
  const collection = value.slice(0, separator);
  const id = value.slice(separator + 1);
  return CATALOG_COLLECTIONS.includes(collection) && id ? { collection, id } : null;
}
