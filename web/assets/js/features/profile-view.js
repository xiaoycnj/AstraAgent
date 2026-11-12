const regionField=field('所在国家/地区','profile-region');
const regionChoices=elem('datalist');regionChoices.id='profile-region-options';
for(const name of ['中国','中国（台湾）','中国（香港）','中国（澳门）','日本','韩国','新加坡','马来西亚','美国','加拿大','英国','法国','德国','澳大利亚','新西兰','其他'])regionChoices.append(new Option(name,name));
regionField.input.setAttribute('list',regionChoices.id);regionField.input.maxLength=120;profileForm.insertBefore(regionField.label,bioField.label);profileForm.append(regionChoices);
const profileReadView=elem('section','settings-group profile-read-view');const profileEditActions=elem('div','profile-edit-actions');
let profileEditing=false;
function drawProfileReadView(){
 profileReadView.replaceChildren();
 for(const [title,value] of [['身份或职业',localProfile.role],['所在国家/地区',localProfile.region],['关于我',localProfile.bio]]){const row=elem('div','profile-detail');row.append(elem('strong','',uiText(title)),elem('p','',value||uiText('未填写')));row.lastChild.dataset.i18nIgnore='';profileReadView.append(row);}
 regionField.input.value=localProfile.region||'';
}
function editProfile(value){profileEditing=value;profileForm.hidden=!value;profileReadView.hidden=value;profileEditActions.hidden=value;if(!value){avatarUpload.input.value='';pendingAvatar=localProfile.avatar;drawProfileHero(localProfile);drawProfileReadView();}else displayNameField.input.focus();}
profileEditActions.append(actionButton('编辑资料',()=>editProfile(true),'secondary'));
profileForm.append(actionButton('取消编辑',async()=>{await loadPersonal();editProfile(false)},'secondary'));
profilePanel.insertBefore(profileEditActions,profileForm);profilePanel.insertBefore(profileReadView,profileForm);
const beforeProfileLoad=loadPersonal;loadPersonal=async function(){await beforeProfileLoad();drawProfileReadView();if(!profileEditing)editProfile(false)};
profileForm.onsubmit=async function(event){event.preventDefault();profileSave.disabled=true;try{localProfile=await api('/api/profile','PUT',{display_name:displayNameField.input.value,username:handleField.input.value,role:roleField.input.value,region:regionField.input.value,bio:bioField.input.value,avatar:pendingAvatar,inject_profile:injectProfile.checked});userName.value=localProfile.display_name;editProfile(false);toast('本地资料已保存');}catch(error){toast(error.message)}finally{profileSave.disabled=false}};
editProfile(false);loadPersonal().catch(error=>toast(error.message));
