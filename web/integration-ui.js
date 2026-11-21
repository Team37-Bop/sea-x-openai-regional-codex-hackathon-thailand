export { publicLineConfig, tripRequest } from './stream.js';

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
export function label(title, input) {
  const wrap = el('label', title);
  wrap.append(input);
  return wrap;
}
