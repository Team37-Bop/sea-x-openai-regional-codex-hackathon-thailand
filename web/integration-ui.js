export function el(tag, text, classes) {
  const item = document.createElement(tag);
  if (text != null) item.textContent = text;
  if (classes) item.className = classes;
  return item;
}
export function action(title, handler, classes = 'quiet') {
  const button = el('button', title, classes);
  button.type = 'button';
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    try {
      await handler();
    } finally {
      button.disabled = false;
    }
  });
  return button;
}
export function message(container) {
  const output = el('p', '', 'feedback');
  output.setAttribute('role', 'status');
  container.append(output);
  return output;
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
export function label(title, input) {
  const wrap = el('label', title);
  wrap.append(input);
  return wrap;
}
