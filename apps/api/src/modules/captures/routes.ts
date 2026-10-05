import type { FastifyPluginAsync } from 'fastify';
import { createReadStream } from 'node:fs';
import {
  captureSchema,
  captureSources,
  createCaptureBodySchema,
  deleteCaptureParamsSchema,
  deleteCaptureResponseSchema,
  type Capture,
  type CreateCaptureBody
} from '@anti-void/contracts';
import type { CaptureMedia, CaptureService } from '@anti-void/domain';

interface CaptureParams {
  id: string;
}

interface DeleteCaptureReply {
  deleted: boolean;
}

const audioTypes: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'mp4',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg'
};

function isCaptureSource(value: string): value is (typeof captureSources)[number] {
  return (captureSources as readonly string[]).includes(value);
}

export function captureRoutes(service: CaptureService): FastifyPluginAsync {
  return async function routes(app) {
    app.get<{ Reply: Capture[] }>('/captures', {
      schema: {
        response: {
          200: { type: 'array', items: captureSchema }
        }
      }
    }, async () => service.list());

    app.post<{ Body: CreateCaptureBody; Reply: Capture }>('/captures', {
      schema: {
        body: createCaptureBodySchema,
        response: { 201: captureSchema }
      }
    }, async (request, reply) => {
      const capture = await service.create(request.body);
      return reply.code(201).send(capture);
    });

    app.post<{ Reply: Capture | { message: string } }>('/captures/audio', async (request, reply) => {
      if (!request.isMultipart()) return reply.code(415).send({ message: 'Send this capture as multipart form data.' });

      let text = '';
      let source = 'web';
      let media: CaptureMedia | undefined;

      for await (const part of request.parts()) {
        if (part.type === 'file') {
          if (part.fieldname !== 'audio') {
            await part.toBuffer();
            return reply.code(400).send({ message: 'The audio field is required.' });
          }
          const contentType = part.mimetype.split(';')[0].trim().toLowerCase();
          const extension = audioTypes[contentType];
          if (!extension) {
            await part.toBuffer();
            return reply.code(415).send({ message: 'Use a WebM, MP4, WAV, or Ogg audio recording.' });
          }
          media = { bytes: await part.toBuffer(), contentType, extension };
        } else if (part.fieldname === 'text') {
          text = String(part.value);
        } else if (part.fieldname === 'source') {
          source = String(part.value);
        }
      }

      if (!media) return reply.code(400).send({ message: 'The audio field is required.' });
      if (!text.trim() || text.length > 10_000) return reply.code(400).send({ message: 'A transcript of up to 10,000 characters is required.' });
      if (!isCaptureSource(source)) return reply.code(400).send({ message: 'The capture source is invalid.' });

      const capture = await service.create({ text, source }, media);
      return reply.code(201).send(capture);
    });

    app.get<{ Params: CaptureParams }>('/captures/:id/audio', async (request, reply) => {
      const audio = await service.getAudio(request.params.id);
      if (!audio) return reply.code(404).send({ message: 'Audio not found.' });
      return reply
        .type(audio.contentType)
        .header('Cache-Control', 'private, max-age=3600')
        .send(createReadStream(audio.path));
    });

    app.delete<{ Params: CaptureParams; Reply: DeleteCaptureReply }>('/captures/:id', {
      schema: {
        params: deleteCaptureParamsSchema,
        response: { 200: deleteCaptureResponseSchema }
      }
    }, async (request, reply) => {
      const deleted = await service.delete(request.params.id);
      if (!deleted) return reply.code(404).send({ deleted: false });
      return { deleted: true };
    });
  };
}
