const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { app, server } = require('../src/index');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  
  // Connect Mongoose to the memory server
  await mongoose.connect(uri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
  server.close();
});

beforeEach(async () => {
  // Clear collections before each test
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    const collection = collections[key];
    await collection.deleteMany();
  }
});

describe('Auth API', () => {
  describe('POST /api/auth/register', () => {
    it('should register a new user successfully', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'testuser',
          password: 'Password123!',
        });

      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveProperty('message', 'Registration successful.');
      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
      expect(res.body.user).toHaveProperty('username', 'testuser');
    });

    it('should return error if username already exists', async () => {
      // Create first user
      await request(app).post('/api/auth/register').send({
        username: 'duplicateuser',
        password: 'Password123!',
      });

      // Try creating again
      const res = await request(app).post('/api/auth/register').send({
        username: 'duplicateuser',
        password: 'Password123!',
      });

      expect(res.statusCode).toBe(409);
      expect(res.body).toHaveProperty('error', 'Username already taken.');
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await request(app).post('/api/auth/register').send({
        username: 'loginuser',
        password: 'Password123!',
      });
    });

    it('should login with correct credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'loginuser',
          password: 'Password123!',
        });

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
      expect(res.body.user).toHaveProperty('username', 'loginuser');
    });

    it('should fail with incorrect password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'loginuser',
          password: 'WrongPassword!',
        });

      expect(res.statusCode).toBe(401);
      expect(res.body).toHaveProperty('error', 'Invalid credentials.');
    });
  });
});
