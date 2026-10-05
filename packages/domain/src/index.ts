import type { Capture, CreateCaptureBody } from '@anti-void/contracts';

export interface CaptureRepository {
  list(): Promise<Capture[]>;
  create(capture: Capture, media?: CaptureMedia): Promise<void>;
  delete(id: string): Promise<boolean>;
  getAudio(id: string): Promise<CaptureAudioFile | null>;
}

export interface CaptureMedia {
  bytes: Uint8Array;
  contentType: string;
  extension: string;
}

export interface CaptureAudioFile {
  path: string;
  contentType: string;
}

export class CaptureService {
  constructor(
    private readonly repository: CaptureRepository,
    private readonly createId: () => string,
    private readonly now: () => Date = () => new Date()
  ) {}

  async list(): Promise<Capture[]> {
    return this.repository.list();
  }

  async create(input: CreateCaptureBody, media?: CaptureMedia): Promise<Capture> {
    const text = input.text.trim();
    if (!text) throw new Error('A capture needs some text.');
    const id = this.createId();
    const capture: Capture = {
      id,
      text,
      source: input.source,
      createdAt: this.now().toISOString(),
      audioUrl: media ? `/v1/captures/${encodeURIComponent(id)}/audio` : null
    };
    await this.repository.create(capture, media);
    return capture;
  }

  async delete(id: string): Promise<boolean> {
    return this.repository.delete(id);
  }

  async getAudio(id: string): Promise<CaptureAudioFile | null> {
    return this.repository.getAudio(id);
  }
}
