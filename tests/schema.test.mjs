import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SCHEMA_VERSION,
  recordRef,
  validateDatabase
} from '../js/schema.js';
import {
  DATABASE_KEY,
  FAVORITES_KEY,
  LEGACY_KEYS,
  clone,
  createEvidenceRecord,
  databaseStats,
  loadAppData,
  makeBackup,
  makeCsvTemplate,
  mergeImportedData,
  migrateLegacyPayload,
  migrateV2Database,
  migrateV3Database,
  parseCsvImport,
  parseImportPayload,
  reviewEvidence
} from '../js/storage.js';

const seed = JSON.parse(fs.readFileSync(new URL('../data/maplestar.seed.json', import.meta.url), 'utf8'));

test('內建 schema v4 資料通過完整驗證', () => {
  const result = validateDatabase(seed, { allowTestData: true });
  assert.equal(result.valid, true, result.errors.join('\n'));
});

test('怪物、物品、地圖雙向查詢所需的穩定 ID 關聯存在', () => {
  const monster = seed.monsters.find((record) => record.id === 'monster-cloud-fox');
  const item = seed.items.find((record) => record.id === 'item-cloud-fox-tail');
  const map = seed.maps.find((record) => record.id === 'map-mushroom-shrine-vicinity');
  assert.ok(monster.dropItemIds.includes(item.id));
  assert.ok(monster.mapIds.includes(map.id));
  assert.ok(map.monsterIds.includes(monster.id));
  assert.ok(seed.monsters.filter((record) => record.dropItemIds.includes(item.id)).some((record) => record.id === monster.id));
});

test('新增地圖、NPC、職業、技能與攻略使用雙向穩定 ID 關聯', () => {
  const map = seed.maps.find((record) => record.id === 'map-spiegelmann-guesthouse');
  const npc = seed.npcs.find((record) => record.id === 'npc-brave-amis');
  const job = seed.jobs.find((record) => record.id === 'job-shadower');
  const skill = seed.skills.find((record) => record.id === 'skill-shadower-fatal-assassination');
  const hayato = seed.jobs.find((record) => record.id === 'job-hayato');
  const travelGuide = seed.guides.find((record) => record.id === 'guide-job-travel-skills');

  assert.ok(map.npcIds.includes(npc.id));
  assert.ok(npc.mapIds.includes(map.id));
  assert.ok(job.skillIds.includes(skill.id));
  assert.equal(skill.jobId, job.id);
  assert.ok(hayato.trainingGuideIds.includes(travelGuide.id));
  assert.ok(travelGuide.jobIds.includes(hayato.id));
});

test('官方查證條目保留公告精確數值並避免推算未知值', () => {
  const skill = seed.skills.find((record) => record.id === 'skill-shadower-fatal-assassination');
  const levelGuide = seed.guides.find((record) => record.id === 'guide-level-exp-10-20');
  const mysteryBook = seed.items.find((record) => record.id === 'item-mystery-skill-book');
  const chaosPinkBean = seed.bosses.find((record) => record.id === 'boss-chaos-pink-bean');

  assert.match(skill.description, /1000%.*900%/);
  assert.match(skill.description, /6 秒.*5 秒/);
  assert.match(levelGuide.content, /Lv\.10 1,350/);
  assert.match(levelGuide.content, /Lv\.20 13,140/);
  assert.match(mysteryBook.description, /不可.*推算.*絕對掉落率/);
  assert.equal(chaosPinkBean.level, null);
  assert.deepEqual(chaosPinkBean.dropItemIds, []);
});

test('本次引用的官方來源均已完成內文核對', () => {
  const sourceIds = [
    'source-update-2026-04-02',
    'source-update-2026-05-21',
    'source-update-2026-05-28',
    'source-update-2026-07-09',
    'source-boss-rewards-2026-07-23',
    'source-update-2026-07-30',
    'source-update-2026-08-13',
    'source-update-2026-09-28',
    'source-reset-schedule-2026-09-30',
    'source-update-2026-10-08',
    'source-maintenance-2026-10-08'
  ];

  for (const id of sourceIds) {
    const source = seed.sources.find((record) => record.id === id);
    assert.ok(source, `缺少來源 ${id}`);
    assert.equal(source.verificationStatus, '官方已確認');
    assert.equal(source.sourceType, '楓星官方');
    assert.match(source.url, /^https:\/\/(?:www\.)?tw\.maplestar\.io\//);
  }
});

test('驗證器拒絕重複 ID', () => {
  const database = clone(seed);
  database.items.push(clone(database.items[0]));
  const result = validateDatabase(database);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('重複 ID')));
});

