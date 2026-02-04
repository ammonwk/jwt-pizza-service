const request = require('supertest');
const app = require('../service.js');
const { Role, DB } = require('../database/database.js');

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

async function createAdminUser() {
  const user = { password: 'toomanysecrets', roles: [{ role: Role.Admin }] };
  user.name = randomName();
  user.email = user.name + '@admin.com';
  await DB.addUser(user);
  return { ...user, password: 'toomanysecrets' };
}

let adminUser;

beforeAll(async () => {
  adminUser = await createAdminUser();
});

test('register a new user', async () => {
  const name = randomName();
  const email = name + '@test.com';
  const res = await request(app).post('/api/auth').send({ name, email, password: 'testpass' });
  expect(res.status).toBe(200);
  expect(res.body.user.name).toBe(name);
  expect(res.body.user.email).toBe(email);
  expect(res.body.token).toBeDefined();
  expect(res.body.user.roles).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'diner' })]));
});

test('register with missing fields returns 400', async () => {
  const res = await request(app).post('/api/auth').send({ name: 'test' });
  expect(res.status).toBe(400);
  expect(res.body.message).toMatch(/name, email, and password are required/);
});

test('login existing user', async () => {
  const res = await request(app).put('/api/auth').send({ email: adminUser.email, password: adminUser.password });
  expect(res.status).toBe(200);
  expect(res.body.user.email).toBe(adminUser.email);
  expect(res.body.token).toBeDefined();
});

test('login with bad credentials returns 404', async () => {
  const res = await request(app).put('/api/auth').send({ email: 'nobody@example.com', password: 'wrong' });
  expect(res.status).toBe(404);
  expect(res.body.message).toMatch(/unknown/);
});

test('logout success', async () => {
  // Login first to get a fresh token
  const loginRes = await request(app).put('/api/auth').send({ email: adminUser.email, password: adminUser.password });
  const token = loginRes.body.token;

  const res = await request(app).delete('/api/auth').set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  expect(res.body.message).toBe('logout successful');
});

test('unauthenticated request returns 401', async () => {
  const res = await request(app).delete('/api/auth');
  expect(res.status).toBe(401);
  expect(res.body.message).toBe('unauthorized');
});

test('invalid token returns 401', async () => {
  const res = await request(app).delete('/api/auth').set('Authorization', 'Bearer invalid.token.here');
  expect(res.status).toBe(401);
  expect(res.body.message).toBe('unauthorized');
});

test('logged out token returns 401', async () => {
  // Login, logout, then try to use the token
  const name = randomName();
  const email = name + '@test.com';
  await request(app).post('/api/auth').send({ name, email, password: 'testpass' });
  const loginRes = await request(app).put('/api/auth').send({ email, password: 'testpass' });
  const token = loginRes.body.token;

  // Logout
  await request(app).delete('/api/auth').set('Authorization', `Bearer ${token}`);

  // Try to use the old token
  const res = await request(app).get('/api/user/me').set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(401);
});
