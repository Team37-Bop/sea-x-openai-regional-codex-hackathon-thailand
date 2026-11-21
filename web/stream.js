function disconnected(message, code, cause) {
  return Object.assign(new Error(message, { cause }), { code });
}

export async function fetchStream(path, options) {
  try {
    return await fetch(path, options);
  } catch (error) {
    if (options?.signal?.aborted) throw options.signal.reason;
    throw disconnected('ติดต่อ Bop ไม่ได้ ตรวจการเชื่อมต่อแล้วลองอีกครั้ง', 'offline', error);
  }
}

export async function readEvents(response, onEvent) {
  if (!response.ok || !response.body) throw new Error('Bop ติดต่อบริการไม่ได้');
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let partial = '';
  function parse(line) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (!event || typeof event !== 'object') return;
    onEvent(event);
    if (event.type === 'error') throw Object.assign(new Error(event.message), { code: event.code });
    if (event.type === 'done') return event;
  }
  try {
    while (true) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        throw disconnected('การเชื่อมต่อกับ Bop ขาดก่อนรับผลครบ ลองอีกครั้งได้', 'cut', error);
      }
      const { value, done } = chunk;
      partial += value || '';
      const lines = partial.split('\n');
      partial = lines.pop();
      if (done) lines.push(partial);
      for (const line of lines) {
        const terminal = parse(line);
        if (terminal) return terminal;
      }
      if (done)
        throw Object.assign(new Error('การเชื่อมต่อขาดก่อนรับแผนครบ ลองอีกครั้งได้'), { code: 'cut' });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export async function tripRequest(path, { method = 'GET', data, token } = {}) {
  const response = await fetch(path, {
    method,
    headers: {
      ...(data != null ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { 'x-bop-trip-token': token } : {}),
    },
    ...(data == null ? {} : { body: JSON.stringify(data) }),
  });
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(result.message || 'Bop ทำรายการไม่สำเร็จ'), { code: result.error });
  return result;
}
let configRequest;
export function publicLineConfig() {
  configRequest ??= tripRequest('/api/config').catch(error => {
    configRequest = undefined;
    throw error;
  });
  return configRequest;
}
