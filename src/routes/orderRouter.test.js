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

const originalFetch = global.fetch;
let adminUser, adminToken;
let dinerUser, dinerToken;
let testMenuItem;
let testFranchise, testStore;

beforeAll(async () => {
  // Create and login admin
  adminUser = await createAdminUser();
  const adminLogin = await request(app).put('/api/auth').send({ email: adminUser.email, password: adminUser.password });
  adminToken = adminLogin.body.token;

  // Create and login regular diner
  const name = randomName();
  const email = name + '@test.com';
  const registerRes = await request(app).post('/api/auth').send({ name, email, password: 'dinerpass' });
  dinerToken = registerRes.body.token;
  dinerUser = registerRes.body.user;

  // Create a franchise and store for order tests
  const franchiseName = randomName();
  const franchiseRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: franchiseName, admins: [{ email: adminUser.email }] });
  testFranchise = franchiseRes.body;

  const storeRes = await request(app)
    .post(`/api/franchise/${testFranchise.id}/store`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: randomName() });
  testStore = storeRes.body;

  // Add a menu item
  const menuRes = await request(app)
    .put('/api/order/menu')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ title: 'Test Pizza', description: 'A test pizza', image: 'test.png', price: 0.005 });
  testMenuItem = menuRes.body[menuRes.body.length - 1];
});

afterAll(() => {
  global.fetch = originalFetch;
});

test('get menu', async () => {
  const res = await request(app).get('/api/order/menu');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  expect(res.body.length).toBeGreaterThan(0);
});

test('add menu item as admin', async () => {
  const res = await request(app)
    .put('/api/order/menu')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ title: 'Admin Pizza', description: 'Admin special', image: 'admin.png', price: 0.01 });
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  expect(res.body.some((item) => item.title === 'Admin Pizza')).toBe(true);
});

test('add menu item as non-admin returns 403', async () => {
  const res = await request(app)
    .put('/api/order/menu')
    .set('Authorization', `Bearer ${dinerToken}`)
    .send({ title: 'Hacker Pizza', description: 'No', image: 'hack.png', price: 0.001 });
  expect(res.status).toBe(403);
  expect(res.body.message).toMatch(/unable to add menu item/);
});

test('get orders for authenticated user', async () => {
  const res = await request(app)
    .get('/api/order')
    .set('Authorization', `Bearer ${dinerToken}`);
  expect(res.status).toBe(200);
  expect(res.body.dinerId).toBe(dinerUser.id);
  expect(res.body.orders).toBeDefined();
  expect(Array.isArray(res.body.orders)).toBe(true);
});

test('create order with factory success', async () => {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ reportUrl: 'http://example.com/report', jwt: 'factory-jwt-123' }),
    })
  );

  const res = await request(app)
    .post('/api/order')
    .set('Authorization', `Bearer ${dinerToken}`)
    .send({
      franchiseId: testFranchise.id,
      storeId: testStore.id,
      items: [{ menuId: testMenuItem.id, description: testMenuItem.description, price: testMenuItem.price }],
    });
  expect(res.status).toBe(200);
  expect(res.body.order).toBeDefined();
  expect(res.body.jwt).toBe('factory-jwt-123');
  expect(res.body.followLinkToEndChaos).toBe('http://example.com/report');
});

test('create order with factory failure', async () => {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: false,
      json: () => Promise.resolve({ reportUrl: 'http://example.com/fail-report' }),
    })
  );

  const res = await request(app)
    .post('/api/order')
    .set('Authorization', `Bearer ${dinerToken}`)
    .send({
      franchiseId: testFranchise.id,
      storeId: testStore.id,
      items: [{ menuId: testMenuItem.id, description: testMenuItem.description, price: testMenuItem.price }],
    });
  expect(res.status).toBe(500);
  expect(res.body.message).toMatch(/Failed to fulfill order/);
  expect(res.body.followLinkToEndChaos).toBe('http://example.com/fail-report');
});

test('create order with invalid menuId returns 500', async () => {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ reportUrl: 'http://example.com/report', jwt: 'factory-jwt-123' }),
    })
  );

  const res = await request(app)
    .post('/api/order')
    .set('Authorization', `Bearer ${dinerToken}`)
    .send({
      franchiseId: testFranchise.id,
      storeId: testStore.id,
      items: [{ menuId: 999999, description: 'Invalid', price: 1.0 }],
    });
  expect(res.status).toBe(500);
});
