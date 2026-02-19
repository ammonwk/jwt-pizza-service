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

let adminUser, adminToken;
let dinerUser, dinerToken, dinerId;

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
  dinerId = registerRes.body.user.id;
  dinerUser = { name, email, password: 'dinerpass' };
});

test('get current user (GET /api/user/me)', async () => {
  const res = await request(app).get('/api/user/me').set('Authorization', `Bearer ${dinerToken}`);
  expect(res.status).toBe(200);
  expect(res.body.email).toBe(dinerUser.email);
  expect(res.body.id).toBe(dinerId);
});

test('update user (self)', async () => {
  const newName = randomName();
  const res = await request(app)
    .put(`/api/user/${dinerId}`)
    .set('Authorization', `Bearer ${dinerToken}`)
    .send({ name: newName, email: dinerUser.email, password: 'dinerpass' });
  expect(res.status).toBe(200);
  expect(res.body.user.name).toBe(newName);
  expect(res.body.token).toBeDefined();
  // Update our token for future requests
  dinerToken = res.body.token;
  dinerUser.name = newName;
});

test('admin can update another user', async () => {
  const newName = randomName();
  const res = await request(app)
    .put(`/api/user/${dinerId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: newName, email: dinerUser.email, password: 'dinerpass' });
  expect(res.status).toBe(200);
  expect(res.body.user.name).toBe(newName);
  dinerUser.name = newName;
  // Re-login diner to get updated token
  const loginRes = await request(app).put('/api/auth').send({ email: dinerUser.email, password: 'dinerpass' });
  dinerToken = loginRes.body.token;
});

test('non-self non-admin update returns 403', async () => {
  // Create a second diner
  const name2 = randomName();
  const email2 = name2 + '@test.com';
  const reg2 = await request(app).post('/api/auth').send({ name: name2, email: email2, password: 'pass2' });
  const token2 = reg2.body.token;

  const res = await request(app)
    .put(`/api/user/${dinerId}`)
    .set('Authorization', `Bearer ${token2}`)
    .send({ name: 'hacker', email: dinerUser.email, password: 'dinerpass' });
  expect(res.status).toBe(403);
  expect(res.body.message).toBe('unauthorized');
});

test('list users unauthorized (no token)', async () => {
  const res = await request(app).get('/api/user');
  expect(res.status).toBe(401);
});

test('list users forbidden (non-admin)', async () => {
  const res = await request(app)
    .get('/api/user')
    .set('Authorization', `Bearer ${dinerToken}`);
  expect(res.status).toBe(403);
  expect(res.body.message).toBe('unauthorized');
});

test('list users as admin', async () => {
  const res = await request(app)
    .get('/api/user')
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  expect(res.body.users).toBeDefined();
  expect(Array.isArray(res.body.users)).toBe(true);
  expect(res.body.users.length).toBeGreaterThan(0);
  // Check user shape
  const user = res.body.users[0];
  expect(user.id).toBeDefined();
  expect(user.name).toBeDefined();
  expect(user.email).toBeDefined();
  expect(user.roles).toBeDefined();
});

test('list users with pagination', async () => {
  const res = await request(app)
    .get('/api/user?page=0&limit=2')
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  expect(res.body.users.length).toBeLessThanOrEqual(2);
  expect(typeof res.body.more).toBe('boolean');
});

test('list users with name filter', async () => {
  const res = await request(app)
    .get(`/api/user?name=*${dinerUser.name.substring(0, 3)}*`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  expect(res.body.users.length).toBeGreaterThanOrEqual(1);
  expect(res.body.users.some((u) => u.name === dinerUser.name)).toBe(true);
});

test('delete user unauthorized (no token)', async () => {
  const res = await request(app).delete(`/api/user/${dinerId}`);
  expect(res.status).toBe(401);
});

test('delete user forbidden (non-admin)', async () => {
  const res = await request(app)
    .delete(`/api/user/${dinerId}`)
    .set('Authorization', `Bearer ${dinerToken}`);
  expect(res.status).toBe(403);
  expect(res.body.message).toBe('unauthorized');
});

test('admin can delete user', async () => {
  // Create a user to delete
  const name = randomName();
  const email = name + '@test.com';
  const reg = await request(app).post('/api/auth').send({ name, email, password: 'pass' });
  const userId = reg.body.user.id;

  const res = await request(app)
    .delete(`/api/user/${userId}`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  expect(res.body.message).toBe('user deleted');

  // Verify user is gone - login should fail
  const loginRes = await request(app).put('/api/auth').send({ email, password: 'pass' });
  expect(loginRes.status).toBe(404);
});
