/*! Foody Auth Patch v2 (2025-08-18)
 *  Auto-add show/hide eye to password fields on login/register/change-password.
 *  Works in static pages and SPA (MutationObserver).
 */
(function(){
  'use strict';

  const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 5c5.05 0 9.27 3.11 10.98 7.5C21.27 16.89 17.05 20 12 20S2.73 16.89 1.02 12.5C2.73 8.11 6.95 5 12 5Zm0 2C7.86 7 4.39 9.44 3 12.5 4.39 15.56 7.86 18 12 18s7.61-2.44 9-5.5C19.61 9.44 16.14 7 12 7Zm0 2.5a3.5 3.5 0 1 1 0 7a3.5 3.5 0 0 1 0-7Z"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3.28 2.22 21.78 20.7l-1.06 1.06-3.06-3.06A12.4 12.4 0 0 1 12 20C6.95 20 2.73 16.89 1.02 12.5c.83-2.06 2.34-3.85 4.24-5.15L2.22 3.28 3.28 2.22Zm6.2 6.2 1.5 1.5a3.5 3.5 0 0 1 4.1 4.1l1.5 1.5a5 5 0 0 0-7.1-7.1ZM12 7c4.14 0 7.61 2.44 9 5.5c-.64 1.5-1.64 2.83-2.87 3.9l-1.43-1.42A7.36 7.36 0 0 0 19 12.5C17.61 9.44 14.14 7 10 7c-.35 0-.7.02-1.04.05l-1.6-1.6C8.34 7.16 10.15 7 12 7Z"/></svg>';

  function enhance(input){
    if (!input || input.dataset.pwReady) return;
    const name = (input.name || "").toLowerCase();
    const id = (input.id || "").toLowerCase();
    const isPw = input.type === "password" || /password/.test(name) || /password/.test(id);
    if (!isPw) return;

    input.dataset.pwReady = "1";

    const wrap = document.createElement('span');
    wrap.className = 'pw-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-eye';
    btn.setAttribute('aria-label','Показать пароль');
    btn.setAttribute('title','Показать пароль');
    btn.setAttribute('aria-pressed','false');
    btn.innerHTML = EYE;
    wrap.appendChild(btn);

    btn.addEventListener('click', ()=>{
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', show ? 'true' : 'false');
      btn.setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
      btn.setAttribute('title', show ? 'Скрыть пароль' : 'Показать пароль');
      btn.innerHTML = show ? EYE_OFF : EYE;
      try{ input.focus({preventScroll:true}); input.selectionStart = input.selectionEnd = input.value.length; }catch{}
    });
  }

  function scan(root){
    root.querySelectorAll('input[type="password"], input[name*="password" i]').forEach(enhance);
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ()=>scan(document));
  } else {
    scan(document);
  }

  const obs = new MutationObserver((muts)=>{
    for(const m of muts){
      for(const node of m.addedNodes){
        if (!(node instanceof Element)) continue;
        if (node.matches && (node.matches('input[type="password"]') || node.matches('input[name*="password" i]'))) enhance(node);
        node.querySelectorAll && scan(node);
      }
    }
  });
  try{ obs.observe(document.body, {childList:true, subtree:true}); }catch{}

  window.foodyPwEnable = () => scan(document);
})();