test('驗證器拒絕不存在的外鍵', () => {
  const database = clone(seed);
  database.monsters[0].dropItemIds.push('item-does-not-exist');
  const result = validateDatabase(database);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('item-does-not-exist')));
});

test('驗證器拒絕錯誤欄位型別', () => {
  const database = clone(seed);
  database.monsters[0].hp = '未知';
  database.items[0].stats = [];
  const result = validateDatabase(database);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('.hp')));
  assert.ok(result.errors.some((error) => error.includes('.stats')));
});

test('驗證器拒絕未隔離的測試資料', () => {
  const database = clone(seed);
  database.items[0].testData = true;
  database.items[0].verificationStatus = '待驗證';
  const result = validateDatabase(database);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('testData')));
});

test('舊版自建條目、價格與收藏可遷移且不依賴中文名稱作為價格主鍵', () => {
  const legacy = {
    entries: [{ id: 'user-old-monster', kind: 'monster', title: '舊怪物', level: '10', region: '舊地圖', related: '舊掉落物', note: '舊版內容', source: 'https://example.com/source', date: '2026-10-01' }],
    prices: [{ id: 'price-old', item: '舊掉落物', price: 12345, world: '測試服', type: '實際成交', memo: '保留備註', ts: 1760000000000 }],
    favorites: ['user-old-monster']
  };
  const migrated = migrateLegacyPayload(seed, legacy);
  const monster = migrated.database.monsters.find((record) => record.id === 'user-old-monster');
  const price = migrated.database.prices.find((record) => record.id === 'price-old');
  assert.equal(monster.name, '舊怪物');
  assert.ok(price.itemId.startsWith('item-legacy-price-'));
  assert.equal(migrated.database.items.find((record) => record.id === price.itemId).name, '舊掉落物');
  assert.ok(migrated.favorites.includes(recordRef('monsters', monster.id)));
  assert.equal(validateDatabase(migrated.database, { allowTestData: true }).valid, true);
});

test('可辨識 v1 備份並遷移到 v4', () => {
  const result = parseImportPayload({ format: 'StarDexBackup', version: 1, entries: [], prices: [], favorites: [] }, seed);
  assert.equal(result.valid, true);
  assert.equal(result.migrated, true);
  assert.equal(result.database.schemaVersion, SCHEMA_VERSION);
});

test('匯入時不允許自建資料覆寫內建資料', () => {
  const incoming = clone(seed);
  incoming.monsters[0] = { ...incoming.monsters[0], name: '惡意覆寫', userCreated: true };
  const merged = mergeImportedData(seed, incoming, [], []);
  assert.equal(merged.database.monsters[0].name, '雲狐');
  assert.ok(merged.warnings.some((warning) => warning.includes('不可覆寫內建條目')));
});

test('匯出的完整備份可再次通過匯入驗證', () => {
  const backup = makeBackup(seed, [recordRef('monsters', 'monster-cloud-fox')]);
  const result = parseImportPayload(backup, seed);
  assert.equal(result.valid, true, result.errors?.join('\n'));
  assert.deepEqual(result.favorites, [recordRef('monsters', 'monster-cloud-fox')]);
});

test('無效 schema version 會提供清楚錯誤', () => {
  const result = parseImportPayload({ schemaVersion: 99 }, seed);
  assert.equal(result.valid, false);
  assert.ok(result.errors[0].includes('schema'));
});

