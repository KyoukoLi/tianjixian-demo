/**
 * 天际线 MiniMax 代理 Worker
 * 将请求转发到 MiniMax API，绕过网络限制
 */

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // 完整路径直接转发，去掉 /proxy 前缀
    let targetPath = url.pathname;
    if (targetPath.startsWith('/proxy')) {
      targetPath = targetPath.slice(6); // 去掉 "/proxy"
    }
    if (!targetPath) targetPath = '/';

    const target = 'https://api.minimax.chat' + targetPath;
    const fullUrl = url.search ? target + url.search : target;

    const headers = {};
    for (const [k, v] of request.headers) {
      if (k.toLowerCase() !== 'host') {
        headers[k] = v;
      }
    }

    const body = await request.text();

    const response = await fetch(fullUrl, {
      method: request.method,
      headers,
      body: body || undefined,
    });

    const newHeaders = {};
    for (const [k, v] of response.headers) {
      const kl = k.toLowerCase();
      if (!['content-encoding', 'transfer-encoding', 'connection', 'content-length'].includes(kl)) {
        newHeaders[k] = v;
      }
    }

    return new Response(response.body, {
      status: response.status,
      headers: newHeaders,
    });
  }
};
