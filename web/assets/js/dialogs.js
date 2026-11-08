// Native browser dialogs are synchronous; application actions explicitly await these.
let appDialogQueue=Promise.resolve();
function appDialog(message,value=null){
 const run=()=>new Promise(resolve=>{
  const previous=document.activeElement,dialog=document.createElement('dialog');dialog.className='app-dialog';
  dialog.setAttribute('aria-labelledby','app-dialog-title');dialog.setAttribute('aria-describedby','app-dialog-message');
  const title=document.createElement('h2');title.id='app-dialog-title';title.textContent=typeof uiText==='function'?uiText(value===null?'请确认':'输入内容'):(value===null?'请确认':'输入内容');
  const text=document.createElement('p');text.id='app-dialog-message';text.textContent=typeof uiText==='function'?uiText(String(message)):String(message);
  const input=document.createElement('input');input.type='text';input.value=value??'';input.maxLength=2048;input.setAttribute('aria-label',String(message));
  const actions=document.createElement('div');actions.className='app-dialog-actions';
  const cancel=document.createElement('button'),accept=document.createElement('button');cancel.type=accept.type='button';cancel.className='secondary';accept.className='primary';
  cancel.textContent=typeof uiText==='function'?uiText('取消'):'取消';accept.textContent=typeof uiText==='function'?uiText('确认'):'确认';
  let result=value===null?false:null;
  const finish=ok=>{result=ok?(value===null?true:input.value):(value===null?false:null);dialog.close();};
  cancel.onclick=()=>finish(false);accept.onclick=()=>finish(true);dialog.oncancel=e=>{e.preventDefault();finish(false);};
  dialog.addEventListener('keydown',e=>e.stopPropagation());
  dialog.onclose=()=>{dialog.remove();if(previous?.isConnected)previous.focus();resolve(result);};
  input.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();finish(true);}};
  actions.append(cancel,accept);dialog.append(title,text);if(value!==null)dialog.append(input);dialog.append(actions);document.body.append(dialog);dialog.showModal();
  if(value!==null){input.focus();input.select();}else cancel.focus();
 });
 const result=appDialogQueue.then(run);appDialogQueue=result.catch(()=>{});return result;
}
function appConfirm(message){return appDialog(message);}
function appPrompt(message,value=''){return appDialog(message,String(value));}