test('物品可反查怪物、BOSS 與任務來源', () => {
  const cloudTail = seed.items.find((record) => record.id === 'item-cloud-fox-tail');
  const alishanCoin = seed.items.find((record) => record.id === 'item-alishan-coin');
  const strengthRing = seed.items.find((record) => record.id === 'item-strength-ring-3');
  assert.ok(seed.monsters.some((record) => record.dropItemIds.includes(cloudTail.id)));
  assert.ok(seed.bosses.some((record) => record.dropItemIds.includes(alishanCoin.id)));
  assert.ok(seed.quests.some((record) => record.requiredItemIds.includes(strengthRing.id)));
});

test('官方地圖、NPC 與職業技能的新關聯閉合', () => {
  const skyCity = seed.maps.find((record) => record.id === 'map-sky-city');
  const thomas = seed.npcs.find((record) => record.id === 'npc-thomas');
  const demonSlayer = seed.jobs.find((record) => record.id === 'job-demon-slayer');
  const darkRevenge = seed.skills.find((record) => record.id === 'skill-demon-slayer-dark-revenge');
  assert.ok(skyCity.npcIds.includes(thomas.id));
  assert.ok(thomas.mapIds.includes(skyCity.id));
  assert.ok(demonSlayer.skillIds.includes(darkRevenge.id));
  assert.equal(darkRevenge.jobId, demonSlayer.id);
});

test('玩家證據可驗證目標、類型、日期與安全網址', () => {
  const database = clone(seed);
  database.evidence.push(createEvidenceRecord({
    id: 'evidence-cloud-fox-hp-a',
    targetRef: 'monsters:monster-cloud-fox',
    field: 'HP',
    claimValue: '遊戲畫面顯示的測試主張',
    evidenceType: '遊戲內截圖',
    evidenceUrl: 'https://example.com/evidence',
    reporterAlias: '玩家甲',
    observedAt: '2026-10-10'
  }));
  assert.equal(validateDatabase(database).valid, true);
  database.evidence[0].targetRef = 'monsters:not-found';
  const invalid = validateDatabase(database);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((error) => error.includes('not-found')));
});

test('同一回報者的重複證據會提出警告', () => {
  const database = clone(seed);
  const base = {
    targetRef: 'monsters:monster-cloud-fox', field: 'HP', claimValue: '123', evidenceType: '玩家填寫',
    reporterAlias: '玩家甲', observedAt: '2026-10-10'
  };
  database.evidence.push(createEvidenceRecord({ ...base, id: 'evidence-repeat-1' }));
  database.evidence.push(createEvidenceRecord({ ...base, id: 'evidence-repeat-2' }));
  const result = validateDatabase(database);
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((warning) => warning.includes('重複主張')));
});

test('玩家自建條目不能冒充官方，且需有已採用證據才能標示玩家驗證', () => {
  const database = clone(seed);
  const item = clone(database.items[0]);
  item.id = 'item-user-verification';
  item.name = '玩家驗證物品';
  item.userCreated = true;
  item.sourceIds = [];
  item.verificationStatus = '官方已確認';
  database.items.push(item);
  let result = validateDatabase(database);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('不可標示為「官方已確認」')));
  item.verificationStatus = '玩家證據已驗證';
  result = validateDatabase(database);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('已採用的玩家證據')));
  const evidence = createEvidenceRecord({ id: 'evidence-user-verification', targetRef: 'items:item-user-verification', field: '取得方式', claimValue: '遊戲內截圖可確認', evidenceType: '遊戲內截圖', reporterAlias: '玩家甲', observedAt: '2026-10-10' });
  evidence.reviewStatus = '已採用';
  evidence.reviewedAt = '2026-10-11T00:00:00.000Z';
  database.evidence.push(evidence);
  assert.equal(validateDatabase(database).valid, true);
});

test('CSV 範本可預覽並一次建立怪物、物品與地圖關聯', () => {
  const result = parseCsvImport(makeCsvTemplate(), seed);
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(result.previewRows.length, 3);
  const monster = result.database.monsters.find((record) => record.id === 'monster-user-example');
  assert.deepEqual(monster.mapIds, ['map-user-example']);
  assert.deepEqual(monster.dropItemIds, ['item-user-example']);
  assert.equal(monster.verificationStatus, '待驗證');
});

