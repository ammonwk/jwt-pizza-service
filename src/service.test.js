const request = require('supertest');
const app = require('./service.js');

test('welcome endpoint returns correct message', async () => {
  const res = await request(app).get('/');
  expect(res.status).toBe(200);
  expect(res.body.message).toBe('welcome to JWT Pizza');
  expect(res.body.version).toBeDefined();
});

test('docs endpoint returns endpoints array', async () => {
  const res = await request(app).get('/api/docs');
  expect(res.status).toBe(200);
  expect(res.body.endpoints).toBeDefined();
  expect(Array.isArray(res.body.endpoints)).toBe(true);
  expect(res.body.version).toBeDefined();
  expect(res.body.config).toBeDefined();
});

test('unknown endpoint returns 404', async () => {
  const res = await request(app).get('/api/nonexistent');
  expect(res.status).toBe(404);
  expect(res.body.message).toBe('unknown endpoint');
});
