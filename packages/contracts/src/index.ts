export const captureSources = ['web', 'mobile', 'shortcut', 'wearable', 'api'] as const;

export type CaptureSource = (typeof captureSources)[number];

export interface Capture {
  id: string;
  text: string;
  createdAt: string;
  source: CaptureSource;
  audioUrl: string | null;
}

export interface CreateCaptureBody {
  text: string;
  source: CaptureSource;
}

export const captureSchema = {
  $id: 'Capture',
  type: 'object',
  additionalProperties: false,
  required: ['id', 'text', 'createdAt', 'source', 'audioUrl'],
  properties: {
    id: { type: 'string' },
    text: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    source: { type: 'string', enum: captureSources },
    audioUrl: { anyOf: [{ type: 'string' }, { type: 'null' }] }
  }
} as const;

export const createCaptureBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'source'],
  properties: {
    text: { type: 'string', minLength: 1, maxLength: 10000 },
    source: { type: 'string', enum: captureSources }
  }
} as const;

export const deleteCaptureParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1 } }
} as const;

export const deleteCaptureResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['deleted'],
  properties: { deleted: { type: 'boolean' } }
} as const;
