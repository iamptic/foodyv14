
/*! Foody Bundle JS — 2025-08-17 fix4
 * - Tabs persistence hardened: hash + localStorage, re-assert after load, hashchange/beforeunload hooks
 * - Auth dedupe guard
 * - Create Offer: discount after base, % input, nice select, bestBefore, strict closing from profile with inline hint
 * - FilePond hook (if present)
 */
(function(){
  const onReady=(fn)=>{ if(document.readyState==='complete'||document.readyState==='interactive') setTimeout(fn,0); else document.addEventListener('DOMContentLoaded',fn); };
  onReady(()=>{ bindTabs(); dedupeAuth(); enhanceCreateOffer(); });

  /* ---------- Tabs with persistence (hardened) ---------- */
  function bindTabs(){
    const panes=[...document.querySelectorAll('.pane')];
    const tabs=[...document.querySelectorAll('#tabs [data-tab], .bottom-nav [data-tab]')];
    if(!panes.length||!tabs.length) return;

    let current = null, applying=false;

    function activate(name, opts){
      if (!name || !document.getElementById(name)) return;
      current=name; applying=true;
      panes.forEach(p=>p.classList.toggle('active', p.id===name));
      tabs.forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
      if (!opts || !opts.silentHash) { try{ history.replaceState(null,'','#'+name);}catch(_){} }
      try{ localStorage.setItem('foody:lastTab', name);}catch(_){}
      applying=false;
    }

    // clicks
    tabs.forEach(b=> b.addEventListener('click',()=>{ const name=b.dataset.tab; activate(name); }));

    // restore
    const fromHash=(location.hash||'').replace('#','');
    const saved=(function(){ try{ return localStorage.getItem('foody:lastTab'); }catch(_){ return null; } })();
    if (fromHash && document.getElementById(fromHash)) activate(fromHash, {silentHash:true});
    else if (saved && document.getElementById(saved)) activate(saved, {silentHash:true});
    else { const first=(document.querySelector('#tabs .seg-btn.active')||tabs[0]); activate((first&&first.dataset.tab)||'dashboard', {silentHash:true}); }

    // re-assert after other scripts
    setTimeout(()=> current && activate(current, {silentHash:true}), 0);
    setTimeout(()=> current && activate(current, {silentHash:true}), 200);

    // hashchange
    window.addEventListener('hashchange', ()=>{
      if (applying) return;
      const name=(location.hash||'').replace('#','');
      if (name && document.getElementById(name)) activate(name, {silentHash:true});
    });

    // beforeunload save
    window.addEventListener('beforeunload', ()=>{ try{ localStorage.setItem('foody:lastTab', current || 'dashboard'); }catch(_){}});
  }

  /* ---------- Remove auth duplicates ---------- */
  function dedupeAuth(){
    const auth=document.getElementById('auth'); if(!auth) return;
    const isAuth=el=> el&&el.querySelector && !!(el.querySelector('#loginForm,#registerForm,.auth-switch'));
    function cleanup(scope){ const root=scope||document;
      root.querySelectorAll('.card').forEach(c=>{ if(isAuth(c)&&!auth.contains(c)) c.remove(); });
      root.querySelectorAll('#loginForm,#registerForm,.auth-switch').forEach(n=>{ if(!auth.contains(n)){ const c=n.closest('.card'); (c||n).remove(); } });
    }
    cleanup(document);
    const mo=new MutationObserver(m=> m.forEach(x=> x.addedNodes && x.addedNodes.forEach(n=>{ if(n.nodeType===1) cleanup(n); })));
    mo.observe(document.body,{childList:true,subtree:true});
  }

  /* ---------- Create Offer UX ---------- */
  function enhanceCreateOffer(){
    const pane=document.getElementById('create'); if(!pane) return;
    const form=pane.querySelector('#offerForm')||pane.querySelector('form'); if(!form) return;

    const base = form.querySelector('#offerOldPrice,[name="original_price"]'); // базовая (до скидки)
    const final = form.querySelector('#offerPrice,[name="price"]');            // итоговая (продажа)
    const qty   = form.querySelector('[name="qty_total"]');
    const expires = form.querySelector('#expires_at,[name="expires_at"]');
    const chipsWrap = form.querySelector('#discountPresets');
    const expireWrap = form.querySelector('#expirePresets');
    const category = form.querySelector('select[name="category"]');
    const errorBox = form.querySelector('#offerError');

    // nice select
    if (category && !category.classList.contains('nice-select')) category.classList.add('nice-select');

    // move discount chips right after base price
    if (base && chipsWrap){
      const baseBox = base.closest('label') || base.parentElement;
      if (baseBox && baseBox.parentElement) baseBox.parentElement.insertBefore(chipsWrap, baseBox.nextSibling);
    }

    // ensure discount% input after chips
    let disc = form.querySelector('#discountPercent');
    if (!disc){
      const row = document.createElement('div');
      row.className='full';
      row.innerHTML='<label for="discountPercent">Скидка, %</label> <input id="discountPercent" type="number" min="0" max="99" step="1" inputmode="numeric" placeholder="например, 50" style="width:120px">';
      if (chipsWrap && chipsWrap.parentElement) chipsWrap.parentElement.insertBefore(row, chipsWrap.nextSibling);
      else form.appendChild(row);
      disc = row.querySelector('#discountPercent');
    }

    // rename "expires" label
    if (expires){ const lbl=expires.closest('label'); if (lbl) setLabelText(lbl, 'Срок действия оффера'); }

    // ensure bestBefore before expires
    let bestBefore=form.querySelector('#bestBefore');
    if (!bestBefore && expires){
      const label=document.createElement('label'); label.className='full';
      label.innerHTML='Срок годности продукта <input id="bestBefore" type="datetime-local" placeholder="до какого времени продукт ок"><div class="muted small">Поле не отправляется на сервер — только контроль.</div>';
      const expLabel=expires.closest('label')||expires.parentElement;
      if (expLabel && expLabel.parentElement) expLabel.parentElement.insertBefore(label, expLabel);
      bestBefore=label.querySelector('#bestBefore');
    }

    // inline hint holder (for closing time help)
    let closingHint = form.querySelector('#closingHint');
    if (!closingHint){
      closingHint = document.createElement('div');
      closingHint.id='closingHint'; closingHint.className='foody-hint full'; closingHint.style.display='none';
      (expireWrap && expireWrap.parentElement ? expireWrap.parentElement : form).appendChild(closingHint);
    }

    // default strictly by profile
    if (expires && !expires.value){
      const close = computeStrictClosingTime();
      if (close) { expires.value = toLocalInputValue(close); closingHint.style.display='none'; }
      else { showClosingHelp(); }
    }

    // chip events
    const discountChips = Array.from(form.querySelectorAll('#discountPresets .chip'));
    discountChips.forEach(ch=> ch.addEventListener('click', e=>{
      e.preventDefault(); const d=parseInt(ch.dataset.discount,10);
      if (!isFinite(d)) return; disc && (disc.value=String(d)); activateChip(discountChips, ch); recalcFromDiscount();
    }));

    const expireChips = Array.from(expireWrap ? expireWrap.querySelectorAll('.chip') : []);
    expireChips.forEach(ch=> ch.addEventListener('click', e=>{
      e.preventDefault();
      const action = ch.dataset.action || ch.dataset.exp;
      const now = new Date(); let t=null;
      if (action==='close'){
        const c = computeStrictClosingTime();
        if (!c) return showClosingHelp();
        t = c;
      } else if (/^\+\d+$/.test(action)){
        t = new Date(now.getTime() + parseInt(action,10)*60*1000);
      }
      if (t && expires){ expires.value = toLocalInputValue(t); activateChip(expireChips, ch); clearError(); closingHint.style.display='none'; guardDates(); }
    }));

    // sync + summary + guards
    let lock=false, lastChanged='discount';
    disc && ['input','change'].forEach(ev=> disc.addEventListener(ev, ()=>{ lastChanged='discount'; recalcFromDiscount(); }));
    final && ['input','change'].forEach(ev=> final.addEventListener(ev, ()=>{ lastChanged='final'; recalcFromFinal(); }));
    base && ['input','change'].forEach(ev=> base.addEventListener(ev, ()=>{ lastChanged==='final'? recalcFromFinal():recalcFromDiscount(); }));
    qty && ['input','change'].forEach(ev=> qty.addEventListener(ev, updateSummary));
    bestBefore && ['change','blur'].forEach(ev=> bestBefore.addEventListener(ev, guardDates));
    expires && ['change','blur'].forEach(ev=> expires.addEventListener(ev, guardDates));

    let summary=form.querySelector('#foodySummary');
    if (!summary){ summary=document.createElement('div'); summary.id='foodySummary'; summary.className='foody-summary full'; (form.querySelector('.form-footer')||form).before(summary); }

    form.addEventListener('submit', e=>{ clearError(); if(!validate()) { e.preventDefault(); return false; } });

    recalcFromDiscount(); updateSummary(); guardDates();

    // FilePond hook
    try{
      const input=document.getElementById('offerImage'), hidden=document.getElementById('offerImageUrl');
      if (input && hidden && typeof FilePond !== 'undefined'){
        if (typeof FilePondPluginImagePreview !== 'undefined') FilePond.registerPlugin(FilePondPluginImagePreview);
        if (typeof FilePondPluginFileValidateType !== 'undefined') FilePond.registerPlugin(FilePondPluginFileValidateType);
        if (typeof FilePondPluginFileValidateSize !== 'undefined') FilePond.registerPlugin(FilePondPluginFileValidateSize);
        const pond = FilePond.create(input, {
          credits:false, allowMultiple:false, maxFiles:1,
          acceptedFileTypes:['image/*'], allowImagePreview:true, imagePreviewHeight:140, stylePanelAspectRatio:'1:1',
          labelIdle:'Перетащите фото или <span class="filepond--label-action">выберите</span>', maxFileSize:'5MB'
        });
        pond.on('addfile', async (err, item) => { if (err) return; try{ hidden.value=(await uploadImage(item.file))||''; }catch(_){ hidden.value=''; } });
        pond.on('removefile', ()=> hidden.value='' );
      }
    }catch(_){}

    // ---- helpers ----
    function showClosingHelp(){
      closingHint.innerHTML = 'Чтобы использовать «До закрытия», заполните время работы в профиле (поле <b>до</b>). <a id="goProfile">Перейти в профиль</a>';
      closingHint.style.display = '';
      const link=document.getElementById('goProfile');
      if (link){ link.addEventListener('click', (e)=>{ e.preventDefault(); try{ location.hash='#profile'; }catch(_){ } }); }
    }

    function recalcFromDiscount(){
      if (lock) return; if (!base || !final) return; lock=true;
      const b=money(base.value); const d=disc?parseInt(disc.value,10):NaN;
      if (isFinite(b) && isFinite(d)){ final.value = moneyFmt(b*(1 - clamp(d,0,99.9)/100), 1); markChipByValue(discountChips, d); }
      lock=false; updateSummary();
    }
    function recalcFromFinal(){
      if (lock) return; if (!base || !final || !disc) return; lock=true;
      const b=money(base.value), f=money(final.value);
      if (isFinite(b) && isFinite(f) && b>0){ const d=(1 - f/b)*100; disc.value=String(Math.round(clamp(d,0,99.9))); markChipByValue(discountChips, parseInt(disc.value,10)); }
      lock=false; updateSummary();
    }
    function updateSummary(){
      if (!summary) return;
      const b=money(base?.value), f=money(final?.value); const q=parseInt(qty?.value||'0',10)||0;
      const d=(isFinite(b)&&isFinite(f)&&b>0)? Math.round((1 - f/b)*100) : null;
      if (isFinite(f) && q>0){ const total=Math.round(f)*q; const dtxt=d!=null?` (скидка ${d}%)`:''; summary.textContent=`Итог: ${Math.round(f)} ₽ × ${q} шт = ${total} ₽${dtxt}`; }
      else summary.textContent='';
    }
    function guardDates(){
      if (!expires) return true;
      const ea=getDate(expires.value), now=new Date();
      if (!ea || ea.getTime()<=now.getTime()){ showError('«Срок действия оффера» должен быть в будущем.'); return false; }
      if (bestBefore && bestBefore.value){
        const bb=getDate(bestBefore.value);
        if (bb && ea.getTime()>bb.getTime()){
          expires.value=toLocalInputValue(bb);
          showError('«Срок действия оффера» не может быть позже срока годности — поправили автоматически.');
          return false;
        }
      }
      clearError(); return true;
    }
    function validate(){
      const b=money(base?.value), f=money(final?.value), q=parseInt(qty?.value||'0',10)||0;
      if (!isFinite(b)||b<=0) return showError('Проверьте базовую цену.');
      if (!isFinite(f)||f<=0) return showError('Проверьте итоговую цену.');
      if (f>=b) return showError('Итоговая цена должна быть меньше базовой.');
      if (!(q>0)) return showError('Количество должно быть больше нуля.');
      if (!guardDates()) return false;
      return true;
    }

    function computeStrictClosingTime(){
      const to=document.getElementById('profile_work_to');
      const from=document.getElementById('profile_work_from');
      if (!to || !to.value) return null;
      const [toH,toM] = to.value.split(':').map(x=>parseInt(x,10)||0);
      const now=new Date(); const y=now.getFullYear(), m=now.getMonth(), d=now.getDate();
      let candidate=new Date(y,m,d,toH,toM);
      let overnight=false;
      if (from && from.value){
        const [fH,fM]=from.value.split(':').map(x=>parseInt(x,10)||0);
        const fromMin=fH*60+fM, toMin=toH*60+toM, nowMin=now.getHours()*60+now.getMinutes();
        overnight = fromMin > toMin;
        if (overnight){
          if (nowMin <= toMin){ candidate = new Date(y,m,d,toH,toM); }
          else if (nowMin >= fromMin){ candidate = new Date(y,m,d+1,toH,toM); }
          else { candidate = new Date(y,m,d,toH,toM); if (candidate.getTime() <= now.getTime()) candidate = new Date(y,m,d+1,toH,toM); }
          return candidate;
        }
      }
      if (candidate.getTime() <= now.getTime()) candidate = new Date(y,m,d+1,toH,toM);
      return candidate;
    }

    function setLabelText(labelEl, text){
      const nodes = Array.from(labelEl.childNodes);
      if (!nodes.length) { labelEl.textContent = text; return; }
      if (nodes[0].nodeType === 3) { nodes[0].textContent = text + ' '; }
      else { labelEl.insertBefore(document.createTextNode(text + ' '), nodes[0]); }
    }

    // utils
    function activateChip(list, el){ list.forEach(x=>x.classList.remove('active')); el.classList.add('active'); }
    function markChipByValue(list, d){ const el=list.find(x=>parseInt(x.dataset.discount,10)===parseInt(d,10)); if(!el) return list.forEach(x=>x.classList.remove('active')); activateChip(list, el); }
    function money(v){ if(v==null) return NaN; const s=String(v).replace(/\s+/g,'').replace(',','.').replace(/[^\d.]/g,''); return parseFloat(s); }
    function clamp(n,min,max){ return Math.min(max, Math.max(min,n)); }
    function getDate(val){ if(!val) return null; if(/^\d{4}-\d{2}-\d{2}$/.test(val)) return new Date(val+'T23:59:00'); const d=new Date(val); return isNaN(d)?null:d; }
    function toLocalInputValue(d){ const y=d.getFullYear(),M=String(d.getMonth()+1).padStart(2,'0'),D=String(d.getDate()).padStart(2,'0'),h=String(d.getHours()).padStart(2,'0'),mi=String(d.getMinutes()).padStart(2,'0'); return `${y}-${M}-${D}T${h}:${mi}`; }
    function showError(msg){ if(!errorBox) return false; errorBox.textContent=msg; errorBox.classList.remove('hidden'); return false; }
    function clearError(){ if(!errorBox) return; errorBox.textContent=''; errorBox.classList.add('hidden'); }
  }
})();
