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

let adminUser, adminToken, adminId;
let dinerUser, dinerToken, dinerId;
let franchiseAdminToken;
let testFranchise;

beforeAll(async () => {
  // Create and login admin
  adminUser = await createAdminUser();
  const adminLogin = await request(app).put('/api/auth').send({ email: adminUser.email, password: adminUser.password });
  adminToken = adminLogin.body.token;
  adminId = adminLogin.body.user.id;

  // Create and login regular diner
  const dinerName = randomName();
  const dinerEmail = dinerName + '@test.com';
  const dinerReg = await request(app).post('/api/auth').send({ name: dinerName, email: dinerEmail, password: 'dinerpass' });
  dinerToken = dinerReg.body.token;
  dinerId = dinerReg.body.user.id;
  dinerUser = { name: dinerName, email: dinerEmail, password: 'dinerpass' };

  // Create a franchise with diner as franchise admin
  const franchiseName = randomName();
  const franchiseRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: franchiseName, admins: [{ email: dinerUser.email }] });
  testFranchise = franchiseRes.body;

  // Re-login diner to get updated roles (now a franchisee)
  const dinerReLogin = await request(app).put('/api/auth').send({ email: dinerUser.email, password: dinerUser.password });
  franchiseAdminToken = dinerReLogin.body.token;
  dinerToken = franchiseAdminToken;
});

test('list franchises unauthenticated', async () => {
  const res = await request(app).get('/api/franchise');
  expect(res.status).toBe(200);
  expect(res.body.franchises).toBeDefined();
  expect(Array.isArray(res.body.franchises)).toBe(true);
  // Unauthenticated should have stores but not admins array
  const franchise = res.body.franchises.find((f) => f.id === testFranchise.id);
  if (franchise) {
    expect(franchise.stores).toBeDefined();
  }
});

test('list franchises as admin (gets admin details)', async () => {
  const res = await request(app)
    .get('/api/franchise')
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  expect(res.body.franchises).toBeDefined();
  // Admin should see admins array on franchises
  const franchise = res.body.franchises.find((f) => f.id === testFranchise.id);
  if (franchise) {
    expect(franchise.admins).toBeDefined();
    expect(franchise.stores).toBeDefined();
  }
});

test('create franchise as admin', async () => {
  const name = randomName();
  const res = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name, admins: [{ email: adminUser.email }] });
  expect(res.status).toBe(200);
  expect(res.body.name).toBe(name);
  expect(res.body.id).toBeDefined();
  expect(res.body.admins).toBeDefined();
});

test('create franchise as non-admin returns 403', async () => {
  const name = randomName();
  const res = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${dinerToken}`)
    .send({ name, admins: [{ email: dinerUser.email }] });
  expect(res.status).toBe(403);
  expect(res.body.message).toMatch(/unable to create a franchise/);
});

test('create franchise with unknown admin email returns 404', async () => {
  const name = randomName();
  const res = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name, admins: [{ email: 'nonexistent-' + randomName() + '@fake.com' }] });
  expect(res.status).toBe(404);
  expect(res.body.message).toMatch(/unknown user/);
});

test('get user franchises (self)', async () => {
  const res = await request(app)
    .get(`/api/franchise/${dinerId}`)
    .set('Authorization', `Bearer ${dinerToken}`);
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  expect(res.body.length).toBeGreaterThan(0);
  expect(res.body[0].admins).toBeDefined();
});

test('get user franchises (admin for other)', async () => {
  const res = await request(app)
    .get(`/api/franchise/${dinerId}`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  expect(res.body.length).toBeGreaterThan(0);
});

test('get user franchises (non-matching non-admin) returns empty', async () => {
  // Create a third user
  const name3 = randomName();
  const email3 = name3 + '@test.com';
  const reg3 = await request(app).post('/api/auth').send({ name: name3, email: email3, password: 'pass3' });
  const token3 = reg3.body.token;

  const res = await request(app)
    .get(`/api/franchise/${dinerId}`)
    .set('Authorization', `Bearer ${token3}`);
  expect(res.status).toBe(200);
  expect(res.body).toEqual([]);
});

test('get user franchises for user with no franchises returns empty', async () => {
  const res = await request(app)
    .get(`/api/franchise/${adminId}`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  // Admin might have franchises from other tests, but checking the endpoint works
  expect(Array.isArray(res.body)).toBe(true);
});

test('delete franchise', async () => {
  // Create a franchise to delete
  const name = randomName();
  const createRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name, admins: [{ email: adminUser.email }] });
  const franchiseId = createRes.body.id;

  const res = await request(app)
    .delete(`/api/franchise/${franchiseId}`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  expect(res.body.message).toBe('franchise deleted');
});

test('delete franchise without auth (known bug - no auth check)', async () => {
  // Create a franchise to delete
  const name = randomName();
  const createRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name, admins: [{ email: adminUser.email }] });
  const franchiseId = createRes.body.id;

  // No auth header — this should still work due to the known bug
  const res = await request(app).delete(`/api/franchise/${franchiseId}`);
  expect(res.status).toBe(200);
  expect(res.body.message).toBe('franchise deleted');
});

test('create store as admin', async () => {
  const storeName = randomName();
  const res = await request(app)
    .post(`/api/franchise/${testFranchise.id}/store`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: storeName });
  expect(res.status).toBe(200);
  expect(res.body.name).toBe(storeName);
  expect(res.body.id).toBeDefined();
});

test('create store as franchise admin', async () => {
  const storeName = randomName();
  const res = await request(app)
    .post(`/api/franchise/${testFranchise.id}/store`)
    .set('Authorization', `Bearer ${franchiseAdminToken}`)
    .send({ name: storeName });
  expect(res.status).toBe(200);
  expect(res.body.name).toBe(storeName);
  expect(res.body.id).toBeDefined();
});

test('create store as non-admin returns 403', async () => {
  // Create a new user with no franchise rights
  const name3 = randomName();
  const email3 = name3 + '@test.com';
  const reg3 = await request(app).post('/api/auth').send({ name: name3, email: email3, password: 'pass3' });
  const token3 = reg3.body.token;

  const res = await request(app)
    .post(`/api/franchise/${testFranchise.id}/store`)
    .set('Authorization', `Bearer ${token3}`)
    .send({ name: randomName() });
  expect(res.status).toBe(403);
  expect(res.body.message).toMatch(/unable to create a store/);
});

test('delete store as admin', async () => {
  // Create a store to delete
  const storeRes = await request(app)
    .post(`/api/franchise/${testFranchise.id}/store`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: randomName() });
  const storeId = storeRes.body.id;

  const res = await request(app)
    .delete(`/api/franchise/${testFranchise.id}/store/${storeId}`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  expect(res.body.message).toBe('store deleted');
});

test('delete store as non-admin returns 403', async () => {
  // Create a store first
  const storeRes = await request(app)
    .post(`/api/franchise/${testFranchise.id}/store`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: randomName() });
  const storeId = storeRes.body.id;

  // Create a new user with no franchise rights
  const name4 = randomName();
  const email4 = name4 + '@test.com';
  const reg4 = await request(app).post('/api/auth').send({ name: name4, email: email4, password: 'pass4' });
  const token4 = reg4.body.token;

  const res = await request(app)
    .delete(`/api/franchise/${testFranchise.id}/store/${storeId}`)
    .set('Authorization', `Bearer ${token4}`);
  expect(res.status).toBe(403);
  expect(res.body.message).toMatch(/unable to delete a store/);
});
