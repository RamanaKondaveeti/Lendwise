const test = require('node:test');
const assert = require('node:assert/strict');
const { buildGroupAnalyticsFilter } = require('../src/group-analytics');

test('builds date filters for supported periods and all time', () => {
  for (const [period, days] of [['7d', 7], ['30d', 30], ['90d', 90]]) {
    const filter = buildGroupAnalyticsFilter({ period });
    assert.match(filter.where, /e\.voided_at IS NULL/);
    assert.match(filter.where, /DATE_SUB\(UTC_TIMESTAMP\(\), INTERVAL \? DAY\)/);
    assert.deepEqual(filter.parameters, [days]);
  }
  const all = buildGroupAnalyticsFilter({ period: 'all' });
  assert.equal(all.where, 'e.group_id = ? AND e.voided_at IS NULL');
  assert.deepEqual(all.parameters, []);
});

test('custom dates override period and use inclusive calendar bounds', () => {
  const filter = buildGroupAnalyticsFilter({ period: '7d', startDate: '2025-01-03', endDate: '2025-01-31' });
  assert.match(filter.where, /e\.created_at >= \?/);
  assert.match(filter.where, /e\.created_at < DATE_ADD\(\?, INTERVAL 1 DAY\)/);
  assert.deepEqual(filter.parameters, ['2025-01-03 00:00:00', '2025-01-31']);
});

test('rejects unsupported periods, malformed dates, and reversed ranges', () => {
  assert.throws(() => buildGroupAnalyticsFilter({ period: '14d' }), /Invalid analytics filters/);
  assert.throws(() => buildGroupAnalyticsFilter({ startDate: '2025-02-29' }), /Invalid analytics filters/);
  assert.throws(() => buildGroupAnalyticsFilter({ startDate: '2025-03-01', endDate: '2025-02-28' }), /Invalid analytics filters/);
});
