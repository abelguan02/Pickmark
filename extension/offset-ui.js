import {I,E,FAV} from './offset-icons.js';
import {shell} from './offset-shell.js';
import {UNGROUPED} from './core.js';
import {getLanguage,workspaceLabel} from './i18n.js';
import {changeBookmarks} from './bookmarks.js';
import {renderBookmarkPanel} from './bookmark-panels.js';
import {organizeBookmarksAI} from './bookmark-ai-workflow.js';
import {groupIcon} from './group-icons.js';
import {brandMark} from './brand-mark.js';
import {mountHeroFlow} from './hero-flow.js';
import {installHelp,openAbout,helpLabels,focusAI} from './help-ui.js';
import {previewAllowed} from './thumbnails.js';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const L=(zh,en)=>getLanguage()==='en'?en:zh;
const titles={workspace:['工作区','Workspace'],review:['每日回顾','Daily review'],history:['继续浏览','Continue browsing'],folders:['原文件夹','Folders'],smart:['智能分类','Collections'],manage:['工作区管理','Workspaces'],rules:['分类规则','Rules'],settings:['设置与隐私','Settings & privacy']};
const descriptions={workspace:['正在打开的标签，按主题归位','Open tabs, organized by topic'],review:['今天的注意力去了哪里','Your browsing time and journey'],history:['找回那天留下的页面，保留已有分类与人工调整','Return to saved pages, with your classifications preserved'],folders:['沿用浏览器里的收藏目录','Your original browser bookmark folders'],smart:['按主题重新整理，不动原目录','Organize by topic, keep original folders'],manage:['新建、重命名你的分类','Manage your workspaces'],rules:['让网址自动落进对应分类','Classify pages with local rules'],settings:['外观、预览与隐私','Appearance, previews and privacy']};
const fav=r=>FAV(r);
const icon=(name,label,attr='')=>`<button type="button" class="tool" aria-label="${E(label)}" title="${E(label)}" ${attr}>${I(name)}</button>`;
export class OffsetUI{
 constructor(api){
  installHelp(()=>{this.rail(false);if(this.panel==='settings'){focusAI();return;}this.pendingAI=true;$('#settings').click();});
  this.api=api;this.mode='tabs';this.bookView='folders';this.panel=null;this.filters={tabs:'',bookmarks:''};this.layouts={tabs:'list',bookmarks:'list'};this.queries={tabs:'',bookmarks:''};this.density='compact';this.book=null;this.selected=null;this.previewEnabled=true;this.autoPreview=false;this.bookLoading=false;this.thumbnails=new Map();this.previewStates=new Map();this.previewToken=0;
  try{const p=JSON.parse(localStorage.getItem('pickmark-view-v1')||'{}');if(['compact','comfortable'].includes(p.density))this.density=p.density;if(['list','gallery'].includes(p.layout))this.layouts.tabs=p.layout;this.previewEnabled=p.preview!==false;if(p.layout==='cards')localStorage.setItem('pickmark-view-v1',JSON.stringify({...p,layout:'list'}));}catch{}
  const main=$('main.atlas'),header=main.querySelector('header');const legacy=document.createElement('div');legacy.hidden=true;legacy.id='mono-legacy';legacy.append(header);document.body.prepend(legacy);
  const root=document.createElement('div');root.innerHTML=shell;root.querySelector('.brand-logo').innerHTML=brandMark;document.body.prepend(...root.childNodes);$('#mono-placeholder').replaceWith(main);main.id='workspace';main.className='workspace atlas';
  const hero=document.createElement('div');hero.id='mono-hero';main.prepend(hero);
  hero.insertAdjacentHTML('afterend','<section id="classification-navigation" hidden></section>');
  hero.insertAdjacentHTML('afterend','<div id="storage-warning" class="help" role="status" hidden><span></span> <button type="button"></button></div>');
  $('#storage-warning button').onclick=()=>$('#settings-shortcut').click();
  hero.insertAdjacentHTML('afterend','<div id="book-ai-progress" class="help" role="status" hidden><span></span><button type="button" data-pm="cancel-book-ai"></button></div>');
  main.insertAdjacentHTML('beforeend','<section id="mono-list" class="stage"><section class="index"></section><aside id="inspector" class="inspector" aria-hidden="true"></aside></section><section id="mono-panel" hidden></section>');
  $('#mono-legacy').append($('#more-menu'));
  for(const id of ['reorganize','workspaces-button','rules-button','refresh'])$('#mono-legacy').append($('#'+id));
  if(!$('#statusbar'))document.body.insertAdjacentHTML('beforeend','<div id="statusbar" class="statusbar" role="status"></div>');
  document.body.insertAdjacentHTML('beforeend','<dialog id="mono-preview"><div class="dialog-heading"><h2></h2><button type="button" data-pm="close-preview" aria-label="Close">×</button></div><div class="mono-preview-body"></div></dialog><dialog id="mono-book-dialog"></dialog><div id="mono-row-menu" popover="auto"></div>');
  $('#mono-preview').addEventListener('close',()=>{if($('#mono-preview').open)return;this.explicitPreview=null;this.clearPreview();});
  $('#search-toolbar').insertAdjacentHTML('beforeend',icon('close',L('关闭搜索','Close search'),'data-pm="search-close"'));
  $('#mono-search-toggle').innerHTML=I('search')+'<span>'+L('查找','Search')+'</span><span class="key mono">⌘ K</span>';
  $('#menu').innerHTML=I('menu');$('#theme').innerHTML=I('moon');$('#settings').innerHTML=I('settings');$('#rail-close').innerHTML=I('close');
  $('#brand').onclick=()=>{this.changeMode('tabs',false);this.navigationId=(this.navigationId||0)+1;this.closePanel();this.filters.tabs='';this.api.home();};$('#menu').onclick=()=>this.rail(true);$('#rail-close').onclick=()=>this.rail(false);$('#rail-overlay').onclick=()=>this.rail(false);
  $('#mono-search-toggle').onclick=()=>$('#search-toggle').click();$('#settings').onclick=()=>this.navigate('settings');
  document.body.insertAdjacentHTML('beforeend','<div id="appearance-menu" popover="auto" role="menu"><button type="button" role="menuitemradio" data-appearance="light"></button><button type="button" role="menuitemradio" data-appearance="dark"></button><button type="button" role="menuitemradio" data-appearance="system"></button></div>');
  const appearanceMenu=$('#appearance-menu'),themeButton=$('#theme');
  themeButton.setAttribute('aria-haspopup','menu');themeButton.setAttribute('aria-controls','appearance-menu');themeButton.setAttribute('aria-expanded','false');
  themeButton.onclick=()=>{
   if(appearanceMenu.matches(':popover-open')){appearanceMenu.hidePopover();return;}
   appearanceMenu.showPopover();const rect=themeButton.getBoundingClientRect();
   appearanceMenu.style.left=Math.max(8,Math.min(innerWidth-appearanceMenu.offsetWidth-8,rect.right-appearanceMenu.offsetWidth))+'px';
   appearanceMenu.style.top=Math.max(8,Math.min(innerHeight-appearanceMenu.offsetHeight-8,rect.bottom+10))+'px';
   appearanceMenu.querySelector('[aria-checked=true]').focus();
  };
  appearanceMenu.addEventListener('toggle',()=>themeButton.setAttribute('aria-expanded',String(appearanceMenu.matches(':popover-open'))));
  appearanceMenu.onclick=event=>{const button=event.target.closest('[data-appearance]');if(!button)return;window.atlasColorMode.set(button.dataset.appearance);appearanceMenu.hidePopover();themeButton.focus();};
  appearanceMenu.onkeydown=event=>{
   event.stopPropagation();const buttons=[...appearanceMenu.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);
   if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus();}
   if(event.key==='Escape'){event.preventDefault();appearanceMenu.hidePopover();themeButton.focus();}
   if(event.key==='Tab'){appearanceMenu.hidePopover();themeButton.focus();}
  };
  window.addEventListener('resize',()=>appearanceMenu.hidePopover());
  window.addEventListener('scroll',()=>appearanceMenu.hidePopover(),{passive:true});
  document.addEventListener('click',event=>{const b=event.target.closest('button');if(!b)return;
   if(b.dataset.mode)this.changeMode(b.dataset.mode);
   if(b.dataset.classificationSource)this.changeMode(b.dataset.classificationSource);
   if(b.dataset.pmView)this.navigate(b.dataset.pmView);
   if(b.hasAttribute('data-pm-filter')){this.filters[this.mode]=b.dataset.pmFilter;this.api.render();this.rail(false);}
   if(b.dataset.pmLayout){this.layouts[this.mode]=b.dataset.pmLayout;this.persist();this.api.render();}
   if(b.dataset.pmDensity){this.density=b.dataset.pmDensity;this.layouts[this.mode]='list';this.persist();this.api.render();}
   if(b.dataset.pm==='organize')this.organize();
   if(b.dataset.pm==='book-ai')this.prepareBookAI();
   if(b.dataset.pm==='cancel-book-ai')this.cancelBookAI();
   if(b.dataset.pm==='refresh')this.refreshCurrent();
   if(b.dataset.pmPage){this.bookPage=Math.max(0,(this.bookPage||0)+Number(b.dataset.pmPage));this.render();$('#mono-list').scrollIntoView({block:'start'});$('#mono-list [data-pm-page="'+b.dataset.pmPage+'"]')?.focus();}
   if(b.dataset.pm==='regroup'&&this.mode==='tabs'&&this.view==='workspace')$('#reorganize').click();
   if(b.dataset.pm==='connect')this.connectBookmarks();
   if(b.dataset.pm==='search-close')$('#search-toggle').click();
   if(b.dataset.pm==='close-preview')$('#mono-preview').close();
   if(b.dataset.pm==='preview-toggle'){this.previewEnabled=!this.previewEnabled;this.persist();b.setAttribute('aria-pressed',this.previewEnabled);b.textContent=this.previewEnabled?L('开启','On'):L('关闭','Off');}
  });
  document.addEventListener('keydown',e=>this.keyboard(e));
  $('#search').addEventListener('input',()=>{if(this.mode==='bookmarks')this.render();});
  $('#day').addEventListener('change',()=>this.clearPreview());
  document.addEventListener('pointermove',e=>{
   const previous=this.previewPointer;
   this.previewPointer=e.pointerType==='mouse'?{x:e.clientX,y:e.clientY}:null;
   if(this.keyboardNavigation&&this.previewPointer&&(!previous||previous.x!==e.clientX||previous.y!==e.clientY)){
    this.keyboardNavigation=false;
    e.target.closest('#mono-list .item,#mono-list .gallery-card')?.previewEnter?.();
   }
  },{passive:true});
  document.documentElement.addEventListener('pointerleave',()=>{this.previewPointer=null;this.clearPreview();});
  window.addEventListener('scroll',()=>{this.dismissMovedActions();this.resumePreviewAfterScroll();document.body.classList.toggle('hero-mini',scrollY>100);},{passive:true});
  window.addEventListener('resize',()=>{this.closeActions();this.clearPreview();if(innerWidth>800)this.rail(false);else this.railAccess();this.alignCategories();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){this.clearPreview();clearTimeout(this.galleryStatusTimer);}else if(this.api.extension)this.refreshPreviews();});
  window.addEventListener('atlas-color-mode-change',()=>this.color());this.color();this.railAccess();
  if(this.api.extension){
   chrome.permissions?.onRemoved?.addListener(p=>{void this.syncAutoPreview();this.refreshPreviews();if(p.permissions?.includes('bookmarks')){this.book=null;if(this.mode==='bookmarks')this.render();}});
   chrome.permissions?.onAdded?.addListener(()=>{void this.syncAutoPreview();this.refreshPreviews();});
   for(const name of ['onCreated','onRemoved','onChanged','onMoved','onChildrenReordered'])chrome.bookmarks?.[name]?.addListener(()=>{if(this.book&&this.mode==='bookmarks')this.refreshBookmarks();});
   chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local')return;if(changes['pickmark-thumbnails-v1'])this.thumbnails.clear();if(changes['pickmark-thumbnails-v1']||changes.config||changes['pickmark-auto-preview-v1'])this.refreshPreviews();if(changes['pickmark-auto-preview-v1'])this.syncAutoPreview();if(changes['pickmark-bookmarks-v1']&&this.book&&this.mode==='bookmarks')this.refreshBookmarks();});
   chrome.runtime.onMessage?.addListener((message,sender)=>{if(sender.id===chrome.runtime.id&&message.type==='preview:changed'&&typeof message.url==='string')this.refreshPreviews(message.url);});
   void this.syncAutoPreview();
  }
 }
 persist(){try{localStorage.setItem('pickmark-view-v1',JSON.stringify({density:this.density,layout:this.layouts.tabs,preview:this.previewEnabled}));}catch{}}
 color(){document.documentElement.classList.toggle('night',document.documentElement.dataset.colorScheme==='dark');this.themeLabels();}
 themeLabels(){
  const mode=window.atlasColorMode.value,labels={light:L('浅色','Light'),dark:L('深色','Dark'),system:L('跟随系统','System')};
  const glyph=value=>value==='system'?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h18v13H3z M8 21h8 M12 17v4"/></svg>':I(value==='light'?'sun':'moon');
  $('#theme').innerHTML=glyph(mode);$('#theme').dataset.appearance=mode;
  $('#theme').title=L('外观：','Appearance: ')+labels[mode];$('#theme').setAttribute('aria-label',$('#theme').title);
  const menu=$('#appearance-menu');if(!menu)return;menu.setAttribute('aria-label',L('外观','Appearance'));
  for(const button of menu.querySelectorAll('button')){const value=button.dataset.appearance;button.setAttribute('aria-checked',String(value===mode));button.innerHTML=glyph(value)+'<span>'+labels[value]+'</span><span class="appearance-check">'+(value===mode?I('check'):'')+'</span>';}
 }
 get view(){return this.panel||(this.mode==='bookmarks'?this.bookView:this.api.view());}
 get allowsAuto(){return this.mode==='tabs'&&!this.panel;}
 filterRows(rows){return this.filters.tabs?rows.filter(r=>r.group===this.filters.tabs):rows;}
 get rows(){if(this.mode==='tabs')return this.api.rows();const q=$('#search').value.toLowerCase().trim(),key=this.bookView==='folders'?'folder':'group';return (this.book?.rows||[]).filter(r=>(!this.filters.bookmarks||r[key]===this.filters.bookmarks)&&(!q||`${r.title} ${r.domain} ${r.group} ${r.folder}`.toLowerCase().includes(q)));}
 railAccess(){$('#rail').inert=innerWidth<=800&&!$('#rail').classList.contains('open');}
 alignCategories(){
  cancelAnimationFrame(this.categoryAlignmentFrame);
  this.categoryAlignmentFrame=requestAnimationFrame(()=>{
   const categories=$('.nav-cats');if(!categories)return;categories.style.marginTop='';
   if(innerWidth<=800||this.panel||this.layouts[this.mode]!=='list')return;
   const first=$('#mono-list .item'),all=$('.nav.cat'),primary=$('.nav-primary');if(!first||!all||!primary)return;
   // Match the unscrolled document position; later page scrolling stays independent.
   const delta=first.getBoundingClientRect().top+scrollY-all.getBoundingClientRect().top;
   const availableGap=Math.max(0,parseFloat(getComputedStyle(primary).marginBottom)-4);
   categories.style.marginTop=Math.max(-availableGap,delta)+'px';
  });
 }
 rail(open){$('#rail').classList.toggle('open',open);$('#rail-overlay').hidden=!open;$('#menu').setAttribute('aria-expanded',open);this.railAccess();if(open)$('#brand').focus();else if(innerWidth<=800)$('#menu').focus();}
 changeMode(mode,keepManagement=true){if(mode===this.mode)return;const management=keepManagement&&['manage','rules'].includes(this.panel)?this.panel:null;this.navigationId=(this.navigationId||0)+1;if(this.bookAIRunning)this.cancelBookAI();this.queries[this.mode]=$('#search').value;this.closePanel();this.mode=mode;$('#search').value=this.queries[mode];this.selected=null;this.clearPreview();this.api.render();if(management)this.navigate(management);if(mode==='bookmarks'&&this.api.extension)this.checkBookmarks();}
 async checkBookmarks(){try{if(await chrome.permissions.contains({permissions:['bookmarks']}))await this.refreshBookmarks();}catch(e){this.api.toast(e.message);}}
 async connectBookmarks(){try{
  if(this.api.extension&&!await chrome.permissions.request({permissions:['bookmarks']}))return;
  if(!this.api.extension&&!this.book)this.book={rows:this.api.state().records.slice(0,16).map((r,i)=>({...r,id:'demo-book-'+i,folder:L('示例书签','Example bookmarks'),folderId:'demo'})),rules:[],groups:[]};
  await this.refreshBookmarks();
 }catch(e){this.api.toast(e.message);}}
 async refreshBookmarks(){if(this.bookLoading)return;this.bookLoading=true;try{if(this.api.extension)this.book=await this.api.send({type:'bookmarks:get'});this.api.render();}catch(e){this.book=null;this.api.toast(e.message);this.render();}finally{this.bookLoading=false;}}
 async refreshCurrent(){try{if(this.mode==='bookmarks'){if(!this.book)return this.connectBookmarks();await this.refreshBookmarks();}else await this.api.refresh();}catch(e){this.api.toast(e.message);}}
 async bookSend(action,payload={}){
  const message={type:'bookmarks:'+action,expectedRevision:this.book?.revision||0,...payload};
  if(this.api.extension)this.book=await this.api.send(message);
  else this.book=changeBookmarks(this.book,message);
  this.render();
 }
 async navigate(view){
  this.navigationId=(this.navigationId||0)+1;
  this.clearPreview();this.rail(false);this.closePanel();
  if(['settings','manage','rules'].includes(view)){
   if(this.mode==='bookmarks'&&view!=='settings'){this.panel=view;this.render();return;}
   const trigger={settings:'settings-shortcut',manage:'workspaces-button',rules:'rules-button'}[view];$('#'+trigger).click();return;
  }
  this.filters[this.mode]='';if(this.mode==='bookmarks'){this.bookView=view;this.render();}else this.api.switchView(view);
  window.scrollTo(0,0);
 }
 openPanel(id,view){this.closePanel();this.panel=view;if(this.mode==='bookmarks'&&view!=='settings'){this.render();return;}const dialog=$('#'+id);dialog.classList.add('mono-page');$('#mono-panel').append(dialog);dialog.show();
  if(id==='settings-dialog')this.settingsExtras(dialog);
  if(!dialog.dataset.monoBound){dialog.dataset.monoBound='true';dialog.addEventListener('close',()=>{if(!dialog.open&&dialog.classList.contains('mono-page')&&this.panel===view){this.panel=null;dialog.classList.remove('mono-page');document.body.append(dialog);this.api.render();}});}
  this.render();window.scrollTo(0,0);if(view==='settings'&&this.pendingAI){this.pendingAI=false;focusAI();}
 }
 closePanel(){const previous=this.panel;this.panel=null;for(const d of $$('#mono-panel dialog.mono-page')){d.close();d.classList.remove('mono-page');document.body.append(d);}$('#mono-panel').replaceChildren();return previous;}
 settingsExtras(dialog){if(!$('#mono-appearance')){
  const block=document.createElement('section');block.id='mono-appearance';block.innerHTML='<h3>'+L('界面与交互','Appearance & interaction')+'</h3>';
  block.append($('.appearance-controls'));block.insertAdjacentHTML('beforeend',`<div class="setting-row"><div><strong>${L('悬停缩略图','Hover previews')}</strong></div><button type="button" class="toggle" data-pm="preview-toggle" aria-pressed="${this.previewEnabled}">${this.previewEnabled?L('开启','On'):L('关闭','Off')}</button></div><div class="setting-row"><div><strong>${L('自动保存网页预览','Automatically save previews')}</strong><p>${L('授权后仅保存当前可见网页；截图只存本机，不发送给 AI。','With permission, save only the visible page. Images stay local and are never sent to AI.')}</p><details class="preview-capture-details"><summary>${L('采集范围与缓存','Capture & cache')}</summary><p data-preview-details></p></details></div><button type="button" id="mono-auto-preview" class="toggle" aria-pressed="${this.autoPreview}">${this.autoPreview?L('开启','On'):L('关闭','Off')}</button></div>`);
  dialog.querySelector('form').insertBefore(block,dialog.querySelector('h3'));
  const form=dialog.querySelector('form'),grid=document.createElement('div'),right=document.createElement('section');grid.className='settings-grid';right.className='settings-section';block.classList.add('settings-section');
  for(const child of [...form.children])if(child!==block&&!child.classList.contains('dialog-heading'))right.append(child);
  grid.append(block,right);form.append(grid);
  const aboutLink=document.createElement('section');aboutLink.id='mono-about';
  const aboutButton=document.createElement('button');aboutButton.type='button';aboutButton.className='button';aboutButton.id='open-about-help';aboutButton.onclick=openAbout;
  aboutLink.append(aboutButton);block.append(aboutLink);
  const privacy=document.createElement('section');privacy.className='settings-section';privacy.id='mono-privacy';
  let recordingHeading=$('#recording').closest('label').previousElementSibling;
  for(let node=recordingHeading;node;){const next=node.nextElementSibling;privacy.append(node);node=next;}
  const storage=privacy.querySelector('#storage-controls');storage.classList.add('settings-section');
  const actions=privacy.querySelector('.dialog-actions');
  const disclosure=document.createElement('details');disclosure.className='settings-disclosure ai-data';
  disclosure.innerHTML='<summary></summary>';disclosure.append(privacy.querySelector('.privacy-box'));right.append(disclosure);
  grid.append(privacy,storage,$('#mono-about'));form.append(actions);
  for(const input of ['idle-seconds','excluded']){const label=$('#'+input).closest('label'),help=label.nextElementSibling;const field=document.createElement('div');field.className='settings-field';label.before(field);field.append(label,help);}
  $('#mono-auto-preview').onclick=()=>this.setAutoPreview(!this.autoPreview);
  void this.syncAutoPreview();
 }this.appearanceLabels();}
 appearanceLabels(){
  const block=$('#mono-appearance');if(!block)return;
  block.querySelector('h3').textContent=L('界面与交互','Appearance & interaction');
  $('#open-about-help').textContent=L('关于与帮助 →','About & help →');
  $('.settings-disclosure.ai-data summary').textContent=L('AI 处理与隐私','AI processing & privacy');
  block.querySelector('.preview-capture-details summary').textContent=L('采集范围与缓存','Capture & cache');
  block.querySelector('[data-preview-details]').textContent=L('暂停记录时停止采集；邮箱和排除网站不采集。缓存最多 100 张 / 1.5 MB，保留 7 天。','Capture stops when recording is paused. Email and excluded sites are skipped. Up to 100 images / 1.5 MB, kept for 7 days.');
  const rows=block.querySelectorAll('.setting-row');
  rows[0].querySelector('strong').textContent=L('悬停缩略图','Hover previews');
  rows[0].querySelector('button').textContent=this.previewEnabled?L('开启','On'):L('关闭','Off');
  rows[1].querySelector('strong').textContent=L('自动保存网页预览','Automatically save previews');
  rows[1].querySelector('p').textContent=L('授权后仅保存当前可见网页；截图只存本机，不发送给 AI。','With permission, save only the visible page. Images stay local and are never sent to AI.');
  rows[1].querySelector('button').textContent=this.autoPreview?L('开启','On'):L('关闭','Off');
 }
 render(){
  helpLabels();
  const preview=$('#mono-preview')?.open?this.explicitPreview:null;
  this.closeActions();this.appearanceLabels();
  this.themeLabels();
  document.body.dataset.indexLayout=this.layouts[this.mode];
  const state=this.api.state();if(!state)return;this.clearPreview();const view=this.view,rows=this.rows,book=this.mode==='bookmarks',panel=!!this.panel,reviewSearch=view==='review'&&!!$('#search').value.trim();
  document.body.classList.add('offset-live');document.documentElement.classList.toggle('dense',this.density==='compact');document.body.dataset.monoView=view;
  const names=titles[view]||titles.workspace,desc=descriptions[view]||descriptions.workspace;
  const count=view==='manage'?(book?new Set([...(this.book?.groups||[]),...(this.book?.rows||[]).map(r=>r.group),...(this.book?.rules||[]).map(r=>r.group)].filter(g=>g!==UNGROUPED)).size:this.api.names().length):view==='rules'?(book?this.book?.rules.length||0:state.config.rules.length):view==='settings'?3:rows.length;
  const label=panel?L('项','items'):book?L('条书签','bookmarks'):L('个页面','pages');
  const pending=rows.filter(r=>r.group===UNGROUPED&&!r.manualGroup).length;
  const heroIcon={workspace:'tabs',folders:'folder',smart:'spark',review:'clock',history:'history',manage:'grid',rules:'list',settings:'settings'}[view]||'folder';
  this.disposeHeroFlow?.();
  $('#mono-hero').innerHTML=`<section class="hero"><div class="hero-icon" aria-hidden="true">${I(heroIcon)}</div><div class="hero-text"><h1>${L(...names)}</h1>${!['workspace','review','manage','rules','settings'].includes(view)?'<p class="hero-sub">'+L(...desc)+'</p>':''}</div>${!panel&&view!=='review'?`<button class="button hero-action ${pending?'primary':''}" data-pm="organize" ${this.api.busy()?'disabled':''}>${view==='history'?L('历史补分类','Classify history'):L(book?'应用书签规则':'整理待分类',book?'Apply bookmark rules':'Organize unclassified')}${pending?`<span class="badge mono">${pending}</span>`:''}${I('arrow')}</button>`:''}<div class="hero-stat"><strong class="hero-count">${count}</strong><span class="mono">${label}</span></div></section>`;
  this.disposeHeroFlow=mountHeroFlow($('#mono-hero .hero-icon'),view);
  const management=['manage','rules'].includes(view),classificationNav=$('#classification-navigation');
  classificationNav.hidden=!management;
  if(!management)classificationNav.replaceChildren();
  if(management){
   $('#mono-hero h1').textContent=L('分类与规则','Categories & rules');
   classificationNav.innerHTML=`<div class="classification-sources" role="group" aria-label="${L('管理对象','Manage source')}">${[['tabs','标签页','Tabs'],['bookmarks','书签','Bookmarks']].map(([source,zh,en])=>`<button type="button" data-classification-source="${source}" aria-pressed="${source===this.mode}">${L(zh,en)}</button>`).join('')}</div><div class="classification-sections" role="group" aria-label="${L('管理内容','Manage section')}">${[['manage','分类管理','Categories'],['rules','自动分类规则','Classification rules']].map(([section,zh,en])=>`<button type="button" data-pm-view="${section}" aria-pressed="${section===view}">${L(zh,en)}</button>`).join('')}</div>`;
  }
  $('#top-title').textContent=$('#mono-hero h1').textContent;document.title=L('拾签','Pickmark');
  $('#storage-warning').hidden=!state.storageWarning;
  $('#storage-warning span').textContent=L('存储空间不足，正在显示已保存的数据。新记录暂时无法保存，请到设置清理缓存或历史记录。','Storage is full. Showing saved data; new activity may not be saved. Open settings to clear cached previews or history.');
  $('#storage-warning button').textContent=L('设置与清理','Settings & cleanup');
  $('#book-ai-progress').hidden=!book||!this.bookAIStatus;
  $('#settings-shortcut').textContent=L('设置与隐私','Settings & privacy');
  $('#settings').setAttribute('aria-label',L('设置与隐私','Settings & privacy'));
  $('#mono-search-toggle>span').textContent=L('查找','Search');
  $('#search').placeholder=L(book?'搜索书签标题、域名或分类…':'搜索当前标签清单…',book?'Search bookmark titles, domains or categories…':'Search the current tab list…');
  $$('[data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode===this.mode);b.setAttribute('aria-pressed',b.dataset.mode===this.mode);b.querySelector('sup').textContent=b.dataset.mode==='tabs'?state.tabs.length:this.book?.rows.length??'—';b.querySelector('strong').textContent=b.dataset.mode==='tabs'?L('标签页','Tabs'):L('书签','Bookmarks');});
  const source=book?this.book?.rows||[]:this.api.scoped(),key=book&&this.bookView==='folders'?'folder':'group';
  const categories=[...new Set(source.map(r=>r[key]))];
  if(!book||this.bookView==='smart'){const order=book?this.book?.groups||[]:this.api.names();categories.sort((a,b)=>order.indexOf(a)-order.indexOf(b));}
  if(this.selected&&!rows.some(r=>r.id===this.selected.id))this.selected=rows[0]||null;
  const nav=(v,ic)=>`<button class="nav ${view===v?'active':''}" data-pm-view="${v}" ${view===v?'aria-current="page"':''}>${I(ic)}<span>${L(...titles[v])}</span>${['workspace','folders'].includes(v)?`<span class="number mono">${v==='workspace'?state.tabs.length:this.book?.rows.length??'—'}</span>`:''}</button>`;
  const primary=book?nav('folders','folder')+nav('smart','spark'):nav('workspace','tabs')+nav('review','clock')+nav('history','history');
  const q=$('#nav-filter')?.value||'';
  $('#nav').innerHTML=`<div class="nav-group nav-primary"><p class="rail-label mono">${book?L('收藏','Collection'):L('浏览','Browsing')}</p>${primary}</div>${!panel&&view!=='review'?`<div class="nav-group nav-cats"><p class="rail-label mono">${key==='folder'?L('目录','Folders'):L('分类','Groups')}<span>${categories.length}</span></p>${categories.length>6?`<label class="nav-find">${I('search')}<input id="nav-filter" aria-label="${L('筛选分类','Filter groups')}" placeholder="${L('筛选分类','Filter groups')}" value="${E(q)}"></label>`:''}<div class="nav-scroll"><button class="nav cat ${!this.filters[this.mode]?'active':''}" data-pm-filter="">${I('all')}<span class="group-label">${L('全部','All')}</span><span class="number mono">${source.length}</span></button>${categories.map(name=>{const items=source.filter(r=>r[key]===name);return `<button class="nav cat ${this.filters[this.mode]===name?'active':''}" data-pm-filter="${E(name)}">${groupIcon(name,book?this.book?.icons?.[name]:state.config.workspaceIcons?.[name])}<span class="group-label">${E(key==='folder'?name.split(' / ').at(-1):workspaceLabel(name))}</span><span class="number mono">${items.length}</span></button>`;}).join('')}</div></div>`:''}<div class="nav-dock">${[['manage','grid'],['settings','settings']].map(([v,ic])=>`<button class="dock ${(v==='manage'?management:view===v)?'active':''}" data-pm-view="${v}" title="${v==='manage'?L('分类与规则','Categories & rules'):L(...titles[v])}" aria-label="${v==='manage'?L('分类与规则','Categories & rules'):L(...titles[v])}">${I(ic)}<span>${L(...{manage:['分类与规则','Categories & rules'],rules:['规则','Rules'],settings:['设置','Settings']}[v])}</span></button>`).join('')}</div>`;
  if($('#nav-filter'))$('#nav-filter').oninput=e=>$$('[data-pm-filter]').forEach(b=>b.hidden=!!b.dataset.pmFilter&&!b.textContent.toLowerCase().includes(e.target.value.toLowerCase()));
  $('#mono-panel').hidden=!panel;$('#recap').hidden=panel||book||view==='workspace';$('#review-dashboard').hidden=panel||book||view!=='review';
  $('#ai-onboarding').hidden=$('#ai-onboarding').hidden||book||panel;
  for(const id of ['history-progress','organize-progress','ai-recovery'])if(book||panel)$('#'+id).hidden=true;
  $('#mono-list').hidden=panel||(view==='review'&&!reviewSearch);
  if(panel&&book&&view!=='settings')this.renderBookPanel(view);
  if(!panel&&(view!=='review'||reviewSearch))this.renderList(rows);
  this.status(rows);this.railAccess();this.alignCategories();
  if(preview){
   const source=book?this.book?.rows||[]:state.records||[],row=source.find(r=>r.id===preview.row.id&&r.url===preview.row.url);
   if(preview.mode===this.mode&&row)this.preview({...preview.row,title:row.title},true);
   else $('#mono-preview').close();
  }
 }
 renderList(rows){
  const book=this.mode==='bookmarks',view=this.view,layout=this.layouts[this.mode];
  const total=rows.length,pageSize=100;
  if(book){const key=JSON.stringify([view,this.filters.bookmarks,$('#search').value]);if(key!==this.bookPageKey){this.bookPage=0;this.bookPageKey=key;}this.bookPage=Math.min(this.bookPage||0,Math.max(0,Math.ceil(total/pageSize)-1));rows=rows.slice(this.bookPage*pageSize,(this.bookPage+1)*pageSize);}
  const controls=`${icon('dense',L('紧凑列表','Compact list'),`data-pm-density="compact" aria-pressed="${layout==='list'&&this.density==='compact'}"`)}${icon('airy',L('舒适列表','Comfortable list'),`data-pm-density="comfortable" aria-pressed="${layout==='list'&&this.density==='comfortable'}"`)}<span class="vsep"></span>${icon('list',L('索引列表','List'),`data-pm-layout="list" aria-pressed="${layout==='list'}"`)}${icon('grid',L('预览画廊','Gallery'),`data-pm-layout="gallery" aria-pressed="${layout==='gallery'}"`)}`;
  let html=`<div class="list-tools"><div class="scope"><strong>${E(this.filters[this.mode]||L(book?'全部书签':'全部标签',book?'All bookmarks':'All tabs'))}</strong><span class="mono">/ ${total}</span></div><div class="view-controls">${book?`<button class="tool" data-pm="book-ai" ${this.bookAIRunning?'disabled':''}>${L('AI 分类…','AI classify…')}</button>`:''}<button class="tool" data-pm="refresh">${L(book?'刷新书签':'刷新标签页',book?'Refresh bookmarks':'Refresh tabs')}</button>${!book&&view==='workspace'?`<button class="tool" data-pm="regroup">${L('重新分组…','Regroup…')}</button>`:''}${controls}</div></div>`;
  if(book&&!this.book){html+=`<div class="empty"><p>${L('连接浏览器书签','Connect browser bookmarks')}</p><span>${L('仅在你授权后读取目录。智能分类独立保存，不移动原书签。','Read folders only after your permission. Classification never moves original bookmarks.')}</span><button class="button primary" data-pm="connect">${this.api.extension?L('授权并读取书签','Authorize bookmarks'):L('查看模拟书签','Show example bookmarks')}</button></div>`;}
  else if(!rows.length)html+=`<div class="empty"><p>${L('这里还没有页面','No pages here')}</p><span>${L('可以切换分类、日期或清除搜索条件。','Choose another group or date, or clear the search.')}</span></div>`;
  else if(layout==='gallery')html+=`<div class="gallery">${rows.map(r=>`<article class="gallery-card" data-row="${E(r.id)}"><button type="button" class="gallery-open" data-pm-open="${E(r.id)}"><div class="gallery-art" data-preview-url="${E(r.url)}">${this.previewMarkup(r)}</div><div class="gallery-copy"><strong>${E(r.title)}</strong><span>${E(r.domain)} · ${E(workspaceLabel(r.group))}</span></div></button><div class="gallery-tools">${icon('more',L('页面操作','Page actions'),'data-pm-actions="'+E(r.id)+'" aria-haspopup="true" aria-expanded="false"')}</div></article>`).join('')}</div>`;
  else html+=rows.map(r=>this.row(r,book,view)).join('');
  if(book&&total>pageSize)html+=`<nav class="bookmark-pager" aria-label="${L('书签分页','Bookmark pages')}"><button class="button" data-pm-page="-1" ${this.bookPage===0?'disabled':''}>${L('上一页','Previous')}</button><span class="mono">${this.bookPage*pageSize+1}–${Math.min(total,(this.bookPage+1)*pageSize)} / ${total}</span><button class="button" data-pm-page="1" ${(this.bookPage+1)*pageSize>=total?'disabled':''}>${L('下一页','Next')}</button><small>${L('搜索与整理覆盖全部匹配结果','Search and organize include all matching results')}</small></nav>`;
  $('#mono-list .index').innerHTML=html;
  $$('#mono-list [data-pm-open]').forEach(b=>b.onclick=()=>this.open(rows.find(r=>r.id===b.dataset.pmOpen)));
  $$('#mono-list [data-pm-actions]').forEach(b=>b.onclick=()=>this.actions(rows.find(r=>r.id===b.dataset.pmActions),b));
  $$('#mono-list [data-pm-preview]').forEach(b=>b.onclick=()=>this.preview(rows.find(r=>r.id===b.dataset.pmPreview),true));
  $$('#mono-list .item,#mono-list .gallery-card').forEach(row=>{const r=rows.find(r=>r.id===row.dataset.row);row.onclick=e=>{if(!e.target.closest('button,a,input,select'))this.open(r);};const enter=(keyboard=false)=>{if($('#mono-preview').open||(!keyboard&&this.keyboardNavigation))return;if(keyboard)this.keyboardNavigation=true;this.clearPreview();this.selected=r;row.classList.add('is-hovered');this.status(rows);if(this.previewEnabled&&(keyboard||matchMedia('(any-hover: hover)').matches)){this.previewAnchor=row;this.hoverTimer=setTimeout(()=>this.preview(r),480);}};row.previewEnter=enter;row.onmouseenter=()=>enter();row.onmouseleave=()=>{if(!$('#mono-preview').open&&!row.querySelector(':focus-visible'))this.clearPreview();};row.addEventListener('focusin',e=>{this.selected=r;this.status(rows);if(e.target.matches(':focus-visible'))enter(true);});row.addEventListener('focusout',e=>{if(!$('#mono-preview').open&&!row.contains(e.relatedTarget))this.clearPreview();});});
  this.hydrateGallery();
 }
 row(r,book,view){const name=r.title.includes(' · ')?r.title.split(' · ')[0]:r.domain.split('.')[0],title=r.title.includes(' · ')?r.title.split(' · ').slice(1).join(' · '):r.title;
  const date=r.lastSeen||r.firstSeen,time=date?new Date(date).toLocaleDateString(getLanguage()==='en'?'en-US':'zh-CN',{month:'2-digit',day:'2-digit'}):'';
  return `<div class="item" data-row="${E(r.id)}"><button type="button" class="row-origin" data-pm-open="${E(r.id)}" aria-label="${E(r.title)}"><span class="row-origin-text">${fav(r)}<strong>${E(name)}</strong></span></button><button type="button" class="row-stripes" data-pm-open="${E(r.id)}" aria-label="${E(L('打开：','Open: ')+r.title)}">${Array.from({length:12},(_,n)=>`<i aria-hidden="true" style="--weight:${1/(n+2)};--delay:${180+n*12}ms"></i>`).join('')}</button><div class="row-details"><button type="button" class="item-main" data-pm-open="${E(r.id)}"><span class="item-title">${E(title)}${r.manualGroup?`<span class="manual-tag">${L('手动','Manual')}</span>`:''}</span><span class="item-meta">${E(book&&view==='folders'?r.folder:r.domain)}</span></button><span class="row-state mono">${E(time)}</span><span class="row-group">${E(workspaceLabel(r.group))}</span><span class="item-actions">${icon('more',L('页面操作','Page actions'),'data-pm-actions="'+E(r.id)+'" aria-haspopup="true" aria-expanded="false"')}</span></div></div>`;
 }
 previewText(r,blocked=false){
  const excluded=blocked||!previewAllowed(r.url,this.api.state()?.config?.excluded||[]);
  const info=excluded?{state:'unavailable',reason:'excluded'}:this.previewStates.get(r.url)||{state:this.thumbnails.get(r.url)?'saved':'pending',reason:this.api.extension?'checking':'demo'};
  const title=info.state==='saved'?L('已保存','Saved'):info.state==='generating'?L('正在生成','Generating'):info.state==='error'?L('未能生成预览','Preview failed'):info.state==='unavailable'?L('无法生成预览','Preview unavailable'):L('待浏览','Awaiting visit');
  const reasons={visit:L('打开此网页，加载完成后停留片刻即可，无需滚到底。','Open this page and stay briefly after it loads. No scrolling is needed.'),ready:L('网页已就绪，等待开始截图。','The page is ready; capture will begin shortly.'),loading:L('正在等待网页加载完成。','Waiting for the page to finish loading.'),foreground:L('请将网页所在的浏览器窗口切到前台。','Bring the page’s browser window to the foreground.'),disabled:L('自动预览未开启，可在设置中开启并授权。','Automatic previews are off. Enable and authorize them in Settings.'),permission:L('缺少截图授权，请在设置中重新开启自动预览并授权。','Screenshot permission is missing. Enable automatic previews in Settings and authorize access.'),paused:L('记录已暂停，恢复记录后才会自动生成。','Recording is paused. Resume recording to generate previews automatically.'),excluded:L('邮箱和排除的网站不会采集预览。','Email and excluded websites are not captured.'),unsupported:L('浏览器内部页面等非网页地址不支持截图。','Browser internal pages and other non-web addresses cannot be captured.'),private:L('无痕窗口不采集预览。','Incognito windows are not captured.'),storage:L('本机存储空间不足，请在设置中清理预览缓存后重试。','Local storage is full. Clear preview cache in Settings and retry.'),timeout:L('截图超时，请重新打开网页或使用手动更新重试。','Capture timed out. Revisit the page or retry with the manual update button.'),changed:L('截图时页面已切换，请回到该网页后重试。','The page changed during capture. Return to this page and retry.'),tooLarge:L('截图超出缓存大小限制，未能保存。','The screenshot exceeded the cache size limit and was not saved.'),capture:L('浏览器未能完成截图，请重新打开网页或手动更新重试。','The browser could not capture this page. Revisit it or retry the manual update.'),status:L('暂时无法读取预览状态，请重新打开预览。','Preview status could not be read. Reopen the preview.'),checking:L('正在检查预览状态。','Checking preview status.'),demo:L('示例模式不会采集网页。','The demo does not capture pages.')};
  const hint=info.state==='generating'?L('正在截图并保存到本机。','Capturing and saving on this device.'):info.state==='saved'?'':reasons[info.reason]||'';
  return {state:info.state,title,hint};
 }
 previewMarkup(r,blocked=false){
  const status=this.previewText(r,blocked),image=status.state!=='unavailable'&&this.thumbnails.get(r.url);
  if(image)return `<img class="cached-thumbnail" loading="lazy" decoding="async" src="${E(image)}" alt="${E(r.title)}"><span class="preview-badge" role="status" data-preview-state="${status.state}">${E(status.state==='error'?L('已保存 · 更新失败','Saved · update failed'):status.title)}${status.hint?`<small>${E(status.hint)}</small>`:''}</span>`;
  return `<div class="placeholder-art" role="status" data-preview-state="${status.state}"><p class="preview-state">${E(status.title)}</p><small>${E(status.hint)}</small></div>`;
 }
 rememberPreviewState(url,info){this.previewStates.delete(url);this.previewStates.set(url,info);while(this.previewStates.size>100)this.previewStates.delete(this.previewStates.keys().next().value);}
 refreshPreviews(url){
  if(url)this.previewStates.delete(url);else this.previewStates.clear();
  if(document.hidden)return;
  this.hydrateGallery();
  if($('#mono-preview').open&&this.explicitPreview&&(!url||this.explicitPreview.row.url===url))this.preview(this.explicitPreview.row,true);
  else if(this.previewAnchor&&$('#inspector').classList.contains('is-visible')){const row=this.rows.find(r=>r.id===this.previewAnchor.dataset.row);if(row&&(!url||row.url===url))this.preview(row);}
 }
 async syncAutoPreview(){
  if(!this.api.extension)return;const token=this.autoPreviewRequest=(this.autoPreviewRequest||0)+1;
  try{
   const info=await this.api.send({type:'preview:status'});if(token!==this.autoPreviewRequest)return;
   const changed=this.autoPreview!==info.enabled;this.autoPreview=info.enabled;
   const button=$('#mono-auto-preview');if(button){button.setAttribute('aria-pressed',String(this.autoPreview));button.textContent=this.autoPreview?L('开启','On'):L('关闭','Off');}
   if(changed){this.hydrateGallery();if($('#mono-preview').open&&this.explicitPreview)this.preview(this.explicitPreview.row,true);}
  }catch{}
 }
 async setAutoPreview(enabled){
  if(!this.api.extension){this.api.toast(L('请在 Chrome 插件中授权使用；示例页面不采集网页。','Authorize this feature in the Chrome extension. The demo does not capture pages.'));return false;}
  try{if(enabled&&!await chrome.permissions.request({origins:['<all_urls>']}))return false;await this.api.send({type:'preview:auto',enabled});await this.syncAutoPreview();this.api.toast(enabled?L('自动预览已开启；浏览网页后在本机保存。','Automatic previews enabled; visited pages are saved locally.'):L('自动预览已关闭。','Automatic previews disabled.'));return true;}catch(e){this.api.toast(e.message);return false;}
 }
 async hydrateGallery(){
  clearTimeout(this.galleryStatusTimer);
  const token=this.galleryToken=(this.galleryToken||0)+1,art=$$('#mono-list .gallery-art[data-preview-url]');
  if(!this.api.extension||!art.length||document.hidden)return;
  const draw=()=>{for(const node of art){if(!node.isConnected)continue;const url=node.dataset.previewUrl,title=node.closest('.gallery-card').querySelector('.gallery-copy strong').textContent;node.innerHTML=this.previewMarkup({url,title});}};
  try{
   const states=await this.api.send({type:'preview:states',urls:art.map(node=>node.dataset.previewUrl)});if(token!==this.galleryToken)return;
   for(const [url,info] of Object.entries(states)){this.rememberPreviewState(url,info);if(!info.savedAt)this.thumbnails.delete(url);}draw();
   if(Object.values(states).some(info=>info.state==='generating'))this.galleryStatusTimer=setTimeout(()=>this.hydrateGallery(),1500);
   const urls=art.map(node=>node.dataset.previewUrl).filter(url=>states[url].savedAt);if(!urls.length)return;
   const images=await this.api.send({type:'thumbnail:lookup',urls});if(token!==this.galleryToken)return;
   // Render from the batch so galleries larger than the small hover cache stay hydrated.
   for(const node of art){const url=node.dataset.previewUrl;if(!node.isConnected||!images[url])continue;const title=node.closest('.gallery-card').querySelector('.gallery-copy strong').textContent;this.cacheThumbnail(url,images[url]);node.innerHTML=this.previewMarkup({url,title});}
  }catch{if(token!==this.galleryToken)return;for(const node of art)this.rememberPreviewState(node.dataset.previewUrl,{state:'error',reason:'status'});draw();}
 }
 cacheThumbnail(url,image){this.thumbnails.delete(url);this.thumbnails.set(url,image);while(this.thumbnails.size>20)this.thumbnails.delete(this.thumbnails.keys().next().value);}
 preview(r,explicit=false){
  if(!r)return;if(explicit){this.explicitPreview={row:r,mode:this.mode};this.selected=r;this.clearPreview();}else if(document.querySelector('dialog[open]:not(.mono-page)'))return;
  const token=++this.previewToken;
  let info={enabled:this.autoPreview,visible:false,blocked:!previewAllowed(r.url,this.api.state()?.config?.excluded||[])};
  const draw=()=>{
   if(token!==this.previewToken)return;
   if(explicit){
    const focused=$('#mono-preview').contains(document.activeElement)?document.activeElement.id:null;
    $('#mono-preview h2').textContent=r.title;
    $('#mono-preview .mono-preview-body').innerHTML=this.previewMarkup(r,info.blocked)+`<div class="dialog-actions"><button type="button" id="mono-preview-open" class="button primary">${L('打开网页','Open page')}</button>${this.api.extension?`${!info.enabled&&!info.blocked?`<button type="button" id="mono-preview-auto" class="button">${L('开启自动预览','Enable automatic previews')}</button>`:''}${info.visible?`<button type="button" id="mono-capture" class="button" ${this.captureBusy?'disabled':''}>${L('更新当前网页预览','Update visible page preview')}</button>`:''}`:''}</div>`+(this.api.extension?`<p class="help">${L('只截取当前可见网页，截图保存在本机，不发送给 AI。','Only the visible page is captured. Images stay on this device and are not sent to AI.')}</p>`:'');
    $('#mono-preview-open').onclick=()=>this.open(r);
    if($('#mono-preview-auto'))$('#mono-preview-auto').onclick=async()=>{if(await this.setAutoPreview(true)){info=await this.api.send({type:'preview:status',url:r.url});this.rememberPreviewState(r.url,info);draw();}};
    if($('#mono-capture'))$('#mono-capture').onclick=async()=>{if(this.captureBusy)return;this.captureBusy=true;this.rememberPreviewState(r.url,{state:'generating'});draw();try{const image=await this.api.send({type:'thumbnail:capture',url:r.url});this.cacheThumbnail(r.url,image);info=await this.api.send({type:'preview:status',url:r.url});this.rememberPreviewState(r.url,info);this.hydrateGallery();}catch(e){try{info=await this.api.send({type:'preview:status',url:r.url});this.rememberPreviewState(r.url,info);}catch{this.rememberPreviewState(r.url,{state:'error',reason:'capture'});}this.api.toast(e.message);}finally{this.captureBusy=false;draw();}};
    if(!$('#mono-preview').open)$('#mono-preview').showModal();
    else if(focused)$('#mono-preview').querySelector('[id="'+focused+'"]')?.focus({preventScroll:true});
   }else{$('#inspector').innerHTML='<div class="floating-art">'+this.previewMarkup(r)+'</div><div class="floating-caption">'+E(r.domain)+'</div>';$('#inspector').classList.add('is-visible');$('#inspector').setAttribute('aria-hidden','false');this.positionPreview();}
   clearTimeout(this.previewStatusTimer);if(this.api.extension&&this.previewStates.get(r.url)?.state==='generating'&&!document.hidden)this.previewStatusTimer=setTimeout(()=>{if(token===this.previewToken)this.preview(r,explicit);},1500);
  };draw();
  if(this.api.extension)this.api.send({type:'preview:status',url:r.url}).then(value=>{if(token!==this.previewToken)return;info=value;this.rememberPreviewState(r.url,value);if(!value.savedAt)this.thumbnails.delete(r.url);draw();}).catch(()=>{if(token!==this.previewToken)return;this.rememberPreviewState(r.url,{state:'error',reason:'status'});draw();});
  if(this.api.extension&&!this.thumbnails.has(r.url))this.api.send({type:'thumbnail:get',url:r.url}).then(image=>{if(token!==this.previewToken)return;this.cacheThumbnail(r.url,image);draw();}).catch(()=>{if(token!==this.previewToken)return;this.rememberPreviewState(r.url,{state:'error',reason:'status'});draw();});
 }
 clearPreview(){this.previewToken++;clearTimeout(this.hoverTimer);clearTimeout(this.scrollPreviewTimer);clearTimeout(this.previewStatusTimer);this.previewAnchor=null;$$('.item.is-hovered,.gallery-card.is-hovered').forEach(r=>r.classList.remove('is-hovered'));$('#inspector')?.classList.remove('is-visible');$('#inspector')?.setAttribute('aria-hidden','true');}
 resumePreviewAfterScroll(){
  this.clearPreview();
  if((!this.previewPointer&&!this.keyboardNavigation)||document.hidden)return;
  this.scrollPreviewTimer=setTimeout(()=>{
   if(document.hidden)return;
   if(this.keyboardNavigation){document.activeElement?.closest('#mono-list .item,#mono-list .gallery-card')?.previewEnter?.(true);return;}
   const point=this.previewPointer;if(!point||document.hidden)return;
   document.elementFromPoint(point.x,point.y)?.closest('#mono-list .item,#mono-list .gallery-card')?.previewEnter?.();
  },160);
 }
 positionPreview(){
  const p=$('#inspector'),anchor=this.previewAnchor;
  if(!p?.classList.contains('is-visible'))return;
  if(!anchor?.isConnected){this.clearPreview();return;}
  const row=anchor.getBoundingClientRect(),box=$('#mono-list').getBoundingClientRect();
  const top=Math.max(8,$('.app .topbar').getBoundingClientRect().bottom+8),bottom=innerHeight-38;
  if(row.bottom<top||row.top>bottom){this.clearPreview();return;}
  // Keep the original under-list composition and difference blending.
  // Rows traverse a stationary image within each group; the next group starts at its top again.
  const width=Math.min(480,Math.max(280,box.width*.47),innerWidth-32,box.width,Math.max(0,bottom-top-32)*640/420);
  if(width<140){this.clearPreview();return;}
  p.style.width=width+'px';
  p.style.left=Math.max(16,Math.min(innerWidth-width-16,box.right-width))+'px';
  const height=p.getBoundingClientRect().height;
  const imageHeight=p.querySelector('.floating-art').getBoundingClientRect().height;
  const rows=$$('#mono-list .item,#mono-list .gallery-card');
  const perGroup=Math.max(1,Math.floor(imageHeight/row.height));
  const groupStart=Math.floor(rows.indexOf(anchor)/perGroup)*perGroup;
  let target=Math.max(rows[0].getBoundingClientRect().top,row.bottom-imageHeight);
  if(anchor.matches('.item')){
   const ceiling=Math.max(top,bottom-height),groups=[];
   for(let start=0;start<rows.length;start+=perGroup){
    const first=rows[start].getBoundingClientRect(),last=rows[Math.min(rows.length-1,start+perGroup-1)].getBoundingClientRect();
    if(last.bottom>top&&first.top<bottom)groups.push({start,y:Math.max(top,Math.min(ceiling,first.top))});
   }
   // Keep distinct visible groups separated at both edges. Resolve from geometry,
   // not hover history, so revisiting a group always restores the same position.
   const gap=Math.min(row.height,(ceiling-top)/Math.max(1,groups.length-1));
   for(let i=1;i<groups.length;i++)groups[i].y=Math.max(groups[i].y,groups[i-1].y+gap);
   if(groups.length)groups.at(-1).y=Math.min(ceiling,groups.at(-1).y);
   for(let i=groups.length-2;i>=0;i--)groups[i].y=Math.min(groups[i].y,groups[i+1].y-gap);
   target=groups.find(g=>g.start===groupStart)?.y??top;
  }
  p.style.top=Math.max(top,Math.min(bottom-height,target))+'px';
 }

 async open(r){if(!r)return;if($('#mono-preview').open)$('#mono-preview').close();this.clearPreview();try{if(this.mode==='bookmarks'){if(!this.api.extension){this.api.toast(L('模拟书签，不打开外部网站。','Example bookmark; no external page opened.'));return;}const url=new URL(r.url);if(!['https:','http:'].includes(url.protocol))return;await chrome.tabs.create({url:r.url});}else await this.api.send({type:'jump',id:r.id});}catch(e){this.api.toast(e.message);}}
 closeActions(){const menu=$('#mono-row-menu');if(menu?.matches(':popover-open'))menu.hidePopover();this.actionTrigger?.setAttribute('aria-expanded','false');this.actionRect=null;}
 dismissMovedActions(){
  if(!this.actionRect||!$('#mono-row-menu')?.matches(':popover-open'))return;
  const box=this.actionTrigger.getBoundingClientRect();
  // Scrolling the trigger into view can queue an event before the menu opens.
  // Dismiss only when its anchor actually moved after opening.
  if(box.top!==this.actionRect.top||box.left!==this.actionRect.left)this.closeActions();
 }
 actions(r,trigger){
  if(!r)return;this.closeActions();this.clearPreview();this.selected=r;this.actionTrigger=trigger;
  const menu=$('#mono-row-menu');menu.setAttribute('aria-label',L('页面操作','Page actions'));
  menu.innerHTML=`<button type="button" data-row-action="open">${L('打开网页','Open page')}</button><button type="button" data-pm-preview>${L('查看大图','View large preview')}</button><button type="button" data-pm-edit>${L('调整分类…','Move to category…')}</button><button type="button" data-row-action="copy">${L('复制链接','Copy link')}</button>`;
  menu.querySelector('[data-row-action=open]').onclick=()=>{this.closeActions();this.open(r);};
  menu.querySelector('[data-pm-preview]').onclick=()=>{this.closeActions();this.preview(r,true);};
  menu.querySelector('[data-pm-edit]').onclick=()=>{this.closeActions();this.edit(r);};
  menu.querySelector('[data-row-action=copy]').onclick=async()=>{this.closeActions();try{await navigator.clipboard.writeText(r.url);this.api.toast(L('链接已复制','Link copied'));}catch{this.api.toast(L('无法复制链接，请检查浏览器剪贴板权限。','Cannot copy link. Check browser clipboard permission.'));}};
  menu.ontoggle=e=>{if(e.newState==='closed')trigger.setAttribute('aria-expanded','false');};
  menu.showPopover();trigger.setAttribute('aria-expanded','true');
  const box=trigger.getBoundingClientRect(),width=menu.offsetWidth,height=menu.offsetHeight;
  this.actionRect={top:box.top,left:box.left};
  menu.style.left=Math.max(8,Math.min(innerWidth-width-8,box.right-width))+'px';
  menu.style.top=Math.max(8,box.bottom+height+8>innerHeight?box.top-height:box.bottom+4)+'px';
  menu.querySelector('button').focus();
 }
 edit(r){if(!r)return;if(this.mode==='tabs'){this.api.edit(r);return;}const expectedRevision=this.book.revision||0;this.bookDialog(L('调整书签分类','Move bookmark to category'),`<p>${E(r.title)}</p><p class="help">${L('选择已有分类，或输入新分类。只调整此书签的智能分类，不修改网页标题或浏览器原文件夹。','Choose an existing category or enter a new one. Only this bookmark’s classification changes; its title and browser folder stay unchanged.')}</p><label>${L('移入分类','Move to category')}<input id="mono-book-group" list="mono-book-categories" maxlength="40" required value="${E(r.group)}"></label><datalist id="mono-book-categories">${[UNGROUPED,...this.book.groups].map(g=>`<option value="${E(g)}"></option>`).join('')}</datalist>`,async()=>this.bookSend('patch',{expectedRevision,id:r.id,url:r.url,group:$('#mono-book-group').value}));}
 bookDialog(title,body,save){const d=$('#mono-book-dialog');d.innerHTML=`<form><div class="dialog-heading"><h2>${title}</h2><button type="button" aria-label="Close">×</button></div>${body}<div class="dialog-actions"><button class="primary">${L('保存','Save')}</button></div></form>`;d.querySelector('button[type=button]').onclick=()=>d.close();d.querySelector('form').onsubmit=async e=>{e.preventDefault();try{await save();d.close();}catch(error){this.api.toast(error.message);}};d.showModal();}
 async organize(){try{if(this.mode==='bookmarks'){if(!this.book)return this.connectBookmarks();await this.bookSend('classify',{ids:this.rows.map(r=>r.id)});this.api.toast(L('已应用书签规则；已有分类与人工调整保持不变。','Bookmark rules applied; existing and manual classifications preserved.'));}else if(this.view==='history')$('#organize-history').click();else await this.api.organize();}catch(e){this.api.toast(e.message);}}
 async prepareBookAI(){
  if(this.bookAIRunning)return;
  if(!this.api.extension){this.api.toast(L('模拟预览不发送 AI 请求；加载扩展后可确认范围。','Demo does not send AI requests. Load the extension to confirm a scope.'));return;}
  if(!this.book)return this.connectBookmarks();
  try{
   const prepared=await this.api.send({type:'bookAI:prepare',ids:this.rows.map(r=>r.id)});if(this.mode!=='bookmarks')return;
   this.bookDialog(L('确认书签 AI 分类','Confirm bookmark AI classification'),`<p>${E(this.filters.bookmarks||L('全部书签','All bookmarks'))}${$('#search').value?' · '+E($('#search').value):''}</p><p>${L('范围','Scope')} ${prepared.total} · ${L('保留已有/人工分类','Existing/manual protected')} ${prepared.protected} · ${L('本地规则','Local rules')} ${prepared.local} · AI ${prepared.ai}</p><p>${E(prepared.provider)} / ${E(prepared.model)}</p><p class="help">${L('仅发送待分类书签的标题、域名、分类名称与规则到上述供应商，可能产生 API 费用。不发送完整网址、原文件夹路径或网页正文。每批最多 200 条；取消保留已完成结果。','Send only unclassified bookmark titles, domains, category names and rules to this provider. API charges may apply. No full URLs, folder paths or page content. Up to 200 per batch; cancellation preserves completed work.')}</p><div class="preview-list">${prepared.preview.map(r=>`<div>${E(r.title)} · ${E(r.domain)}</div>`).join('')}</div><p class="help">${prepared.ai>50?L('仅展示前 50 条，确认范围包含全部待分类结果。','Preview shows 50; confirmation includes all candidates.'):''}${!prepared.hasKey?L('请先在设置中配置 AI Key。','Configure an AI key in Settings first.'):''}</p>`,async()=>{if(!prepared.hasKey||!prepared.ai)return;$('#mono-book-dialog').close();void this.runBookAI(prepared);});
   const button=$('#mono-book-dialog .primary');button.textContent=L('确认发送','Confirm and send');button.disabled=!prepared.hasKey||!prepared.ai;
  }catch(e){this.api.toast(e.message);}
 }
 cancelBookAI(){this.bookAICancelled=true;if(this.bookAIToken)this.api.send({type:'bookAI:cancel',token:this.bookAIToken}).catch(()=>{});}
 async runBookAI(prepared){
  if(this.bookAIRunning)return;this.bookAIRunning=true;this.bookAICancelled=false;this.bookAIToken=crypto.randomUUID();
  const show=text=>{this.bookAIStatus=text;$('#book-ai-progress span').textContent=text;$('#book-ai-progress').hidden=this.mode!=='bookmarks';};
  const cancel=$('#book-ai-progress button');cancel.hidden=false;cancel.textContent=L('取消','Cancel');
  show(L('正在处理书签…','Classifying bookmarks…'));
  try{const result=await organizeBookmarksAI({send:this.api.send,prepared,token:this.bookAIToken,shouldContinue:()=>!this.bookAICancelled&&this.mode==='bookmarks',onProgress:r=>show(L(`AI 已完成 ${r.applied} · 剩余 ${r.remaining}`,`AI completed ${r.applied} · Remaining ${r.remaining}`))});show(L(`已保存 ${result.applied} 条 AI 分类${result.stopped?'，已停止后续批次':''}；未分类条目可重新确认后重试。`,`Saved ${result.applied} AI assignments. Reconfirm to retry remaining items.`));}
  catch(e){show(L('处理中断，已完成结果保留。重新点击 AI 分类确认范围后重试。 ','Interrupted; completed results preserved. Reconfirm AI classification to retry. ')+e.message);}
  finally{this.bookAIRunning=false;this.bookAIToken=null;cancel.hidden=true;await this.refreshBookmarks();}
 }
 status(rows){const bar=$('#statusbar');bar.hidden=!!this.panel;if(this.panel){bar.replaceChildren();return;}const state=this.api.state(),book=this.mode==='bookmarks',pending=rows.filter(r=>r.group===UNGROUPED&&!r.manualGroup).length;$('#statusbar').innerHTML=`<span class="sb-left"><span class="dot"></span>${rows.length} ${book?L('条书签','bookmarks'):L('个页面','pages')} · ${pending} ${L('待整理','unclassified')}${this.selected?'<span class="sep">·</span><span class="cursor">▸ '+E(this.selected.title)+'</span>':''}</span><span class="sb-right"><span class="k"><kbd>↑↓</kbd>${L('移动','Move')}</span><span class="k"><kbd>↵</kbd>${L('打开','Open')}</span><span class="k"><kbd>Space</kbd>${L('预览','Preview')}</span><span class="k"><kbd>E</kbd>${L('整理','Organize')}</span><span class="k"><kbd>/</kbd>${L('搜索','Search')}</span><span class="sep">·</span>${this.api.extension?(state.config.recording?L('本地记录','Local recording'):L('记录已暂停','Recording paused')):L('模拟数据','Example data')}</span>`;}
 keyboard(e){
 if(e.key==='Tab')this.keyboardNavigation=true;
 if(e.target.closest('#mono-row-menu')){if(e.key==='Escape'){e.preventDefault();this.closeActions();this.actionTrigger?.focus();}return;}
 if(e.target.closest('[data-pm-actions]')&&['Enter',' '].includes(e.key))return;
 if(document.querySelector('dialog[open]:not(.mono-page)'))return;
 if(e.key==='Tab'&&$('#rail').classList.contains('open')){const items=[...$('#rail').querySelectorAll('button,input')].filter(n=>!n.hidden&&n.offsetParent!==null),first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}return;}
 if(e.key==='Escape'){this.clearPreview();if($('#rail').classList.contains('open'))this.rail(false);if(!$('#search-toolbar').hidden)$('#search-toggle').click();return;}
 if(e.target.closest('input,textarea,select,[contenteditable=true]'))return;if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#search-toggle').click();return;}if(e.metaKey||e.ctrlKey||e.altKey)return;if(e.key==='/'){e.preventDefault();$('#search-toggle').click();return;}if(this.panel)return;
 const list=$$('#mono-list .item-main[data-pm-open],#mono-list .gallery-open[data-pm-open]'),focused=document.activeElement,row=focused.closest('[data-row]')?.dataset.row,index=list.findIndex(b=>b===focused||b.dataset.pmOpen===row);
 const focusedRecord=index>=0?this.rows.find(r=>r.id===row):null;
 if(['ArrowDown','ArrowUp','j','k'].includes(e.key)){if(!list.length)return;e.preventDefault();this.keyboardNavigation=true;const delta=['ArrowDown','j'].includes(e.key)?1:-1;list[Math.max(0,Math.min(list.length-1,index<0?(delta>0?0:list.length-1):index+delta))].focus();}
 else if(e.key===' '&&focusedRecord&&!focused.closest('[data-pm-edit],[data-pm-preview]')){e.preventDefault();this.preview(focusedRecord,true);}
 else if(e.key.toLowerCase()==='e'){e.preventDefault();this.organize();}
 else if(['Backspace','Delete'].includes(e.key)&&focusedRecord&&this.mode==='tabs'&&this.view==='workspace'){e.preventDefault();this.api.close(focusedRecord);}}
 renderBookPanel(view){renderBookmarkPanel(this,view);}
}
