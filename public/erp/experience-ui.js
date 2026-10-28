'use strict';

// Shortcuts and navigation are client-side presentation; no record writes here.
(() => {
  const sidebarEl=document.getElementById('sidebar');
  const menuButton=document.querySelector('[data-action="menu"]');
  const scrim=document.getElementById('nav-scrim');
  const appContent=document.querySelector('.app-content');
  let navFocusReturn=null;
  function mobile(){return window.matchMedia('(max-width:740px)').matches;}
  function syncMenu(){
    const open=mobile()&&sidebarEl.classList.contains('open');
    scrim.hidden=!open;
    menuButton.setAttribute('aria-expanded',String(open));
    appContent.inert=open;
    document.body.classList.toggle('mobile-nav-open',open);
    sidebarEl.inert=mobile()&&!open;
  }
  function closeMenu(restore=false){
    sidebarEl.classList.remove('open');syncMenu();
    if(restore)(navFocusReturn||menuButton).focus();
  }
  function toggleMenu(){
    if(sidebarEl.classList.contains('open')){closeMenu(true);return;}
    navFocusReturn=document.activeElement;
    sidebarEl.classList.add('open');syncMenu();
    sidebarEl.querySelector('.mobile-menu-close')?.focus();
  }
  const previousRender=render;
  render=function(){
    const scroll=sidebarEl.scrollTop;
    previousRender();
    document.body.dataset.view=view;
    sidebarEl.scrollTop=scroll;
    syncMenu();
  };
  const searchShortcut=document.querySelector('.nav-shortcut');
  if(searchShortcut)searchShortcut.textContent=/Mac/i.test(navigator.platform)?'⌘ K':'Ctrl K';
  document.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.action==='menu'){
      event.preventDefault();event.stopImmediatePropagation();toggleMenu();return;
    }
    if(button.hasAttribute('data-ui-close-menu')){closeMenu(true);return;}
    if(button.hasAttribute('data-ui-market')){
      const name=button.dataset.uiMarket;
      marketFilter=name;c28.orderPage=1;render();
      document.querySelector(`.market-chip[data-ui-market="${CSS.escape(name)}"]`)?.focus({preventScroll:true});
      return;
    }
    if(button.hasAttribute('data-ui-channel')){
      marketFilter=button.dataset.uiChannel;orderQuery='';statusFilter='';c28.orderPage=1;c28.orderFrom='';c28.orderTo='';
      navigate('orders');document.getElementById('main').focus({preventScroll:true});return;
    }
    if(button.dataset.uiCreate){
      button.closest('details')?.removeAttribute('open');
      if(!ERP.ready||ERP.busy){toast('Espera a que termine la operación actual.');return;}
      if(button.dataset.uiCreate==='sale')window.saleFormV28();
      if(button.dataset.uiCreate==='purchase'){navigate('purchases');op28PurchaseForm();}
      if(button.dataset.uiCreate==='expense'){navigate('expenses');op28ExpenseForm();}
    }
  },true);
  document.addEventListener('click',event=>{
    const menu=document.querySelector('.quick-action-menu');
    if(menu?.open&&!menu.contains(event.target))menu.open=false;
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){
      const quick=document.querySelector('.quick-action-menu');if(quick?.open){quick.open=false;quick.querySelector('summary')?.focus();}
      if(sidebarEl.classList.contains('open'))closeMenu(true);
    }
    if(event.key==='Tab'&&mobile()&&sidebarEl.classList.contains('open')){
      const elements=[...sidebarEl.querySelectorAll('a,button,select,input,[tabindex="0"]')].filter(el=>!el.disabled&&!el.hidden&&el.getClientRects().length);
      const first=elements[0],last=elements.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
  });
  window.addEventListener('resize',()=>{if(!mobile())sidebarEl.classList.remove('open');syncMenu();});
  syncMenu();
})();
