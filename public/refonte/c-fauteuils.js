(function(){
'use strict';
var NB=LA.NB, $=function(s,r){return (r||document).querySelector(s)};
function el(t,a,h){var e=document.createElement(t);if(a)for(var k in a){if(k==='class')e.className=a[k];else if(k==='text')e.textContent=a[k];else e.setAttribute(k,a[k])}if(h!==undefined)e.innerHTML=h;return e}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
var CATS=[['coupes','Coupes'],['look','Changer de tête'],['barbe','Barbe']];
var S={step:1,staff:null,cat:'coupes',ids:[],days:null,day:null,m:null,slotStaff:null,holdId:null,done:null,busy:false,nexts:null,err:'',loading:false};
var bk=$('#bk');

/* ---------- menu (carte) ---------- */
function renderMenu(){
  var m=$('#menu');m.innerHTML='';
  CATS.forEach(function(c){
    var box=el('div');box.appendChild(el('h3',{text:c[1]}));
    LA.services().filter(function(s){return s.cat===c[0]}).forEach(function(s){
      var best=s.id==='ct';
      var r=el('div',{class:'row'+(best?' best':'')});
      r.innerHTML='<div class="n"><b>'+esc(s.name)+(best?'<span class="bt">La plus complète</span>':'')+'</b><small>'+esc(s.inc.join(' · '))+(s.note?' — '+esc(s.note):'')+'</small></div><span class="d">'+s.dur+' min</span><span class="p">'+LA.eur(s.price,s.from)+'</span>';
      var g=el('button',{class:'go',type:'button','aria-label':'Réserver '+s.name},'Réserver');
      g.onclick=function(){S.ids=[s.id];S.cat=s.cat;S.step=S.staff?3:1;S.day=S.m=null;S.days=null;if(S.staff)loadDays();render();$('#reserver').scrollIntoView();};
      r.appendChild(g);box.appendChild(r);
    });
    m.appendChild(box);
  });
}

/* ---------- helpers ---------- */
function nowMin(){var n=new Date();return n.getHours()*60+n.getMinutes()}
function lowerFirst(s){return s.charAt(0).toLowerCase()+s.slice(1)}
function liveFor(n){
  if(!n)return '<span class="live">complet sur 14 jours</span>';
  var today=LA.iso(new Date());
  if(n.day===today&&LA.openNow()&&n.m<=nowMin()+45)return '<span class="live now">libre maintenant</span>';
  return '<span class="live soon">prochain créneau : '+esc(lowerFirst(LA.dayLabel(n.day)))+' '+LA.hhmm(n.m)+'</span>';
}
function firstFree(){
  var best=null;if(!S.nexts)return null;
  Object.keys(S.nexts).forEach(function(k){var n=S.nexts[k];if(n&&(!best||n.day<best.day||(n.day===best.day&&n.m<best.m)))best=n});
  return best;
}
function summary(i){
  if(i===1)return S.staff?(S.staff==='any'?'Le premier de libre':LA.barber(S.staff).name):'';
  if(i===2)return S.ids.length?LA.service(S.ids[0]).name+' · '+LA.eur(LA.service(S.ids[0]).price,LA.service(S.ids[0]).from):'';
  if(i===3)return S.m!=null?LA.dayLabel(S.day)+' à '+LA.hhmm(S.m)+(S.slotStaff?' · '+LA.barber(S.slotStaff).name:''):'';
  return '';
}
function goStep(i){
  if(i<S.step||i===S.step){
    if(i<3&&S.holdId){LA.release(S.holdId);S.holdId=null}
    S.step=i;S.err='';render();focusStep(i);
  }
}
function focusStep(i){setTimeout(function(){var h=$('#st'+i+' .step-t');if(h){h.setAttribute('tabindex','-1');h.focus({preventScroll:true});h.scrollIntoView({block:'start',behavior:'smooth'})}},30)}

/* ---------- render ---------- */
function render(){
  bk.innerHTML='';
  if(S.done){renderDone();return}
  var titles=['Choisis ton barbier','Choisis ta formule','Choisis ton créneau','Tes coordonnées'];
  for(var i=1;i<=4;i++){
    (function(i){
      var cls='step'+(S.step===i?' cur':'')+(i<S.step?' done':'');
      var st=el('div',{class:cls,id:'st'+i});
      var h=el('div',{class:'step-h'});
      var n=el('span',{class:'step-n','aria-hidden':'true',text:i<S.step?'✓':String(i)});
      var t=el('span',{class:'step-t',text:titles[i-1]});
      h.appendChild(n);h.appendChild(t);
      if(i<S.step){
        var sm=el('span',{class:'step-s',text:summary(i)});
        var ed=el('button',{class:'step-edit',type:'button','aria-label':'Modifier : '+titles[i-1]},'Modifier');
        ed.onclick=function(){goStep(i)};
        h.insertBefore(sm,null);h.appendChild(ed);
        t.style.flex='0 1 auto';sm.style.flex='1';
      }
      st.appendChild(h);
      var b=el('div',{class:'step-b'});st.appendChild(b);
      if(S.step===i){[null,r1,r2,r3,r4][i](b)}
      bk.appendChild(st);
    })(i);
  }
}

function r1(b){
  var c=el('div',{class:'cards',role:'group','aria-label':'Barbiers'});
  LA.barbers().forEach(function(x){
    var btn=el('button',{class:'bc',type:'button','aria-pressed':String(S.staff===x.id)});
    var n=S.nexts?S.nexts[x.id]:undefined;
    btn.innerHTML='<span class="mono" aria-hidden="true">'+x.initials+'</span><h3>'+esc(x.name)+'</h3><p>'+esc(x.line)+'</p>'+(S.nexts?liveFor(n):'<span class="sk" aria-hidden="true"></span>');
    btn.onclick=function(){pickStaff(x.id)};
    c.appendChild(btn);
  });
  var f=firstFree();
  var any=el('button',{class:'bc any',type:'button','aria-pressed':String(S.staff==='any')});
  any.innerHTML='<span class="mono" aria-hidden="true">★</span><h3>Le premier de libre</h3><p>Peu importe qui : tu as le créneau le plus proche.</p>'+(S.nexts?liveFor(f):'<span class="sk" aria-hidden="true"></span>');
  any.onclick=function(){pickStaff('any')};
  c.appendChild(any);
  b.appendChild(c);
}
function pickStaff(id){S.staff=id;S.day=S.m=null;S.days=null;S.step=S.ids.length?3:2;if(S.step===3)loadDays();render();focusStep(S.step)}

function r2(b){
  var cats=el('div',{class:'cats',role:'group','aria-label':'Catégories'});
  CATS.forEach(function(c){var x=el('button',{class:'chip',type:'button','aria-pressed':String(S.cat===c[0]),text:c[1]});x.onclick=function(){S.cat=c[0];render();};cats.appendChild(x)});
  b.appendChild(cats);
  var l=el('div',{class:'fl',role:'group','aria-label':'Formules'});
  LA.services().filter(function(s){return s.cat===S.cat}).forEach(function(s){
    var o=el('button',{class:'fo',type:'button','aria-pressed':String(S.ids[0]===s.id)});
    o.innerHTML='<span><b>'+esc(s.name)+(s.tag?'<span class="tg">'+esc(s.tag)+'</span>':'')+'</b><small>'+s.dur+' min · '+esc(s.inc.slice(0,4).join(', '))+'</small></span><span class="pr">'+LA.eur(s.price,s.from)+'</span>';
    o.onclick=function(){S.ids=[s.id];S.day=S.m=null;S.days=null;S.step=3;loadDays();render();focusStep(3)};
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
  }).catch(function(){S.loading=false;S.days=[];S.err='Impossible de charger les créneaux. Réessaie ou appelle le salon.';if(S.step===3)render()});
}
function uniqTimes(slots){var seen={},o=[];slots.forEach(function(s){if(!seen[s.m]){seen[s.m]=1;o.push(s)}});return o}
function r3(b){
  if(S.err){var a=el('div',{class:'alert',role:'alert',text:S.err});b.appendChild(a)}
  if(!S.days){b.appendChild(el('p',{class:'note',text:'Chargement des créneaux…'}));return}
  var days=el('div',{class:'days',role:'group','aria-label':'Jours'});
  S.days.forEach(function(d){
    var ds=LA.dayShort(d.day),n=d.slots.length;
    var x=el('button',{class:'dy',type:'button','aria-pressed':String(S.day===d.day),'aria-label':LA.dayLabel(d.day)+(n?'':', indisponible')});
    x.innerHTML='<small>'+ds.dow+'.</small><b>'+ds.n+'</b><span>'+(d.open?(n?n+' dispo':'complet'):'fermé')+'</span>';
    if(!n)x.disabled=true;
    x.onclick=function(){S.day=d.day;S.m=null;render()};
    days.appendChild(x);
  });
  b.appendChild(days);
  var cur=S.days.filter(function(x){return x.day===S.day})[0];
  if(!cur){b.appendChild(el('p',{class:'note',text:'Aucun créneau sur les 14 prochains jours. Appelle le salon, ou choisis un autre barbier.'}));return}
  b.appendChild(el('div',{class:'dayl',text:LA.dayLabel(S.day)}));
  var ts=uniqTimes(cur.slots),parts=[['Matin',0,720],['Après-midi',720,1440]];
  parts.forEach(function(p){
    var g=ts.filter(function(s){return s.m>=p[1]&&s.m<p[2]});if(!g.length)return;
    b.appendChild(el('div',{class:'part',text:p[0]}));
    var w=el('div',{class:'times',role:'group','aria-label':p[0]});
    g.forEach(function(s){
      var t=el('button',{class:'tm',type:'button','aria-pressed':String(S.m===s.m),text:LA.hhmm(s.m)});
      t.onclick=function(){pickTime(s,t)};
      w.appendChild(t);
    });
    b.appendChild(w);
  });
  b.appendChild(el('p',{class:'note',style:'margin-top:14px',text:S.staff==='any'?'Le barbier est choisi pour toi parmi ceux qui sont libres.':'Créneaux de '+LA.barber(S.staff).name+'.'}));
}
function pickTime(s,btn){
  if(S.busy)return;S.busy=true;btn.disabled=true;
  var prev=S.holdId;
  LA.hold(S.ids,s.s,S.day,s.m,prev).then(function(h){
    S.busy=false;S.holdId=h.holdId;S.m=s.m;S.slotStaff=s.s;S.err='';S.step=4;render();focusStep(4);
  }).catch(function(e){
    S.busy=false;S.m=null;S.holdId=null;
    S.err=(e&&e.code==='taken')?'Ce créneau vient d’être pris. Choisis-en un autre, tes choix sont gardés.':((e&&e.message)||'Impossible de garder ce créneau.');
    S.days=null;loadDays();render();
  });
}

function r4(b){
  var t=LA.total(S.ids),sv=LA.service(S.ids[0]);
  var rc=el('div',{class:'recap'});
  rc.innerHTML='<span><b>'+esc(sv.name)+'</b></span><span>'+esc(LA.dayLabel(S.day))+' à <b>'+LA.hhmm(S.m)+'</b></span><span>avec <b>'+esc(LA.barber(S.slotStaff).name)+'</b></span><span><b>'+LA.eur(t.price,t.from)+'</b> · à régler au salon</span>';
  b.appendChild(rc);
  if(S.err){b.appendChild(el('div',{class:'alert',role:'alert',text:S.err}))}
  var f=el('form',{novalidate:'novalidate',class:'fg'});
  f.innerHTML=
   '<div class="fld"><label for="f-first">Prénom</label><input id="f-first" name="first" autocomplete="given-name" required><span class="err" id="e-first"></span></div>'+
   '<div class="fld"><label for="f-last">Nom <span style="font-weight:500;color:var(--mute)">(facultatif)</span></label><input id="f-last" name="last" autocomplete="family-name"></div>'+
   '<div class="fld"><label for="f-phone">Téléphone portable</label><input id="f-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="06 12 34 56 78" required><span class="err" id="e-phone"></span></div>'+
   '<div class="fld"><label for="f-mail">E-mail <span style="font-weight:500;color:var(--mute)">(facultatif)</span></label><input id="f-mail" name="email" type="email" inputmode="email" autocomplete="email" placeholder="pour recevoir la confirmation"><span class="err" id="e-mail"></span></div>'+
   '<label class="ck"><input type="checkbox" name="marketing"><span>J’accepte de recevoir des offres du salon par SMS (facultatif).</span></label>'+
   '<div class="fld full"><button class="btn" type="submit" id="f-go">Confirmer mon rendez-vous</button><p class="hold">Créneau gardé pour toi quelques minutes. Tu recevras une confirmation par SMS, et par e-mail si tu laisses ton adresse.</p></div>';
  f.onsubmit=function(ev){ev.preventDefault();submit(f)};
  b.appendChild(f);
  try{var sf=JSON.parse(sessionStorage.getItem('la-c-me')||'{}');['first','last','phone','email'].forEach(function(k){if(sf[k])f.elements[k].value=sf[k]})}catch(e){}
}
function bad(id,input,msg){var e=$('#'+id);e.textContent=msg;input.setAttribute('aria-invalid','true')}
function submit(f){
  ['first','phone','email'].forEach(function(k){f.elements[k].removeAttribute('aria-invalid')});['e-first','e-phone','e-mail'].forEach(function(i){$('#'+i).textContent=''});
  var first=f.elements.first.value.trim(),phone=f.elements.phone.value.replace(/[\s.\-]/g,''),mail=f.elements.email.value.trim(),ok=true,focus=null;
  if(first.length<2||/[:\/]/.test(first)){bad('e-first',f.elements.first,'Ton prénom, sans « : » ni « / ».');ok=false;focus=focus||f.elements.first}
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
    if(e&&(e.code==='taken'||e.status===409)){S.err=(e.message||'Ce créneau vient d’être pris.')+' Tes choix sont gardés.';S.m=null;S.step=3;S.days=null;loadDays();render();focusStep(3)}
    else{S.err=(e&&e.message)||'Une erreur est survenue. Réessaie, ou appelle le salon.';render();focusStep(4)}
  });
}
function renderDone(){
  var d=S.done,p=d.p,r=d.r,t=LA.total(p.ids),sv=LA.service(p.ids[0]);
  var o=el('div',{class:'ok',id:'done'});
  var pend=r&&r.status==='pending'&&r.deposit>0;
  o.innerHTML='<p class="eyebrow">'+(pend?'Presque terminé':'C’est réservé')+'</p><h3 id="done-h">À '+LA.hhmm(p.m)+', '+esc(LA.dayLabel(p.day).toLowerCase())+'.</h3>'+
   '<p class="big">'+esc(sv.name)+' avec '+esc(LA.barber(p.staff).name)+' · '+LA.eur(t.price,t.from)+' à régler au salon'+(r&&r.code?' · réf. <span class="code">'+esc(r.code)+'</span>':'')+'</p>'+
   '<ul><li>Confirmation par SMS envoyée au '+esc(p.phone)+(p.email?', et par e-mail à '+esc(p.email):'')+(p.email?' (avec le fichier agenda).':'. Pas d’e-mail ? Ajoute-le la prochaine fois pour l’avoir aussi.')+'</li>'+
   '<li>Rappel par SMS la veille à 18&nbsp;h.</li><li>Un empêchement&nbsp;? Déplace ou annule en un tap depuis ton SMS.</li><li>16, place Pélabon, Marseille 13e.</li></ul>'+
   (LA.isDemo()?'<p class="note" style="margin-bottom:16px">Mode démo : rien n’a été réellement envoyé.</p>':'');
  var a=el('div',{class:'acts'});
  var ics=el('a',{class:'btn',href:LA.ics({ids:p.ids,day:p.day,m:p.m,code:r&&r.code}),download:'rendez-vous-larchitecte.ics'},'Ajouter à mon agenda');a.appendChild(ics);
  if(r&&r.manage&&r.manage!=='#'){a.appendChild(el('a',{class:'btn dark',href:r.manage},'Gérer mon rendez-vous'))}
  var nw=el('button',{class:'btn ghost',type:'button'},'Réserver un autre rendez-vous');nw.onclick=function(){reset();};a.appendChild(nw);
  o.appendChild(a);bk.appendChild(o);
}
function reset(){S.step=1;S.staff=null;S.ids=[];S.days=null;S.day=S.m=S.slotStaff=S.holdId=S.done=null;S.err='';loadNexts();render();$('#reserver').scrollIntoView()}
function loadNexts(){S.nexts=null;LA.nextByBarber(['cl']).then(function(n){S.nexts=n;if(S.step===1&&!S.done)render()}).catch(function(){S.nexts={}; if(S.step===1)render()})}

window.addEventListener('pagehide',function(){if(S.holdId)LA.release(S.holdId)});
renderMenu();render();
LA.init().then(function(r){if(r.demo)$('#demo').classList.add('on');loadNexts();});
})();
