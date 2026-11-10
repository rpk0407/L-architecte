(function(){
var $=function(s,r){return(r||document).querySelector(s)};
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
var NB=LA.NB, FAV=['cl','cc','ct'];
var st={step:1,ids:[],staff:'any',day:null,m:null,sStaff:null,holdId:null,days:[],loading:false,msg:'',done:null,heroId:'cc',nexts:null,returnFocus:null};
try{var h=localStorage.getItem('ar_formule');if(h&&LA.service(h))st.heroId=h}catch(e){}
function ph(m){return LA.hhmmShort(m)}
function when(day,m){return LA.dayLabel(day).toLowerCase()+' à '+LA.hhmm(m)}

/* ---------- status ---------- */
function status(){
  var n=new Date(),dow=n.getDay(),m=n.getHours()*60+n.getMinutes(),el=$('#status'),t;
  if(LA.openNow()){el.classList.add('open');t='Ouvert · 18 h 30'}
  else{el.classList.remove('open');
    if(dow>=2&&dow<=6&&m<540)t='Ouvre à 9 h';
    else{var d=new Date(n);do{d.setDate(d.getDate()+1)}while(d.getDay()<2||d.getDay()>6);var diff=Math.round((new Date(d.getFullYear(),d.getMonth(),d.getDate())-new Date(n.getFullYear(),n.getMonth(),n.getDate()))/864e5);
      t='Ouvre '+(diff===1?'demain':LA.DAYS[d.getDay()])+' 9 h'}}
  $('#stxt').textContent=t;
}

/* ---------- hero: next slots ---------- */
function renderFchips(){
  $('#fchips').innerHTML=FAV.concat(FAV.indexOf(st.heroId)<0?[st.heroId]:[]).map(function(i){var s=LA.service(i);return'<button type="button" class="fchip" data-f="'+i+'" aria-pressed="'+(i===st.heroId)+'">'+esc(s.name.replace('Coupe + ','+ '))+' · '+LA.eur(s.price,s.from)+'</button>'}).join('');
}
function loadNexts(){
  var box=$('#nexts');
  box.innerHTML=LA.barbers().map(function(b){return'<div class="next skel" aria-hidden="true"><small>'+esc(b.name)+'</small><b>00:00</b><span>Aujourd’hui</span></div>'}).join('');
  var ids=[st.heroId];
  LA.nextByBarber(ids).then(function(o){
    st.nexts=o;
    box.innerHTML=LA.barbers().map(function(b){var x=o[b.id];
      return x?'<button type="button" class="next" data-b="'+b.id+'" data-d="'+x.day+'" data-m="'+x.m+'"><small>'+esc(b.name)+'</small><b>'+ph(x.m)+'</b><span>'+LA.dayLabel(x.day)+'</span></button>'
             :'<div class="next" style="opacity:.5"><small>'+esc(b.name)+'</small><b>—</b><span>Complet sous 14 j</span></div>'}).join('');
    var best=null;LA.barbers().forEach(function(b){var x=o[b.id];if(x&&(!best||x.day<best.x.day||(x.day===best.x.day&&x.m<best.x.m)))best={b:b,x:x}});
    if(best){$('#bbs').textContent='Prochain créneau · '+LA.dayLabel(best.x.day);$('#bbt').textContent=ph(best.x.m)+' avec '+best.b.name}
    else{$('#bbs').textContent='Réservation en ligne';$('#bbt').textContent='Choisir un créneau'}
  }).catch(function(){box.innerHTML='<p class="note" style="grid-column:1/-1">Impossible de charger les créneaux. Touche « Voir tout » ou écris-nous.</p>'});
}

/* ---------- static sections ---------- */
function renderMenu(){
  var cats=[['coupes','Coupes'],['look','Changer de tête'],['barbe','Barbe']],h='';
  cats.forEach(function(c){h+='<div class="cat"><h3>'+c[1]+'</h3>';
    LA.services().filter(function(s){return s.cat===c[0]}).forEach(function(s){
      h+='<button type="button" class="row" data-s="'+s.id+'"><span class="n">'+esc(s.name)+(s.tag?'<span class="tag">'+esc(s.tag)+'</span>':'')+'</span><span class="p">'+LA.eur(s.price,s.from)+'</span><span class="m">'+s.dur+' min · '+esc(s.inc.join(' · '))+(s.note?' · '+esc(s.note):'')+'</span></button>'});
    h+='</div>'});
  $('#menu').innerHTML=h;
}
function renderBarbers(){
  $('#barbers').innerHTML=LA.barbers().map(function(b){return'<article class="bar"><div class="ph"><div class="av" aria-hidden="true">'+b.initials+'</div><div><h3>'+esc(b.name)+'</h3></div></div><p>'+esc(b.line)+'</p><button type="button" class="next" data-pick="'+b.id+'" data-nx="'+b.id+'"><small>Prochain créneau</small><b>…</b><span>&nbsp;</span></button></article>'}).join('');
}
function fillBarberNexts(){
  document.querySelectorAll('[data-nx]').forEach(function(el){var x=st.nexts&&st.nexts[el.dataset.nx];
    el.innerHTML=x?'<small>Prochain créneau · '+LA.dayLabel(x.day)+'</small><b>'+ph(x.m)+'</b><span>Réserver avec '+esc(LA.barber(el.dataset.nx).name)+'</span>':'<small>Prochain créneau</small><b>—</b><span>Voir le planning</span>'});
}

/* ---------- sheet ---------- */
var sheet=$('#sheet'),veil=$('#veil'),B=$('#shB'),F=$('#shF');
function openSheet(step,opts){
  opts=opts||{};st.returnFocus=document.activeElement;
  if(!st.done||opts.fresh){if(st.done)reset();}
  if(opts.ids)st.ids=opts.ids;if(opts.staff)st.staff=opts.staff;
  st.msg=opts.msg||'';
  sheet.classList.add('on');veil.classList.add('on');document.body.style.overflow='hidden';
  go(step||(st.ids.length?2:1));
}
function closeSheet(){
  if(st.holdId&&!st.done){LA.release(st.holdId);st.holdId=null}
  sheet.classList.remove('on');veil.classList.remove('on');document.body.style.overflow='';
  if(st.done)reset();
  if(st.returnFocus&&st.returnFocus.focus)try{st.returnFocus.focus()}catch(e){}
}
function reset(){st.ids=[];st.staff='any';st.day=null;st.m=null;st.sStaff=null;st.holdId=null;st.days=[];st.done=null;st.msg=''}
function go(n){
  st.step=n;
  var titles={1:'Ta formule',2:'Ton créneau',3:'Tes coordonnées',4:'C’est réservé'};
  $('#shT').textContent=titles[n];
  document.querySelectorAll('#prog i').forEach(function(i,k){i.classList.toggle('on',k<Math.min(n,3))});
  $('#prog').style.display=n===4?'none':'flex';
  $('#shBack').hidden=(n===1||n===4);
  if(n===1)view1();else if(n===2)view2();else if(n===3)view3();else view4();
  B.scrollTop=0;setTimeout(function(){var f=B.querySelector('[autofocus],input,button');if(f&&n===3)f.focus({preventScroll:true})},50);
}
function ticket(extra){
  var t=LA.total(st.ids),sv=st.ids.map(LA.service),b=st.sStaff||(st.staff!=='any'?st.staff:null);
  return'<div class="ticket" aria-label="Récapitulatif"><h3><span>Ticket</span><span>'+(st.done?'N° '+esc(st.done.code):'')+'</span></h3><div class="pole"></div><dl>'+
   '<dt>Formule</dt><dd>'+(sv.length?esc(sv[0].name):'—')+(extra&&st.step>1&&!st.done?' <button type="button" class="chg" data-chg="1">changer</button>':'')+'</dd>'+
   '<dt>Barbier</dt><dd>'+(b?esc(LA.barber(b).name):'Peu importe')+'</dd>'+
   '<dt>Quand</dt><dd>'+(st.day&&st.m!=null?esc(when(st.day,st.m)):'—')+'</dd>'+
   '<dt>Durée</dt><dd>'+(sv.length?t.dur+' min':'—')+'</dd></dl>'+
   '<div class="tot"><span>Total</span><span>'+(sv.length?LA.eur(t.price,t.from):'—')+'</span></div>'+
   (st.done?'<p style="margin-top:8px;font-size:13px">À régler au salon (carte bancaire).</p>':'')+'</div>';
}
function view1(){
  var cats=[['coupes','Coupes'],['look','Changer de tête'],['barbe','Barbe']],h='';
  if(st.msg)h+='<div class="alert" role="alert">'+esc(st.msg)+'</div>';
  cats.forEach(function(c){h+='<p class="opt-h">'+c[1]+'</p>';LA.services().filter(function(s){return s.cat===c[0]}).forEach(function(s){
    h+='<button type="button" class="opt" data-pick-s="'+s.id+'"><span class="n">'+esc(s.name)+'</span><span class="p">'+LA.eur(s.price,s.from)+'</span><span class="m">'+s.dur+' min'+(s.tag?' · '+esc(s.tag):'')+'</span></button>'})});
  B.innerHTML=h;F.hidden=true;
}
function view2(){
  var h=(st.msg?'<div class="alert" role="alert">'+esc(st.msg)+'</div>':'')+ticket(true);
  h+='<div class="pills" role="group" aria-label="Barbier"><button type="button" class="pill" data-st="any" aria-pressed="'+(st.staff==='any')+'">Peu importe</button>'+LA.barbers().map(function(b){return'<button type="button" class="pill" data-st="'+b.id+'" aria-pressed="'+(st.staff===b.id)+'">'+esc(b.name)+'</button>'}).join('')+'</div>';
  h+='<div class="pills" id="dp" role="group" aria-label="Jour">'+(st.loading?'<span class="note">Chargement…</span>':st.days.map(function(d){var s=LA.dayShort(d.day);return'<button type="button" class="dpill" data-day="'+d.day+'" aria-pressed="'+(st.day===d.day)+'" '+(d.slots.length?'':'disabled')+' aria-label="'+esc(LA.dayLabel(d.day))+(d.slots.length?'':', complet ou fermé')+'"><small>'+s.dow+'</small><b>'+s.n+'</b></button>'}).join(''))+'</div>';
  var cur=st.days.filter(function(d){return d.day===st.day})[0];
  if(st.loading)h+='<div class="slots">'+'<div class="slot skel">00</div>'.repeat(6)+'</div>';
  else if(!cur||!cur.slots.length)h+='<div class="empty">Aucun créneau ce jour-là. Essaie un autre jour ou un autre barbier.</div>';
  else{
    var seen={},list=cur.slots.filter(function(s){if(st.staff==='any'){if(seen[s.m])return false;seen[s.m]=1}return true});
    h+='<div class="slots" role="group" aria-label="Créneaux">'+list.map(function(s){return'<button type="button" class="slot" data-m="'+s.m+'" data-sb="'+s.s+'" aria-label="'+LA.hhmm(s.m)+(st.staff==='any'?'':' avec '+esc(LA.barber(s.s).name))+'">'+ph(s.m)+(st.staff==='any'?'':'<small>'+esc(LA.barber(s.s).name)+'</small>')+'</button>'}).join('')+'</div>';
  }
  B.innerHTML=h;F.hidden=true;
}
function loadDays(keepDay){
  st.loading=true;view2();
  LA.availability(st.ids,st.staff,LA.iso(new Date()),10).then(function(d){
    st.days=d;st.loading=false;
    var has=d.filter(function(x){return x.slots.length});
    if(!keepDay||!d.some(function(x){return x.day===st.day&&x.slots.length}))st.day=has.length?has[0].day:(d[0]&&d[0].day);
    if(st.step===2)view2();
  }).catch(function(){st.loading=false;st.days=[];st.msg='Impossible de charger les créneaux. Réessaie dans un instant.';if(st.step===2)view2()});
}
function pickSlot(m,sb){
  var btns=B.querySelectorAll('.slot');btns.forEach(function(b){b.disabled=true});
  var prev=st.holdId;
  LA.hold(st.ids,sb,st.day,m,prev).then(function(r){
    st.m=m;st.sStaff=sb;st.holdId=r.holdId;st.msg='';go(3);
  }).catch(function(e){
    st.holdId=null;st.msg=(e&&e.code==='taken')?'Ce créneau vient d’être pris. Choisis-en un autre, ta formule est gardée.':'Impossible de bloquer ce créneau. Réessaie.';
    loadDays(true);
  });
}
function view3(){
  var v=st.form||{};
  B.innerHTML=(st.msg?'<div class="alert" role="alert">'+esc(st.msg)+'</div>':'')+ticket(true)+
  '<p class="note" style="margin:0 0 14px">Créneau réservé pour toi pendant quelques minutes.</p>'+
  '<form id="f" novalidate><div class="fld"><label for="fn">Prénom</label><input id="fn" name="first" autocomplete="given-name" required value="'+esc(v.first)+'"><div class="err" id="e-fn" hidden></div></div>'+
  '<div class="fld"><label for="fp">Téléphone mobile</label><input id="fp" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="06 12 34 56 78" required value="'+esc(v.phone)+'"><small>Pour ta confirmation et ton rappel par SMS.</small><div class="err" id="e-fp" hidden></div></div>'+
  '<div class="fld"><label for="fe">E-mail <span style="color:var(--mute);font-weight:400">(facultatif)</span></label><input id="fe" name="email" type="email" inputmode="email" autocomplete="email" placeholder="toi@exemple.fr" value="'+esc(v.email)+'"><small>Pour recevoir aussi la confirmation par e-mail, avec l’invitation agenda.</small><div class="err" id="e-fe" hidden></div></div>'+
  '<p class="note">En réservant, tu acceptes les <a href="/cgv" target="_blank" rel="noopener">CGV</a>. Tes données servent uniquement à ce rendez-vous (<a href="/confidentialite" target="_blank" rel="noopener">confidentialité</a>).</p></form>';
  F.hidden=false;F.innerHTML='<button type="submit" form="f" class="btn" id="go">Confirmer · '+LA.eur(LA.total(st.ids).price,LA.total(st.ids).from)+'</button>';
}
function fieldErr(id,msg){var i=$('#'+id),e=$('#e-'+id);if(msg){i.setAttribute('aria-invalid','true');e.textContent=msg;e.hidden=false;i.setAttribute('aria-describedby','e-'+id)}else{i.removeAttribute('aria-invalid');e.hidden=true}return!msg}
function submit(ev){
  ev.preventDefault();
  var first=$('#fn').value.trim(),phone=$('#fp').value.replace(/[\s.\-]/g,''),email=$('#fe').value.trim();
  st.form={first:first,phone:$('#fp').value,email:email};
  var a=fieldErr('fn',first.length<2?'Ton prénom (2 lettres minimum).':(/[:\/]/.test(first)?'Pas de « : » ni « / » dans le prénom.':''));
  var b=fieldErr('fp',/^(\+33|0033|0)[1-9]\d{8}$/.test(phone)||/^\+\d{8,15}$/.test(phone)?'':'Numéro invalide, ex. 06 12 34 56 78.');
  var c=fieldErr('fe',!email||/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)?'':'Adresse e-mail invalide.');
  if(!(a&&b&&c)){var bad=B.querySelector('[aria-invalid]');if(bad)bad.focus();return}
  var btn=$('#go');btn.disabled=true;btn.textContent='Réservation…';
  var p={ids:st.ids,staff:st.sStaff,day:st.day,m:st.m,holdId:st.holdId,first:first,phone:phone,email:email,sms:true};
  LA.book(p).then(function(r){
    st.done={code:r.code,manage:r.manage,demo:r.demo,email:email,p:p};st.holdId=null;
    try{localStorage.setItem('ar_formule',st.ids[0])}catch(e){}
    go(4);loadNexts();
  }).catch(function(e){
    if(e&&(e.code==='taken'||e.status===409)){st.holdId=null;st.msg='Ce créneau vient d’être pris. Choisis-en un autre, tes choix sont gardés.';go(2);loadDays(true)}
    else{st.msg=(e&&e.message)||'La réservation a échoué. Réessaie ou appelle le salon.';view3();}
  });
}
function view4(){
  var d=st.done;
  B.innerHTML=ticket(false).replace('<div class="pole"></div>','<div class="pole"></div><div class="code" aria-label="Code '+esc(d.code)+'">'+esc(d.code)+'</div>')+
  '<ul class="ok-list"><li><i>✓</i><span>Confirmation envoyée par <b>SMS</b>'+(d.email?' et par <b>e-mail</b> à '+esc(d.email):'')+'.</span></li><li><i>✓</i><span>Rappel par <b>SMS la veille à 18 h</b>.</span></li><li><i>✓</i><span>16, place Pélabon, Marseille 13e. Paiement au salon.</span></li></ul>'+
  (d.demo?'<p class="note">Mode démo : aucun message réel n’est parti.</p>':'')+
  '<div class="acts"><a class="btn" download="rendez-vous-architecte.ics" href="'+LA.ics({day:d.p.day,m:d.p.m,ids:d.p.ids,code:d.code})+'">Ajouter à mon agenda</a>'+
  (d.manage&&d.manage!=='#'?'<a class="btn ghost" href="'+esc(d.manage)+'">Déplacer / annuler</a>':'<button type="button" class="btn ghost" disabled title="Disponible hors démo">Déplacer / annuler</button>')+
  '<a class="btn ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=L%27Architecte%20coiffeur&query_place_id=ChIJJSWkBLy_yRIRbgAQcMwb-JY">Itinéraire</a></div>';
  F.hidden=false;F.innerHTML='<button type="button" class="btn ghost" id="fin">Terminer</button>';
}

/* ---------- events ---------- */
document.addEventListener('click',function(e){
  var t=e.target.closest('button,a');if(!t)return;
  if(t.hasAttribute('data-open')){openSheet(st.ids.length?2:1,{ids:[],fresh:true});return}
  if(t.id==='seeAll'){openSheet(2,{ids:[st.heroId],fresh:true});loadDays();return}
  if(t.dataset.f){st.heroId=t.dataset.f;renderFchips();loadNexts();return}
  if(t.classList.contains('next')&&t.dataset.b&&t.dataset.d){ // hero chip → straight to form
    var ids=[st.heroId],b=t.dataset.b,d=t.dataset.d,m=+t.dataset.m;
    openSheet(2,{ids:ids,staff:b,fresh:true});st.day=d;st.loading=true;view2();
    LA.hold(ids,b,d,m).then(function(r){st.m=m;st.sStaff=b;st.holdId=r.holdId;st.msg='';go(3)}).catch(function(){st.msg='Ce créneau vient d’être pris. Voici les suivants.';loadDays()});
    return}
  if(t.dataset.s&&t.classList.contains('row')){openSheet(2,{ids:[t.dataset.s],fresh:true});loadDays();return}
  if(t.dataset.pick){var b2=t.dataset.pick;if(st.nexts&&st.nexts[b2]){openSheet(1,{fresh:true,staff:b2})}else openSheet(1,{fresh:true,staff:b2});return}
  if(t.dataset.pickS){st.ids=[t.dataset.pickS];st.msg='';go(2);loadDays();return}
  if(t.dataset.st){st.staff=t.dataset.st;st.msg='';loadDays();return}
  if(t.dataset.day){st.day=t.dataset.day;view2();return}
  if(t.classList.contains('slot')){pickSlot(+t.dataset.m,t.dataset.sb);return}
  if(t.dataset.chg){if(st.holdId){LA.release(st.holdId);st.holdId=null}st.m=null;st.sStaff=null;go(1);return}
  if(t.id==='shBack'){if(st.step===3){if(st.holdId){LA.release(st.holdId);st.holdId=null}st.m=null;st.sStaff=null;st.msg='';go(2);loadDays(true)}else if(st.step===2){st.msg='';go(1)}return}
  if(t.id==='shX'||t.id==='fin'){closeSheet();return}
});
veil.addEventListener('click',closeSheet);
document.addEventListener('submit',function(e){if(e.target.id==='f')submit(e)});
document.addEventListener('keydown',function(e){
  if(!sheet.classList.contains('on'))return;
  if(e.key==='Escape')closeSheet();
  if(e.key==='Tab'){var f=[].slice.call(sheet.querySelectorAll('button:not([disabled]),input,a[href]')).filter(function(x){return x.offsetParent&&!x.closest('[hidden]')});if(!f.length)return;var a=f[0],z=f[f.length-1];if(e.shiftKey&&document.activeElement===a){e.preventDefault();z.focus()}else if(!e.shiftKey&&document.activeElement===z){e.preventDefault();a.focus()}}
});

/* ---------- boot ---------- */
renderMenu();renderBarbers();renderFchips();status();setInterval(status,60000);
LA.init().then(function(r){
  if(r.demo)$('#demo').hidden=false;
  loadNexts();
  var iv=setInterval(function(){if(st.nexts){fillBarberNexts();clearInterval(iv)}},150);setTimeout(function(){clearInterval(iv)},8000);
});
var _ln=loadNexts;loadNexts=function(){_ln();var iv=setInterval(function(){if(st.nexts){fillBarberNexts();clearInterval(iv)}},150);setTimeout(function(){clearInterval(iv)},8000)};
})();
