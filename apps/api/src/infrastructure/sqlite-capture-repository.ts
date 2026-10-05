import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { Capture, CaptureSource } from '@anti-void/contracts';
import type { CaptureAudioFile, CaptureMedia, CaptureRepository } from '@anti-void/domain';

interface CaptureRow {
  id: string;
  text: string;
  created_at: string;
  source: string;
  audio_filename: string | null;
  audio_content_type: string | null;
}

const here = path.dirname(fileURLToPath(import.meta.url));

function findWorkspaceRoot(start: string): string {
  let directory = start;
  while (true) {
    if (fs.existsSync(path.join(directory, 'nx.json'))) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) return process.cwd();
    directory = parent;
  }
}

const workspaceRoot = findWorkspaceRoot(here);
const dataDirectory = process.env.ANTI_VOID_DATA_DIR || path.join(workspaceRoot, 'data');
const mediaDirectory = path.join(dataDirectory, 'media');
const databasePath = path.join(dataDirectory, 'anti-void.db');

fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
fs.mkdirSync(mediaDirectory, { recursive: true, mode: 0o700 });
fs.chmodSync(dataDirectory, 0o700);
fs.chmodSync(mediaDirectory, 0o700);

const database = new DatabaseSync(databasePath);
fs.chmodSync(databasePath, 0o600);
database.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS captures (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('web', 'mobile', 'shortcut', 'wearable', 'api')),
    audio_filename TEXT UNIQUE,
    audio_content_type TEXT,
    CHECK ((audio_filename IS NULL) = (audio_content_type IS NULL))
  );
  CREATE INDEX IF NOT EXISTS captures_created_at_idx ON captures(created_at DESC);
  INSERT OR IGNORE INTO schema_migrations (version, applied_at)
    VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
`);

function toCapture(row: CaptureRow): Capture {
  return {
    id: row.id,
    text: row.text,
    createdAt: row.created_at,
    source: row.source as CaptureSource,
    audioUrl: row.audio_filename ? `/v1/captures/${encodeURIComponent(row.id)}/audio` : null
  };
}

function audioFilePath(filename: string): string | null {
  if (path.basename(filename) !== filename) return null;
  return path.join(mediaDirectory, filename);
}

export class SqliteCaptureRepository implements CaptureRepository {
  async list(): Promise<Capture[]> {
    const rows = database.prepare(`
      SELECT id, text, created_at, source, audio_filename, audio_content_type
      FROM captures ORDER BY created_at DESC
    `).all() as unknown as CaptureRow[];
    return rows.map(toCapture);
  }

  async create(capture: Capture, media?: CaptureMedia): Promise<void> {
    const filename = media ? `${capture.id}.${media.extension}` : null;
    const filePath = filename ? audioFilePath(filename) : null;

    if (media && filePath) {
      await fsp.writeFile(filePath, media.bytes, { flag: 'wx', mode: 0o600 });
    }

    try {
      database.prepare(`
        INSERT INTO captures (id, text, created_at, source, audio_filename, audio_content_type)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(capture.id, capture.text, capture.createdAt, capture.source, filename, media?.contentType ?? null);
    } catch (error) {
      if (filePath) await fsp.rm(filePath, { force: true });
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    const row = database.prepare('SELECT audio_filename FROM captures WHERE id = ?').get(id) as { audio_filename: string | null } | undefined;
    if (!row) return false;
    database.prepare('DELETE FROM captures WHERE id = ?').run(id);
    if (row.audio_filename) {
      const filePath = audioFilePath(row.audio_filename);
      if (filePath) await fsp.rm(filePath, { force: true });
    }
    return true;
  }

  async getAudio(id: string): Promise<CaptureAudioFile | null> {
    const row = database.prepare('SELECT audio_filename, audio_content_type FROM captures WHERE id = ?').get(id) as {
      audio_filename: string | null;
      audio_content_type: string | null;
    } | undefined;
    if (!row?.audio_filename || !row.audio_content_type) return null;
    const filePath = audioFilePath(row.audio_filename);
    if (!filePath) return null;
    return { path: filePath, contentType: row.audio_content_type };
  }
}
