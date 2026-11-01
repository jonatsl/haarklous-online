const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../game-weather.js');

// Trimmed from a real /weather answer (MET Norway Locationforecast 2.0 complete, Haarklous plass, 1 Nov 2026).
const sample = {source: 'MET Norway', updated_at: '2026-11-01T20:29:13Z', fetched_at: '2026-11-01T20:43:18.459Z', timeseries: [
  {time: '2026-11-01T20:00:00Z', data: {instant: {details: {air_temperature: 7.9, cloud_area_fraction: 47, fog_area_fraction: 0, relative_humidity: 73.2, wind_from_direction: 16, wind_speed: 4.6, wind_speed_of_gust: 8.4}},
    next_1_hours: {summary: {symbol_code: 'partlycloudy_night'}, details: {precipitation_amount: 0}}}},
  {time: '2026-11-01T21:00:00Z', data: {instant: {details: {air_temperature: 6.1, cloud_area_fraction: 100, fog_area_fraction: 12, wind_from_direction: 200, wind_speed: 9}},
    next_1_hours: {summary: {symbol_code: 'heavyrain'}, details: {precipitation_amount: 5.2}}}}]};

test('MET symbol codes become a weather kind, a strength and thunder', () => {
  const c = s => W.classify(s);
  assert.deepEqual(c('partlycloudy_night'), {kind: 'partly', intensity: 0, thunder: false});
  assert.equal(c('clearsky_polartwilight').kind, 'clear');assert.equal(c('fair_day').kind, 'fair');assert.equal(c('cloudy').kind, 'cloudy');assert.equal(c('fog').kind, 'fog');
  assert.equal(c('heavyrainshowers_day').kind, 'rain');assert.ok(c('heavyrain').intensity > c('rain').intensity && c('rain').intensity > c('lightrain').intensity);
  assert.deepEqual([c('sleetandthunder').kind, c('sleetandthunder').thunder], ['sleet', true]);
  // MET's own spellings with an extra "s" (and a stray space in their legend file).
  assert.deepEqual([c('lightssnowshowersandthunder_day').kind, c('lightssnowshowersandthunder_day').thunder], ['snow', true]);
  assert.equal(c('lightssleetshowersandthunder ').kind, 'sleet');
  assert.ok(W.classify('lightrain', 6).intensity > .9, 'a lot of rain in the hour makes it heavy');
});

test('the hour now is the last forecast entry that has started', () => {
  const a = W.parse(sample, Date.parse('2026-11-01T20:43:00Z'));
  assert.equal(a.time, '2026-11-01T20:00:00Z');assert.equal(a.temp, 7.9);assert.equal(a.kind, 'partly');assert.equal(a.clouds, .47);assert.equal(a.windFrom, 16);
  const b = W.parse(sample, Date.parse('2026-11-01T21:05:00Z'));
  assert.equal(b.kind, 'rain');assert.equal(b.clouds, 1);assert.equal(b.fog, .12);assert.equal(b.precip, 5.2);
  assert.equal(W.parse({timeseries: []}), null);assert.equal(W.parse(null), null);
});

test('a short text for the player', () => {
  assert.equal(W.describe(W.parse(sample, Date.parse('2026-11-01T20:30:00Z'))), '7.9 °C · partly cloudy · wind 4.6 m/s from NNE');
  assert.equal(W.describe(W.parse(sample, Date.parse('2026-11-01T21:30:00Z'))), '6.1 °C · heavy rain · wind 9.0 m/s from SSW');
});
