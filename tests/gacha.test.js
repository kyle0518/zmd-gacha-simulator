'use strict';
/* Focused regression tests for the pity model. Run: node --test tests/gacha.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { computeSwitchAngle, SWITCH_TRIGGER_ANGLE, simulateBatch, sixRateFor, freshPityState, normalizeConfig, getPoolConfig } =
    require(path.join(__dirname, '..', 'app.js'));

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
normalizeConfig(config);
const pools = getPoolConfig();
const renewal = pools.renewal;
const standard = pools.standard;

test('config: current banner is 萬物更新 with verified pool', () => {
    assert.equal(Object.keys(pools)[0], 'renewal');
    assert.equal(renewal.featured6, '祀');
    assert.deepEqual(renewal.units[6].slice(-3), ['祀', '提弗洛斯', '梨諾']);
});

test('soft pity: rate is 0.8% before 65 and rises after', () => {
    assert.equal(sixRateFor({ drawsWithoutSix: 0 }), 0.8);
    assert.equal(sixRateFor({ drawsWithoutSix: 64 }), 0.8);
    assert.equal(sixRateFor({ drawsWithoutSix: 65 }), 5.8);
});

test('hard pity: 80th draw without a 6-star is guaranteed 6-star', () => {
    const pity = { ...freshPityState(standard), drawsWithoutSix: 79, drawsWithoutFive: 0 };
    const batch = simulateBatch(1, standard, pity, 'standard', 0);
    assert.equal(batch.records[0].star, 6);
    assert.equal(batch.pity.drawsWithoutSix, 0);
});

test('five-star pity: 10th draw without a 5-star+ is at least 5-star', () => {
    const pity = { ...freshPityState(standard), drawsWithoutFive: 9, drawsWithoutSix: 0 };
    const batch = simulateBatch(1, standard, pity, 'standard', 0);
    assert.ok(batch.records[0].star >= 5);
});

test('featured guarantee: 120th draw yields the featured 6-star', () => {
    const pity = { ...freshPityState(renewal), drawsWithoutFeatured6: 119 };
    const batch = simulateBatch(1, renewal, pity, 'renewal', 0);
    assert.equal(batch.records[0].result, '祀');
    assert.equal(batch.pity.featured6CounterActive, false);
});

test('token: 240th draw on a featured banner grants a token', () => {
    const pity = { ...freshPityState(renewal), drawsSinceTokenCounterStart: 239 };
    const batch = simulateBatch(1, renewal, pity, 'renewal', 0);
    assert.equal(batch.records[0].tokenObtained, true);
    assert.equal(batch.pity.tokensObtained, 1);
});

test('simulation does not mutate the source pity state', () => {
    const pity = freshPityState(renewal);
    simulateBatch(10, renewal, pity, 'renewal', 0);
    assert.deepEqual(pity, freshPityState(renewal));
});

test('every element id looked up in app.js exists in index.html', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const js = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
    const lookedUp = new Set([...js.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));
    // ids registered via the els[...] init list
    const listMatch = js.match(/\[\s*'sidebar'[\s\S]*?'\]\s*\.forEach/);
    assert.ok(listMatch, 'els init list not found');
    for (const m of listMatch[0].matchAll(/'([A-Za-z][A-Za-z0-9-]*)'/g)) lookedUp.add(m[1]);
    for (const id of lookedUp) assert.ok(htmlIds.has(id), `app.js looks up #${id} but index.html has no such id`);
});

test('knife switch: drag angle has resistance and clamps at max', () => {
    assert.equal(computeSwitchAngle(-50), 0);
    assert.equal(computeSwitchAngle(0), 0);
    assert.ok(computeSwitchAngle(110) < 110 * 0.5, 'angle should lag behind drag distance');
    assert.equal(computeSwitchAngle(10000), 68);
    assert.ok(SWITCH_TRIGGER_ANGLE < 68);
});

test('every featured 6-star has a portrait and a face focus point', () => {
    for (const pool of Object.values(pools)) {
        if (!pool.featured6) continue;
        assert.ok(config.unitImages[pool.featured6], `${pool.featured6} missing unitImages`);
        assert.ok(config.unitImageFocus[pool.featured6], `${pool.featured6} missing unitImageFocus`);
    }
});
