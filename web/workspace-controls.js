// Keep the form footer and planner masthead in step with the underlying form and trip.
export function bindWorkspace(form) {
  function summary() {
    const note = document.querySelector('#setup-summary'),
      count = document.querySelector('#setup-person-count');
    const days = 1 + (Date.parse(form.endDate.value) - Date.parse(form.startDate.value)) / 86400000;
    form.querySelector('#start-plan-label').textContent =
      form.elements.autonomy.value === 'ask' ? 'ดูตัวเลือกจาก Bop' : 'เริ่มวางแผน';
    if (note)
      note.textContent = [form.city.value.trim(), Number.isInteger(days) && days > 0 ? days + ' วัน' : '']
        .filter(Boolean)
        .join(' · ');
    if (count) count.textContent = form.querySelectorAll('#members .member').length + ' คน';
  }
  form.addEventListener('input', summary);
  new MutationObserver(summary).observe(form.querySelector('#members'), { childList: true });
  summary();
}
export function renderPeople(setup, plan) {
  const people = document.querySelector('#poc-people');
  if (!people) return;
  people.replaceChildren();
  for (const member of setup.members || []) {
    const item = document.createElement('span'),
      mark = document.createElement('span');
    const rules = (plan?.checks || []).filter((rule) => rule.memberId === member.id);
    const issue = rules.some((rule) => !rule.pass);
    item.className = 'party-person' + (issue ? ' needs-attention' : '');
    mark.className = 'party-avatar';
    mark.textContent = member.name?.slice(0, 1) || '•';
    mark.setAttribute('aria-hidden', 'true');
    item.append(mark, document.createTextNode(member.name + (issue ? ' · ตรวจเงื่อนไข' : '')));
    item.title = rules.map((r) => (r.pass ? '✓ ' : '! ') + r.label).join(' · ');
    people.append(item);
  }
}
