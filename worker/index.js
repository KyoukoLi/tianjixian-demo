/**
 * 天际线 MiniMax 代理 Worker
 * 将请求转发到 MiniMax API，绕过网络限制
 */

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // 转发到 MiniMax API（去掉 /proxy 前缀）
    const path = url.pathname.replace('/proxy', '');
    const target = 'https://api.minimax.chat' + path;

    const headers = {};
    for (const [k, v] of request.headers) {
      if (k.toLowerCase() !== 'host') {
        headers[k] = v;
      }
    }

    const body = await request.text();

    const response = await fetch(target, {
      method: request.method,
      headers,
      body: body || undefined,
    });

    const newHeaders = {};
    for (const [k, v] of response.headers) {
      if (!['content-encoding', 'transfer-encoding', 'connection'].includes(k.toLowerCase())) {
        newHeaders[k] = v;
      }
    }

    return new Response(response.body, {
      status: response.status,
      headers: newHeaders,
    });
  }
};
