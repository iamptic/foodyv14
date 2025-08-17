
/*! Foody Bundle JS — 2025-08-17 (one file)
 *  - Tabs & pane single-active guard
 *  - Auth dedupe guard (remove login/register outside #auth)
 *  - Create Offer enrich: discount% input + sync + rounding + summary + dates + expire chips
 *  - FilePond init hook (if present)
 */
(function(){
  const onReady=(fn)=>{ if (document.readyState==='complete'||document.readyState==='interactive') setTimeout(fn,0); else document.addEventListener('DOMContentLoaded',fn); };
  onReady(init);

  function init(){
    bindTabs();
    dedupeAuth();
    enhanceCreateOffer();
  }

  /* ---------- Tabs single-active ---------- */
  function bindTabs(){
    const panes = Array.from(document.querySelectorAll('.pane'));
    const tabs = Array.from(document.querySelectorAll('#tabs [data-tab], .bottom-nav [data-tab]'));
    if (!panes.length || !tabs.length) return;
    function activate(name){
      panes.forEach(p=>p.classList.toggle('active', p.id===name));
      tabs.forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
      try{ history.replaceState(null,'','#'+name);}catch(_){}
    }
    tabs.forEach(b=> b.addEventListener('click',()=>{
      const name=b.dataset.tab; if (name && document.getElementById(name)) activate(name);
    }));
    const actives=panes.filter(p=>p.classList.contains('active'));
    if (actives.length!==1){ const first=(document.querySelector('#tabs .seg-btn.active')||tabs[0]); activate((first&&first.dataset.tab)||'dashboard'); }
  }

  /* ---------- Remove auth card duplicates ---------- */
  function dedupeAuth(){
    const authSection = document.getElementById('auth');
    if (!authSection) return;
    const isAuthCard=(el)=> el && el.querySelector && !!(el.querySelector('#loginForm, #registerForm, .auth-switch'));
    function cleanup(scope){
      const root=scope||document;
      root.querySelectorAll('.card').forEach(card=>{ if (isAuthCard(card) && !authSection.contains(card)) card.remove(); });
      root.querySelectorAll('#loginForm, #registerForm, .auth-switch').forEach(n=>{ if (!authSection.contains(n)){ const c=n.closest('.card'); (c||n).remove(); } });
    }
    cleanup(document);
    const mo=new MutationObserver(muts=>{ muts.forEach(m=> m.addedNodes && m.addedNodes.forEach(n=>{ if (n.nodeType===1) cleanup(n); })); });
    mo.observe(document.body,{childList:true,subtree:true});
  }

  /* ---------- Create Offer enhance ---------- */
  function enhanceCreateOffer(){
    const pane = document.getElementById('create'); if (!pane) return;
    const form = pane.querySelector('#offerForm') || pane.querySelector('form');
    if (!form) return;

    // Fields (existing in your current HTML)
    const base = form.querySelector('#offerOldPrice,[name="original_price"]');
    const final = form.querySelector('#offerPrice,[name="price"]');
    const qty = form.querySelector('[name="qty_total"]');
    const expires = form.querySelector('#expires_at,[name="expires_at"]');
    const chipsWrap = form.querySelector('#discountPresets');
    const expireWrap = form.querySelector('#expirePresets');

    // Add discount% + rounding row if missing
    let disc = form.querySelector('#discountPercent');
    if (!disc){
      const row = document.createElement('div');
      row.className='foody-rounder full';
      row.innerHTML = [
        '<label for="discountPercent">Скидка, %</label>',
        '<input id="discountPercent" type="number" min="0" max="99" step="1" inputmode="numeric" placeholder="например, 50" style="width:100px">',
        '<span class="sep">•</span><span class="lbl">Округлять до:</span>',
        '<label class="radio"><input type="radio" name="foody-round" value="1" checked>1 ₽</label>',
        '<label class="radio"><input type="radio" name="foody-round" value="5">5 ₽</label>'
      ].join(' ');
      (chipsWrap && chipsWrap.parentElement) ? chipsWrap.parentElement.appendChild(row) : form.insertBefore(row, form.firstChild);
      disc = row.querySelector('#discountPercent');
    }
    // Round step
    let roundStep = 1;
    form.querySelectorAll('input[name="foody-round"]').forEach(r=> r.addEventListener('change',()=>{
      roundStep = parseInt(r.value,10)||1;
      lastChanged==='final' ? recalcFromFinal() : recalcFromDiscount();
    }));

    // Ensure +1h/+2h chips exist
    if (expireWrap && !expireWrap.querySelector('[data-exp="+60"]')){
      const c1=document.createElement('span'); c1.className='chip'; c1.dataset.exp='+60'; c1.textContent='+1 час';
      const c2=document.createElement('span'); c2.className='chip'; c2.dataset.exp='+120'; c2.textContent='+2 часа';
      expireWrap.prepend(c2); expireWrap.prepend(c1);
    }

    // Summary
    let summary = form.querySelector('#foodySummary');
    if (!summary){
      summary = document.createElement('div'); summary.id='foodySummary'; summary.className='foody-summary full';
      form.insertBefore(summary, form.querySelector('.form-footer, [type="submit"]').closest('div') || form.lastChild);
    }

    // Discount chips events
    const discountChips = Array.from(form.querySelectorAll('#discountPresets .chip'));
    discountChips.forEach(ch=> ch.addEventListener('click', (e)=>{
      e.preventDefault();
      const d=parseInt(ch.dataset.discount,10);
      if (!isFinite(d)) return;
      disc && (disc.value=String(d));
      activateChip(discountChips, ch);
      recalcFromDiscount();
    }));

    // Sync listeners
    let lock=false, lastChanged='discount';
    disc && ['input','change'].forEach(ev=> disc.addEventListener(ev, ()=>{ lastChanged='discount'; recalcFromDiscount(); }));
    final && ['input','change'].forEach(ev=> final.addEventListener(ev, ()=>{ lastChanged='final'; recalcFromFinal(); }));
    base && ['input','change'].forEach(ev=> base.addEventListener(ev, ()=>{
      lastChanged==='final' ? recalcFromFinal() : recalcFromDiscount();
    }));
    qty && ['input','change'].forEach(ev=> qty.addEventListener(ev, updateSummary));

    // Expire chips
    const expireChips = Array.from(expireWrap ? expireWrap.querySelectorAll('.chip') : []);
    expireChips.forEach(ch => ch.addEventListener('click', (e)=>{
      e.preventDefault();
      const action = ch.dataset.exp;
      const now = new Date();
      let t=null;
      if (action==='close'){ t = computeClosingTime(); }
      else if (/^\+\d+$/.test(action)){ t = new Date(now.getTime() + parseInt(action,10)*60*1000); }
      if (t && expires){ expires.value = toLocalInputValue(t); activateChip(expireChips, ch); }
    }));

    // Default expires: +2h if empty
    if (expires && !expires.value){ const d=new Date(Date.now()+2*60*60*1000); expires.value = toLocalInputValue(d); }

    // FilePond hook (optional)
    try{
      const input=document.getElementById('offerImage'), hidden=document.getElementById('offerImageUrl');
      if (typeof FilePond!=='undefined' && input && hidden){
        const pond=FilePond.create(input,{credits:false,allowMultiple:false,maxFiles:1,acceptedFileTypes:['image/*'],maxFileSize:'5MB'});
        pond.on('addfile', async (err,item)=>{ if(err) return; try{ hidden.value=(await uploadImage(item.file))||''; }catch(_){ hidden.value=''; } });
        pond.on('removefile', ()=> hidden.value='' );
      }
    }catch(_){}

    // Initial compute
    recalcFromDiscount(); updateSummary();

    // ------- helpers -------
    function recalcFromDiscount(){
      if (lock) return; if (!base || !final) return; lock=true;
      const b=money(base.value); const d=disc ? parseInt(disc.value,10) : NaN;
      if (isFinite(b) && isFinite(d)){ final.value = moneyFmt(b*(1 - clamp(d,0,99.9)/100), roundStep); markChipByValue(discountChips, d); }
      lock=false; updateSummary();
    }
    function recalcFromFinal(){
      if (lock) return; if (!base || !final || !disc) return; lock=true;
      const b=money(base.value); const f=money(final.value);
      if (isFinite(b) && isFinite(f) && b>0){ const d=(1 - f/b)*100; disc.value=String(Math.round(clamp(d,0,99.9))); markChipByValue(discountChips, parseInt(disc.value,10)); }
      lock=false; updateSummary();
    }
    function updateSummary(){
      if (!summary) return;
      const b=money(base?.value), f=money(final?.value); const q=parseInt(qty?.value||'0',10)||0;
      const d=(isFinite(b)&&isFinite(f)&&b>0)? Math.round((1 - f/b)*100) : null;
      if (isFinite(f)&&q>0){ const total=Math.round(f)*q; const dtxt=d!=null?` (скидка ${d}%)`:''; summary.textContent=`Итог: ${Math.round(f)} ₽ × ${q} шт = ${total} ₽${dtxt}`; }
      else summary.textContent='';
    }

    function computeClosingTime(){
      const to=document.getElementById('profile_work_to');
      const now=new Date();
      if (to && to.value){ const [hh,mm]=(to.value||'').split(':').map(x=>parseInt(x,10)||0); return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm); }
      return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 22, 0);
    }

    // utils
    function activateChip(list, active){ list.forEach(x=>x.classList.remove('active')); active.classList.add('active'); }
    function markChipByValue(list, d){ const el=list.find(x => parseInt(x.dataset.discount,10)===parseInt(d,10)); if (!el) return list.forEach(x=>x.classList.remove('active')); activateChip(list, el); }
    function money(v){ if (v==null) return NaN; const s=String(v).replace(/\s+/g,'').replace(',','.').replace(/[^\d.]/g,''); return parseFloat(s); }
    function moneyFmt(n, step){ if (!isFinite(n)) return ''; const k=Math.max(1,step||1); return String(Math.round(n/k)*k); }
    function clamp(n,min,max){ return Math.min(max, Math.max(min,n)); }
    function toLocalInputValue(d){ const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), da=String(d.getDate()).padStart(2,'0'), h=String(d.getHours()).padStart(2,'0'), mi=String(d.getMinutes()).padStart(2,'0'); return `${y}-${m}-${da}T${h}:${mi}`; }
    async function uploadImage(file){
      try{ const api=(window.foodyApi||(window.__FOODY__&&window.__FOODY__.FOODY_API)||'').replace(/\/+$/,''); if(!api) return null;
        const fd=new FormData(); fd.append('file', file); const headers={}; const tok=(localStorage.getItem('merchant_token')||localStorage.getItem('token')||'').trim(); if(tok) headers['Authorization']='Bearer '+tok;
        const r=await fetch(api+'/upload',{method:'POST',body:fd,headers}); if(!r.ok) return null; const data=await r.json().catch(()=>({}));
        return data.url || data.location || (data.file&&data.file.url) || (data.result&&data.result.url) || null;
      }catch(_){ return null; }
    }
  }
})();
