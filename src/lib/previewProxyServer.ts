import http, { IncomingMessage, ServerResponse } from 'http';
import type { Socket } from 'net';
import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware';

const PROXY_HOST = '127.0.0.1';
const PREVIEW_CLIENT_SCRIPT_PATH = '/__viba_preview_bridge.js';
const PREVIEW_CLIENT_SCRIPT_VERSION = '1';

const PREVIEW_CLIENT_SCRIPT_TEMPLATE = String.raw`(() => {
  if (window.__vibaPreviewBridgeInstalled) {
    return;
  }

  window.__vibaPreviewBridgeInstalled = true;

  const TARGET_ORIGIN = __VIBA_TARGET_ORIGIN__;

  const toTargetUrl = (value) => {
    if (!TARGET_ORIGIN || typeof TARGET_ORIGIN !== 'string') {
      return value;
    }

    try {
      const parsed = new URL(value, window.location.href);
      const targetOrigin = new URL(TARGET_ORIGIN);

      if (parsed.origin !== window.location.origin) {
        return parsed.toString();
      }

      parsed.protocol = targetOrigin.protocol;
      parsed.host = targetOrigin.host;
      return parsed.toString();
    } catch {
      return value;
    }
  };

  const postLocationChange = () => {
    window.parent.postMessage({
      type: 'viba:preview-location-change',
      url: toTargetUrl(window.location.href),
    }, '*');
  };

  const handleMessage = (event) => {
    const payload = event.data;
    if (!payload || typeof payload !== 'object') {
      return;
    }

    if (payload.type === 'viba:preview-navigation') {
      if (payload.action === 'back') {
        window.history.back();
        return;
      }

      if (payload.action === 'forward') {
        window.history.forward();
        return;
      }

      if (payload.action === 'reload') {
        window.location.reload();
      }
      return;
    }

    if (payload.type === 'viba:preview-location-request') {
      postLocationChange();
    }
  };

  const wrapHistoryMethod = (methodName) => {
    const originalMethod = window.history[methodName];
    if (typeof originalMethod !== 'function') {
      return;
    }

    window.history[methodName] = function (...args) {
      const result = originalMethod.apply(window.history, args);
      postLocationChange();
      return result;
    };
  };

  wrapHistoryMethod('pushState');
  wrapHistoryMethod('replaceState');

  window.addEventListener('message', handleMessage);
  window.addEventListener('popstate', postLocationChange);
  window.addEventListener('hashchange', postLocationChange);

  postLocationChange();
  window.parent.postMessage({ type: 'viba:preview-ready' }, '*');
})();`;

type PreviewProxyState = {
  middleware: ReturnType<typeof createProxyMiddleware<IncomingMessage, ServerResponse>>;
  port: number;
  server: http.Server;
  targetOrigin: string;
};

declare global {
  var __vibaPreviewProxyState: PreviewProxyState | undefined;
}

const buildPreviewClientScript = (targetOrigin: string): string => (
  PREVIEW_CLIENT_SCRIPT_TEMPLATE.replace('__VIBA_TARGET_ORIGIN__', JSON.stringify(targetOrigin))
);

const injectPreviewClientScript = (html: string): string => {
  if (html.includes(PREVIEW_CLIENT_SCRIPT_PATH)) {
    return html;
  }

  const scriptTag = `<script src="${PREVIEW_CLIENT_SCRIPT_PATH}?v=${PREVIEW_CLIENT_SCRIPT_VERSION}"></script>`;
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${scriptTag}</body>`);
  }

  return `${html}${scriptTag}`;
};

const normalizeTargetUrl = (target: string): URL => {
  const parsed = new URL(target);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https preview URLs are supported');
  }

  return parsed;
};

const createPreviewProxyServer = async (targetOrigin: string): Promise<PreviewProxyState> => {
  const middleware = createProxyMiddleware<IncomingMessage, ServerResponse>({
    changeOrigin: true,
    xfwd: true,
    selfHandleResponse: true,
    secure: false,
    target: targetOrigin,
    ws: true,
    on: {
      proxyReq: (proxyReq, request) => {
        const host = request.headers.host;
        if (host) {
          proxyReq.setHeader('x-forwarded-host', host);
          const forwardedPort = host.includes(':') ? host.split(':').at(-1) : undefined;
          if (forwardedPort) {
            proxyReq.setHeader('x-forwarded-port', forwardedPort);
          }
        }

        if (!proxyReq.getHeader('x-forwarded-proto')) {
          proxyReq.setHeader('x-forwarded-proto', 'http');
        }
      },
      proxyRes: responseInterceptor(async (responseBuffer, proxyRes) => {
        const rawContentType = proxyRes.headers['content-type'];
        const contentType = Array.isArray(rawContentType)
          ? rawContentType.join(';')
          : rawContentType || '';

        if (!contentType.toLowerCase().includes('text/html')) {
          return responseBuffer;
        }

        return injectPreviewClientScript(responseBuffer.toString('utf8'));
      }),
      error: (error, _request, response) => {
        if (response instanceof ServerResponse) {
          if (!response.headersSent) {
            response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
          }
          response.end(`Preview proxy error: ${error.message}`);
        }
      },
    },
  });

  const server = http.createServer((request, response) => {
    if (request.url === PREVIEW_CLIENT_SCRIPT_PATH || request.url?.startsWith(`${PREVIEW_CLIENT_SCRIPT_PATH}?`)) {
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'application/javascript; charset=utf-8',
      });
      response.end(buildPreviewClientScript(targetOrigin));
      return;
    }

    middleware(request, response, (error) => {
      if (error) {
        if (!response.headersSent) {
          response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
        }
        response.end(`Preview proxy error: ${String(error)}`);
        return;
      }

      if (!response.headersSent) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      }
      response.end('Preview route not found');
    });
  });

  server.on('upgrade', (request: IncomingMessage, socket: Socket, head: Buffer) => {
    const upgrade = (middleware as { upgrade?: (req: IncomingMessage, socket: Socket, head: Buffer) => void }).upgrade;

    if (!upgrade) {
      socket.destroy();
      return;
    }

    upgrade(request, socket, head);
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, PROXY_HOST, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Preview proxy failed to bind to a TCP port'));
        return;
      }

      resolve(address.port);
    });
  });

  return {
    middleware,
    port,
    server,
    targetOrigin,
  };
};

const closePreviewProxyServer = async (state: PreviewProxyState): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    state.server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
};

export const ensurePreviewProxyServer = async (target: string): Promise<{ proxyBaseUrl: string }> => {
  const normalizedTarget = normalizeTargetUrl(target);
  const targetOrigin = normalizedTarget.origin;

  const activeState = globalThis.__vibaPreviewProxyState;
  if (activeState && activeState.targetOrigin === targetOrigin) {
    return { proxyBaseUrl: `http://${PROXY_HOST}:${activeState.port}` };
  }

  if (activeState) {
    await closePreviewProxyServer(activeState);
    globalThis.__vibaPreviewProxyState = undefined;
  }

  const nextState = await createPreviewProxyServer(targetOrigin);
  globalThis.__vibaPreviewProxyState = nextState;

  return { proxyBaseUrl: `http://${PROXY_HOST}:${nextState.port}` };
};

export const buildPreviewProxyUrl = (proxyBaseUrl: string, target: string): string => {
  const targetUrl = normalizeTargetUrl(target);
  const proxyUrl = new URL(proxyBaseUrl);

  proxyUrl.pathname = targetUrl.pathname || '/';
  proxyUrl.search = targetUrl.search;
  proxyUrl.hash = targetUrl.hash;

  return proxyUrl.toString();
};
