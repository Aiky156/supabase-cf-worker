/**
 * Cloudflare Worker Reverse Proxy for Supabase (纯粹专注版)
 *
 * 专注于将所有流量稳定转发至指定的 Supabase 数据库
 * 原生支持 REST、Auth、Storage、WebSocket (Realtime) 及全自动 CORS。
 */

// 默认上游目标
const DEFAULT_UPSTREAM = 'nqrsydzsyowmrdqsclzj.supabase.co';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. 探活与状态检查
    if (url.pathname === '/' || url.pathname === '/health') {
      const target = env?.TARGET_HOST || DEFAULT_UPSTREAM;
      return new Response(
        JSON.stringify(
          {
            status: 'ok',
            service: 'supabase-proxy',
            target: target,
            colo: request.cf?.colo || 'unknown',
            client_ip: request.headers.get('cf-connecting-ip') || 'unknown',
            time: new Date().toISOString(),
          },
          null,
          2
        ),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // 2. 浏览器 CORS 跨域预检处理
    if (request.method === 'OPTIONS') {
      const origin = request.headers.get('Origin') || '*';
      const reqHeaders = request.headers.get('Access-Control-Request-Headers') || '*';
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
          'Access-Control-Allow-Headers': reqHeaders,
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // 3. 构建目标上游地址
    const targetHost = env?.TARGET_HOST || DEFAULT_UPSTREAM;
    const targetUrl = new URL(url.pathname + url.search, `https://${targetHost}`);

    // 4. 请求头清洗与伪装
    const forwardHeaders = new Headers(request.headers);
    forwardHeaders.set('host', targetHost);
    forwardHeaders.delete('x-forwarded-host');
    forwardHeaders.delete('x-forwarded-proto');

    // 5. WebSocket 协议透传 (Supabase Realtime)
    if (request.headers.get('Upgrade') === 'websocket') {
      return fetch(targetUrl.toString(), {
        method: request.method,
        headers: forwardHeaders,
      });
    }

    const init = {
      method: request.method,
      headers: forwardHeaders,
      redirect: 'manual',
    };

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
    }

    // 6. 执行转发
    try {
      const upstreamRes = await fetch(targetUrl.toString(), init);

      const responseHeaders = new Headers(upstreamRes.headers);

      // 附加 CORS 头支持直接调用
      const origin = request.headers.get('Origin');
      if (origin) {
        responseHeaders.set('Access-Control-Allow-Origin', origin);
        responseHeaders.set('Access-Control-Allow-Credentials', 'true');
      } else {
        responseHeaders.set('Access-Control-Allow-Origin', '*');
      }
      responseHeaders.set('Access-Control-Expose-Headers', '*');

      responseHeaders.set('x-proxied-by', 'supabase-cf-worker');
      responseHeaders.set('x-proxied-target', targetHost);

      return new Response(upstreamRes.body, {
        status: upstreamRes.status,
        statusText: upstreamRes.statusText,
        headers: responseHeaders,
      });
    } catch (err) {
      return new Response(
        JSON.stringify(
          {
            error: `Supabase Proxy Error: ${err.message}`,
            target: targetHost,
            time: new Date().toISOString(),
          },
          null,
          2
        ),
        {
          status: 502,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }
  },
};
