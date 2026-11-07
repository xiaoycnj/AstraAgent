// Native buttons address only the window that owns this WebView bridge.
const historyBack=actionButton('',()=>history.back(),'chrome-button'),historyForward=actionButton('',()=>history.forward(),'chrome-button');
function chromeGlyph(path){const svg=svgIcon('note');svg.querySelector('path').setAttribute('d',path);return svg}
historyBack.id='history-back';historyBack.setAttribute('aria-label','后退');historyBack.title='后退';historyBack.append(chromeGlyph('m14 5-7 7 7 7M7 12h14'));
historyForward.id='history-forward';historyForward.setAttribute('aria-label','前进');historyForward.title='前进';historyForward.append(chromeGlyph('m10 5 7 7-7 7M17 12H3'));
appMenu.prepend(historyBack,historyForward);appMenu.classList.add('custom-titlebar','pywebview-drag-region');
const titlebarDrag=elem('div','titlebar-drag pywebview-drag-region');titlebarDrag.setAttribute('aria-hidden','true');appMenu.append(titlebarDrag);
const windowControls=elem('div','window-controls');windowControls.hidden=true;windowControls.setAttribute('aria-label','窗口控制');
for(const [id,label,path] of [['minimize','最小化','M5 12h14'],['maximize','最大化或还原','M6 5h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z'],['close','关闭窗口','m6 6 12 12M6 18 18 6']]){const button=actionButton('',()=>nativeWindowAction(id),'window-'+id);button.id='window-'+id;button.title=label;button.setAttribute('aria-label',label);button.append(chromeGlyph(path));windowControls.append(button)}appMenu.append(windowControls);
async function nativeWindowAction(action){const bridge=window.pywebview?.api;if(typeof bridge?.window_control!=='function')return;try{const result=await bridge.window_control(action);$('#window-maximize').setAttribute('aria-pressed',String(!!result?.maximized))}catch(error){toast(error.message)}}
function showNativeChrome(){if(typeof window.pywebview?.api?.window_control==='function'){windowControls.hidden=false;document.body.classList.add('native-chrome')}}
let chromeFrame=0,nativeChromeReady=false,lastChromePress=null;
window.reportWindowChrome=function(){if(chromeFrame)return;chromeFrame=requestAnimationFrame(()=>{chromeFrame=0;const bridge=window.pywebview?.api;if(typeof bridge?.window_chrome!=='function')return;const box=$('#window-maximize').getBoundingClientRect(),scale=window.devicePixelRatio||1;bridge.window_chrome({maximize:[box.left*scale,box.top*scale,box.right*scale,box.bottom*scale]}).then(result=>{nativeChromeReady=!!result.ready}).catch(()=>{})})};
new ResizeObserver(window.reportWindowChrome).observe(appMenu);window.addEventListener('resize',window.reportWindowChrome);window.addEventListener('pywebviewready',window.reportWindowChrome);
window.addEventListener('pywebviewready',showNativeChrome);showNativeChrome();
appMenu.addEventListener('mousedown',event=>{if(!nativeChromeReady||event.button!==0||![appMenu,titlebarDrag].includes(event.target))return;event.preventDefault();event.stopPropagation();const now=performance.now(),double=lastChromePress&&now-lastChromePress.time<350&&Math.abs(event.screenX-lastChromePress.x)<5&&Math.abs(event.screenY-lastChromePress.y)<5;lastChromePress={time:now,x:event.screenX,y:event.screenY};if(double)nativeWindowAction('maximize');else window.pywebview.api.window_drag().catch(error=>toast(error.message))});
titlebarDrag.addEventListener('dblclick',()=>{if(!nativeChromeReady)nativeWindowAction('maximize')});
function syncHistoryButtons(){historyBack.title=uiText('后退');historyForward.title=uiText('前进')}
syncHistoryButtons();

// Small drafts keep a single text row; longer drafts grow within a bounded height.
function sizeCompactComposer(){const input=$('#chat-input');if(!input.value){input.style.height='36px';return}if(document.hidden||input.clientWidth<80)return;input.style.height='36px';input.style.height=Math.min(142,Math.max(36,input.scrollHeight))+'px'}
$('#chat-input').rows=1;$('#chat-input').addEventListener('input',sizeCompactComposer);window.addEventListener('resize',sizeCompactComposer);
const beforeCompactMessages=renderMessages;renderMessages=function(){beforeCompactMessages();sizeCompactComposer()};sizeCompactComposer();