test('CSV 拒絕檔案內重複 ID', () => {
  const csv = 'collection,id,name,description\nitems,item-duplicate,甲,說明\nitems,item-duplicate,乙,說明';
  const result = parseCsvImport(csv, seed);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('重複 ID')));
});

test('CSV 拒絕不存在的外鍵與內建 ID 覆寫', () => {
  const missing = parseCsvImport('collection,id,name,description,mapIds\nmonsters,monster-user-bad,錯誤怪物,說明,map-not-found', seed);
  assert.equal(missing.valid, false);
  assert.ok(missing.errors.some((error) => error.includes('map-not-found')));
  const protectedRecord = parseCsvImport('collection,id,name,description\nmonsters,monster-cloud-fox,覆寫雲狐,說明', seed);
  assert.equal(protectedRecord.valid, false);
  assert.ok(protectedRecord.errors.some((error) => error.includes('不可覆寫內建條目')));
});

test('CSV 不接受玩家自行宣告官方確認', () => {
  const csv = 'collection,id,name,description,verificationStatus\nitems,item-user-status,玩家物品,說明,官方已確認';
  const result = parseCsvImport(csv, seed);
  assert.equal(result.valid, true);
  assert.equal(result.database.items.find((record) => record.id === 'item-user-status').verificationStatus, '待驗證');
  assert.ok(result.warnings.some((warning) => warning.includes('已改為待驗證')));
});

test('CSV 拒絕錯誤數值格式', () => {
  const result = parseCsvImport('collection,id,name,description,hp\nmonsters,monster-user-number,數值錯誤怪物,說明,未知', seed);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('hp 必須是非負數或留空')));
});

test('schema v2 可升級並保留自建資料、價格與來源', () => {
  const v2 = clone(seed);
  v2.schemaVersion = 2;
  delete v2.evidence;
  for (const source of v2.sources) {
    delete source.sourceType;
    source.verificationStatus = source.verificationStatus === '官方已確認' ? '已驗證' : source.verificationStatus;
  }
  for (const collection of ['monsters', 'items', 'maps', 'npcs', 'jobs', 'skills', 'quests', 'bosses', 'guides']) {
    for (const record of v2[collection]) record.verificationStatus = record.verificationStatus === '官方已確認' ? '已驗證' : record.verificationStatus;
  }
  const custom = clone(v2.items[0]);
  custom.id = 'item-user-v2-preserved';
  custom.name = 'v2 自建物品';
  custom.userCreated = true;
  custom.verificationStatus = '待驗證';
  v2.items.push(custom);
  v2.prices.push({ id: 'price-v2-preserved', itemId: custom.id, server: '玩家服', price: 321, recordedAt: '2026-10-10T00:00:00.000Z', dataSource: '手動', notes: '', sourceId: null, userCreated: true });
  const migrated = migrateV2Database(v2);
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
  assert.ok(migrated.items.some((record) => record.id === custom.id));
  assert.ok(migrated.prices.some((record) => record.id === 'price-v2-preserved'));
  assert.equal(migrated.sources[0].sourceType, '楓星官方');
  assert.equal(validateDatabase(migrated, { allowTestData: true }).valid, true);
});

test('首次載入 v2 localStorage 後收藏與價格仍保留', () => {
  const v2 = clone(seed);
  v2.schemaVersion = 2;
  delete v2.evidence;
  for (const source of v2.sources) {
    delete source.sourceType;
    source.verificationStatus = '已驗證';
  }
  for (const collection of ['monsters', 'items', 'maps', 'npcs', 'jobs', 'skills', 'quests', 'bosses', 'guides']) {
    for (const record of v2[collection]) if (record.verificationStatus === '官方已確認') record.verificationStatus = '已驗證';
  }
  v2.prices.push({ id: 'price-v2-load', itemId: 'item-cloud-fox-tail', server: '玩家服', price: 999, recordedAt: '2026-10-10T00:00:00.000Z', dataSource: '手動', notes: '', sourceId: null, userCreated: true });
  const values = new Map([
    [LEGACY_KEYS.databaseV2, JSON.stringify(v2)],
    [LEGACY_KEYS.favoritesV2, JSON.stringify(['monsters:monster-cloud-fox'])]
  ]);
  const storage = { getItem: (key) => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, value) };
  const loaded = loadAppData(seed, storage);
  assert.equal(loaded.migration.schema, 2);
  assert.ok(loaded.database.prices.some((record) => record.id === 'price-v2-load'));
  assert.deepEqual(loaded.favorites, ['monsters:monster-cloud-fox']);
  assert.ok(values.has(DATABASE_KEY));
  assert.ok(values.has(FAVORITES_KEY));
  assert.ok(values.has(LEGACY_KEYS.databaseV2));
});

