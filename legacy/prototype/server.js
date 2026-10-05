import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, 'public');
const dataDir = path.join(here, 'data');
const dataFile = path.join(dataDir, 'thoughts.json');
const port = Number(process.env.PORT || 3000);
fs.mkdirSync(dataDir, { recursive: true });

function readThoughts() {
  try { return JSON.parse(fs.readFileSync(dataFile, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

function writeThoughts(thoughts) {
  const tempFile = `${dataFile}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(thoughts, null, 2), { mode: 0o600 });
  fs.renameSync(tempFile, dataFile);
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; if (body.length > 100_000) reject(new Error('Thought is too long.')); });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (url.pathname === '/api/thoughts' && request.method === 'GET') {
    return sendJson(response, 200, readThoughts().sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }
  if (url.pathname === '/api/thoughts' && request.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(request) || '{}');
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text) return sendJson(response, 400, { error: 'There is no transcript to save yet.' });
      const thought = { id: randomUUID(), text, createdAt: new Date().toISOString(), source: 'web' };
      const thoughts = readThoughts();
      thoughts.push(thought);
      writeThoughts(thoughts);
      return sendJson(response, 201, thought);
    } catch (error) {
      return sendJson(response, error instanceof SyntaxError ? 400 : 413, { error: error.message || 'Could not save this thought.' });
    }
  }
  const deleteMatch = url.pathname.match(/^\/api\/thoughts\/([\w-]+)$/);
  if (deleteMatch && request.method === 'DELETE') {
    const thoughts = readThoughts();
    const next = thoughts.filter(thought => thought.id !== deleteMatch[1]);
    if (next.length === thoughts.length) return sendJson(response, 404, { error: 'Thought not found.' });
    writeThoughts(next);
    return sendJson(response, 200, { deleted: true });
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 404, { error: 'Not found.' });
  const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const filePath = path.resolve(publicDir, requested);
  if (!filePath.startsWith(`${publicDir}${path.sep}`) && filePath !== path.join(publicDir, 'index.html')) {
    response.writeHead(403); return response.end('Forbidden');
  }
  fs.readFile(filePath, (error, content) => {
    if (error) { response.writeHead(404); return response.end('Not found'); }
    response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : content);
  });
});

server.listen(port, '127.0.0.1', () => console.log(`Anti-Void is ready at http://localhost:${port}`));
