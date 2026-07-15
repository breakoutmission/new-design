function byId(id) { return document.getElementById(id); }

function checkScope() {
  const picked = document.querySelector('input[name="scope"]:checked');
  const result = byId('scope-result');
  if (!picked) {
    result.textContent = '请先选择一个方案。';
  } else if (picked.value === 'focused') {
    result.textContent = '正确。这个方案有单一用户、单一任务和可验收闭环，适合零代码经验的第一款产品。';
  } else {
    result.textContent = '这个范围仍然太大。第一版的目标不是证明你能列出功能，而是证明你能完成一个真实任务闭环。';
  }
  result.classList.add('visible');
}

function buildStatement() {
  const user = byId('target-user').value.trim();
  const moment = byId('pain-moment').value.trim();
  const action = byId('core-action').value.trim();
  const outcome = byId('desired-outcome').value.trim();
  const result = byId('statement-result');
  if (![user, moment, action, outcome].every(Boolean)) {
    result.textContent = '还差一点：请填完四个输入框。';
    result.classList.add('visible');
    return;
  }
  const statement = `为${user}提供一个轻量工具：当${moment}时，可以${action}，从而${outcome}。`;
  result.innerHTML = `<strong>你的一句话问题定义：</strong><br>${statement}`;
  result.classList.add('visible');
  localStorage.setItem('finecanvas-problem-statement', statement);
}

document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('finecanvas-problem-statement');
  if (saved && byId('statement-result')) {
    byId('statement-result').innerHTML = `<strong>上次保存的版本：</strong><br>${saved}`;
    byId('statement-result').classList.add('visible');
  }
});

