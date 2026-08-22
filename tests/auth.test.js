import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { prisma } from '../config/prisma.js';
import app from '../index.js';

const testUser = {
  name: 'Test User',
  email: 'test@example.com',
  password: 'password123',
};

describe('Auth Endpoints', () => {
  let accessToken = '';
  let refreshToken = '';

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: testUser.email } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: testUser.email } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.refreshToken.deleteMany({ where: { user: { email: testUser.email } } });
  });

  it('POST /api/auth/signup - creates new user', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send(testUser)
      .expect(201);

    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe(testUser.email);
    expect(res.body.accessToken).toBeDefined();
    expect(res.headers['set-cookie']).toBeDefined();

    accessToken = res.body.accessToken;
    const cookies = res.headers['set-cookie'];
    refreshToken = cookies.find(c => c.startsWith('refreshToken='))?.split(';')[0].split('=')[1];
  });

  it('POST /api/auth/signup - fails on duplicate email', async () => {
    await request(app)
      .post('/api/auth/signup')
      .send(testUser)
      .expect(409);
  });

  it('POST /api/auth/login - logs in existing user', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: testUser.email, password: testUser.password })
      .expect(200);

    expect(res.body.user).toBeDefined();
    expect(res.body.accessToken).toBeDefined();
    accessToken = res.body.accessToken;
  });

  it('POST /api/auth/login - fails on wrong password', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({ email: testUser.email, password: 'wrongpassword' })
      .expect(401);
  });

  it('GET /api/auth/me - returns current user', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.user.email).toBe(testUser.email);
  });

  it('GET /api/auth/me - fails without token', async () => {
    await request(app)
      .get('/api/auth/me')
      .expect(401);
  });

  it('POST /api/auth/refresh-token - returns new access token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh-token')
      .send({ refreshToken })
      .expect(200);

    expect(res.body.accessToken).toBeDefined();
    expect(res.body.accessToken).not.toBe(accessToken);
    accessToken = res.body.accessToken;
  });

  it('POST /api/auth/logout - revokes refresh token', async () => {
    await request(app)
      .post('/api/auth/logout')
      .send({ refreshToken })
      .expect(200);

    // Try to use revoked token
    await request(app)
      .post('/api/auth/refresh-token')
      .send({ refreshToken })
      .expect(401);
  });
});

describe('Demo OTP Flow', () => {
  it('POST /api/auth/request-otp - works with demo number', async () => {
    const res = await request(app)
      .post('/api/auth/request-otp')
      .send({ virtualNumber: '+91 92345 00110' })
      .expect(200);

    expect(res.body.sent).toBe(true);
  });

  it('POST /api/auth/verify-otp - works with demo OTP', async () => {
    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ virtualNumber: '+91 92345 00110', otp: '123456' })
      .expect(200);

    expect(res.body.user).toBeDefined();
    expect(res.body.accessToken).toBeDefined();
  });
});