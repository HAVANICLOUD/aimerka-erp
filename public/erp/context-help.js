(function(){
 'use strict';let panel=null,target=null,pinned=false,popover=false;
 function hide(){if(!panel)return;if(popover){try{panel.hidePopover();}catch{}}popover=false;panel.hidden=true;target?.setAttribute('aria-expanded','false');target?.removeAttribute('aria-describedby');target=null;pinned=false;}
 function show(anchor,pin=false){const message=anchor.dataset.taxHelp||anchor.title;if(!message)return;hide();target=anchor;pinned=pin;
 if(!panel){panel=document.createElement('div');panel.id='aimerka-context-help';panel.className='context-help-popover';panel.setAttribute('role','tooltip');panel.setAttribute('popover','manual');const text=document.createElement('p');text.dataset.helpText='';panel.append(text);const close=document.createElement('button');close.type='button';close.className='context-help-close';close.setAttribute('aria-label','Cerrar ayuda');close.textContent='×';close.addEventListener('click',hide);panel.append(close);}
 const root=anchor.closest('dialog[open]')||document.body;if(panel.parentNode!==root)root.append(panel);panel.querySelector('[data-help-text]').textContent=message;panel.hidden=false;
 try{if(panel.showPopover){panel.showPopover();popover=true;}}catch{}
 anchor.setAttribute('aria-expanded','true');anchor.setAttribute('aria-describedby',panel.id);const rect=anchor.getBoundingClientRect(),width=Math.min(330,window.innerWidth-24);panel.style.width=width+'px';panel.style.left=Math.max(12,Math.min(rect.left-16,window.innerWidth-width-12))+'px';const height=panel.getBoundingClientRect().height;panel.style.top=(rect.bottom+10+height>window.innerHeight?Math.max(12,rect.top-height-10):rect.bottom+10)+'px';
 }
 document.addEventListener('mouseover',event=>{const el=event.target.closest?.('[data-tax-help]');if(el&&el!==target)show(el);});
 document.addEventListener('mouseout',event=>{if(!target||pinned)return;const next=event.relatedTarget;if(target.contains(next)||panel?.contains(next))return;if(event.target.closest?.('[data-tax-help]')||panel?.contains(event.target))hide();});
 document.addEventListener('focusin',event=>{const el=event.target.closest?.('[data-tax-help]');if(el)show(el);});
 document.addEventListener('focusout',event=>{if(!pinned&&event.target.closest?.('[data-tax-help]')&&!panel?.contains(event.relatedTarget))hide();});
 document.addEventListener('click',event=>{const el=event.target.closest?.('[data-tax-help]');if(el){event.preventDefault();event.stopPropagation();show(el,true);}else if(panel&&!panel.contains(event.target))hide();});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&target){event.preventDefault();event.stopImmediatePropagation();hide();return;}const el=event.target.closest?.('[data-tax-help]');if(el&&['Enter',' '].includes(event.key)){event.preventDefault();show(el,true);}},true);
 document.addEventListener('scroll',hide,true);window.addEventListener('resize',hide);
})();
