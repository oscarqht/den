import fs from 'node:fs/promises';
import path from 'node:path';

const EMOJI_DATA_PATH = path.join(
  process.cwd(),
  'node_modules',
  'emoji-picker-element-data',
  'en',
  'emojibase',
  'data.json',
);

const ETAG = '"emoji-picker-element-data-en-emojibase"';

async function readEmojiData(): Promise<string> {
  return fs.readFile(EMOJI_DATA_PATH, 'utf8');
}

function createHeaders() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    ETag: ETAG,
  };
}

export async function HEAD(request: Request) {
  if (request.headers.get('if-none-match') === ETAG) {
    return new Response(null, { status: 304, headers: createHeaders() });
  }

  return new Response(null, { headers: createHeaders() });
}

export async function GET(request: Request) {
  if (request.headers.get('if-none-match') === ETAG) {
    return new Response(null, { status: 304, headers: createHeaders() });
  }

  const emojiData = await readEmojiData();
  return new Response(emojiData, { headers: createHeaders() });
}
