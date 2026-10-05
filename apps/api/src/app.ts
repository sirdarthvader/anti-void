import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { CaptureService } from '@anti-void/domain';
import { SqliteCaptureRepository } from './infrastructure/sqlite-capture-repository.js';
import { captureRoutes } from './modules/captures/routes.js';

export function createApp() {
  const app = Fastify({ logger: true, bodyLimit: 21 * 1024 * 1024 });
  const repository = new SqliteCaptureRepository();
  const captures = new CaptureService(repository, randomUUID);

  app.register(multipart, { limits: { files: 1, fields: 2, parts: 3, fileSize: 20 * 1024 * 1024 } });
  app.get('/health', async () => ({ status: 'ok' }));
  app.register(captureRoutes(captures), { prefix: '/v1' });

  return app;
}
