export function finishTrace(list, state = 'done') {
  const current = list.lastElementChild;
  if (current?.dataset.state !== 'active') return;
  current.dataset.state = state;
  current.removeAttribute('aria-current');
}
export function appendTrace(list, text) {
  if (typeof text !== 'string' || !text.trim()) return;
  if (list.lastElementChild?.dataset.state === 'active' && list.lastElementChild.textContent === text) return;
  const following = list.scrollHeight - list.scrollTop - list.clientHeight < 20;
  finishTrace(list);
  const step = document.createElement('li');
  step.dataset.state = 'active';
  step.setAttribute('aria-current', 'step');
  const mark = document.createElement('span');
  mark.className = 'trace-mark';
  mark.setAttribute('aria-hidden', 'true');
  step.append(mark, document.createTextNode(text));
  list.append(step);
  if (following) list.scrollTop = list.scrollHeight;
}