test('統計排除測試資料並分列四種驗證狀態', () => {
  const database = clone(seed);
  const testItem = clone(database.items[0]);
  testItem.id = 'item-test-stat';
  testItem.name = '統計測試資料';
  testItem.testData = true;
  testItem.userCreated = true;
  testItem.verificationStatus = '測試資料';
  database.items.push(testItem);
  const stats = databaseStats(database);
  assert.equal(stats.total, stats.formalTotal + 1);
  assert.equal(stats.statuses['測試資料'], 1);
  assert.equal(stats.formalTotal, seed.monsters.length + seed.items.length + seed.maps.length + seed.npcs.length + seed.jobs.length + seed.skills.length + seed.quests.length + seed.bosses.length + seed.guides.length);
});

test('schema v3 可升級至 v4 並保留條目、價格、證據與欄位名稱', () => {
  const v3 = clone(seed);
  v3.schemaVersion = 3;
  for (const collection of ['monsters', 'items', 'maps', 'npcs', 'jobs', 'skills', 'quests', 'bosses', 'guides']) {
    for (const record of v3[collection]) delete record.fieldVerifications;
  }
  const evidence = createEvidenceRecord({ id: 'evidence-v3', targetRef: 'monsters:monster-cloud-fox', field: 'HP', claimValue: '123', evidenceType: '遊戲內截圖', reporterAlias: '遷移玩家', observedAt: '2026-10-10' });
  delete evidence.fieldKey;
  v3.evidence.push(evidence);
  const migrated = migrateV3Database(v3);
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
  assert.equal(migrated.evidence[0].fieldKey, 'hp');
  assert.ok(migrated.monsters[0].fieldVerifications.name);
  assert.equal(validateDatabase(migrated, { allowTestData: true }).valid, true);
});

test('採用玩家證據後才更新指定欄位與欄位級來源', () => {
  const database = clone(seed);
  database.evidence.push(createEvidenceRecord({ id: 'evidence-hp-accepted', targetRef: 'monsters:monster-cloud-fox', fieldKey: 'hp', field: 'HP', claimValue: '123', evidenceType: '遊戲內截圖', reporterAlias: '玩家甲', observedAt: '2026-10-10' }));
  assert.equal(database.monsters[0].hp, null);
  const reviewed = reviewEvidence(database, 'evidence-hp-accepted', '已採用', '已人工核對截圖');
  assert.equal(reviewed.monsters[0].hp, 123);
  assert.equal(reviewed.monsters[0].fieldVerifications.hp.status, '玩家證據已驗證');
  assert.deepEqual(reviewed.monsters[0].fieldVerifications.hp.evidenceIds, ['evidence-hp-accepted']);
});

test('衝突證據保留雙方紀錄且拒絕時不改寫欄位', () => {
  const database = clone(seed);
  database.evidence.push(createEvidenceRecord({ id: 'evidence-level-a', targetRef: 'monsters:monster-cloud-fox', fieldKey: 'level', field: '等級', claimValue: '20', evidenceType: '玩家填寫', reporterAlias: '玩家甲', observedAt: '2026-10-10' }));
  database.evidence.push(createEvidenceRecord({ id: 'evidence-level-b', targetRef: 'monsters:monster-cloud-fox', fieldKey: 'level', field: '等級', claimValue: '21', evidenceType: '遊戲內截圖', reporterAlias: '玩家乙', observedAt: '2026-10-10' }));
  const accepted = reviewEvidence(database, 'evidence-level-a', '已採用', '採用 A');
  const rejected = reviewEvidence(accepted, 'evidence-level-b', '已拒絕', '畫面不清楚');
  assert.equal(rejected.monsters[0].level, 20);
  assert.equal(rejected.evidence.length, 2);
  assert.deepEqual(rejected.evidence.map((record) => record.reviewStatus).sort(), ['已拒絕', '已採用']);
});

