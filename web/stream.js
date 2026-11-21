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
      const { value, done } = await reader.read();
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
