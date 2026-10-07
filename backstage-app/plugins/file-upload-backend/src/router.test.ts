import express from 'express';
import { Server } from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ConfigReader } from '@backstage/config';
import { createRouter, RouterOptions } from './router';

describe('artifact operation authorization', () => {
  let server: Server;
  let baseUrl: string;
  let directory: string;
  let groups: string[];

  beforeAll(async () => {
    directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'backstage-artifact-test-'),
    );
    jest.spyOn(os, 'homedir').mockReturnValue(directory);
    const router = await createRouter({
      config: new ConfigReader({}),
      logger: { info: jest.fn() },
      httpAuth: { credentials: async () => ({}) },
      userInfo: { getUserInfo: async () => ({ ownershipEntityRefs: groups }) },
    } as unknown as RouterOptions);
    const app = express().use(router);
    app.use(
      (
        error: Error,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        res
          .status(error.name === 'NotAllowedError' ? 403 : 500)
          .json({ error: error.message });
      },
    );
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('No test server address');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (server)
      await new Promise<void>(resolve => server.close(() => resolve()));
    jest.restoreAllMocks();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  });

  it.each([
    [
      'pedrinho',
      ['artifact-viewers', 'artifact-uploaders'],
      { view: true, download: false, upload: true, delete: false },
    ],
    [
      'zezinho',
      ['artifact-uploaders', 'artifact-deleters'],
      { view: true, download: false, upload: true, delete: true },
    ],
    [
      'deleter only',
      ['artifact-deleters'],
      { view: true, download: false, upload: false, delete: true },
    ],
    [
      'legacy publisher',
      ['artifact-publisher'],
      { view: true, download: true, upload: true, delete: false },
    ],
    [
      'legacy publisher with EKS permissions',
      ['artifact-publisher', 'artifact-viewers', 'eks-deployers', 'eks-destroyers'],
      { view: true, download: true, upload: true, delete: false },
    ],
    [
      'platform admin',
      ['platform-admin'],
      { view: true, download: true, upload: true, delete: true },
    ],
    [
      'EKS deployer',
      ['eks-deployers'],
      { view: false, download: false, upload: false, delete: false },
    ],
    [
      'unknown',
      [],
      { view: false, download: false, upload: false, delete: false },
    ],
  ])(
    'enforces backend operations for %s',
    async (_name, memberships, expected) => {
      groups = (memberships as string[]).map(group => `group:default/${group}`);
      const permissions = await fetch(`${baseUrl}/permissions`);
      expect(await permissions.json()).toMatchObject(expected);
      // Missing inputs produce 400 only after authorization. Denied users must
      // receive 403 before reaching file parsing, disk writes or GitHub calls.
      for (const [operation, method] of [
        ['upload', 'POST'],
        ['delete', 'DELETE'],
        ['download', 'GET'],
      ] as const) {
        const response = await fetch(`${baseUrl}/${operation}`, { method });
        expect(response.status).toBe(expected[operation] ? 400 : 403);
      }
    },
  );
});
