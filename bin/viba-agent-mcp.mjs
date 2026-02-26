#!/usr/bin/env node

import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const SERVER_NAME = 'viba_notify';
const SERVER_VERSION = '1.0.0';
const TOOL_NAME = 'viba_notify_reply_done';
const EVENT_DIR = path.join(os.homedir(), '.viba', 'session-agent-events');

let inputBuffer = Buffer.alloc(0);
let expectedContentLength = null;

function sanitizeSessionName(value) {
  const safe = String(value || '').trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  return safe || 'session';
}

function sendMessage(payload) {
  const body = JSON.stringify(payload);
  const header = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n`;
  process.stdout.write(header + body);
}

function sendError(id, code, message) {
  sendMessage({
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message },
  });
}

async function appendReplyDoneEvent(args) {
  const sessionNameRaw = typeof args?.session_name === 'string'
    ? args.session_name
    : (typeof args?.sessionName === 'string' ? args.sessionName : '');
  const safeSessionName = sanitizeSessionName(sessionNameRaw);
  const eventFilePath = path.join(EVENT_DIR, `${safeSessionName}.jsonl`);
  const now = Date.now();
  const event = {
    sessionName: sessionNameRaw || safeSessionName,
    timestamp: now,
    createdAt: new Date(now).toISOString(),
    source: 'mcp',
    tool: TOOL_NAME,
  };

  await fs.mkdir(EVENT_DIR, { recursive: true });
  await fs.appendFile(eventFilePath, `${JSON.stringify(event)}\n`, 'utf8');

  return event;
}

async function handleRequest(message) {
  const { id, method, params } = message;

  if (method === 'initialize') {
    sendMessage({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
        },
      },
    });
    return;
  }

  if (method === 'notifications/initialized') {
    return;
  }

  if (method === 'ping') {
    sendMessage({
      jsonrpc: '2.0',
      id,
      result: {},
    });
    return;
  }

  if (method === 'tools/list') {
    sendMessage({
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          {
            name: TOOL_NAME,
            description: 'Notify Viba that the agent has finished a reply for a session.',
            inputSchema: {
              type: 'object',
              properties: {
                session_name: {
                  type: 'string',
                  description: 'Viba session identifier.',
                },
              },
              required: ['session_name'],
              additionalProperties: false,
            },
          },
        ],
      },
    });
    return;
  }

  if (method === 'tools/call') {
    if (params?.name !== TOOL_NAME) {
      sendMessage({
        jsonrpc: '2.0',
        id,
        result: {
          isError: true,
          content: [{ type: 'text', text: `Unknown tool: ${String(params?.name || '')}` }],
        },
      });
      return;
    }

    try {
      const args = params?.arguments;
      const sessionName = typeof args?.session_name === 'string' ? args.session_name.trim() : '';
      if (!sessionName) {
        sendMessage({
          jsonrpc: '2.0',
          id,
          result: {
            isError: true,
            content: [{ type: 'text', text: 'session_name is required.' }],
          },
        });
        return;
      }

      const event = await appendReplyDoneEvent(args);
      sendMessage({
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: `Notified Viba for session ${event.sessionName}.`,
            },
          ],
        },
      });
    } catch (error) {
      sendMessage({
        jsonrpc: '2.0',
        id,
        result: {
          isError: true,
          content: [{ type: 'text', text: `Failed to notify Viba: ${error instanceof Error ? error.message : String(error)}` }],
        },
      });
    }
    return;
  }

  if (id !== undefined) {
    sendError(id, -32601, `Method not found: ${method}`);
  }
}

function processIncomingChunk(chunk) {
  const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  inputBuffer = Buffer.concat([inputBuffer, chunkBuffer]);

  while (true) {
    if (expectedContentLength === null) {
      const headerEnd = inputBuffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;

      const rawHeaders = inputBuffer.slice(0, headerEnd).toString('utf8').split('\r\n');
      const contentLengthHeader = rawHeaders.find((line) => line.toLowerCase().startsWith('content-length:'));
      if (!contentLengthHeader) {
        sendError(null, -32700, 'Missing Content-Length header.');
        inputBuffer = Buffer.alloc(0);
        return;
      }

      const rawLength = contentLengthHeader.split(':')[1]?.trim();
      const parsedLength = Number.parseInt(rawLength || '', 10);
      if (!Number.isFinite(parsedLength) || parsedLength < 0) {
        sendError(null, -32700, 'Invalid Content-Length header.');
        inputBuffer = Buffer.alloc(0);
        return;
      }

      expectedContentLength = parsedLength;
      inputBuffer = inputBuffer.slice(headerEnd + 4);
    }

    if (expectedContentLength === null || inputBuffer.length < expectedContentLength) {
      return;
    }

    const messageContent = inputBuffer.slice(0, expectedContentLength).toString('utf8');
    inputBuffer = inputBuffer.slice(expectedContentLength);
    expectedContentLength = null;

    let payload;
    try {
      payload = JSON.parse(messageContent);
    } catch {
      sendError(null, -32700, 'Parse error.');
      continue;
    }

    if (!payload || payload.jsonrpc !== '2.0' || typeof payload.method !== 'string') {
      sendError(payload?.id ?? null, -32600, 'Invalid Request');
      continue;
    }

    void handleRequest(payload);
  }
}

process.stdin.on('data', processIncomingChunk);
process.stdin.on('error', (error) => {
  process.stderr.write(`MCP stdin error: ${error instanceof Error ? error.message : String(error)}\n`);
});
