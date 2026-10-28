// About Kit / Terminal, adapted to the extension's existing language and theme.
// Project links use the owner's repository; support stays unconfigured.
let generation=0;
export async function renderAbout(dialog,L,onGuide){
 const token=++generation;
 dialog.innerHTML=`<div class="about-terminal"><div class="about-titlebar"><span id="about-title">[ ${L('关于与帮助','ABOUT & HELP')} ]</span><button type="button" data-close-help aria-label="${L('关闭','Close')}">×</button></div><div class="about-body"><div class="about-brand"><div class="about-mark" role="img" aria-label="${L('拾签图标','Pickmark icon')}"></div><div><h2 class="about-name">${L('拾签','PICKMARK')}</h2><div class="about-command" aria-hidden="true">$ pickmark --version</div><button type="button" class="about-version" data-version-copy disabled><span data-version>—</span><span aria-hidden="true" class="about-cursor"></span></button></div></div><p class="about-tagline">// ${L('整理网页，找回浏览的线索。','Organize pages. Pick up where you left off.')}</p><p class="about-notice" data-copy-status role="status"></p>
 <h3 class="about-section">${L('LINKS · 项目与支持','LINKS · PROJECT & SUPPORT')}</h3><div class="about-menu">
 <a href="https://github.com/abelguan02/Pickmark" target="_blank" rel="noopener noreferrer" data-about-link="repo"><span aria-hidden="true">[1]</span><strong>${L('开源仓库','Source code')}</strong><small>GitHub</small><span aria-hidden="true">↗</span></a>
 <a href="https://github.com/abelguan02/Pickmark/issues" target="_blank" rel="noopener noreferrer" data-about-link="feedback"><span aria-hidden="true">[2]</span><strong>${L('反馈与建议','Feedback')}</strong><small>Issues</small><span aria-hidden="true">↗</span></a>
 <button type="button" data-about-link="support" aria-expanded="false" aria-controls="about-support-panel"><span aria-hidden="true">[3]</span><strong>${L('自愿赞赏','Voluntary support')}</strong><small>${L('请作者喝杯咖啡','Buy me a coffee')}</small><span aria-hidden="true">→</span></button></div>
 <section id="about-support-panel" class="about-inset" hidden><p>${L('如果拾签帮到了你，欢迎自愿赞赏，支持持续维护。','If Pickmark helps you, voluntary support helps fund maintenance.')}</p><div class="about-qr-placeholder">${L('赞赏二维码待配置','Support QR code not configured')}</div><p>${L('所有功能均可正常使用，无需赞赏。','All features remain available without a contribution.')}</p></section>
 <h3 class="about-section">${L('HELP · 使用帮助','HELP · GETTING STARTED')}</h3><button type="button" class="about-guide-link" data-guide><span>${L('重新查看新手引导','View the introduction again')}</span><span aria-hidden="true">→</span></button><details class="about-tips"><summary>${L('分类、AI 与隐私','Categories, AI & privacy')}</summary><p>${L('标签页和书签独立整理。人工分类、本地规则和历史补分类均可使用；AI 为可选功能，书签 AI 处理前需要确认范围。','Tabs and bookmarks are organized independently. Manual categories, local rules and historical classification are available. AI is optional; bookmark AI requires scope confirmation.')}</p><p>${L('记录、预览授权和清理选项位于「设置与隐私」。','Recording, preview permissions and cleanup controls are in Settings & privacy.')}</p></details></div><footer class="about-footer"><span>MIT · © 2026 PICKMARK</span><span>${L('↑↓ 选择 · Enter 打开','↑↓ Select · Enter Open')}</span></footer></div>`;
 const brand=document.querySelector('#brand .brand-logo');
 dialog.querySelector('[data-close-help]').onclick=()=>dialog.close();
 dialog.querySelector('[data-guide]').onclick=()=>{dialog.close();onGuide();};
 dialog.onkeydown=event=>event.stopPropagation();
 if(brand){const clone=brand.cloneNode(true);clone.removeAttribute('id');clone.setAttribute('aria-hidden','true');dialog.querySelector('.about-mark').append(clone);}
 const current=()=>token===generation&&dialog.open;
 const runtime=globalThis.chrome?.runtime;
 let manifest;
 try{manifest=runtime?.getManifest?.()||await fetch(new URL('./manifest.json',import.meta.url)).then(response=>{if(!response.ok)throw Error();return response.json();});}catch{manifest={};}
 if(token!==generation)return;
 const version=manifest.version||'—';
 dialog.querySelector('[data-version]').textContent=`v${version}`;
 const copy=dialog.querySelector('[data-version-copy]');copy.disabled=version==='—';copy.title=L('复制版本号','Copy version');
 copy.onclick=async()=>{try{await navigator.clipboard.writeText(version);if(current())dialog.querySelector('[data-copy-status]').textContent=L('已复制版本号','Version copied');}catch{if(current())dialog.querySelector('[data-copy-status]').textContent=L('无法复制，请手动选择版本号。','Could not copy. Select the version manually.');}};
 const links=[...dialog.querySelectorAll('[data-about-link]')];
 const support=dialog.querySelector('[data-about-link=support]');
 support.onclick=()=>{const panel=dialog.querySelector('#about-support-panel');panel.hidden=!panel.hidden;support.setAttribute('aria-expanded',String(!panel.hidden));};
 dialog.onkeydown=event=>{
  event.stopPropagation();if(event.ctrlKey||event.metaKey||event.altKey)return;
  if(['1','2','3'].includes(event.key)){event.preventDefault();links[+event.key-1].focus();}
  if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();const index=links.indexOf(document.activeElement);links[index<0?(event.key==='ArrowDown'?0:2):(index+(event.key==='ArrowDown'?1:2))%3].focus();}
 };
}
