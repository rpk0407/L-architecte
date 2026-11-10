(function(){
'use strict';
var $=function(s,r){return (r||document).querySelector(s)};
function el(t,a,h){var e=document.createElement(t);if(a)for(var k in a){if(k==='class')e.className=a[k];else if(k==='text')e.textContent=a[k];else e.setAttribute(k,a[k])}if(h!==undefined)e.innerHTML=h;return e}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
var MEMOJI={jkut:'img/jkut.png',soldat:'img/soldat.jpeg',esteban:'img/esteban.png',frank:'img/frank.png'};
/* the original site's order */
var ORDER=['jkut','soldat','esteban','frank'];
var CATS=[['coupes','Coupes'],['look','Changer de tête'],['barbe','Barbe']];
var S={step:1,staff:null,cat:'coupes',ids:[],days:null,day:null,m:null,slotStaff:null,holdId:null,done:null,busy:false,nexts:null,err:'',loading:false};
var bk=$('#bk');

/* ---------- services (the menu) ---------- */
function renderMenu(){
  var m=$('#menu');m.innerHTML='';
  CATS.forEach(function(c){
    var box=el('div');box.appendChild(el('h3',{text:c[1]}));
    LA.services().filter(function(s){return s.cat===c[0]}).forEach(function(s){
      var best=s.id==='ct';
      var r=el('div',{class:'row'+(best?' best':'')});
      r.innerHTML='<div class="n"><b>'+esc(s.name)+(best?'<span class="tg">La plus complète</span>':'')+'</b><small>'+s.dur+' min · '+esc(s.inc.join(' · '))+(s.note?' — '+esc(s.note):'')+'</small></div><span class="p">'+LA.eur(s.price,s.from)+'</span>';
      var g=el('button',{class:'go',type:'button','aria-label':'Réserver : '+s.name},'Réserver cette formule');
      g.addEventListener('click',function(){
        S.ids=[s.id];S.cat=s.cat;S.day=S.m=null;S.days=null;
        if(S.holdId){LA.release(S.holdId);S.holdId=null}
        S.step=S.staff?3:1;if(S.staff)loadDays();render();toBooking();
      });
      r.appendChild(g);box.appendChild(r);
    });
    m.appendChild(box);
  });
}
function toBooking(){var t=$('#reserver');if(t)t.scrollIntoView({block:'start'})}

/* ---------- helpers ---------- */
function nowMin(){var n=new Date();return n.getHours()*60+n.getMinutes()}
function lowerFirst(s){return s.charAt(0).toLowerCase()+s.slice(1)}
function liveText(n){
  if(!n)return {c:'',t:'complet sur 14 jours'};
  var today=LA.iso(new Date());
  if(n.day===today&&LA.openNow()&&n.m<=nowMin()+45)return {c:' now',t:'libre maintenant'};
  return {c:'',t:'prochain créneau : '+lowerFirst(LA.dayLabel(n.day))+' '+LA.hhmm(n.m)};
}
function firstFree(){
  var best=null;if(!S.nexts)return null;
  Object.keys(S.nexts).forEach(function(k){var n=S.nexts[k];if(n&&(!best||n.day<best.day||(n.day===best.day&&n.m<best.m)))best=n});
  return best;
}
function staffName(id){return id==='any'?'Le premier de libre':LA.barber(id).name}
function summary(i){
  if(i===1)return S.staff?staffName(S.staff):'';
  if(i===2)return S.ids.length?LA.service(S.ids[0]).name+' · '+LA.eur(LA.service(S.ids[0]).price,LA.service(S.ids[0]).from):'';
  if(i===3)return S.m!=null?LA.dayLabel(S.day)+' à '+LA.hhmm(S.m)+(S.slotStaff?' · '+LA.barber(S.slotStaff).name:''):'';
  return '';
}
function goStep(i){
  if(i<=S.step){
    if(i<3&&S.holdId){LA.release(S.holdId);S.holdId=null}
    S.step=i;S.err='';if(i===3&&!S.days)loadDays();render();focusStep(i);
  }
}
function focusStep(i){setTimeout(function(){var h=$('#st'+i+' .step-t');if(h){h.setAttribute('tabindex','-1');h.focus({preventScroll:true});h.scrollIntoView({block:'start',behavior:'smooth'})}},30)}

/* ---------- barbers on the page: the entry ---------- */
function renderTeam(){
  var t=$('#team');t.innerHTML='';
  ORDER.forEach(function(id){
    var x=LA.barber(id);
    var b=el('button',{class:'bb',type:'button','aria-pressed':String(S.staff===id),'aria-label':'Réserver avec '+x.name});
    var lv=S.nexts?liveText(S.nexts[id]):null;
    b.innerHTML='<h3>'+esc(x.name)+'</h3><span class="av"><img src="'+MEMOJI[id]+'" alt="" width="150" height="150" loading="lazy"></span>'+
      (lv?'<span class="st'+lv.c+'">'+esc(lv.t)+'</span>':'<span class="st"><span class="sk" aria-hidden="true"></span></span>')+'<span class="cta">Réserver</span>';
    b.addEventListener('click',function(){pickStaff(id,true)});
    t.appendChild(b);
  });
  var a=$('#any');a.innerHTML='';
  var f=firstFree(),lv=S.nexts?liveText(f):null;
  var any=el('button',{type:'button','aria-pressed':String(S.staff==='any')},'Le premier de libre'+(lv?' <small>· '+esc(lv.t)+'</small>':''));
  any.addEventListener('click',function(){pickStaff('any',true)});
  a.appendChild(any);
}
function pickStaff(id,scroll){
  if(S.holdId){LA.release(S.holdId);S.holdId=null}
  S.staff=id;S.day=S.m=null;S.days=null;S.err='';S.done=null;
  S.step=S.ids.length?3:2;if(S.step===3)loadDays();
  renderTeam();render();
  if(scroll){toBooking();setTimeout(function(){focusStep(S.step)},350)}
}

/* ---------- booking panel ---------- */
function progress(){
  var n=S.done?4:S.step;
  $('#prog-i').style.width=(n*25)+'%';
  $('#prog-l').textContent=S.done?'Réservation confirmée':'Étape '+n+' sur 4';
  $('#bk-sub').textContent=S.done?'Merci, à très vite.':['De quoi avez-vous besoin ?','Quelle formule ?','Quel jour, quelle heure ?','Plus que vos coordonnées'][n-1];
}
function render(){
  bk.innerHTML='';progress();
  if(S.done){renderDone();return}
  var titles=['Votre barbier','Votre formule','Votre créneau','Vos coordonnées'];
  for(var i=1;i<=4;i++){
    (function(i){
      var st=el('div',{class:'step'+(S.step===i?' cur':'')+(i<S.step?' done':''),id:'st'+i});
      var h=el('div',{class:'step-h'});
      h.appendChild(el('span',{class:'step-n','aria-hidden':'true',text:i<S.step?'✓':String(i)}));
      h.appendChild(el('span',{class:'step-t',text:titles[i-1]}));
      if(i<S.step){
        h.appendChild(el('span',{class:'step-s',text:summary(i)}));
        var ed=el('button',{class:'step-edit',type:'button','aria-label':'Modifier : '+titles[i-1]},'Modifier');
        ed.addEventListener('click',function(){goStep(i)});
        h.appendChild(ed);
      }
      st.appendChild(h);
      var b=el('div',{class:'step-b'});st.appendChild(b);
      if(S.step===i)[null,r1,r2,r3,r4][i](b);
      bk.appendChild(st);
    })(i);
  }
}

function r1(b){
  var c=el('div',{class:'chips',role:'group','aria-label':'Barbiers'});
  ORDER.forEach(function(id){
    var x=LA.barber(id),lv=S.nexts?liveText(S.nexts[id]):null;
    var btn=el('button',{class:'mc',type:'button','aria-pressed':String(S.staff===id)});
    btn.innerHTML='<span class="av"><img src="'+MEMOJI[id]+'" alt="" width="42" height="42"></span><span>'+esc(x.name)+(lv?'<small>'+esc(lv.t)+'</small>':'')+'</span>';
    btn.addEventListener('click',function(){pickStaff(id,false);focusStep(S.step)});
    c.appendChild(btn);
  });
  var f=firstFree(),lv=S.nexts?liveText(f):null;
  var any=el('button',{class:'mc',type:'button','aria-pressed':String(S.staff==='any')});
  any.innerHTML='<span class="av" aria-hidden="true" style="font-size:20px;color:#be4141">★</span><span>Le premier de libre'+(lv?'<small>'+esc(lv.t)+'</small>':'')+'</span>';
  any.addEventListener('click',function(){pickStaff('any',false);focusStep(S.step)});
  c.appendChild(any);
  b.appendChild(c);
}

function r2(b){
  var cats=el('div',{class:'cats',role:'group','aria-label':'Catégories'});
  CATS.forEach(function(c){var x=el('button',{class:'chip',type:'button','aria-pressed':String(S.cat===c[0]),text:c[1]});x.addEventListener('click',function(){S.cat=c[0];render()});cats.appendChild(x)});
  b.appendChild(cats);
  var l=el('div',{class:'fl',role:'group','aria-label':'Formules'});
  LA.services().filter(function(s){return s.cat===S.cat}).forEach(function(s){
    var o=el('button',{class:'fo',type:'button','aria-pressed':String(S.ids[0]===s.id)});
    o.innerHTML='<span><b>'+esc(s.name)+(s.tag?'<span class="tg">'+esc(s.tag)+'</span>':'')+'</b><small>'+s.dur+' min · '+esc(s.inc.slice(0,4).join(', '))+'</small></span><span class="pr">'+LA.eur(s.price,s.from)+'</span>';
    o.addEventListener('click',function(){S.ids=[s.id];S.day=S.m=null;S.days=null;S.step=3;loadDays();render();focusStep(3)});
    l.appendChild(o);
  });
  b.appendChild(l);
}

function loadDays(){
  S.loading=true;var ids=S.ids.slice(),staff=S.staff;
  LA.availability(ids,staff,LA.iso(new Date()),14).then(function(d){
    if(ids.join()!==S.ids.join()||staff!==S.staff)return;
    S.days=d;S.loading=false;
    var cur=d.filter(function(x){return x.day===S.day&&x.slots.length})[0];
    if(!cur){var f=d.filter(function(x){return x.slots.length})[0];S.day=f?f.day:null}
    if(S.step===3)render();
  }).catch(function(){S.loading=false;S.days=[];S.err='Impossible de charger les créneaux. Réessayez ou appelez le salon.';if(S.step===3)render()});
}
function uniqTimes(slots){var seen={},o=[];slots.forEach(function(s){if(!seen[s.m]){seen[s.m]=1;o.push(s)}});return o}
function r3(b){
  if(S.err)b.appendChild(el('div',{class:'alert',role:'alert',text:S.err}));
  if(!S.days){b.appendChild(el('p',{class:'note',text:'Chargement des créneaux…'}));return}
  var days=el('div',{class:'days',role:'group','aria-label':'Jours'});
  S.days.forEach(function(d){
    var ds=LA.dayShort(d.day),n=uniqTimes(d.slots).length;
    var x=el('button',{class:'dy',type:'button','aria-pressed':String(S.day===d.day),'aria-label':LA.dayLabel(d.day)+(n?'':', indisponible')});
    x.innerHTML='<small>'+ds.dow+'.</small><b>'+ds.n+'</b><span>'+(d.open?(n?n+' créneaux':'complet'):'fermé')+'</span>';
    if(!n)x.disabled=true;
    x.addEventListener('click',function(){S.day=d.day;S.m=null;render()});
    days.appendChild(x);
  });
  b.appendChild(days);
  var cur=S.days.filter(function(x){return x.day===S.day})[0];
  if(!cur){b.appendChild(el('p',{class:'note',text:'Aucun créneau sur les 14 prochains jours. Appelez le salon, ou choisissez un autre barbier.'}));return}
  b.appendChild(el('div',{class:'dayl',text:LA.dayLabel(S.day)}));
  var ts=uniqTimes(cur.slots);
  [['Matin',0,720],['Après-midi',720,1440]].forEach(function(p){
    var g=ts.filter(function(s){return s.m>=p[1]&&s.m<p[2]});if(!g.length)return;
    b.appendChild(el('div',{class:'part',text:p[0]}));
    var w=el('div',{class:'times',role:'group','aria-label':p[0]});
    g.forEach(function(s){
      var t=el('button',{class:'tm',type:'button','aria-pressed':String(S.m===s.m),text:LA.hhmm(s.m)});
      t.addEventListener('click',function(){pickTime(s,t)});
      w.appendChild(t);
    });
    b.appendChild(w);
  });
  b.appendChild(el('p',{class:'note',style:'margin-top:14px',text:S.staff==='any'?'Le barbier est choisi parmi ceux qui sont libres à cette heure.':'Créneaux de '+LA.barber(S.staff).name+'.'}));
}
function pickTime(s,btn){
  if(S.busy)return;S.busy=true;btn.disabled=true;
  LA.hold(S.ids,s.s,S.day,s.m,S.holdId).then(function(h){
    S.busy=false;S.holdId=h.holdId;S.m=s.m;S.slotStaff=s.s;S.err='';S.step=4;render();focusStep(4);
  }).catch(function(e){
    S.busy=false;S.m=null;S.holdId=null;
    S.err=(e&&(e.code==='taken'||e.status===409))?'Ce créneau vient d’être pris. Choisissez-en un autre, vos choix sont gardés.':((e&&e.message)||'Impossible de garder ce créneau.');
    S.days=null;loadDays();render();
  });
}

function r4(b){
  var t=LA.total(S.ids),sv=LA.service(S.ids[0]);
  var rc=el('div',{class:'recap'});
  rc.innerHTML='<span><b>'+esc(sv.name)+'</b></span><span>'+esc(LA.dayLabel(S.day))+' à <b>'+LA.hhmm(S.m)+'</b></span><span>avec <b>'+esc(LA.barber(S.slotStaff).name)+'</b></span><span><b>'+LA.eur(t.price,t.from)+'</b> · à régler au salon</span>';
  b.appendChild(rc);
  if(S.err)b.appendChild(el('div',{class:'alert',role:'alert',text:S.err}));
  var f=el('form',{novalidate:'novalidate',class:'fg'});
  f.innerHTML=
   '<div class="fld"><label for="f-first">Prénom</label><input id="f-first" type="text" name="first" autocomplete="given-name" required><span class="err" id="e-first"></span></div>'+
   '<div class="fld"><label for="f-last">Nom <i>(facultatif)</i></label><input id="f-last" type="text" name="last" autocomplete="family-name"></div>'+
   '<div class="fld"><label for="f-phone">Téléphone portable</label><input id="f-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="06 12 34 56 78" required><span class="err" id="e-phone"></span></div>'+
   '<div class="fld"><label for="f-mail">E-mail <i>(facultatif)</i></label><input id="f-mail" name="email" type="email" inputmode="email" autocomplete="email" placeholder="pour recevoir la confirmation"><span class="err" id="e-mail"></span></div>'+
   '<label class="ck full"><input type="checkbox" name="marketing"><span>J’accepte de recevoir les offres du salon par SMS (facultatif).</span></label>'+
   '<div class="fld full"><button class="btn" type="submit" id="f-go">Confirmer mon rendez-vous</button><p class="hold">Créneau gardé pour vous quelques minutes. Vous recevrez une confirmation par SMS, et par e-mail si vous laissez votre adresse.</p></div>';
  f.addEventListener('submit',function(ev){ev.preventDefault();submit(f)});
  b.appendChild(f);
  try{var sf=JSON.parse(sessionStorage.getItem('la-c-me')||'{}');['first','last','phone','email'].forEach(function(k){if(sf[k])f.elements[k].value=sf[k]})}catch(e){}
}
function bad(id,input,msg){$('#'+id).textContent=msg;input.setAttribute('aria-invalid','true')}
function submit(f){
  ['first','phone','email'].forEach(function(k){f.elements[k].removeAttribute('aria-invalid')});['e-first','e-phone','e-mail'].forEach(function(i){$('#'+i).textContent=''});
  var first=f.elements.first.value.trim(),phone=f.elements.phone.value.replace(/[\s.\-]/g,''),mail=f.elements.email.value.trim(),ok=true,focus=null;
  if(first.length<2||/[:\/]/.test(first)){bad('e-first',f.elements.first,'Votre prénom, sans « : » ni « / ».');ok=false;focus=focus||f.elements.first}
  if(!/^(\+|00)?\d{9,14}$/.test(phone)){bad('e-phone',f.elements.phone,'Un numéro de portable valide, pour le SMS.');ok=false;focus=focus||f.elements.phone}
  if(mail&&!/^\S+@\S+\.\S+$/.test(mail)){bad('e-mail',f.elements.email,'Cette adresse ne semble pas valide.');ok=false;focus=focus||f.elements.email}
  if(!ok){focus.focus();return}
  if(S.busy)return;S.busy=true;var go=$('#f-go');go.disabled=true;go.textContent='Confirmation…';
  var p={ids:S.ids.slice(),staff:S.slotStaff,day:S.day,m:S.m,holdId:S.holdId,first:first,last:f.elements.last.value.trim(),phone:phone,email:mail,sms:true,marketing:f.elements.marketing.checked};
  try{sessionStorage.setItem('la-c-me',JSON.stringify({first:p.first,last:p.last,phone:f.elements.phone.value,email:mail}))}catch(e){}
  LA.book(p).then(function(r){
    S.busy=false;S.done={r:r,p:p};S.holdId=null;render();
    var d=$('#done-h');if(d){d.setAttribute('tabindex','-1');d.focus({preventScroll:true});d.scrollIntoView({block:'start',behavior:'smooth'})}
  }).catch(function(e){
    S.busy=false;S.holdId=null;
    if(e&&(e.code==='taken'||e.status===409)){S.err='Ce créneau vient d’être pris. Choisissez-en un autre, vos choix sont gardés.';S.m=null;S.step=3;S.days=null;loadDays();render();focusStep(3)}
    else{S.err=(e&&e.message)||'Une erreur est survenue. Réessayez, ou appelez le salon.';render();focusStep(4)}
  });
}
function renderDone(){
  var d=S.done,p=d.p,r=d.r,t=LA.total(p.ids),sv=LA.service(p.ids[0]);
  var o=el('div',{class:'ok',id:'done'});
  var pend=r&&r.status==='pending'&&r.deposit>0;
  o.innerHTML='<p class="eyebrow">'+(pend?'Presque terminé':'C’est réservé')+'</p><h3 id="done-h">'+esc(LA.dayLabel(p.day))+' à '+LA.hhmm(p.m)+'.</h3>'+
   '<p class="big">'+esc(sv.name)+' avec '+esc(LA.barber(p.staff).name)+' · '+LA.eur(t.price,t.from)+' à régler au salon'+(r&&r.code?' · réf. <span class="code">'+esc(r.code)+'</span>':'')+'</p>'+
   '<ul><li>Confirmation par SMS envoyée au '+esc(p.phone)+(p.email?', et par e-mail à '+esc(p.email)+' (avec le fichier agenda).':'. Laissez votre e-mail la prochaine fois pour la recevoir aussi par e-mail.')+'</li>'+
   '<li>Rappel par SMS la veille à 18&nbsp;h.</li><li>Un empêchement&nbsp;? Déplacez ou annulez en un geste depuis votre SMS.</li><li>16, place Pélabon, Marseille 13e.</li></ul>'+
   (LA.isDemo()?'<p class="note" style="margin-bottom:16px">Mode démo : rien n’a été réellement envoyé.</p>':'');
  var a=el('div',{class:'acts'});
  a.appendChild(el('a',{class:'btn',href:LA.ics({ids:p.ids,day:p.day,m:p.m,code:r&&r.code}),download:'rendez-vous-larchitecte.ics'},'Ajouter à mon agenda'));
  if(r&&r.manage&&r.manage!=='#')a.appendChild(el('a',{class:'btn dark',href:r.manage},'Gérer mon rendez-vous'));
  var nw=el('button',{class:'btn ghost',type:'button'},'Réserver un autre rendez-vous');nw.addEventListener('click',reset);a.appendChild(nw);
  o.appendChild(a);bk.appendChild(o);
}
function reset(){S.step=1;S.staff=null;S.ids=[];S.days=null;S.day=S.m=S.slotStaff=S.holdId=S.done=null;S.err='';loadNexts();renderTeam();render();toBooking()}
function loadNexts(){S.nexts=null;renderTeam();LA.nextByBarber(['cl']).then(function(n){S.nexts=n;renderTeam();if(S.step===1&&!S.done)render()}).catch(function(){S.nexts={};renderTeam();if(S.step===1)render()})}

/* ---------- contact form ---------- */
function contact(){
  var f=$('#cform');if(!f)return;
  f.addEventListener('submit',function(ev){
    ev.preventDefault();
    var nom=f.elements.first.value.trim(),mail=f.elements.email.value.trim(),msg=f.elements.message.value.trim(),ok=true;
    ['ce-nom','ce-mail','ce-msg'].forEach(function(i){$('#'+i).textContent=''});['first','email','message'].forEach(function(k){f.elements[k].removeAttribute('aria-invalid')});
    function b(id,k,t){$('#'+id).textContent=t;f.elements[k].setAttribute('aria-invalid','true');ok=false}
    if(nom.length<1)b('ce-nom','first','Indiquez votre nom.');
    if(!/^\S+@\S+\.\S+$/.test(mail))b('ce-mail','email','Vérifiez votre adresse e-mail.');
    if(msg.length<2)b('ce-msg','message','Écrivez votre message.');
    if(!ok){f.querySelector('[aria-invalid]').focus();return}
    var go=$('#c-go');go.disabled=true;go.textContent='Envoi…';
    var done=function(){$('#cwrap').innerHTML='<div class="cok" role="status">Merci, votre message est bien parti. Nous vous répondons rapidement.</div>'};
    if(LA.isDemo()){setTimeout(done,500);return}
    fetch('/api/public/inquiries',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'contact',first:nom,email:mail,message:msg,website:f.elements.website.value})})
      .then(function(r){return r.json().catch(function(){return {}}).then(function(j){if(!r.ok){var x=j.error||j;throw new Error(x.message||'Envoi impossible.')}done()})})
      .catch(function(e){go.disabled=false;go.textContent='Envoyer';$('#ce-msg').textContent=(e&&e.message)||'Envoi impossible. Écrivez-nous à larchitectebarber@gmail.com.'});
  });
}

window.addEventListener('pagehide',function(){if(S.holdId)LA.release(S.holdId)});
renderMenu();renderTeam();render();contact();
LA.init().then(function(r){if(r.demo)$('#demo').classList.add('on');loadNexts()});
})();
