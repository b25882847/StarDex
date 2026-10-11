import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  recordRef,
  validateDatabase
} from '../js/schema.js';
import {
  clone,
  makeBackup,
  mergeImportedData,
  migrateLegacyPayload,
  parseImportPayload
} from '../js/storage.js';

const seed = JSON.parse(fs.readFileSync(new URL('../data/maplestar.seed.json', import.meta.url), 'utf8'));

test('內建 schema v2 資料通過完整驗證', () => {
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

test('可辨識 v1 備份並遷移到 v2', () => {
  const result = parseImportPayload({ format: 'StarDexBackup', version: 1, entries: [], prices: [], favorites: [] }, seed);
  assert.equal(result.valid, true);
  assert.equal(result.migrated, true);
  assert.equal(result.database.schemaVersion, 2);
});

test('匯入時不允許自建資料覆寫內建資料', () => {
  const incoming = clone(seed);
  incoming.monsters[0] = { ...incoming.monsters[0], name: '惡意覆寫', userCreated: true };
  const merged = mergeImportedData(seed, incoming, [], []);
  assert.equal(merged.database.monsters[0].name, '雲狐');
  assert.ok(merged.warnings.some((warning) => warning.includes('不可用匯入資料覆寫')));
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