test('完整度不會只因有名稱就判定完成', () => {
  const stats = databaseStats(seed);
  assert.ok(stats.collections.monsters.critical.completenessRatio < 100);
  assert.ok(stats.collections.monsters.critical.verifiedRatio < stats.collections.monsters.critical.completenessRatio);
  assert.equal(stats.levelCoverage.reduce((sum, row) => sum + row.total, 0), 0);
});

test('本期新增官方條目與職業技能關聯存在', () => {
  assert.equal(seed.jobs.length, 15);
  assert.equal(seed.skills.find((record) => record.id === 'skill-mechanic-rocket-booster').jobId, 'job-mechanic');
  assert.ok(seed.jobs.find((record) => record.id === 'job-mechanic').skillIds.includes('skill-mechanic-rocket-booster'));
  assert.equal(seed.quests.find((record) => record.id === 'quest-hungry-roni').fieldVerifications.name.status, '官方已確認');
});

test('首次載入 v3 localStorage 保留收藏、價格、證據與自建內容', () => {
  const v3 = clone(seed);
  v3.schemaVersion = 3;
  for (const collection of ['monsters', 'items', 'maps', 'npcs', 'jobs', 'skills', 'quests', 'bosses', 'guides']) for (const record of v3[collection]) delete record.fieldVerifications;
  const custom = clone(v3.items[0]);
  custom.id = 'item-user-v3-preserved'; custom.name = 'v3 保留物品'; custom.userCreated = true; custom.verificationStatus = '待驗證';
  v3.items.push(custom);
  v3.prices.push({ id: 'price-v3-preserved', itemId: custom.id, server: '玩家服', price: 456, recordedAt: '2026-10-10T00:00:00.000Z', dataSource: '手動', notes: '', sourceId: null, userCreated: true });
  const evidence = createEvidenceRecord({ id: 'evidence-v3-preserved', targetRef: `items:${custom.id}`, field: '取得方式', claimValue: '畫面顯示', evidenceType: '遊戲內截圖', reporterAlias: '玩家甲', observedAt: '2026-10-10' });
  delete evidence.fieldKey;
  v3.evidence.push(evidence);
  const values = new Map([[LEGACY_KEYS.databaseV3, JSON.stringify(v3)], [LEGACY_KEYS.favoritesV3, JSON.stringify([`items:${custom.id}`])]]);
  const storage = { getItem: (key) => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, value) };
  const loaded = loadAppData(seed, storage);
  assert.equal(loaded.migration.schema, 3);
  assert.ok(loaded.database.items.some((record) => record.id === custom.id));
  assert.ok(loaded.database.prices.some((record) => record.id === 'price-v3-preserved'));
  assert.ok(loaded.database.evidence.some((record) => record.id === 'evidence-v3-preserved'));
  assert.deepEqual(loaded.favorites, [`items:${custom.id}`]);
  assert.ok(values.has(LEGACY_KEYS.databaseV3));
});

test('完整備份還原時保留已採用於內建條目的欄位證據', () => {
  const withEvidence = clone(seed);
  withEvidence.evidence.push(createEvidenceRecord({ id: 'evidence-backup-hp', targetRef: 'monsters:monster-cloud-fox', fieldKey: 'hp', field: 'HP', claimValue: '321', evidenceType: '遊戲內截圖', reporterAlias: '玩家甲', observedAt: '2026-10-10' }));
  const reviewed = reviewEvidence(withEvidence, 'evidence-backup-hp', '已採用', '人工核對');
  const restored = mergeImportedData(seed, reviewed, [], []);
  const monster = restored.database.monsters.find((record) => record.id === 'monster-cloud-fox');
  assert.equal(monster.hp, 321);
  assert.equal(monster.fieldVerifications.hp.status, '玩家證據已驗證');
});
