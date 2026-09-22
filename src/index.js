/**
 * Cloudflare Worker Reverse Proxy for Supabase
 *
 * 突破国内 GFW 对 *.supabase.co 的 SNI 阻断 / TCP RST (os error 104)
 * 运行在 Cloudflare 全球边缘网络，支持全量 REST、Auth、Storage 与 WebSocket (Realtime) 转发。
 */

// 默认兜底的 Supabase 项目 ref (当未指定子域名或路径前缀时使用)
const FALLBACK_DEFAULT_REF = 'nqrsydzsyowmrdqsclzj';

// 常见 Supabase 项目 ID 格式为 10~40 位小写字母/数字
const REF_REGEX = /^[a-z0-9_-]{10,40}$/;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. 探活检查与说明界面
    if (url.pathname === '/' || url.pathname === '/health') {
      const defaultRef = env?.DEFAULT_SUPABASE_REF || FALLBACK_DEFAULT_REF;
      return new Response(
        JSON.stringify(
          {
            status: 'ok',
            service: 'supabase-cloudflare-worker-proxy',
            default_target: `${defaultRef}.supabase.co`,
            colo: request.cf?.colo || 'unknown',
            client_ip: request.headers.get('cf-connecting-ip') || 'unknown',
            supported_routing: [
              '1. Path-based: https://<domain>/<project-ref>/rest/v1/...',
              '2. Subdomain-based: https://<project-ref>.<domain>/rest/v1/...',
              '3. Default fallback: https://<domain>/rest/v1/... -> targets default ref',
            ],
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

    // 2. 处理浏览器跨域预检 (CORS Preflight)
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

    // 3. 识别目标 Project Ref
    let projectRef = null;
    let targetPath = url.pathname;

    // 方式 A：从子域名识别 (例如 nqrsydzsyowmrdqsclzj.db.aikeyu.cn)
    const hostParts = url.hostname.split('.');
    if (hostParts.length >= 3 && REF_REGEX.test(hostParts[0])) {
      projectRef = hostParts[0];
    }

    // 方式 B：从路径第一段识别 (例如 /nqrsydzsyowmrdqsclzj/rest/v1/...)
    if (!projectRef) {
      const segments = url.pathname.split('/').filter(Boolean);
      if (segments.length > 0 && REF_REGEX.test(segments[0])) {
        projectRef = segments[0];
        targetPath = '/' + segments.slice(1).join('/');
      }
    }

    // 方式 C：从自定义 Header 识别 (x-supabase-ref)
    if (!projectRef) {
      const headerRef = request.headers.get('x-supabase-ref');
      if (headerRef && REF_REGEX.test(headerRef.trim())) {
        projectRef = headerRef.trim();
      }
    }

    // 方式 D：环境变量或代码保底默认值
    if (!projectRef) {
      projectRef = env?.DEFAULT_SUPABASE_REF || FALLBACK_DEFAULT_REF;
    }

    const targetHost = `${projectRef}.supabase.co`;
    const targetOrigin = `https://${targetHost}`;
    const targetUrl = new URL(targetPath + url.search, targetOrigin);

    // 4. 构建转发请求 Headers
    const forwardHeaders = new Headers(request.headers);
    forwardHeaders.set('host', targetHost);
    forwardHeaders.delete('x-forwarded-host');
    forwardHeaders.delete('x-forwarded-proto');
    forwardHeaders.delete('x-supabase-ref');

    // 5. 支持 WebSocket 升级 (Supabase Realtime)
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

    // 6. 执行上游请求并处理响应
    try {
      const upstreamRes = await fetch(targetUrl.toString(), init);

      const responseHeaders = new Headers(upstreamRes.headers);

      // 附加 CORS 跨域头以支持前端直接调用
      const origin = request.headers.get('Origin');
      if (origin) {
        responseHeaders.set('Access-Control-Allow-Origin', origin);
        responseHeaders.set('Access-Control-Allow-Credentials', 'true');
      } else {
        responseHeaders.set('Access-Control-Allow-Origin', '*');
      }
      responseHeaders.set('Access-Control-Expose-Headers', '*');

      // 附加调试标识
      responseHeaders.set('x-proxied-by', 'cloudflare-worker');
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
            error: `Cloudflare Worker Supabase Proxy Error: ${err.message}`,
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
