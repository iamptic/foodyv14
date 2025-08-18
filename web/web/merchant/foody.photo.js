
/*! foody.photo.js — initialize FilePond politely (idempotent) */
(function(){
  const onReady=(fn)=>{ if(document.readyState==='complete'||document.readyState==='interactive') setTimeout(fn,0); else document.addEventListener('DOMContentLoaded',fn); };
  onReady(init); window.addEventListener('load', init);

  function init(){
    const field = document.querySelector('#create #offerForm .field, #create form .field');
    const input = document.getElementById('offerImage');
    const hidden= document.getElementById('offerImageUrl');
    if (!input || !hidden) return;

    // reuse existing hint line (no duplicates)
    let hint = field ? field.querySelector('.hint') : null;
    if (!hint && input.parentElement){ hint = document.createElement('p'); hint.className='hint foody-hint'; input.parentElement.appendChild(hint); }
    if (hint && !hint.classList.contains('foody-hint')) hint.classList.add('foody-hint');
    const setHint=(msg,kind)=>{ if(!hint) return; hint.textContent=msg||''; hint.classList.remove('ok','err'); if(kind) hint.classList.add(kind); };

    // Already initialized?
    if (input._foodyPond) return;

    // If FilePond not present — degrade gracefully
    if (typeof window.FilePond === 'undefined'){ setHint('Поддерживаются JPG/PNG/WebP до 5 МБ'); return; }

    // Optional plugins
    try{
      if (typeof window.FilePondPluginImagePreview!=='undefined') FilePond.registerPlugin(FilePondPluginImagePreview);
      if (typeof window.FilePondPluginFileValidateType!=='undefined') FilePond.registerPlugin(FilePondPluginFileValidateType);
      if (typeof window.FilePondPluginFileValidateSize!=='undefined') FilePond.registerPlugin(FilePondPluginFileValidateSize);
      if (typeof window.FilePondPluginImageCrop!=='undefined') FilePond.registerPlugin(FilePondPluginImageCrop);
      if (typeof window.FilePondPluginImageTransform!=='undefined') FilePond.registerPlugin(FilePondPluginImageTransform);
    }catch(_){}

    // Initial file from hidden
    const files = hidden.value ? [{source:hidden.value, options:{type:'local'}}] : [];

    const pond = FilePond.create(input, {
      credits:false, allowMultiple:false, maxFiles:1, files,
      acceptedFileTypes:['image/*'], allowImagePreview:true,
      imagePreviewHeight:180, stylePanelAspectRatio:'1:1',
      imageCropAspectRatio: (typeof window.FilePondPluginImageCrop!=='undefined') ? '1:1' : undefined,
      maxFileSize:'5MB',
      labelIdle:'Перетащите фото или <span class="filepond--label-action">выберите</span>'
    });
    input._foodyPond = pond;

    if (hidden.value) setHint('Фото загружено ✓','ok'); else setHint('Поддерживаются JPG/PNG/WebP до 5 МБ');

    pond.on('addfile', async (err, item)=>{
      if (err){ setHint('Не удалось загрузить файл','err'); return; }
      try{
        setHint('Загружаем…');
        if (typeof window.uploadImage==='function'){
          const url = await window.uploadImage(item.file);
          hidden.value = url || '';
        } else {
          // fallback: keep preview, upload on submit by your existing flow
        }
        setHint(hidden.value ? 'Фото загружено ✓' : 'Файл выбран. Загрузка при сохранении.','ok');
      }catch(e){ console.error(e); hidden.value=''; setHint('Ошибка при загрузке','err'); }
    });
    pond.on('removefile', ()=>{ hidden.value=''; setHint('Фото удалено','err'); });
  }
})();
