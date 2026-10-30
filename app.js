(function(){

/* ---- parâmetros do URL (substituem a injeção do HtmlService) ---- */
var _QS = (function(){ try { return new URLSearchParams(window.location.search); } catch (e) { return { get: function(){ return null; } }; } })();
window.__CABINET_ID__ = _QS.get('cab') || '';
window.__IS_ADMIN__ = _QS.get('admin') === '1';
window.__IS_PROF__ = _QS.get('prof') === '1';
window.__PC_ID__ = _QS.get('pc') || '';
window.__SALA_ID__ = _QS.get('sala') || '';

/* ---------- ponte para o servidor Apps Script ---------- */
var _pendingCount = 0;
var _slowTimer = null;
function _beginPending(){
  _pendingCount++;
  if (!_slowTimer){
    _slowTimer = setTimeout(function(){
      if (_pendingCount > 0){
        var el = document.getElementById('global-loading');
        if (el) el.classList.remove('hidden');
      }
    }, 1000); // só mostra o ecrã de carregamento se demorar mais de 1s
  }
}
function _endPending(){
  _pendingCount = Math.max(0, _pendingCount - 1);
  if (_pendingCount === 0){
    clearTimeout(_slowTimer);
    _slowTimer = null;
    var el = document.getElementById('global-loading');
    if (el) el.classList.add('hidden');
  }
}
// Ações rápidas do painel (apagar, criar, repor, ativar…) nunca mostram o ecrã de carregamento:
// o ecrã atualiza logo e o pedido segue em segundo plano. Só as operações pesadas o mostram (se demorarem mais de 1 s).
var QUIET_ = {
  api_adminCreateCabinet: 1, api_adminDeleteCabinet: 1, api_adminCreateItem: 1, api_adminDeleteItem: 1, api_adminDeleteItems: 1,
  api_adminRestock: 1, api_adminUpdateItemThreshold: 1, api_adminDeleteUser: 1, api_adminSetUserActive: 1,
  api_adminDeleteMovement: 1, api_adminUpdateMovementQty: 1, api_adminSetDamageStatus: 1, api_adminDecideRequest: 1,
  api_adminGetNotifyLog: 1, api_adminGetNotifySettings: 1, api_adminGetAutomation: 1,
  api_adminCreateSala: 1, api_adminRenameSala: 1, api_adminDeleteSala: 1, api_adminMobCreate: 1, api_adminMobUpdate: 1, api_adminMobDelete: 1,
  api_adminSetFeedbackState: 1, api_adminCancelarReserva: 1, api_profLogin: 1, api_profData: 1, api_profLogout: 1,
  // quiosque: validar o PIN e carregar a valência nunca bloqueiam o ecrã (só registar movimentos e pedidos)
  api_kioskLogin: 1, api_kioskData: 1, api_getCabinetInfo: 1, api_getCabinets: 1
};
/* ---- ponte HTTP (substitui google.script.run) ----
 * text/plain evita o preflight de CORS; credentials:'omit' impede o envio de cookies.
 * NUNCA acrescentar cabeçalhos personalizados. */
var API_URL = String(window.API_URL || '').trim();
var API_TIMEOUT_MS = 30000;
(function verificarConfiguracao(){
  if (/^https:\/\/.+/.test(API_URL)) return;
  window.addEventListener('load', function(){
    var av = document.createElement('div');
    av.id = 'aviso-config';
    av.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#F4F4F1;color:#1D2433;' +
      'font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;padding:28px;overflow:auto';
    av.innerHTML = '<h2 style="margin:0 0 10px;font-size:20px">Falta configurar o endereço da aplicação</h2>' +
      '<p style="margin:0 0 10px">Abre o ficheiro <b>config.js</b> e coloca em <code>API_URL</code> o endereço ' +
      'da aplicação Google Apps Script (o que termina em <code>/exec</code>).</p>' +
      '<p style="margin:0;color:#5E6574;font-size:14px">Depois guarda e volta a carregar esta página.</p>';
    document.body.appendChild(av);
  });
})();
function _call_(quiet, name, args){
  if (!quiet) _beginPending();
  var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var timer = ctrl ? setTimeout(function(){ ctrl.abort(); }, API_TIMEOUT_MS) : null;
  function fim(){ if (!quiet) _endPending(); if (timer) clearTimeout(timer); }
  if (!/^https:\/\/.+/.test(API_URL)){ fim(); return Promise.reject(new Error('sem_url')); }
  return fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ metodo: name, args: args || [] }),
    credentials: 'omit',
    redirect: 'follow',
    cache: 'no-store',
    signal: ctrl ? ctrl.signal : undefined
  }).then(function(r){
    return r.text().then(function(txt){
      var dados = null;
      try { dados = JSON.parse(txt); } catch (e) { throw new Error('resposta_invalida'); }
      if (!dados || dados.ok !== true) throw new Error((dados && dados.error) || 'erro_api');
      return dados.dados;
    });
  }).then(function(v){ fim(); return v; }, function(e){ fim(); throw e; });
}
function gsRun(name){ return _call_(!!QUIET_[name], name, Array.prototype.slice.call(arguments, 1)); }
function gsRunQ(name){ return _call_(true, name, Array.prototype.slice.call(arguments, 1)); }

function toast(msg){
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._h);
  toast._h = setTimeout(function(){ t.classList.remove('show'); }, 2800);
}

function show(id){
  ['scr-loading','scr-picker','scr-pin','scr-kiosk','scr-done','scr-pc','scr-sala'].forEach(function(s){
    document.getElementById(s).classList.toggle('hidden', s !== id);
  });
}
function showAdmin(id){
  ['scr-admin-setup','scr-admin-login','scr-admin-dash'].forEach(function(s){
    document.getElementById(s).classList.toggle('hidden', s !== id);
  });
}

function roleLabel(r){
  if (r === 'professor') return 'professor';
  if (r === 'admin') return 'administração';
  if (r === 'coordenador_junior') return 'coordenador júnior';
  if (r === 'coordenador_cte') return 'coordenação do CTE';
  return 'aluno';
}
function fold(s){ return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function unitLabel(u){ return u === 'ml' ? 'ml' : (u === 'g' ? 'g' : 'un'); }
function fmtQty(n){ var num = Number(n)||0; return (Math.round(num*100)/100).toLocaleString('pt-PT'); }
function fmtDateTime(iso){
  try{ var d = new Date(iso); return d.toLocaleString('pt-PT'); } catch(e){ return iso; }
}
function funcLabel(f){ return f === 'sim' ? 'sim' : f === 'parcial' ? 'com problemas' : f === 'nao' ? 'não' : '—'; }
function tipoLabel(t){ return t === 'consumo' ? 'Consumo' : t === 'levantamento' ? 'Requisição' : t === 'reposicao' ? 'Reposição' : 'Devolução'; }

function playConfirmSound(){
  try{
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    var ctx = new Ctx();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.26);
    setTimeout(function(){ ctx.close && ctx.close(); }, 400);
  } catch(e){ /* silencioso se o áudio não estiver disponível */ }
  try{
    if (navigator.vibrate) navigator.vibrate(150);
  } catch(e){}
}

/* ============================================================
   ROTEAMENTO — quiosque vs administração
   (chamado no fim do ficheiro, depois de tudo estar definido)
   ============================================================ */

/* ============================================================
   QUIOSQUE
   ============================================================ */
var kioskState = { cabinetId: window.__CABINET_ID__ || '', pin: '', token: '', user: null, cabinet: null };

var pickerCabs = [];
function fillPicker(q){
  var sel = document.getElementById('picker-select');
  sel.innerHTML = '';
  var f = fold(q).trim();
  var list = pickerCabs.filter(function(c){ return !f || fold(c.nome + ' ' + c.sala).indexOf(f) !== -1; });
  list.forEach(function(c){
    var o = document.createElement('option');
    o.value = c.id; o.textContent = c.nome + ' — ' + c.sala;
    sel.appendChild(o);
  });
  document.getElementById('picker-go').disabled = !list.length;
  document.getElementById('picker-empty').classList.toggle('hidden', !!list.length);
}
document.getElementById('picker-search').addEventListener('input', function(){ fillPicker(this.value); });

function bootKiosk(){
  if (kioskState.cabinetId){
    goPin();
  } else {
    gsRun('api_getCabinets').then(function(cabs){
      pickerCabs = cabs;
      fillPicker('');
      show('scr-picker');
    }).catch(function(){ toast('Não foi possível carregar as valências.'); });
  }
}
document.getElementById('picker-go').addEventListener('click', function(){
  kioskState.cabinetId = document.getElementById('picker-select').value;
  goPin();
});

function goPin(){
  kioskState.pin = '';
  document.getElementById('pin-error').textContent = '';
  document.getElementById('pin-hint').textContent = 'O teu PIN pessoal identifica-te como professor ou aluno.';
  clearInterval(pinLockInterval);
  setPinControls_(false);
  renderPinDots();
  if (kioskState.cabLabel){ document.getElementById('pin-cabinet-label').textContent = kioskState.cabLabel; }
  else gsRun('api_getCabinetInfo', kioskState.cabinetId).then(function(info){
    kioskState.cabLabel = info ? (info.nome + ' — ' + info.sala) : 'Valência';
    document.getElementById('pin-cabinet-label').textContent = kioskState.cabLabel;
  }).catch(function(){});
  show('scr-pin');
  focusPin_();
}

var pinInput = document.getElementById('pin-input');
var pinSubmitBtn = document.getElementById('pin-submit');
function renderPinDots(){ pinInput.value = kioskState.pin; }
pinInput.addEventListener('input', function(){
  var v = pinInput.value.replace(/\D/g, '').slice(0, 8);
  if (v !== pinInput.value) pinInput.value = v;
  kioskState.pin = v;
});
pinInput.addEventListener('keydown', function(e){ if (e.key === 'Enter'){ e.preventDefault(); submitPin(); } });
pinSubmitBtn.addEventListener('click', submitPin);
function setPinControls_(disabled){ pinInput.disabled = disabled; pinSubmitBtn.disabled = disabled; }
function focusPin_(){ try{ pinInput.focus(); }catch(e){} }

var pinBusy = false;
function setPinBusy_(b){
  pinBusy = b;
  setPinControls_(b);
  if (!b) focusPin_();
  document.getElementById('pin-hint').textContent = b ? 'A verificar…' : 'O teu PIN pessoal identifica-te como professor ou aluno.';
}
function submitPin(){
  kioskState.pin = pinInput.value.replace(/\D/g, '');
  if (kioskState.pin.length < 4){ document.getElementById('pin-error').textContent = 'PIN demasiado curto.'; return; }
  document.getElementById('pin-error').textContent = '';
  if (pinBusy) return;
  setPinBusy_(true);
  gsRun('api_kioskLogin', kioskState.pin, kioskState.cabinetId).then(function(res){
    if (res.locked || res.inativo || !res.ok) setPinBusy_(false); // (o bloqueio por tentativas volta a desativar o teclado)
    if (res.locked){
      startPinLock(res.lockSeconds || 60);
      return;
    }
    if (res.inativo){
      document.getElementById('pin-error').textContent = 'Este utilizador está desativado. Fala com o responsável.';
      kioskState.pin = '';
      renderPinDots();
      return;
    }
    if (!res.ok){
      document.getElementById('pin-error').textContent = res.attemptsLeft
        ? 'PIN não reconhecido. Restam ' + res.attemptsLeft + ' tentativa' + (res.attemptsLeft === 1 ? '' : 's') + '.'
        : 'PIN não reconhecido.';
      kioskState.pin = '';
      renderPinDots();
      return;
    }
    kioskState.token = res.token;
    kioskState.user = { nome: res.nome, role: res.role };
    loadKioskData();
  }).catch(function(){ setPinBusy_(false); document.getElementById('pin-error').textContent = 'Erro de ligação. Tenta outra vez.'; });
}

var pinLockInterval = null;
function startPinLock(seconds){
  kioskState.pin = '';
  renderPinDots();
  setPinControls_(true);
  var remaining = seconds;
  var hint = document.getElementById('pin-hint');
  var errorEl = document.getElementById('pin-error');
  clearInterval(pinLockInterval);
  function tick(){
    errorEl.textContent = 'Demasiadas tentativas erradas. Tenta outra vez daqui a ' + remaining + 's.';
    hint.textContent = '';
    remaining--;
    if (remaining < 0){
      clearInterval(pinLockInterval);
      errorEl.textContent = '';
      hint.textContent = 'O teu PIN pessoal identifica-te como professor ou aluno.';
      setPinControls_(false);
      focusPin_();
    }
  }
  tick();
  pinLockInterval = setInterval(tick, 1000);
}

function loadKioskData(){
  gsRun('api_kioskData', kioskState.token).then(function(data){
    resetDoneBtn_();
    if (!data.ok){ toast('Não foi possível carregar a valência.'); setPinBusy_(false); goPin(); return; }
    kioskState.cabinet = data.cabinet;
    kioskData = data;
    document.getElementById('kiosk-cabinet-name').textContent = data.cabinet.nome + ' — ' + data.cabinet.sala;
    document.getElementById('kiosk-user-line').textContent = 'Olá, ' + data.user.nome + ' (' + roleLabel(data.user.role) + ')';
    setPinBusy_(false);
    showChoice();
    show('scr-kiosk');
    resetAutoLogout();
  }).catch(function(){ toast('Erro de ligação.'); setPinBusy_(false); resetDoneBtn_(); });
}
function resetDoneBtn_(){
  var b = document.getElementById('done-continue');
  b.disabled = false; b.textContent = 'Fazer outro movimento';
}

var kioskData = null;

function isProfKiosk_(){ return !!(kioskState.user && kioskState.user.role === 'professor'); }
function showChoice(){
  renderKioskNotices_();
  document.getElementById('btn-go-prof').classList.toggle('hidden', !(isProfKiosk_() && kioskData && kioskData.appUrl));
  document.getElementById('kiosk-choice').classList.remove('hidden');
  document.getElementById('kiosk-request').classList.add('hidden');
  document.getElementById('kiosk-return').classList.add('hidden');
}

function showRequestView(){
  document.getElementById('kiosk-choice').classList.add('hidden');
  document.getElementById('kiosk-return').classList.add('hidden');
  document.getElementById('kiosk-request').classList.remove('hidden');
  document.getElementById('kiosk-search').value = '';
  renderRequestItems();
}

function showReturnView(){
  document.getElementById('kiosk-choice').classList.add('hidden');
  document.getElementById('kiosk-request').classList.add('hidden');
  document.getElementById('kiosk-return').classList.remove('hidden');
  renderReturnItems();
  renderReturnedToday_();
}

document.getElementById('btn-go-request').addEventListener('click', showRequestView);
document.getElementById('btn-go-prof').addEventListener('click', function(){ if (kioskData && kioskData.appUrl) window.open(kioskData.appUrl + '?prof=1', '_top'); });
document.getElementById('btn-go-return').addEventListener('click', showReturnView);
document.getElementById('request-back').addEventListener('click', showChoice);
document.getElementById('return-back').addEventListener('click', showChoice);

function renderRequestItems(){
  var itemsWrap = document.getElementById('kiosk-request-items');
  itemsWrap.innerHTML = '';
  var items = kioskData.items || [];
  if (!items.length){
    var e = document.createElement('p'); e.className = 'muted'; e.textContent = 'Esta valência ainda não tem itens configurados.';
    itemsWrap.appendChild(e);
    return;
  }
  items.forEach(function(it){
    var card = document.createElement('div');
    card.className = 'item-card';
    card.dataset.search = fold(it.nome);
    var low = it.categoria === 'consumivel' ? false : it.saldo <= 0;
    card.innerHTML =
      '<div class="row1"><b></b><span class="badge cat"></span></div>' +
      '<div class="saldo"></div>';
    card.querySelector('b').textContent = it.nome;
    card.querySelector('.badge.cat').textContent = it.categoria === 'consumivel' ? 'consumível' : 'equipamento';
    card.querySelector('.saldo').textContent = 'Disponível: ' + fmtQty(it.saldo) + ' ' + unitLabel(it.unidade) + (it.indisponivel > 0 ? ' · ' + fmtQty(it.indisponivel) + ' indisponível (danificado)' : '');

    if (it.categoria === 'consumivel'){
      var qr = document.createElement('div');
      qr.className = 'qty-row';
      var input = document.createElement('input');
      input.type = 'number'; input.min = '0'; input.step = (it.unidade === 'un' ? '1' : 'any'); input.placeholder = 'Quantidade (' + unitLabel(it.unidade) + ')';
      var btn = document.createElement('button');
      btn.className = 'btn'; btn.type = 'button'; btn.textContent = 'Registar consumo';
      btn.addEventListener('click', function(){
        var q = Number(input.value);
        if (!q || q <= 0){ toast('Indica uma quantidade válida.'); return; }
        if (q > it.saldo && !confirm('Vais consumir mais do que o saldo disponível (' + fmtQty(it.saldo) + ' ' + unitLabel(it.unidade) + '). Confirmas?')) return;
        doAction('api_registerConsumo', it.id, q, 'Registaste ' + fmtQty(q) + ' ' + unitLabel(it.unidade) + ' de "' + it.nome + '".');
      });
      qr.appendChild(input); qr.appendChild(btn);
      card.appendChild(qr);
    } else {
      var slots = kioskData.slots || [];
      var prazoWrap = document.createElement('div');
      prazoWrap.style.marginTop = '8px';
      var prazoLab = document.createElement('label');
      prazoLab.textContent = 'Devolver até (' + (kioskData.slotDay || 'hoje') + ')';
      var prazoSel = document.createElement('select');
      // só períodos que ainda não passaram; sugestão = fim do bloco de 90 minutos em curso (às 08:50 → 10:00)
      var live = slots.filter(function(s){ return new Date(s.iso).getTime() > Date.now(); });
      if (!live.length) live = slots;
      var def = live.filter(function(s){ return /fim da aula/.test(s.label); })[0] || live[0];
      live.forEach(function(s){ var o = document.createElement('option'); o.value = s.iso; o.textContent = s.label + (def && s.iso === def.iso ? '  ·  sugerido' : ''); prazoSel.appendChild(o); });
      if (def) prazoSel.value = def.iso;
      prazoSel.disabled = it.saldo <= 0;
      prazoWrap.appendChild(prazoLab); prazoWrap.appendChild(prazoSel);
      // professores: também no quiosque podem requisitar vários dias, sem limite e sem pedido
      var diasIn = null;
      if (isProfKiosk_()){
        var oD = document.createElement('option'); oD.value = 'dias'; oD.textContent = 'Vários dias…'; prazoSel.appendChild(oD);
        var diasWrap = document.createElement('div'); diasWrap.className = 'hidden';
        var diasLab = document.createElement('label'); diasLab.textContent = 'Durante quantos dias? (devolves no fim do dia escolar do último dia)';
        diasIn = document.createElement('input'); diasIn.type = 'number'; diasIn.min = '1'; diasIn.max = '365'; diasIn.step = '1'; diasIn.value = '2';
        diasWrap.appendChild(diasLab); diasWrap.appendChild(diasIn);
        prazoSel.addEventListener('change', function(){ diasWrap.classList.toggle('hidden', prazoSel.value !== 'dias'); });
        prazoWrap.appendChild(diasWrap);
      }
      card.appendChild(prazoWrap);

      var qtyRow2 = document.createElement('div');
      qtyRow2.className = 'qty-row';
      var qInput = document.createElement('input');
      qInput.type = 'number'; qInput.min = '1'; qInput.step = '1';
      qInput.max = String(Math.max(Math.floor(it.saldo), 0));
      qInput.placeholder = 'Quantidade (un)';
      qInput.value = it.saldo > 0 ? '1' : '';
      qInput.disabled = it.saldo <= 0;
      var qBtn = document.createElement('button');
      qBtn.className = 'btn'; qBtn.type = 'button'; qBtn.textContent = 'Requisitar';
      qBtn.disabled = it.saldo <= 0;
      qBtn.addEventListener('click', function(){
        var q = Math.floor(Number(qInput.value));
        if (!q || q <= 0){ toast('Indica uma quantidade válida.'); return; }
        if (q > it.saldo){ toast('Só há ' + fmtQty(it.saldo) + ' ' + unitLabel(it.unidade) + ' disponível.'); return; }
        if (!prazoSel.value){ toast('Escolhe até quando precisas do equipamento.'); return; }
        var dias = 0, prazoV = prazoSel.value;
        if (prazoV === 'dias'){
          dias = Math.floor(Number(diasIn.value)); prazoV = '';
          if (!dias || dias < 1 || dias > 365){ toast('Indica um número de dias entre 1 e 365.'); return; }
        }
        doActionWithFlag('api_registerLevantamento', it.id, q, prazoV,
          'Requisitaste ' + fmtQty(q) + ' ' + unitLabel(it.unidade) + ' de "' + it.nome + '". ' + (dias ? 'Devolve no fim do dia escolar, daqui a ' + dias + ' dia' + (dias === 1 ? '' : 's') + '.' : 'Devolve até ' + fmtPrazo_(prazoV) + '.'),
          dias || null);
      });
      qtyRow2.appendChild(qInput); qtyRow2.appendChild(qBtn);
      card.appendChild(qtyRow2);

      // mais do que o dia escolar: pedido ao responsável, a dizer por quantos dias
      var moreBtn = document.createElement('button');
      moreBtn.className = 'btn secondary'; moreBtn.type = 'button'; moreBtn.textContent = 'Preciso de mais tempo…';
      moreBtn.style.marginTop = '10px'; moreBtn.disabled = it.saldo <= 0;
      var loanForm = document.createElement('div');
      loanForm.className = 'loan-form hidden';
      loanForm.innerHTML =
        '<p class="muted" style="margin:0 0 4px">Cada requisição vai, no máximo, até ao fim do dia escolar. Para ficar com o equipamento mais tempo, o responsável tem de aceitar o pedido.</p>' +
        '<label>Durante quantos dias?</label><input type="number" class="loan-dias" min="2" max="30" step="1" value="2">' +
        '<label>Motivo do pedido</label><textarea class="loan-motivo" rows="2" maxlength="300" placeholder="ex.: projeto de robótica da turma"></textarea>' +
        '<button class="btn block loan-send" type="button">Enviar pedido ao responsável</button>';
      moreBtn.addEventListener('click', function(){ loanForm.classList.toggle('hidden'); });
      loanForm.querySelector('.loan-send').addEventListener('click', function(){
        var q = Math.floor(Number(qInput.value));
        var dias = Math.floor(Number(loanForm.querySelector('.loan-dias').value));
        var motivo = loanForm.querySelector('.loan-motivo').value.trim();
        if (!q || q <= 0){ toast('Indica uma quantidade válida.'); return; }
        if (q > it.saldo){ toast('Só há ' + fmtQty(it.saldo) + ' ' + unitLabel(it.unidade) + ' disponível.'); return; }
        if (!dias || dias < 2 || dias > 30){ toast('Indica entre 2 e 30 dias.'); return; }
        if (motivo.length < 3){ toast('Escreve o motivo do pedido.'); return; }
        gsRun('api_kioskPedido', kioskState.token, it.id, q, dias, motivo).then(handleLoanRequestResult_)
          .catch(function(){ toast('Erro de ligação. Tenta outra vez.'); });
      });
      // professores não veem o pedido de mais do que um dia (têm a área do professor, sem limite)
      if (!isProfKiosk_()){ card.appendChild(moreBtn); card.appendChild(loanForm); }
      if (low){ var w = document.createElement('p'); w.className='muted'; w.textContent='Sem stock disponível de momento.'; card.appendChild(w); }
    }
    itemsWrap.appendChild(card);
  });
  applyKioskSearch_();
}
function applyKioskSearch_(){
  var q = fold(document.getElementById('kiosk-search').value).trim();
  var any = false;
  document.querySelectorAll('#kiosk-request-items .item-card').forEach(function(c){
    var show = !q || (c.dataset.search || '').indexOf(q) !== -1;
    c.style.display = show ? '' : 'none';
    if (show) any = true;
  });
  var note = document.getElementById('kiosk-search-empty');
  if (!note){
    note = document.createElement('p'); note.id = 'kiosk-search-empty'; note.className = 'muted hidden'; note.textContent = 'Nenhum material encontrado.';
    document.getElementById('kiosk-request-items').appendChild(note);
  }
  var hasCards = document.querySelectorAll('#kiosk-request-items .item-card').length > 0;
  note.classList.toggle('hidden', any || !hasCards);
}
document.getElementById('kiosk-search').addEventListener('input', applyKioskSearch_);

function renderReturnItems(){
  var wrap = document.getElementById('kiosk-return-items');
  wrap.innerHTML = '';
  var holdings = kioskData.holdings || [];
  if (!holdings.length){
    var e = document.createElement('p'); e.className = 'muted'; e.textContent = 'Não tens nenhum material requisitado nesta valência.';
    wrap.appendChild(e);
    return;
  }
  holdings.forEach(function(h, idx){
    var row = document.createElement('div');
    row.className = 'hold-card';
    row.style.flexDirection = 'column';
    row.style.alignItems = 'stretch';

    var top = document.createElement('div');
    top.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:10px';
    top.innerHTML = '<span><b></b> — ' + fmtQty(h.qty) + ' ' + unitLabel(h.unidade) + '</span>';
    top.querySelector('b').textContent = h.nome;
    var btn = document.createElement('button');
    btn.className = 'btn amber'; btn.type = 'button'; btn.textContent = 'Devolver';
    top.appendChild(btn);
    row.appendChild(top);
    if (h.prazo){
      var pz = document.createElement('div'); pz.className = 'muted'; pz.style.marginTop = '4px';
      pz.textContent = (h.atraso ? '⏰ Em atraso — devia ter sido devolvido até ' : 'Devolver até ') + fmtPrazo_(h.prazo);
      if (h.atraso){ pz.style.color = 'var(--danger)'; pz.style.fontWeight = '600'; }
      row.appendChild(pz);
    }

    // caixa bem visível para assinalar dano
    var dmgLabel = document.createElement('label');
    dmgLabel.className = 'dmg-toggle';
    var dmgCheck = document.createElement('input');
    dmgCheck.type = 'checkbox';
    dmgLabel.appendChild(dmgCheck);
    var dmgText = document.createElement('span');
    dmgText.textContent = '⚠️ Este equipamento está danificado / partido';
    dmgLabel.appendChild(dmgText);
    row.appendChild(dmgLabel);

    var form = makeDamageForm_('r' + idx);
    row.appendChild(form);
    dmgCheck.addEventListener('change', function(){ form.classList.toggle('hidden', !dmgCheck.checked); });

    btn.addEventListener('click', function(){
      var danificado = dmgCheck.checked;
      var detalhes = null;
      if (danificado){ detalhes = form.readDetails(); if (!detalhes) return; }
      var msg = 'Devolveste ' + fmtQty(h.qty) + ' ' + unitLabel(h.unidade) + ' de "' + h.nome + '"' + (danificado ? ' (assinalado como danificado — o responsável vai ser avisado).' : '.');
      doActionWithFlag('api_registerDevolucao', h.id, h.qty, danificado, msg, detalhes);
    });
    wrap.appendChild(row);
  });
}

// questionário de dano (usado ao devolver e ao assinalar depois)
function makeDamageForm_(uid){
  var form = document.createElement('div');
  form.className = 'dmg-form hidden';
  form.innerHTML =
    '<p class="dmg-title">Responde a estas perguntas (obrigatório):</p>' +
    '<label>O equipamento continua funcional?</label>' +
    '<div class="dmg-opts">' +
      '<label class="dmg-opt"><input type="radio" name="dmgf-' + uid + '" value="sim"> Sim</label>' +
      '<label class="dmg-opt"><input type="radio" name="dmgf-' + uid + '" value="parcial"> Com problemas</label>' +
      '<label class="dmg-opt"><input type="radio" name="dmgf-' + uid + '" value="nao"> Não</label>' +
    '</div>' +
    '<label>Como ficou danificado? (que parte, que dano)</label>' +
    '<textarea class="dmg-como" rows="2" maxlength="500" placeholder="ex.: o bico partiu-se; o cabo ficou cortado"></textarea>' +
    '<label>O que aconteceu?</label>' +
    '<textarea class="dmg-ocorr" rows="3" maxlength="500" placeholder="ex.: caiu da bancada durante a aula"></textarea>';
  form.readDetails = function(){
    var sel = form.querySelector('input[type=radio]:checked');
    var como = form.querySelector('.dmg-como').value.trim();
    var ocorr = form.querySelector('.dmg-ocorr').value.trim();
    if (!sel){ toast('Indica se o equipamento continua funcional.'); return null; }
    if (como.length < 3){ toast('Descreve como ficou danificado.'); return null; }
    if (ocorr.length < 3){ toast('Conta o que aconteceu.'); return null; }
    return { funcional: sel.value, como: como, ocorrencia: ocorr };
  };
  return form;
}
function fmtHora_(iso){
  try{ return new Date(iso).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }); } catch(e){ return ''; }
}
function renderReturnedToday_(){
  var wrap = document.getElementById('kiosk-returned-today');
  wrap.innerHTML = '';
  var list = (kioskData && kioskData.devolvidosHoje) || [];
  if (!list.length){
    var e = document.createElement('p'); e.className = 'muted'; e.textContent = 'Ainda não há devoluções tuas hoje nesta valência.';
    wrap.appendChild(e); return;
  }
  list.forEach(function(d, idx){
    var card = document.createElement('div'); card.className = 'item-card';
    var top = document.createElement('div'); top.className = 'row1';
    var b = document.createElement('b'); b.textContent = d.itemNome + ' — ' + fmtQty(d.quantidade) + ' ' + unitLabel(d.unidade);
    top.appendChild(b);
    if (d.estado === 'danificado'){ var bd = document.createElement('span'); bd.className = 'badge low'; bd.textContent = 'danificado'; top.appendChild(bd); }
    card.appendChild(top);
    var how = d.origem === 'admin' ? 'Registado como devolvido pelo administrador' : 'Devolvido por ti';
    var info = document.createElement('div'); info.className = 'saldo';
    info.textContent = how + ' às ' + fmtHora_(d.timestamp) + (d.estado === 'danificado' ? ' · assinalado como danificado' + (d.marcadoEm ? ' às ' + fmtHora_(d.marcadoEm) : '') : '');
    card.appendChild(info);
    if (d.estado !== 'danificado'){
      var open = document.createElement('button'); open.type = 'button'; open.className = 'btn secondary'; open.style.marginTop = '8px';
      open.textContent = '⚠️ Assinalar como danificado';
      var form = makeDamageForm_('t' + idx);
      var send = document.createElement('button'); send.type = 'button'; send.className = 'btn block'; send.textContent = 'Confirmar dano';
      form.appendChild(send);
      open.addEventListener('click', function(){ form.classList.toggle('hidden'); });
      send.addEventListener('click', function(){
        var det = form.readDetails(); if (!det) return;
        gsRun('api_kioskDanoDepois', kioskState.token, d.id, det).then(handleDamageLaterResult_)
          .catch(function(){ toast('Erro de ligação. Tenta outra vez.'); });
      });
      card.appendChild(open); card.appendChild(form);
    }
    wrap.appendChild(card);
  });
}
function handleDamageLaterResult_(res){
  if (!res.ok){
    var m = { ja_danificado: 'Este equipamento já está assinalado como danificado.', fora_do_dia: 'Só podes assinalar no próprio dia da devolução.',
              nao_encontrado: 'Não encontrei esta devolução.', detalhes_em_falta: 'Preenche as perguntas sobre o dano.', utilizador_inativo: 'O teu acesso está desativado.' };
    toast(m[res.error] || 'Não foi possível registar. Tenta outra vez.');
    if (res.error === 'ja_danificado' || res.error === 'nao_encontrado') loadKioskData();
    return;
  }
  handleActionResult({ ok: true }, 'O equipamento ficou assinalado como danificado e o responsável vai ser avisado.');
  document.getElementById('done-msg').textContent = 'Dano registado!';
}

var KIOSK_METODOS = { api_registerConsumo: 'api_kioskConsumo', api_registerLevantamento: 'api_kioskLevantamento', api_registerDevolucao: 'api_kioskDevolucao' };
function doAction(fnName, itemId, qty, successMsg){
  gsRun(KIOSK_METODOS[fnName] || fnName, kioskState.token, itemId, qty).then(function(res){
    if (res.ok) applyKioskOptimistic_(fnName, itemId, qty);
    handleActionResult(res, successMsg);
  }).catch(function(){ toast('Erro de ligação. Tenta outra vez.'); });
}

function doActionWithFlag(fnName, itemId, qty, flag, successMsg, detalhes){
  gsRun(KIOSK_METODOS[fnName] || fnName, kioskState.token, itemId, qty, flag, detalhes || null).then(function(res){
    if (res.ok) applyKioskOptimistic_(fnName, itemId, qty);
    handleActionResult(res, successMsg);
  }).catch(function(){ toast('Erro de ligação. Tenta outra vez.'); });
}

// Atualiza kioskData localmente para o ecrã seguinte já vir correto,
// sem esperar por um novo pedido ao servidor.
function applyKioskOptimistic_(fnName, itemId, qty){
  if (!kioskData) return;
  var tipoMap = { api_registerConsumo: 'consumo', api_registerLevantamento: 'levantamento', api_registerDevolucao: 'devolucao' };
  var tipo = tipoMap[fnName];
  if (!tipo) return;
  var it = kioskData.items.find(function(x){ return x.id === itemId; });
  if (it) it.saldo += (tipo === 'devolucao' ? qty : -qty);

  if (tipo === 'levantamento'){
    var h = kioskData.holdings.find(function(x){ return x.id === itemId; });
    if (h) h.qty += qty;
    else kioskData.holdings.push({ id: itemId, nome: it ? it.nome : '', unidade: it ? it.unidade : 'un', qty: qty });
  } else if (tipo === 'devolucao'){
    var h2 = kioskData.holdings.find(function(x){ return x.id === itemId; });
    if (h2){
      h2.qty -= qty;
      if (h2.qty <= 0) kioskData.holdings = kioskData.holdings.filter(function(x){ return x !== h2; });
    }
  }
}

function handleActionResult(res, successMsg){
  if (!res.ok){
    var msg = res.error === 'excede_posse' ? 'Não tens essa quantidade na tua posse.'
      : res.error === 'detalhes_em_falta' ? 'Preenche as perguntas sobre o dano.'
      : res.error === 'sem_stock' ? 'Já não há equipamento suficiente disponível.'
      : res.error === 'prazo_invalido' ? 'O prazo escolhido já passou. Escolhe outro.'
      : res.error === 'reservado' ? 'Este equipamento está reservado por um professor nesse período. Escolhe um prazo mais curto.' : 'Não foi possível registar. Tenta outra vez.';
    toast(msg);
    if (res.error === 'prazo_invalido' || res.error === 'sem_stock') loadKioskData();
    return;
  }
  document.getElementById('done-msg').textContent = 'Movimento registado!';
  document.getElementById('done-sub').textContent = successMsg;
  show('scr-done');
  playConfirmSound();
  clearTimeout(doAction._t);
  doAction._t = setTimeout(function(){ loadKioskData(); }, 6000);
}

document.getElementById('done-continue').addEventListener('click', function(){
  clearTimeout(doAction._t);
  this.disabled = true; this.textContent = 'A carregar…'; // sem ecrã de carregamento: o botão avisa
  loadKioskData();
});

document.getElementById('kiosk-logout').addEventListener('click', logoutKiosk);
function logoutKiosk(){
  if (kioskState.token) gsRunQ('api_kioskLogout', kioskState.token);
  kioskState.pin = ''; kioskState.token=''; kioskState.user=null;
  clearAutoLogout();
  goPin();
}

var autoLogoutTimer = null;
function resetAutoLogout(){
  clearAutoLogout();
  autoLogoutTimer = setTimeout(logoutKiosk, 45000);
}
function clearAutoLogout(){ if (autoLogoutTimer) clearTimeout(autoLogoutTimer); }
['click','touchstart','keydown'].forEach(function(evt){
  document.addEventListener(evt, function(){
    if (!document.getElementById('scr-kiosk').classList.contains('hidden')) resetAutoLogout();
  });
});

/* ============================================================
   ADMINISTRAÇÃO
   ============================================================ */
var adminState = { token: '' };

function bootAdmin(){
  gsRun('api_adminNeedsSetup').then(function(needs){
    if (needs) showAdmin('scr-admin-setup');
    else showAdmin('scr-admin-login');
  }).catch(function(){ toast('Erro de ligação.'); });
}

/* Enter submete em qualquer campo de entrada.
 * Nota: antes não havia tratamento nenhum — o Enter só "funcionava" porque o botão
 * ficava com o foco depois do primeiro clique. Agora é explícito e igual em todo o lado. */
function enterSubmete_(inputId, btnId){
  var inp = document.getElementById(inputId);
  if (!inp) return;
  inp.addEventListener('keydown', function(e){
    if (e.key !== 'Enter') return;
    e.preventDefault();
    var b = document.getElementById(btnId);
    if (b && !b.disabled) b.click();
  });
}
enterSubmete_('login-pw', 'login-submit');
enterSubmete_('setup-pw1', 'setup-submit');
enterSubmete_('setup-pw2', 'setup-submit');

document.getElementById('setup-submit').addEventListener('click', function(){
  var btn = this;
  var p1 = document.getElementById('setup-pw1').value.trim();
  var p2 = document.getElementById('setup-pw2').value.trim();
  var err = document.getElementById('setup-error');
  err.textContent = '';
  if (p1.length < 4){ err.textContent = 'A password tem de ter pelo menos 4 carateres.'; return; }
  if (p1 !== p2){ err.textContent = 'As passwords não coincidem.'; return; }
  btn.disabled = true; // evita dois pedidos com Enter repetido
  gsRun('api_adminSetup', p1).then(function(res){
    if (!res.ok){ btn.disabled = false; err.textContent = 'Não foi possível definir a password.'; return; }
    adminState.token = res.token;
    enterDashboard();
  }).catch(function(){ btn.disabled = false; err.textContent = 'Erro de ligação.'; });
});

document.getElementById('login-submit').addEventListener('click', function(){
  var btn = this;
  var pw = document.getElementById('login-pw').value.trim();
  var err = document.getElementById('login-error');
  err.textContent = '';
  if (!pw){ err.textContent = 'Escreve a password.'; return; }
  btn.disabled = true;
  gsRun('api_adminLogin', pw).then(function(res){
    if (!res.ok){
      btn.disabled = false;
      if (res.locked){ err.textContent = 'Demasiadas tentativas erradas. Tenta outra vez daqui a ' + Math.round((res.lockSeconds || 300) / 60) + ' minutos.'; return; }
      err.textContent = res.attemptsLeft ? 'Password incorreta. Restam ' + res.attemptsLeft + ' tentativa' + (res.attemptsLeft === 1 ? '' : 's') + '.' : 'Password incorreta.';
      return;
    }
    adminState.token = res.token;
    enterDashboard();
  }).catch(function(){ btn.disabled = false; err.textContent = 'Erro de ligação.'; });
});

function enterDashboard(){
  showAdmin('scr-admin-dash');
  var tb = document.getElementById('theme-toggle'), slot = document.getElementById('nav-theme-slot');
  if (slot && tb.parentNode !== slot){ slot.appendChild(tb); tb.classList.add('in-menu'); }
  initNav_();
  loadAutomation_();
  refreshDashboard();
  loadNotifySettings_();
  renderNotifyLog_();
}

document.querySelectorAll('#admin-root .tab-btn').forEach(function(btn){
  btn.addEventListener('click', function(){
    document.querySelectorAll('#admin-root .tab-btn').forEach(function(b){ b.classList.toggle('active', b===btn); });
    document.querySelectorAll('#admin-root .panel').forEach(function(p){ p.classList.toggle('active', p.id === 'tab-' + btn.dataset.tab); });
    var title = document.getElementById('page-title'); if (title) title.textContent = btn.dataset.label || btn.textContent.trim();
    if (btn.scrollIntoView) btn.scrollIntoView({ block: 'nearest', inline: 'center' });
    if (window.scrollTo) window.scrollTo(0, 0);
    if (_dirty && _dirty[btn.dataset.tab]) renderTab_(btn.dataset.tab);
  });
});

document.getElementById('admin-refresh-all').addEventListener('click', function(){
  refreshDashboard();
});

var dashCache = null;
var _lastHistRows = []; // ids dos movimentos atualmente filtrados na tabela de histórico
function refreshDashboard(quiet){
  (quiet ? gsRunQ : gsRun)('api_adminDashboard', adminState.token).then(function(data){
    if (!data.ok){ toast('Sessão expirada. Inicia sessão outra vez.'); showAdmin('scr-admin-login'); return; }
    dashCache = data;
    var pl = document.getElementById('prof-link'); if (pl) pl.textContent = (data.appUrl || '') + '?prof=1';
    renderAllAdminTabs();
  }).catch(function(){ toast('Erro de ligação.'); });
}

// Só se desenha o separador que está à vista; os outros ficam "sujos" e desenham-se quando se abrem.
// Assim, apagar ou criar algo não obriga a refazer histórico, gráficos, tabelas… (muito mais rápido).
var TAB_RENDER = {
  home: function(){ renderHomeTab(); },
  cabs: function(){ renderCabsTab(dashCache); },
  users: function(){ renderUsersTab(dashCache); },
  stock: function(){ renderStockTab(); renderOutstandingTab(); },
  req: function(){ renderRequestsTab(); },
  dmg: function(){ renderDamagedTab(); },
  fb: function(){ renderFbTab_(); },
  rsv: function(){ renderRsvTab_(); },
  hist: function(){ renderHistTab(); },
  mob: function(){ renderMobTab_(); },
  pcs: function(){ renderPcsTab(dashCache); },
  charts: function(){ renderChartsTab(); },
  settings: function(){}
};
var _dirty = {};
function activeTab_(){
  var p = document.querySelector('#admin-root .panel.active');
  return p ? p.id.replace('tab-', '') : 'home';
}
function renderTab_(t){
  if (!dashCache) return;
  var f = TAB_RENDER[t];
  if (f) f();
  _dirty[t] = false;
}
function renderAllAdminTabs(skipActive){
  if (!dashCache) return;
  fillHistCabinetFilter(dashCache);
  updateNavCounters_();
  Object.keys(TAB_RENDER).forEach(function(k){ _dirty[k] = true; });
  if (!skipActive) renderTab_(activeTab_());
}

// Atualização "otimista": o ecrã muda já; se o servidor falhar, repõe-se o estado real.
function newClientId_(){
  try{ if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch(e){}
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c){ var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
}
function syncDashboard_(){ refreshDashboard(true); }
function bgRun_(){
  var args = Array.prototype.slice.call(arguments);
  return gsRunQ.apply(null, args).then(function(res){
    if (!res || !res.ok){ toast('Não foi possível guardar — a repor o estado real.'); syncDashboard_(); }
    return res;
  }).catch(function(){ toast('Sem ligação — a repor o estado real.'); syncDashboard_(); });
}
function removeItemsLocal_(ids){
  var set = {}; ids.forEach(function(i){ set[i] = true; });
  dashCache.items = dashCache.items.filter(function(x){ return !set[x.id]; });
  dashCache.stock = dashCache.stock.filter(function(x){ return !set[x.id]; });
  dashCache.outstanding = (dashCache.outstanding || []).filter(function(x){ return !set[x.itemId]; });
  (dashCache.requests || []).forEach(function(r){ if (set[r.itemId] && r.estado === 'pendente'){ r.estado = 'recusado'; r.nota = 'Equipamento eliminado'; } });
}
function deleteItems_(ids, msg){
  removeItemsLocal_(ids);
  renderAllAdminTabs();
  toast(msg);
  bgRun_('api_adminDeleteItems', adminState.token, ids);
}
function confirmDeleteItems_(ids){
  var nomes = ids.map(function(id){ return (dashCache.items.filter(function(x){ return x.id === id; })[0] || {}).nome; }).filter(Boolean);
  var fora = (dashCache.outstanding || []).filter(function(o){ return ids.indexOf(o.itemId) !== -1; }).length;
  var msg = ids.length === 1 ? 'Eliminar o item "' + (nomes[0] || '') + '"?' : 'Eliminar ' + ids.length + ' itens?\n\n' + nomes.slice(0, 8).join(', ') + (nomes.length > 8 ? '…' : '');
  msg += '\n\nO histórico mantém-se.';
  if (fora) msg += '\nAtenção: há ' + fora + ' linha(s) de material por devolver destes itens; deixam de aparecer em "Material por devolver".';
  if (!confirm(msg)) return;
  deleteItems_(ids, ids.length === 1 ? 'Item eliminado.' : ids.length + ' itens eliminados.');
}
// barra "selecionar todos / eliminar selecionados" de cada valência
function buildSelBar_(itemsList){
  var bar = document.createElement('div');
  bar.className = 'sel-bar';
  bar.style.cssText = 'display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:4px 0 8px';
  var lab = document.createElement('label');
  lab.style.cssText = 'display:flex;align-items:center;gap:8px;margin:0;font-weight:500';
  var all = document.createElement('input'); all.type = 'checkbox'; all.style.width = 'auto'; all.className = 'it-sel-all';
  lab.appendChild(all); lab.appendChild(document.createTextNode('Selecionar todos'));
  var btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'btn danger'; btn.style.cssText = 'margin:0;padding:6px 12px;font-size:12px'; btn.disabled = true; btn.textContent = 'Eliminar selecionados (0)';
  function boxes(){
    return Array.prototype.slice.call(itemsList.querySelectorAll('.it-sel')).filter(function(b){ var r = b.closest('[data-item]'); return !r || r.style.display !== 'none'; });
  }
  function update(){
    var vis = boxes(), sel = vis.filter(function(b){ return b.checked; });
    itemsList.querySelectorAll('.it-sel').forEach(function(b){ if (vis.indexOf(b) === -1) b.checked = false; }); // o que está escondido pela pesquisa não conta
    btn.disabled = !sel.length;
    btn.textContent = 'Eliminar selecionados (' + sel.length + ')';
    all.checked = vis.length > 0 && sel.length === vis.length;
  }
  bar._update = update;
  all.addEventListener('change', function(){ boxes().forEach(function(b){ b.checked = all.checked; }); update(); });
  itemsList.addEventListener('change', function(e){ if (e.target && e.target.classList && e.target.classList.contains('it-sel')) update(); });
  btn.addEventListener('click', function(){
    var ids = boxes().filter(function(b){ return b.checked; }).map(function(b){ return b.dataset.id; });
    if (ids.length) confirmDeleteItems_(ids);
  });
  bar.appendChild(lab); bar.appendChild(btn);
  return bar;
}

// Ajusta o saldo em cache sem precisar de reler tudo do servidor.
function adjustStockSaldo_(itemId, delta){
  if (!dashCache) return;
  var s = dashCache.stock.find(function(x){ return x.id === itemId; });
  if (s) s.saldo += delta;
}
// devolução/reposição somam ao saldo; consumo/levantamento subtraem
function movementSign_(tipo){ return (tipo === 'devolucao' || tipo === 'reposicao') ? 1 : -1; }

function fillHistCabinetFilter(data){
  var sel = document.getElementById('hist-filter-cabinet');
  var prev = sel.value;
  sel.innerHTML = '<option value="">Todas</option>';
  data.cabinets.forEach(function(c){
    var o = document.createElement('option'); o.value = c.id; o.textContent = c.nome;
    sel.appendChild(o);
  });
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
}

function renderCabsTab(data){
  var wrap = document.getElementById('cabs-list');
  wrap.innerHTML = '';
  var grids = {};
  function makeSection_(s){
    var sec = document.createElement('div'); sec.className = 'sala-sec'; sec.dataset.sala = fold(s.nome);
    var cabsHere = data.cabinets.filter(function(c){ return c.salaId === s.id; });
    var mobHere = (data.mobiliario || []).filter(function(m){ return m.salaId === s.id; });
    var head = document.createElement('div'); head.className = 'sala-head';
    var tt = document.createElement('div');
    var h2 = document.createElement('h2'); h2.textContent = '🏫 ' + s.nome;
    var cnt = document.createElement('div'); cnt.className = 'muted';
    cnt.textContent = cabsHere.length + ' valência' + (cabsHere.length === 1 ? '' : 's') + ' · ' + mobHere.length + ' linha' + (mobHere.length === 1 ? '' : 's') + ' de mobiliário';
    tt.appendChild(h2); tt.appendChild(cnt); head.appendChild(tt);
    var acts = document.createElement('div'); acts.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    function sbtn(txt, cls, fn){ var b = document.createElement('button'); b.type = 'button'; b.className = 'btn ' + cls; b.textContent = txt; b.style.cssText = 'margin:0;padding:6px 12px;font-size:12px'; b.addEventListener('click', fn); acts.appendChild(b); }
    sbtn('🪑 Mobiliário', 'secondary', function(){
      goTab_('mob'); renderMobTab_();
      var fs = document.getElementById('mob-filter-sala'); fs.value = s.id; renderMobTab_();
    });
    sbtn('✎ Renomear', 'secondary', function(){
      var nome = prompt('Novo nome da sala:', s.nome); if (nome === null) return;
      nome = nome.trim(); if (!nome){ toast('O nome não pode ficar vazio.'); return; }
      if ((dashCache.salas || []).some(function(x){ return x.id !== s.id && fold(x.nome) === fold(nome); })){ toast('Já existe uma sala com esse nome.'); return; }
      s.nome = nome;
      dashCache.cabinets.forEach(function(c){ if (c.salaId === s.id) c.sala = nome; });
      (dashCache.mobiliario || []).forEach(function(m){ if (m.salaId === s.id) m.sala = nome; });
      renderAllAdminTabs(); toast('Sala renomeada.');
      bgRun_('api_adminRenameSala', adminState.token, s.id, nome);
    });
    sbtn('Eliminar', 'danger', function(){
      if (cabsHere.length || mobHere.length){ toast('Só se elimina uma sala vazia. Remove primeiro as valências e o mobiliário desta sala.'); return; }
      if (!confirm('Eliminar a sala "' + s.nome + '"?')) return;
      dashCache.salas = dashCache.salas.filter(function(x){ return x.id !== s.id; });
      renderAllAdminTabs(); toast('Sala eliminada.');
      bgRun_('api_adminDeleteSala', adminState.token, s.id);
    });
    head.appendChild(acts); sec.appendChild(head);
    var nw = document.createElement('div'); nw.className = 'sala-new';
    var ni = document.createElement('input'); ni.type = 'text'; ni.maxLength = 150; ni.placeholder = 'Nova valência / armário nesta sala (ex.: Impressão 3D)'; ni.setAttribute('aria-label', 'Nome da nova valência em ' + s.nome);
    var nb = document.createElement('button'); nb.type = 'button'; nb.className = 'btn'; nb.textContent = '+ Criar valência';
    nb.addEventListener('click', function(){
      var nome = ni.value.trim(); if (!nome){ toast('Escreve o nome da valência.'); return; }
      var newId = newClientId_();
      dashCache.cabinets.push({ id: newId, nome: nome, sala: s.nome, salaId: s.id });
      renderAllAdminTabs(); toast('Valência criada em ' + s.nome + '.');
      bgRun_('api_adminCreateCabinet', adminState.token, nome, s.id, newId);
    });
    ni.addEventListener('keydown', function(e){ if (e.key === 'Enter') nb.click(); });
    nw.appendChild(ni); nw.appendChild(nb); sec.appendChild(nw);
    var grid = document.createElement('div'); grid.className = 'cabs-grid'; sec.appendChild(grid);
    grids[s.id] = grid; wrap.appendChild(sec);
  }
  (data.salas || []).slice().sort(function(x, y){ return fold(x.nome).localeCompare(fold(y.nome)); }).forEach(makeSection_);
  function gridFor_(c){
    if (!grids[c.salaId]) makeSection_({ id: c.salaId || '_', nome: c.sala || 'Sem sala' });
    return grids[c.salaId] || grids['_'];
  }
  data.cabinets.forEach(function(c){
    var block = document.createElement('div');
    block.className = 'cab-block';
    var head = document.createElement('div');
    head.className = 'head';
    head.innerHTML = '<div><b></b><div class="muted"></div></div>';
    head.querySelector('b').textContent = c.nome;
    head.querySelector('.muted').textContent = '📍 ' + c.sala;
    var actions = document.createElement('div');
    var qrBtn = document.createElement('button'); qrBtn.className='btn amber'; qrBtn.type='button'; qrBtn.style.marginTop='0'; qrBtn.textContent='▦ QR';
    var delBtn = document.createElement('button'); delBtn.className='btn danger'; delBtn.type='button'; delBtn.style.marginTop='0'; delBtn.textContent='Eliminar';
    delBtn.addEventListener('click', function(){
      var itsC = dashCache.items.filter(function(i){ return i.armarioId === c.id; });
      var fora = (dashCache.outstanding || []).filter(function(o){ return o.armarioId === c.id; }).length;
      var msg = 'Eliminar "' + c.nome + '"' + (itsC.length ? ' e os seus ' + itsC.length + ' item' + (itsC.length === 1 ? '' : 's') : '') + '?\n\nO histórico mantém-se.';
      if (fora) msg += '\nAtenção: há ' + fora + ' linha(s) de material por devolver nesta valência; deixam de aparecer em "Material por devolver".';
      if (!confirm(msg)) return;
      removeItemsLocal_(itsC.map(function(i){ return i.id; }));
      dashCache.cabinets = dashCache.cabinets.filter(function(x){ return x.id !== c.id; });
      renderAllAdminTabs();
      toast('Valência eliminada.');
      bgRun_('api_adminDeleteCabinet', adminState.token, c.id);
    });
    actions.appendChild(qrBtn); actions.appendChild(delBtn);
    head.appendChild(actions);
    block.appendChild(head);

    var itemsOfCab = data.items.filter(function(i){ return i.armarioId === c.id; });
    block.dataset.cab = fold(c.nome + ' ' + c.sala);
    block.dataset.items = fold(itemsOfCab.map(function(i){ return i.nome; }).join(' '));
    var itemsList = document.createElement('div');
    itemsList.style.marginTop = '8px';
    if (!itemsOfCab.length){
      var e = document.createElement('div'); e.className='muted'; e.textContent='Ainda sem itens.'; itemsList.appendChild(e);
    } else {
      itemsList.appendChild(buildSelBar_(itemsList));
      itemsOfCab.forEach(function(it){
        var stockEntry = (data.stock || []).find(function(s){ return s.id === it.id; });
        var saldoAtual = stockEntry ? stockEntry.saldo : it.stockInicial;

        var row = document.createElement('div');
        row.dataset.item = fold(it.nome);
        row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding:8px 0;font-size:13px;border-top:1px dashed var(--border)';

        var left = document.createElement('span');
        left.textContent = it.nome + ' (' + (it.categoria==='consumivel'?'consumível':'equipamento') + ') — inicial: ' +
          fmtQty(it.stockInicial) + ' ' + unitLabel(it.unidade) + ' · saldo atual: ' + fmtQty(saldoAtual) + ' ' + unitLabel(it.unidade) +
          (it.limiteMinimo > 0 ? ' · limite mín.: ' + fmtQty(it.limiteMinimo) + ' ' + unitLabel(it.unidade) : '');
        var leftWrap = document.createElement('span');
        leftWrap.style.cssText = 'display:flex;align-items:center;gap:8px';
        var selBox = document.createElement('input');
        selBox.type = 'checkbox'; selBox.className = 'it-sel'; selBox.dataset.id = it.id; selBox.style.width = 'auto';
        selBox.setAttribute('aria-label', 'Selecionar ' + it.nome);
        leftWrap.appendChild(selBox); leftWrap.appendChild(left);
        row.appendChild(leftWrap);

        var right = document.createElement('span');
        right.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap';

        var restockInput = document.createElement('input');
        restockInput.type = 'number'; restockInput.min = '0'; restockInput.step = 'any';
        restockInput.placeholder = 'Repor qtd.';
        restockInput.style.cssText = 'width:100px;margin-top:0';

        var restockBtn = document.createElement('button');
        restockBtn.textContent = '+ Repor stock'; restockBtn.className = 'btn amber'; restockBtn.type = 'button';
        restockBtn.style.cssText = 'margin-top:0;padding:6px 10px;font-size:11px';
        restockBtn.addEventListener('click', function(){
          var q = Number(restockInput.value);
          if (!q || q <= 0){ toast('Indica uma quantidade válida.'); return; }
          adjustStockSaldo_(it.id, q);
          dashCache.movements.unshift({
            id: 'tmp-' + Date.now(), timestamp: new Date().toISOString(), armarioId: it.armarioId, armarioNome: c.nome,
            itemId: it.id, itemNome: it.nome, categoria: it.categoria, unidade: it.unidade,
            nomeUser: 'Administração', role: 'admin', tipo: 'reposicao', quantidade: q, estado: ''
          });
          renderAllAdminTabs();
          toast('Stock reposto: +' + fmtQty(q) + ' ' + unitLabel(it.unidade) + '.');
          bgRun_('api_adminRestock', adminState.token, it.id, q);
        });

        var limitBtn = document.createElement('button');
        limitBtn.textContent = '⚑ Limite'; limitBtn.className = 'btn secondary'; limitBtn.type = 'button';
        limitBtn.title = 'Definir limite mínimo de stock para avisos automáticos';
        limitBtn.style.cssText = 'margin-top:0;padding:6px 10px;font-size:11px';
        limitBtn.addEventListener('click', function(){
          var novo = prompt('Limite mínimo de "' + it.nome + '" (' + unitLabel(it.unidade) + '). 0 desliga o aviso:', it.limiteMinimo || 0);
          if (novo === null) return;
          var lim = Number(novo);
          if (isNaN(lim) || lim < 0){ toast('Valor inválido.'); return; }
          it.limiteMinimo = lim;
          var stockEntry2 = dashCache.stock.find(function(s){ return s.id === it.id; });
          if (stockEntry2) stockEntry2.limiteMinimo = lim;
          renderAllAdminTabs();
          toast('Limite mínimo atualizado.');
          bgRun_('api_adminUpdateItemThreshold', adminState.token, it.id, lim);
        });

        var del = document.createElement('button');
        del.textContent = '✕'; del.className='btn danger'; del.type='button'; del.style.cssText='margin-top:0;padding:6px 10px;font-size:11px';
        del.addEventListener('click', function(){ confirmDeleteItems_([it.id]); });

        right.appendChild(restockInput); right.appendChild(restockBtn); right.appendChild(limitBtn); right.appendChild(del);
        row.appendChild(right);
        itemsList.appendChild(row);
      });
    }
    block.appendChild(itemsList);

    var form = document.createElement('div');
    form.style.marginTop = '10px';
    form.innerHTML =
      '<h3>Adicionar item</h3>' +
      '<div class="grid3">' +
        '<div><label>Nome</label><input type="text" class="it-name" placeholder="ex.: Filamento PLA"></div>' +
        '<div><label>Categoria</label><select class="it-cat"><option value="consumivel">Consumível</option><option value="equipamento">Equipamento</option></select></div>' +
        '<div><label>Unidade de medida</label><select class="it-unit"><option value="g">Gramas (g)</option><option value="ml">Mililitros (ml)</option><option value="un">Unidades (un)</option></select></div>' +
      '</div>' +
      '<div class="grid2">' +
        '<div><label>Existência inicial</label><input type="number" class="it-qty" min="0" step="any"></div>' +
        '<div><label>Limite mínimo (opcional — 0 desliga o aviso)</label><input type="number" class="it-limite" min="0" step="any" placeholder="ex.: 100"></div>' +
      '</div>' +
      '<button class="btn" type="button">Adicionar item</button>';
    var catSel = form.querySelector('.it-cat');
    var unitSel = form.querySelector('.it-unit');
    catSel.addEventListener('change', function(){
      if (catSel.value === 'equipamento'){ unitSel.value = 'un'; unitSel.disabled = true; }
      else { unitSel.disabled = false; unitSel.value = 'g'; }
    });
    form.querySelector('button').addEventListener('click', function(){
      var name = form.querySelector('.it-name').value.trim();
      var cat = form.querySelector('.it-cat').value;
      var qty = form.querySelector('.it-qty').value;
      var limite = Number(form.querySelector('.it-limite').value) || 0;
      var unidadeSel = (cat === 'equipamento') ? 'un' : unitSel.value;
      if (!name || qty === '') { toast('Preenche o nome e a existência inicial.'); return; }
      var newId = newClientId_();
      dashCache.items.push({ id: newId, armarioId: c.id, nome: name, categoria: cat, unidade: unidadeSel, stockInicial: Number(qty), limiteMinimo: limite });
      dashCache.stock.push({ id: newId, armarioId: c.id, nome: name, categoria: cat, unidade: unidadeSel, stockInicial: Number(qty), limiteMinimo: limite, saldo: Number(qty), indisponivel: 0, armarioNome: c.nome });
      renderAllAdminTabs();
      toast('Item adicionado.');
      bgRun_('api_adminCreateItem', adminState.token, c.id, name, cat, Number(qty), limite, unidadeSel, newId);
    });
    block.appendChild(form);

    var qrBox = document.createElement('div');
    qrBox.className = 'qr-box';
    block.appendChild(qrBox);
    qrBtn.addEventListener('click', function(){
      var opening = !qrBox.classList.contains('open');
      qrBox.classList.toggle('open');
      if (opening && !qrBox.dataset.rendered){
        qrBox.dataset.rendered = '1';
        gsRun('api_adminCabinetUrl', c.id).then(function(url){
          try{
            var qr = qrcode(0, 'M');
            qr.addData(url);
            qr.make();
            qrBox.insertAdjacentHTML('afterbegin', qr.createSvgTag(5));
          } catch(e){ qrBox.innerHTML = '<p class="muted">Não foi possível gerar o QR.</p>'; }
          var p = document.createElement('div');
          p.className = 'link';
          p.textContent = url;
          qrBox.appendChild(p);
          var hint = document.createElement('p');
          hint.style.cssText = 'color:#1b2430;font-size:11px;margin-top:6px';
          hint.textContent = 'Imprime este código e cola-o na porta de "' + c.nome + '".';
          qrBox.appendChild(hint);
        });
      }
    });

    gridFor_(c).appendChild(block);
  });
  applyCabsSearch_();
}

document.getElementById('sal-create').addEventListener('click', function(){
  var inp = document.getElementById('sal-name'), err = document.getElementById('sal-error');
  err.textContent = '';
  var nome = inp.value.trim();
  if (!nome){ err.textContent = 'Escreve o nome da sala.'; return; }
  if ((dashCache.salas || []).some(function(s){ return fold(s.nome) === fold(nome); })){ err.textContent = 'Já existe uma sala com esse nome.'; return; }
  var newId = newClientId_();
  inp.value = '';
  if (!dashCache.salas) dashCache.salas = [];
  dashCache.salas.push({ id: newId, nome: nome });
  renderAllAdminTabs();
  toast('Sala criada. Agora cria lá as valências.');
  bgRun_('api_adminCreateSala', adminState.token, nome, newId);
});
document.getElementById('sal-name').addEventListener('keydown', function(e){ if (e.key === 'Enter') document.getElementById('sal-create').click(); });

function renderUsersTab(data){
  var tbody = document.querySelector('#users-table tbody');
  tbody.innerHTML = '';
  data.users.forEach(function(u){
    var tr = document.createElement('tr');
    tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td>';
    tr.children[0].textContent = u.nome;
    if (u.ativo === false){
      tr.className = 'inactive';
      var off = document.createElement('span'); off.className = 'badge off'; off.textContent = 'desativado'; off.style.marginLeft = '8px';
      tr.children[0].appendChild(off);
    }
    tr.children[1].textContent = roleLabel(u.role);
    if (u.pin){
      var pinPill = document.createElement('span');
      pinPill.className = 'pin-pill';
      pinPill.textContent = u.pin;
      tr.children[2].appendChild(pinPill);
    } else {
      tr.children[2].textContent = '—';
    }
    tr.children[3].textContent = u.email || '—';
    if (_newUserHash && u.pinHash === _newUserHash && u.ativo !== false) tr.className = 'new-user';

    var actions = tr.children[4];
    actions.style.cssText = 'display:flex;gap:6px;flex-wrap:nowrap;border-bottom:0';
    tr.children[1].style.whiteSpace = 'nowrap';
    if (u.pin){
      var mail = document.createElement('button');
      mail.textContent = '✉ Enviar PIN'; mail.className = 'btn secondary'; mail.type = 'button'; mail.style.marginTop = '0';
      mail.title = 'Enviar (ou reenviar) o PIN por email';
      mail.addEventListener('click', function(){
        var to = u.email || '';
        if (!to){
          var r = prompt('Email de ' + u.nome + ' para enviar o PIN:', '');
          if (r === null) return;
          to = r.trim();
          if (!to){ toast('Indica um email.'); return; }
        }
        mail.disabled = true;
        gsRun('api_adminSendPin', adminState.token, u.pinHash, to).then(function(res){
          mail.disabled = false;
          if (res.email) u.email = res.email;
          if (res.ok) toast('PIN enviado para ' + res.email + '.');
          else toast(res.error === 'email_invalido' ? 'Email inválido.' : 'Não foi possível enviar o email. Vê o registo em Definições.');
          renderAllAdminTabs();
          renderNotifyLog_();
        }).catch(function(){ mail.disabled = false; toast('Erro de ligação.'); });
      });
      actions.appendChild(mail);
    }
    // Promover / rebaixar aluno <-> coordenador júnior
    if (u.role === 'aluno' || u.role === 'coordenador_junior'){
      var subir = u.role === 'aluno';
      var cargo = document.createElement('button');
      cargo.type = 'button'; cargo.className = 'btn secondary'; cargo.style.marginTop = '0';
      cargo.textContent = subir ? '↑ C. Júnior' : '↓ Aluno';
      cargo.title = subir ? 'Passar este aluno a coordenador júnior' : 'Voltar a tratar como aluno';
      cargo.addEventListener('click', function(){
        var novo = subir ? 'coordenador_junior' : 'aluno';
        u.role = novo;
        renderAllAdminTabs();
        toast(subir ? u.nome + ' é agora coordenador júnior.' : u.nome + ' voltou a ser aluno.');
        bgRun_('api_adminSetUserRole', adminState.token, u.pinHash, novo);
      });
      actions.appendChild(cargo);
    }

    var tog = document.createElement('button');
    tog.type = 'button'; tog.className = 'btn secondary'; tog.style.marginTop = '0';
    tog.textContent = u.ativo === false ? 'Reativar' : 'Desativar';
    tog.title = u.ativo === false ? 'Devolver o acesso a este utilizador' : 'Impedir o acesso, mantendo o histórico';
    tog.addEventListener('click', function(){
      var ativar = u.ativo === false;
      if (!ativar && !confirm('Desativar "' + u.nome + '"? Deixa de poder entrar no quiosque, mas o histórico mantém-se. Se ainda tiver material por devolver, continua na lista "Material por devolver".')) return;
      u.ativo = ativar;
      renderAllAdminTabs();
      toast(ativar ? 'Utilizador reativado.' : 'Utilizador desativado.');
      bgRun_('api_adminSetUserActive', adminState.token, u.pinHash, ativar);
    });
    actions.appendChild(tog);
    var del = document.createElement('button');
    del.textContent = 'Eliminar'; del.className = 'btn danger'; del.type='button'; del.style.marginTop='0';
    del.addEventListener('click', function(){
      if (!confirm('Eliminar utilizador "' + u.nome + '"? Perde o acesso com este PIN.')) return;
      dashCache.users = dashCache.users.filter(function(x){ return x.pinHash !== u.pinHash; });
      renderAllAdminTabs();
      toast('Utilizador eliminado.');
      bgRun_('api_adminDeleteUser', adminState.token, u.pinHash);
    });
    actions.appendChild(del);
    tbody.appendChild(tr);
  });
}

var _newUserHash = '';
document.getElementById('user-create').addEventListener('click', function(){
  var btn = this;
  var name = document.getElementById('user-name').value.trim();
  var role = document.getElementById('user-role').value;
  var email = document.getElementById('user-email').value.trim();
  var err = document.getElementById('user-error');
  var box = document.getElementById('user-created');
  err.textContent = '';
  if (!name){ err.textContent = 'Preenche o nome.'; return; }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ err.textContent = 'Email inválido.'; return; }
  btn.disabled = true; // evita criar o mesmo utilizador duas vezes por toque duplo
  // PIN vazio => o servidor gera um PIN novo, único e fácil de digitar; com email, envia-o logo
  gsRun('api_adminCreateUser', adminState.token, '', name, role, email).then(function(res){
    btn.disabled = false;
    if (!res.ok){
      err.textContent = res.error === 'sem_pin_livre' ? 'Não foi possível gerar um PIN livre. Tenta outra vez.'
        : res.error === 'email_invalido' ? 'Email inválido.' : 'Não foi possível criar o utilizador.';
      return;
    }
    document.getElementById('user-name').value = '';
    document.getElementById('user-email').value = '';
    _newUserHash = res.pinHash;
    dashCache.users.push({ nome: name, role: role, pin: res.pin, pinHash: res.pinHash, email: res.email || '', ativo: true });
    box.classList.remove('hidden');
    box.textContent = '';
    box.appendChild(document.createTextNode('✅ ' + name + ' (' + roleLabel(role) + ') criado(a) — PIN: '));
    var pill = document.createElement('span'); pill.className = 'pin-pill'; pill.textContent = res.pin;
    box.appendChild(pill);
    var st = document.createElement('div'); st.style.marginTop = '6px';
    if (res.emailStatus === 'enviado') st.textContent = '✉️ PIN enviado por email para ' + res.email + '.';
    else if (res.emailStatus === 'erro') st.textContent = '⚠️ Utilizador criado, mas o email não saiu (' + (res.emailError || 'erro') + '). Depois de resolver, usa "Enviar PIN" na lista.';
    else st.textContent = 'Sem email indicado — o PIN não foi enviado a ninguém.';
    box.appendChild(st);
    renderAllAdminTabs();
    if (res.email) renderNotifyLog_();
    toast('PIN gerado: ' + res.pin);
  }).catch(function(){
    btn.disabled = false;
    err.textContent = 'Erro de ligação. Confirma na lista se o utilizador foi criado antes de repetir.';
  });
});

// Considera o limite mínimo definido no item quando existe;
// caso contrário usa a heurística antiga (15% para consumíveis, 0 para equipamento).
function isLowStock_(it){
  if (it.limiteMinimo > 0) return it.saldo <= it.limiteMinimo;
  return it.categoria === 'consumivel' ? (it.saldo < it.stockInicial * 0.15) : (it.saldo <= 0);
}

function renderStockTab(){
  if (!dashCache) return;
  var tbody = document.querySelector('#stock-table tbody');
  tbody.innerHTML = '';
  var search = (document.getElementById('stock-search').value || '').toLowerCase().trim();
  var cat = document.getElementById('stock-filter-cat').value;
  var onlyLow = document.getElementById('stock-filter-low').checked;

  var rows = dashCache.stock.filter(function(it){
    var low = isLowStock_(it);
    if (cat && it.categoria !== cat) return false;
    if (onlyLow && !low) return false;
    if (search){
      var hay = (it.nome + ' ' + it.armarioNome).toLowerCase();
      if (hay.indexOf(search) === -1) return false;
    }
    return true;
  });

  if (!rows.length){
    var tr0 = document.createElement('tr');
    var td0 = document.createElement('td'); td0.colSpan = 6; td0.className = 'muted'; td0.textContent = 'Sem resultados.';
    tr0.appendChild(td0); tbody.appendChild(tr0);
    return;
  }

  rows.forEach(function(it){
    var low = isLowStock_(it);
    var tr = document.createElement('tr');
    if (low) tr.className = 'low';
    tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td><td></td>';
    tr.children[0].textContent = it.armarioNome;
    tr.children[1].textContent = it.nome;
    tr.children[2].textContent = it.categoria === 'consumivel' ? 'consumível' : 'equipamento';
    tr.children[3].textContent = fmtQty(it.stockInicial) + ' ' + unitLabel(it.unidade);
    tr.children[4].textContent = it.limiteMinimo > 0 ? (fmtQty(it.limiteMinimo) + ' ' + unitLabel(it.unidade)) : '—';
    tr.children[5].textContent = fmtQty(it.saldo) + ' ' + unitLabel(it.unidade) + (low ? ' ⚠️' : '') + (it.indisponivel > 0 ? ' (' + fmtQty(it.indisponivel) + ' indisponível)' : '');
    tbody.appendChild(tr);
  });
}
['stock-search','stock-filter-cat','stock-filter-low'].forEach(function(id){
  document.getElementById(id).addEventListener('input', renderStockTab);
  document.getElementById(id).addEventListener('change', renderStockTab);
});

function renderOutstandingTab(){
  if (!dashCache) return;
  var tbody = document.querySelector('#outstanding-table tbody');
  tbody.innerHTML = '';
  var list = dashCache.outstanding || [];
  document.getElementById('outstanding-select-all').checked = false;

  if (!list.length){
    var tr0 = document.createElement('tr');
    var td0 = document.createElement('td'); td0.colSpan = 6; td0.className = 'muted'; td0.textContent = 'Nada por devolver neste momento.';
    tr0.appendChild(td0); tbody.appendChild(tr0);
    return;
  }
  list.slice().sort(function(x, y){ return (y.atraso ? 1 : 0) - (x.atraso ? 1 : 0); }).forEach(function(o){
    var tr = document.createElement('tr');
    tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td><td></td>';
    if (o.atraso) tr.className = 'low';
    var chk = document.createElement('input'); chk.type = 'checkbox'; chk.style.width = 'auto';
    chk.dataset.key = o.itemId + '|' + o.pinHash;
    tr.children[0].appendChild(chk);
    tr.children[1].textContent = o.armarioNome;
    tr.children[2].textContent = o.itemNome;
    tr.children[3].textContent = o.nomeUser + ' (' + roleLabel(o.role) + ')';
    tr.children[4].textContent = fmtQty(o.qty) + ' ' + unitLabel(o.unidade);
    if (o.prazo){
      tr.children[5].textContent = fmtPrazo_(o.prazo) + ' ';
      if (o.atraso){ var b = document.createElement('span'); b.className = 'badge low'; b.textContent = 'em atraso'; tr.children[5].appendChild(b); }
    } else tr.children[5].textContent = '—';
    tbody.appendChild(tr);
  });
}

document.getElementById('outstanding-select-all').addEventListener('change', function(){
  var checked = this.checked;
  document.querySelectorAll('#outstanding-table tbody input[type=checkbox]').forEach(function(c){ c.checked = checked; });
});

function doReturnOutstanding_(keys, confirmMsg){
  if (!confirm(confirmMsg)) return;
  gsRun('api_adminReturnAllOutstanding', adminState.token, keys || []).then(function(res){
    if (!res.ok){ toast('Não foi possível concluir.'); return; }
    toast(res.count + ' movimento(s) marcado(s) como devolvido(s).');
    refreshDashboard(true);
  }).catch(function(){ toast('Erro de ligação.'); });
}

document.getElementById('outstanding-return-selected').addEventListener('click', function(){
  var keys = Array.prototype.slice.call(document.querySelectorAll('#outstanding-table tbody input[type=checkbox]:checked')).map(function(c){ return c.dataset.key; });
  if (!keys.length){ toast('Seleciona pelo menos uma linha.'); return; }
  doReturnOutstanding_(keys, 'Confirmas que já verificaste que ' + keys.length + ' item(ns) selecionado(s) foram mesmo devolvidos?');
});

document.getElementById('outstanding-return-all').addEventListener('click', function(){
  var total = (dashCache && dashCache.outstanding) ? dashCache.outstanding.length : 0;
  if (!total){ toast('Não há nada por devolver.'); return; }
  doReturnOutstanding_(null, 'Confirmas que já verificaste FISICAMENTE que TODO o material por devolver (' + total + ' linha(s)) já está de volta? Esta ação não distingue linhas — marca tudo.');
});

function renderHistTab(){
  if (!dashCache) return;
  var tbody = document.querySelector('#hist-table tbody');
  tbody.innerHTML = '';

  var search = (document.getElementById('hist-search').value || '').toLowerCase().trim();
  var from = document.getElementById('hist-filter-from').value;
  var to = document.getElementById('hist-filter-to').value;
  var cabFilter = document.getElementById('hist-filter-cabinet').value;
  var tipoFilter = document.getElementById('hist-filter-tipo').value;
  var onlyDamaged = document.getElementById('hist-filter-danificado').checked;

  var rows = dashCache.movements.filter(function(m){
    if (cabFilter && m.armarioId !== cabFilter) return false;
    if (onlyDamaged && m.estado !== 'danificado') return false;
    if (tipoFilter && m.tipo !== tipoFilter) return false;
    if (from && (m.timestamp || '') < from) return false;
    if (to && (m.timestamp || '') > (to + 'T23:59:59')) return false;
    if (search){
      var hay = (m.itemNome + ' ' + m.armarioNome + ' ' + m.nomeUser + ' ' + (m.danoComo || '') + ' ' + (m.danoOcorrencia || '')).toLowerCase();
      if (hay.indexOf(search) === -1) return false;
    }
    return true;
  });

  if (!rows.length){
    var tr0 = document.createElement('tr');
    var td0 = document.createElement('td'); td0.colSpan = 9; td0.className = 'muted'; td0.textContent = 'Sem resultados.';
    tr0.appendChild(td0); tbody.appendChild(tr0);
    _lastHistRows = [];
    return;
  }
  _lastHistRows = rows.map(function(m){ return m.id; });

  rows.forEach(function(m){
    var tr = document.createElement('tr');
    tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>';
    tr.children[0].textContent = fmtDateTime(m.timestamp);
    tr.children[1].textContent = m.armarioNome;
    tr.children[2].textContent = m.itemNome;
    tr.children[3].textContent = tipoLabel(m.tipo);
    tr.children[4].textContent = fmtQty(m.quantidade) + ' ' + unitLabel(m.unidade);
    tr.children[5].textContent = m.nomeUser;
    tr.children[6].textContent = roleLabel(m.role);
    var est = tr.children[7];
    if (m.estado === 'danificado'){
      est.innerHTML = '<span class="badge low">danificado</span>';
      if (m.danoFuncional || m.danoComo || m.danoOcorrencia){
        var det = document.createElement('div');
        det.className = 'muted';
        det.style.cssText = 'margin-top:4px;max-width:300px;white-space:normal';
        det.textContent = 'Funcional: ' + funcLabel(m.danoFuncional) + ' · Como: ' + (m.danoComo || '—') + ' · O que aconteceu: ' + (m.danoOcorrencia || '—') + (m.danoMarcadoEm ? ' · assinalado às ' + fmtHora_(m.danoMarcadoEm) + ' (devolução ' + (m.devolucaoOrigem === 'admin' ? 'feita pelo administrador' : 'normal') + ' às ' + fmtHora_(m.timestamp) + ')' : '');
        est.appendChild(det);
      }
    } else if (m.estado === 'reposto_admin'){ est.innerHTML = '<span class="badge cat">reposto pelo admin</span>'; }
    else if (m.tipo === 'levantamento' && m.prazo){ est.textContent = 'até ' + fmtPrazo_(m.prazo); }
    else { est.textContent = (m.tipo === 'devolucao' ? 'ok' : '—'); }

    var actions = tr.children[8];
    var pdfBtn = document.createElement('button');
    pdfBtn.textContent = '📄'; pdfBtn.className = 'btn secondary'; pdfBtn.type = 'button';
    pdfBtn.title = 'Exportar só este movimento em PDF';
    pdfBtn.style.cssText = 'margin-top:0;padding:4px 9px;font-size:12px';
    pdfBtn.addEventListener('click', function(){
      exportPdf_([m.id], 'movimento-cte', true);
    });
    var editBtn = document.createElement('button');
    editBtn.textContent = '✎'; editBtn.className = 'btn secondary'; editBtn.type = 'button';
    editBtn.title = 'Corrigir quantidade';
    editBtn.style.cssText = 'margin-top:0;padding:4px 9px;font-size:12px';
    editBtn.addEventListener('click', function(){
      var novaQtd = prompt('Corrigir quantidade de "' + m.itemNome + '" (' + tipoLabel(m.tipo) + '):', m.quantidade);
      if (novaQtd === null) return;
      var q = Number(novaQtd);
      if (!q || q <= 0){ toast('Quantidade inválida.'); return; }
      var delta = q - m.quantidade;
      adjustStockSaldo_(m.itemId, movementSign_(m.tipo) * delta);
      m.quantidade = q;
      tr.children[4].textContent = fmtQty(q) + ' ' + unitLabel(m.unidade);
      renderAllAdminTabs(true);
      toast('Movimento corrigido.');
      bgRun_('api_adminUpdateMovementQty', adminState.token, m.id, q);
    });
    var delBtn = document.createElement('button');
    delBtn.textContent = '✕'; delBtn.className = 'btn danger'; delBtn.type = 'button';
    delBtn.title = 'Eliminar movimento';
    delBtn.style.cssText = 'margin-top:0;padding:4px 9px;font-size:12px';
    delBtn.addEventListener('click', function(){
      if (!confirm('Eliminar este movimento? O saldo é recalculado automaticamente.')) return;
      adjustStockSaldo_(m.itemId, -movementSign_(m.tipo) * m.quantidade);
      dashCache.movements = dashCache.movements.filter(function(x){ return x.id !== m.id; });
      _lastHistRows = _lastHistRows.filter(function(id){ return id !== m.id; });
      if (tr.parentNode) tr.parentNode.removeChild(tr);
      renderAllAdminTabs(true);
      toast('Movimento eliminado.');
      bgRun_('api_adminDeleteMovement', adminState.token, m.id);
    });
    actions.appendChild(pdfBtn); actions.appendChild(editBtn); actions.appendChild(delBtn);
    tbody.appendChild(tr);
  });
}
['hist-search','hist-filter-from','hist-filter-to','hist-filter-cabinet','hist-filter-tipo','hist-filter-danificado'].forEach(function(id){
  document.getElementById(id).addEventListener('input', renderHistTab);
  document.getElementById(id).addEventListener('change', renderHistTab);
});

document.getElementById('hist-export').addEventListener('click', function(){
  gsRun('api_adminExportCsv', adminState.token).then(function(res){
    if (!res.ok){ toast('Não foi possível exportar.'); return; }
    var blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'movimentos-cte.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  });
});

// O PDF gera-se aqui, no browser, com os dados que já estão no ecrã: instantâneo e sem depender do conversor do Google.
function describeHistFilters_(){
  var f = [];
  function dt(v){ return v ? v.split('-').reverse().join('/') : ''; }
  var cab = document.getElementById('hist-filter-cabinet'), tipo = document.getElementById('hist-filter-tipo');
  if (cab.value) f.push('Valência: ' + cab.options[cab.selectedIndex].textContent);
  if (tipo.value) f.push('Tipo: ' + tipo.options[tipo.selectedIndex].textContent);
  var from = document.getElementById('hist-filter-from').value, to = document.getElementById('hist-filter-to').value;
  if (from && to) f.push('Período: ' + dt(from) + ' a ' + dt(to)); else if (from) f.push('Desde ' + dt(from)); else if (to) f.push('Até ' + dt(to));
  var q = document.getElementById('hist-search').value.trim();
  if (q) f.push('Pesquisa: "' + q + '"');
  if (document.getElementById('hist-filter-danificado').checked) f.push('Só danificados');
  return f;
}
function exportPdf_(movementIds, filename, ficha){
  var set = {};
  (movementIds || []).forEach(function(id){ set[id] = true; });
  var recs = dashCache.movements.filter(function(m){ return set[m.id]; })
    .sort(function(x, y){ return String(x.timestamp).localeCompare(String(y.timestamp)); });
  var bytes;
  try{ bytes = pdfBytes_(buildHistoryPdf_(recs, { filters: ficha ? [] : describeHistFilters_(), ficha: !!ficha })); }
  catch(e){ toast('Não foi possível gerar o PDF.'); return; }
  var name = (filename || 'movimentos-cte.pdf').replace(/\.pdf$/, '') + '-' + new Date().toISOString().slice(0, 10) + '.pdf';
  var blob = new Blob([bytes], { type: 'application/pdf' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  toast('PDF gerado.');
}

function downloadBase64Pdf_(base64, filename){
  var binary = atob(base64);
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  var blob = new Blob([bytes], { type: 'application/pdf' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

document.getElementById('hist-export-pdf').addEventListener('click', function(){
  if (!_lastHistRows.length){ toast('Não há registos para exportar com estes filtros.'); return; }
  exportPdf_(_lastHistRows, 'movimentos-cte');
});

document.getElementById('settings-notify-submit').addEventListener('click', function(){
  var emailDmg = document.getElementById('settings-email-danificado').value.trim();
  var emailStock = document.getElementById('settings-email-stock').value.trim();
  var emailPed = document.getElementById('settings-email-pedidos').value.trim();
  var err = document.getElementById('settings-notify-error');
  err.textContent = '';
  gsRun('api_adminSetNotifySettings', adminState.token, emailDmg, emailStock, emailPed).then(function(res){
    if (!res.ok){ err.textContent = 'Não foi possível guardar.'; return; }
    toast('Emails de aviso guardados.');
  }).catch(function(){ err.textContent = 'Erro de ligação.'; });
});

function renderNotifyLog_(){
  gsRun('api_adminGetNotifyLog', adminState.token).then(function(res){
    var tbody = document.querySelector('#notify-log-table tbody');
    tbody.innerHTML = '';
    if (!res.ok) return;
    if (!res.log.length){
      var tr0 = document.createElement('tr'); var td0 = document.createElement('td');
      td0.colSpan = 5; td0.className = 'muted'; td0.textContent = 'Ainda não houve nenhuma tentativa de envio.';
      tr0.appendChild(td0); tbody.appendChild(tr0); return;
    }
    var tipos = { danificado: 'danificado', stock_baixo: 'stock baixo', teste: 'teste', pin: 'PIN', resumo: 'resumo semanal', backup: 'cópia de segurança', pedido: 'pedido de requisição', atraso: 'lembrete de atraso', feedback: 'feedback de professor' };
    var resultados = { enviado: '✅ enviado', erro: '❌ erro', ignorado: '⚠️ ignorado' };
    res.log.forEach(function(l){
      var tr = document.createElement('tr');
      tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td>';
      tr.children[0].textContent = fmtDateTime(l.timestamp);
      tr.children[1].textContent = tipos[l.tipo] || l.tipo;
      tr.children[2].textContent = l.destinatario || '—';
      tr.children[3].textContent = resultados[l.resultado] || l.resultado;
      tr.children[4].textContent = l.detalhe || '';
      tbody.appendChild(tr);
    });
  }).catch(function(){});
}
document.getElementById('notify-log-refresh').addEventListener('click', renderNotifyLog_);

document.getElementById('settings-notify-test').addEventListener('click', function(){
  var btn = this;
  var emailDmg = document.getElementById('settings-email-danificado').value.trim();
  var emailStock = document.getElementById('settings-email-stock').value.trim();
  var emailPed = document.getElementById('settings-email-pedidos').value.trim();
  var err = document.getElementById('settings-notify-error');
  var out = document.getElementById('settings-notify-test-result');
  err.textContent = ''; out.textContent = '';
  if (!emailDmg && !emailStock && !emailPed){ err.textContent = 'Preenche pelo menos um email para testar.'; return; }
  btn.disabled = true;
  // guarda primeiro o que está nos campos, para o teste usar exatamente isso
  gsRun('api_adminSetNotifySettings', adminState.token, emailDmg, emailStock, emailPed).then(function(sv){
    if (!sv.ok){ btn.disabled = false; err.textContent = 'Não foi possível guardar.'; return; }
    return gsRun('api_adminSendTestEmail', adminState.token).then(function(res){
      btn.disabled = false;
      if (!res.ok){ err.textContent = 'Não foi possível enviar o teste.'; return; }
      var needsAuth = false;
      res.results.forEach(function(r){
        var line = document.createElement('div');
        line.style.marginTop = '4px';
        if (r.ok){
          line.textContent = '✅ Teste enviado para ' + r.to + ' (' + r.label + '). Confirma a caixa de entrada e o spam.';
        } else {
          line.textContent = '❌ Falhou para ' + r.to + ' (' + r.label + '): ' + r.error;
          if (/autoriz|authoriz|permiss|permission/i.test(r.error)) needsAuth = true;
        }
        out.appendChild(line);
      });
      if (needsAuth){
        var tip = document.createElement('div');
        tip.style.cssText = 'margin-top:8px;padding:10px 12px;border:1px solid var(--amber);border-radius:6px;background:var(--amber-dim)';
        tip.textContent = 'Falta autorizar o envio de emails. No editor de Apps Script, escolhe a função autorizarEmails na lista junto ao botão Executar, clica em Executar e aceita as permissões (Rever permissões → a tua conta → Avançadas → Permitir). Depois volta a testar aqui.';
        out.appendChild(tip);
      }
      if (typeof res.quota === 'number'){
        var q = document.createElement('div'); q.className = 'muted'; q.style.marginTop = '6px';
        q.textContent = 'Emails que ainda podes enviar hoje: ' + res.quota;
        out.appendChild(q);
      }
      renderNotifyLog_();
    });
  }).catch(function(){ btn.disabled = false; err.textContent = 'Erro de ligação.'; });
});

function loadNotifySettings_(){
  gsRun('api_adminGetNotifySettings', adminState.token).then(function(res){
    if (!res.ok) return;
    document.getElementById('settings-email-danificado').value = res.emailDanificado || '';
    document.getElementById('settings-email-stock').value = res.emailStockBaixo || '';
    document.getElementById('settings-email-pedidos').value = res.emailPedidos || '';
  }).catch(function(){});
}

document.getElementById('settings-pw-submit').addEventListener('click', function(){
  var cur = document.getElementById('settings-pw-current').value.trim();
  var pw1 = document.getElementById('settings-pw-new').value.trim();
  var pw2 = document.getElementById('settings-pw-confirm').value.trim();
  var err = document.getElementById('settings-pw-error');
  err.textContent = '';
  if (!cur){ err.textContent = 'Indica a password atual.'; return; }
  if (pw1.length < 4){ err.textContent = 'A nova password tem de ter pelo menos 4 carateres.'; return; }
  if (pw1 !== pw2){ err.textContent = 'As passwords novas não coincidem.'; return; }
  gsRun('api_adminChangePassword', adminState.token, cur, pw1).then(function(res){
    if (!res.ok){
      err.textContent = res.error === 'password_atual_incorreta' ? 'A password atual está incorreta.' : 'Não foi possível alterar a password.';
      return;
    }
    document.getElementById('settings-pw-current').value = '';
    document.getElementById('settings-pw-new').value = '';
    document.getElementById('settings-pw-confirm').value = '';
    toast('Password alterada com sucesso.');
  }).catch(function(){ err.textContent = 'Erro de ligação.'; });
});

/* ============================================================
   IMPORTAR UTILIZADORES
   ============================================================ */
var _importRows = [];
var _lastImportResults = [];
function parseRole_(t){
  var f = fold(t || '').trim().replace(/\s+/g, ' ');
  if (!f) return 'aluno';
  // "coord. júnior", "coordenador junior" e "coordenador do cte" (os acentos já foram removidos pelo fold)
  if (f.indexOf('coord') === 0){
    if (f.indexOf('junior') !== -1) return 'coordenador_junior';
    return 'coordenador_cte';
  }
  if (f.indexOf('prof') === 0) return 'professor';
  if (f.indexOf('alun') === 0 || f === 'a') return 'aluno';
  return null;
}
function isEmail_(e){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function parseImportText_(text){
  var out = [], seenEmail = {}, first = true;
  String(text || '').split(/\r?\n/).forEach(function(line){
    if (!line.trim()) return;
    var sep = line.indexOf('\t') !== -1 ? '\t' : (line.indexOf(';') !== -1 ? ';' : ',');
    var p = line.split(sep).map(function(x){ return x.trim(); });
    if (first){ first = false; if (fold(p[0]) === 'nome') return; } // cabeçalho
    var row = { nome: p[0] || '', tipo: p[1] || '', email: p[2] || '', role: parseRole_(p[1]), erro: '' };
    if (!row.nome) row.erro = 'Falta o nome.';
    else if (!row.role) row.erro = 'Tipo inválido (aluno, professor, coordenador júnior ou coordenação CTE).';
    else if (row.email && !isEmail_(row.email)) row.erro = 'Email inválido.';
    else if (row.email && seenEmail[row.email.toLowerCase()]) row.erro = 'Email repetido na lista.';
    if (row.email && !row.erro) seenEmail[row.email.toLowerCase()] = true;
    out.push(row);
  });
  return out;
}
document.getElementById('import-preview').addEventListener('click', function(){
  var err = document.getElementById('import-error'); err.textContent = '';
  document.getElementById('import-result').classList.add('hidden');
  _importRows = parseImportText_(document.getElementById('import-text').value);
  var box = document.getElementById('import-preview-box');
  if (!_importRows.length){ box.classList.add('hidden'); err.textContent = 'Cola primeiro a lista.'; return; }
  if (_importRows.length > 300){ box.classList.add('hidden'); err.textContent = 'No máximo 300 pessoas de cada vez.'; return; }
  var tbody = document.querySelector('#import-table tbody'); tbody.innerHTML = '';
  _importRows.forEach(function(r){
    var tr = document.createElement('tr');
    tr.innerHTML = '<td></td><td></td><td></td><td></td>';
    tr.children[0].textContent = r.nome || '—';
    tr.children[1].textContent = r.role ? roleLabel(r.role) : (r.tipo || '—');
    tr.children[2].textContent = r.email || '—';
    tr.children[3].textContent = r.erro ? '❌ ' + r.erro : '✅ pronto';
    if (r.erro) tr.className = 'low';
    tbody.appendChild(tr);
  });
  var ok = _importRows.filter(function(r){ return !r.erro; }).length;
  var go = document.getElementById('import-go');
  go.textContent = 'Importar ' + ok + ' utilizador' + (ok === 1 ? '' : 'es');
  go.disabled = ok === 0;
  box.classList.remove('hidden');
});
document.getElementById('import-go').addEventListener('click', function(){
  var btn = this;
  var valid = _importRows.filter(function(r){ return !r.erro; });
  if (!valid.length) return;
  var send = document.getElementById('import-send').checked;
  var comEmail = valid.filter(function(r){ return r.email; }).length;
  if (!confirm('Importar ' + valid.length + ' utilizador(es)?' + (send && comEmail ? '\nSerão enviados ' + comEmail + ' email(s) com o PIN.' : ''))) return;
  btn.disabled = true;
  gsRun('api_adminImportUsers', adminState.token, valid.map(function(r){ return { nome: r.nome, role: r.role, email: r.email }; }), send).then(function(res){
    btn.disabled = false;
    if (!res.ok){ document.getElementById('import-error').textContent = res.error === 'lista_grande' ? 'No máximo 300 pessoas de cada vez.' : 'Não foi possível importar.'; return; }
    _lastImportResults = res.results;
    var tbody = document.querySelector('#import-result-table tbody'); tbody.innerHTML = '';
    res.results.forEach(function(r){
      var tr = document.createElement('tr');
      tr.innerHTML = '<td></td><td></td><td></td><td></td>';
      tr.children[0].textContent = r.nome;
      tr.children[1].textContent = roleLabel(r.role);
      if (r.pin){ var pill = document.createElement('span'); pill.className = 'pin-pill'; pill.textContent = r.pin; tr.children[2].appendChild(pill); } else tr.children[2].textContent = '—';
      var st;
      if (r.estado !== 'criado') st = '⚠️ ignorado — ' + r.motivo;
      else if (r.emailStatus === 'enviado') st = '✅ criado · email enviado';
      else if (r.emailStatus === 'erro') st = '✅ criado · ❌ email falhou (' + (r.emailError || 'erro') + ')';
      else if (r.emailStatus === 'nao_enviado') st = '✅ criado · email não enviado (opção desligada)';
      else st = '✅ criado · sem email';
      tr.children[3].textContent = st;
      tbody.appendChild(tr);
    });
    document.getElementById('import-result').classList.remove('hidden');
    document.getElementById('import-preview-box').classList.add('hidden');
    document.getElementById('import-text').value = '';
    toast(res.criados + ' utilizador(es) criado(s).');
    refreshDashboard(true);
  }).catch(function(){ btn.disabled = false; document.getElementById('import-error').textContent = 'Erro de ligação. Confirma na lista quem foi criado antes de repetir.'; });
});
document.getElementById('import-csv').addEventListener('click', function(){
  var rows = [['Nome', 'Tipo', 'Email', 'PIN', 'Estado']];
  _lastImportResults.forEach(function(r){ rows.push([r.nome, roleLabel(r.role), r.email, r.pin, r.estado === 'criado' ? 'criado' : ('ignorado: ' + r.motivo)]); });
  var csv = '\uFEFF' + rows.map(function(r){ return r.map(function(v){ return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(','); }).join('\r\n');
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'utilizadores-importados.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
});

/* ============================================================
   DANIFICADOS (estado de reparação)
   ============================================================ */
var DMG_LABELS = { por_avaliar: 'Por avaliar', em_reparacao: 'Em reparação', reparado: 'Reparado', libertado: 'Libertado (utilizável)', abatido: 'Abatido' };
function isDmgOpen_(d){ return d.estadoReparacao === 'por_avaliar' || d.estadoReparacao === 'em_reparacao'; }

function renderDamagedTab(){
  if (!dashCache) return;
  var tbody = document.querySelector('#dmg-table tbody');
  tbody.innerHTML = '';
  var list = dashCache.damaged || [];
  var fEstado = document.getElementById('dmg-filter-estado').value;
  var q = fold(document.getElementById('dmg-search').value).trim();
  var open = list.filter(isDmgOpen_).length;
  document.getElementById('dmg-summary').textContent = open + ' por tratar · ' + list.length + ' no total';
  var rows = list.filter(function(d){
    if (fEstado === 'pend' && !isDmgOpen_(d)) return false;
    if (fEstado && fEstado !== 'pend' && d.estadoReparacao !== fEstado) return false;
    if (q && fold([d.itemNome, d.armarioNome, d.nomeUser, d.danoComo, d.danoOcorrencia, d.nota].join(' ')).indexOf(q) === -1) return false;
    return true;
  });
  if (!rows.length){
    var tr0 = document.createElement('tr'); var td0 = document.createElement('td');
    td0.colSpan = 9; td0.className = 'muted'; td0.textContent = list.length ? 'Sem resultados com estes filtros.' : 'Ainda não há equipamento danificado.';
    tr0.appendChild(td0); tbody.appendChild(tr0); return;
  }
  rows.forEach(function(d){
    var tr = document.createElement('tr');
    tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>';
    if (isDmgOpen_(d)) tr.className = 'low';
    tr.children[0].textContent = fmtDateTime(d.timestamp);
    tr.children[1].textContent = d.armarioNome;
    tr.children[2].textContent = d.itemNome;
    tr.children[3].textContent = fmtQty(d.quantidade) + ' ' + unitLabel(d.unidade);
    tr.children[4].textContent = d.nomeUser;
    tr.children[5].textContent = d.danoFuncional ? funcLabel(d.danoFuncional) : '—';
    var desc = (d.danoComo || '—') + (d.danoOcorrencia ? ' · ' + d.danoOcorrencia : '') + (d.marcadoEm ? ' — assinalado às ' + fmtHora_(d.marcadoEm) + ', depois da devolução ' + (d.origem === 'admin' ? 'feita pelo administrador' : 'normal') + ' às ' + fmtHora_(d.timestamp) : '');
    tr.children[6].textContent = desc;
    tr.children[6].style.cssText = 'max-width:320px;white-space:normal';

    var sel = document.createElement('select');
    sel.style.cssText = 'margin:0;min-width:130px';
    Object.keys(DMG_LABELS).forEach(function(k){
      var o = document.createElement('option'); o.value = k; o.textContent = DMG_LABELS[k]; sel.appendChild(o);
    });
    sel.value = d.estadoReparacao;
    sel.addEventListener('change', function(){
      var novo = sel.value;
      if (novo === 'abatido' && !confirm('Abater "' + d.itemNome + '"? Deixa de contar para o stock disponível.')){ sel.value = d.estadoReparacao; return; }
      setDamageStatus_(d, novo, null);
    });
    tr.children[7].appendChild(sel);

    var nota = document.createElement('div'); nota.className = 'muted'; nota.style.cssText = 'white-space:normal;max-width:200px';
    nota.textContent = d.nota || '';
    var nb = document.createElement('button');
    nb.textContent = '✎ Nota'; nb.className = 'btn secondary'; nb.type = 'button';
    nb.style.cssText = 'margin-top:4px;padding:4px 9px;font-size:11px';
    nb.addEventListener('click', function(){
      var novo = prompt('Nota sobre "' + d.itemNome + '" (ex.: enviado para reparação, peça encomendada):', d.nota || '');
      if (novo === null) return;
      setDamageStatus_(d, d.estadoReparacao, novo);
    });
    tr.children[8].appendChild(nota); tr.children[8].appendChild(nb);
    tbody.appendChild(tr);
  });
}
function setDamageStatus_(d, estado, nota){
  d.estadoReparacao = estado;
  if (nota !== null && nota !== undefined) d.nota = nota;
  renderAllAdminTabs();
  toast('Estado atualizado.');
  bgRun_('api_adminSetDamageStatus', adminState.token, d.id, estado, nota).then(function(res){
    if (res && res.ok) syncDashboard_(); // a disponibilidade no stock também muda
  });
}
['dmg-filter-estado', 'dmg-search'].forEach(function(id){
  document.getElementById(id).addEventListener('input', renderDamagedTab);
  document.getElementById(id).addEventListener('change', renderDamagedTab);
});

/* ============================================================
   GRÁFICOS (sem bibliotecas: barras em HTML/CSS, seguem o tema)
   ============================================================ */
var MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
function lastMonths_(n){
  var out = [], now = new Date();
  for (var i = n - 1; i >= 0; i--){
    var x = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2));
  }
  return out;
}
function monthLabel_(k){ var p = k.split('-'); return MESES[Number(p[1]) - 1] + ' ' + p[0].slice(2); }
function vbarsInto_(el, labels, values){
  el.innerHTML = '';
  var total = values.reduce(function(a, b){ return a + b; }, 0);
  if (!total){ var e = document.createElement('div'); e.className = 'chart-empty'; e.textContent = 'Sem dados neste período.'; el.appendChild(e); return; }
  var max = Math.max.apply(null, values.concat([1]));
  var wrap = document.createElement('div'); wrap.className = 'vbars';
  values.forEach(function(v, i){
    var col = document.createElement('div'); col.className = 'vbar';
    var plot = document.createElement('div'); plot.className = 'plot';
    var pct = Math.round(v / max * 88);
    var fill = document.createElement('div'); fill.className = 'fill'; fill.style.height = pct + '%';
    var val = document.createElement('div'); val.className = 'val'; val.style.bottom = 'calc(' + pct + '% + 3px)'; val.textContent = v ? fmtQty(v) : '';
    plot.appendChild(fill); plot.appendChild(val);
    var lbl = document.createElement('div'); lbl.className = 'lbl'; lbl.textContent = labels[i];
    col.appendChild(plot); col.appendChild(lbl); wrap.appendChild(col);
  });
  el.appendChild(wrap);
}
// rows: [{label, value, suffix}]
function hbarsInto_(el, rows, max){
  el.innerHTML = '';
  if (!rows.length){ var e = document.createElement('div'); e.className = 'chart-empty'; e.textContent = 'Sem dados neste período.'; el.appendChild(e); return; }
  var top = Math.max.apply(null, rows.map(function(r){ return r.value; }).concat([1]));
  rows.slice(0, max || 8).forEach(function(r){
    var row = document.createElement('div'); row.className = 'hrow';
    var l = document.createElement('div'); l.className = 'hlabel'; l.textContent = r.label; l.title = r.label;
    var tr = document.createElement('div'); tr.className = 'htrack';
    var f = document.createElement('div'); f.className = 'hfill'; f.style.width = Math.round(r.value / top * 100) + '%'; tr.appendChild(f);
    var v = document.createElement('div'); v.className = 'hval'; v.textContent = fmtQty(r.value) + (r.suffix ? ' ' + r.suffix : '');
    row.appendChild(l); row.appendChild(tr); row.appendChild(v); el.appendChild(row);
  });
}
function groupSum_(movs, keyFn, valFn){
  var map = {};
  movs.forEach(function(m){ var k = keyFn(m); map[k] = (map[k] || 0) + valFn(m); });
  return Object.keys(map).map(function(k){ return { label: k, value: map[k] }; }).sort(function(a, b){ return b.value - a.value; });
}
function renderChartsTab(){
  if (!dashCache) return;
  var selCab = document.getElementById('chart-cabinet');
  var prev = selCab.value;
  selCab.innerHTML = '<option value="">Todas</option>';
  dashCache.cabinets.forEach(function(c){ var o = document.createElement('option'); o.value = c.id; o.textContent = c.nome; selCab.appendChild(o); });
  if (prev && dashCache.cabinets.some(function(c){ return c.id === prev; })) selCab.value = prev;
  var n = Number(document.getElementById('chart-period').value) || 6;
  var months = lastMonths_(n), first = months[0], cab = selCab.value;
  var movs = dashCache.movements.filter(function(m){
    return String(m.timestamp || '').slice(0, 7) >= first && (!cab || m.armarioId === cab);
  });
  var uso = movs.filter(function(m){ return m.tipo === 'consumo' || m.tipo === 'levantamento'; });
  var labels = months.map(monthLabel_);
  vbarsInto_(document.getElementById('chart-month'), labels, months.map(function(k){
    return uso.filter(function(m){ return String(m.timestamp).slice(0, 7) === k; }).length;
  }));
  vbarsInto_(document.getElementById('chart-damage'), labels, months.map(function(k){
    return movs.filter(function(m){ return m.estado === 'danificado' && m.tipo === 'devolucao' && String(m.timestamp).slice(0, 7) === k; }).length;
  }));
  hbarsInto_(document.getElementById('chart-cab'), groupSum_(uso, function(m){ return m.armarioNome || '—'; }, function(){ return 1; }), 8);
  hbarsInto_(document.getElementById('chart-equip'),
    groupSum_(movs.filter(function(m){ return m.tipo === 'levantamento'; }), function(m){ return m.itemNome; }, function(){ return 1; }), 8);
  var consWrap = document.getElementById('chart-cons'); consWrap.innerHTML = '';
  var cons = movs.filter(function(m){ return m.tipo === 'consumo'; });
  var units = [];
  cons.forEach(function(m){ var u = unitLabel(m.unidade); if (units.indexOf(u) === -1) units.push(u); });
  if (!units.length){ var e = document.createElement('div'); e.className = 'chart-empty'; e.textContent = 'Sem consumos neste período.'; consWrap.appendChild(e); }
  units.forEach(function(u){
    var box = document.createElement('div');
    var t = document.createElement('div'); t.className = 'muted'; t.style.fontWeight = '600';
    t.textContent = u === 'g' ? 'Em gramas (g)' : u === 'ml' ? 'Em mililitros (ml)' : 'Em unidades (un)';
    box.appendChild(t);
    var body = document.createElement('div'); box.appendChild(body); consWrap.appendChild(box);
    var rows = groupSum_(cons.filter(function(m){ return unitLabel(m.unidade) === u; }), function(m){ return m.itemNome; }, function(m){ return Number(m.quantidade) || 0; });
    rows.forEach(function(r){ r.suffix = u; });
    hbarsInto_(body, rows, 8);
  });
}
['chart-period', 'chart-cabinet'].forEach(function(id){ document.getElementById(id).addEventListener('change', renderChartsTab); });

/* ============================================================
   PESQUISA (valências e itens, no painel)
   ============================================================ */
function applyCabsSearch_(){
  var q = fold(document.getElementById('cabs-search').value).trim();
  document.querySelectorAll('#cabs-list .cab-block').forEach(function(b){
    var matchCab = !q || (b.dataset.cab || '').indexOf(q) !== -1;
    var matchItem = !q || (b.dataset.items || '').indexOf(q) !== -1;
    b.style.display = (matchCab || matchItem) ? '' : 'none';
    b.querySelectorAll('[data-item]').forEach(function(r){
      // se a pesquisa só corresponde a itens, mostra apenas esses itens
      r.style.display = (!q || matchCab || r.dataset.item.indexOf(q) !== -1) ? '' : 'none';
    });
  });
  document.querySelectorAll('#cabs-list .sala-sec').forEach(function(sec){
    var vis = Array.prototype.some.call(sec.querySelectorAll('.cab-block'), function(b){ return b.style.display !== 'none'; });
    sec.style.display = (!q || (sec.dataset.sala || '').indexOf(q) !== -1 || vis) ? '' : 'none';
  });
}
document.getElementById('cabs-search').addEventListener('input', applyCabsSearch_);

/* ============================================================
   AUTOMAÇÕES: RESUMO SEMANAL E CÓPIAS DE SEGURANÇA
   ============================================================ */
function authHint_(msg){
  var m = String(msg || 'erro');
  if (/autoriz|authoriz|permiss|permission/i.test(m))
    return 'Falta autorizar o Drive. No editor de Apps Script, escolhe a função ativarAutomacoes, clica em Executar e aceita as permissões (Rever permissões → a tua conta → Avançadas → Permitir); depois faz Implementar → Gerir implementações → ✏️ → Nova versão.';
  return 'A cópia falhou: ' + m;
}
var DIAS = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado', 'Domingo'];
function fillSelect_(id, options){
  var sel = document.getElementById(id); sel.innerHTML = '';
  options.forEach(function(o){ var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; sel.appendChild(op); });
}
function initAutomationSelects_(){
  var dias = DIAS.map(function(d, i){ return [String(i + 1), d]; });
  var horas = []; for (var h = 0; h < 24; h++) horas.push([String(h), ('0' + h).slice(-2) + ':00']);
  fillSelect_('dg-dia', dias); fillSelect_('bk-dia', dias);
  fillSelect_('dg-hora', horas); fillSelect_('bk-hora', horas);
}
initAutomationSelects_();
function syncBackupDayVisibility_(){
  document.getElementById('bk-dia-wrap').classList.toggle('hidden', document.getElementById('bk-freq').value !== 'semanal');
}
document.getElementById('bk-freq').addEventListener('change', syncBackupDayVisibility_);

var _automation = null;
function loadAutomation_(){
  gsRun('api_adminGetAutomation', adminState.token).then(function(res){
    if (!res.ok) return;
    _automation = res;
    document.getElementById('dg-ativo').checked = !!res.digest.ativo;
    document.getElementById('dg-dia').value = String(res.digest.dia);
    document.getElementById('dg-hora').value = String(res.digest.hora);
    document.getElementById('dg-email').value = res.digest.email || '';
    document.getElementById('dg-atraso').checked = !res.atraso || res.atraso.ativo !== false;
    document.getElementById('bk-ativo').checked = !!res.backup.ativo;
    document.getElementById('bk-freq').value = res.backup.freq;
    document.getElementById('bk-dia').value = String(res.backup.dia);
    document.getElementById('bk-hora').value = String(res.backup.hora);
    document.getElementById('bk-email').value = res.backup.email || '';
    document.getElementById('dg-tz').textContent = 'Horas no fuso horário do projeto: ' + (res.tz || '—') + '. O envio acontece na primeira verificação (de 10 em 10 minutos) a partir da hora escolhida.';
    syncBackupDayVisibility_();
    renderBackupStatus_(res);
    updateBackupBanner_(res);
    renderHomeTab();
  }).catch(function(){});
}
function daysSince_(iso){ var t = new Date(iso).getTime(); return isNaN(t) ? null : Math.floor((Date.now() - t) / 86400000); }
function renderBackupStatus_(res){
  var st = document.getElementById('bk-status'); st.innerHTML = '';
  function line(txt, cls){ var d = document.createElement('div'); d.textContent = txt; if (cls) d.className = cls; st.appendChild(d); }
  if (res.triggers === true) line('✅ Automações ativas (verificação de 10 em 10 minutos).', 'state-ok');
  else if (res.triggers === 'antigo') line('⚠️ O gatilho é de uma versão antiga (pode ser de hora a hora). Clica em "Ativar automações" para o passar a 10 em 10 minutos.', 'state-bad');
  else if (res.triggers === false) line('⚠️ As automações ainda não estão ativas: clica em "Ativar automações".', 'state-bad');
  else line('⚠️ Não foi possível confirmar se as automações estão ativas. Corre a função ativarAutomacoes no editor de Apps Script.', 'state-bad');
  if (/autoriz|authoriz|permiss|permission/i.test(res.backup.lastResult || '')) line(authHint_(res.backup.lastResult), 'state-bad');
  if (res.backup.lastAt) line('Última cópia: ' + fmtDateTime(res.backup.lastAt) + ' — ' + (res.backup.lastResult || '—'), /^ok/.test(res.backup.lastResult || '') ? '' : 'state-bad');
  else line('Ainda não há nenhuma cópia de segurança.', 'state-bad');
  var tbody = document.querySelector('#bk-table tbody'); tbody.innerHTML = '';
  if (!res.backups.length){
    var tr0 = document.createElement('tr'), td0 = document.createElement('td'); td0.colSpan = 3; td0.className = 'muted'; td0.textContent = 'Ainda sem cópias no Drive.';
    tr0.appendChild(td0); tbody.appendChild(tr0); return;
  }
  res.backups.forEach(function(b){
    var tr = document.createElement('tr'); tr.innerHTML = '<td></td><td></td><td></td>';
    tr.children[0].textContent = b.name; tr.children[1].textContent = fmtDateTime(b.date);
    var a = document.createElement('a'); a.href = b.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Abrir'; a.style.color = 'var(--mint)';
    tr.children[2].appendChild(a); tbody.appendChild(tr);
  });
}
function updateBackupBanner_(res){
  var el = document.getElementById('backup-banner'), msg = '';
  if (res.triggers === 'antigo') msg = 'O gatilho das automações é de uma versão antiga. Vai a Definições e clica em "Ativar automações" para o atualizar.';
  else if (res.triggers !== true) msg = 'As automações (cópias de segurança e resumo semanal) ainda não estão ativas. Vai a Definições e clica em "Ativar automações".';
  else if (!res.backup.ativo) msg = 'As cópias de segurança automáticas estão desligadas.';
  else if (!res.backup.lastAt) msg = 'Ainda não há nenhuma cópia de segurança.';
  else {
    var d = daysSince_(res.backup.lastAt), limite = res.backup.freq === 'semanal' ? 9 : 2;
    if (d !== null && d > limite) msg = 'A última cópia de segurança foi há ' + d + ' dias.';
  }
  el.textContent = msg ? '⚠️ ' + msg : '';
  el.classList.toggle('hidden', !msg);
  var cs = document.getElementById('cnt-settings');
  if (cs){ cs.textContent = '!'; cs.classList.toggle('hidden', !msg); }
}
function collectAutomation_(){
  return {
    atraso: { ativo: document.getElementById('dg-atraso').checked },
    digest: { ativo: document.getElementById('dg-ativo').checked, dia: Number(document.getElementById('dg-dia').value), hora: Number(document.getElementById('dg-hora').value), email: document.getElementById('dg-email').value.trim() },
    backup: { ativo: document.getElementById('bk-ativo').checked, freq: document.getElementById('bk-freq').value, dia: Number(document.getElementById('bk-dia').value),
              hora: Number(document.getElementById('bk-hora').value), email: document.getElementById('bk-email').value.trim() }
  };
}
function saveAutomation_(errId, done){
  var err = document.getElementById(errId); err.textContent = '';
  gsRun('api_adminSetAutomation', adminState.token, collectAutomation_()).then(function(res){
    if (!res.ok){
      var m = { resumo_dia_hora: 'Escolhe o dia e a hora do resumo.', email_resumo_invalido: 'O email do resumo é inválido.', resumo_sem_email: 'Indica o email de destino do resumo.',
                backup_invalido: 'Definições das cópias inválidas.', email_backup_invalido: 'O email das cópias é inválido.' };
      err.textContent = m[res.error] || 'Não foi possível guardar.'; return;
    }
    toast('Definições guardadas.');
    if (done) done(); else loadAutomation_();
  }).catch(function(){ err.textContent = 'Erro de ligação.'; });
}
document.getElementById('dg-save').addEventListener('click', function(){ saveAutomation_('dg-error'); });
document.getElementById('bk-save').addEventListener('click', function(){ saveAutomation_('bk-error'); });
document.getElementById('dg-now').addEventListener('click', function(){
  var btn = this, out = document.getElementById('dg-result'), err = document.getElementById('dg-error');
  out.textContent = ''; err.textContent = '';
  saveAutomation_('dg-error', function(){
    btn.disabled = true;
    gsRun('api_adminSendDigestNow', adminState.token).then(function(res){
      btn.disabled = false;
      if (res.ok) out.textContent = '✅ Resumo enviado para ' + res.to + '. Confirma a caixa de entrada e o spam.';
      else err.textContent = res.error === 'sem_email' ? 'Indica o email de destino.' : 'Falhou o envio: ' + res.error;
      renderNotifyLog_();
    }).catch(function(){ btn.disabled = false; err.textContent = 'Erro de ligação.'; });
  });
});
document.getElementById('bk-now').addEventListener('click', function(){
  var btn = this, err = document.getElementById('bk-error');
  err.textContent = '';
  saveAutomation_('bk-error', function(){
    btn.disabled = true; btn.textContent = 'A copiar…';
    gsRun('api_adminBackupNow', adminState.token).then(function(res){
      btn.disabled = false; btn.textContent = '💾 Fazer cópia agora';
      if (res.ok) toast('Cópia feita: ' + res.name);
      else err.textContent = authHint_(res.error || res.emailError);
      loadAutomation_(); renderNotifyLog_();
    }).catch(function(){ btn.disabled = false; btn.textContent = '💾 Fazer cópia agora'; err.textContent = 'Erro de ligação.'; });
  });
});
document.getElementById('bk-activate').addEventListener('click', function(){
  var btn = this, err = document.getElementById('bk-error'); err.textContent = '';
  btn.disabled = true;
  gsRun('api_adminEnsureTriggers', adminState.token).then(function(res){
    if (!res.ok){ btn.disabled = false; err.textContent = 'Não foi possível ativar aqui (' + res.error + '). No editor de Apps Script, escolhe a função ativarAutomacoes, clica em Executar e aceita as permissões.'; return; }
    // faz logo a primeira cópia: assim qualquer problema de permissões aparece já, e não só às 02:00
    return gsRun('api_adminBackupNow', adminState.token).then(function(b){
      btn.disabled = false;
      if (b.ok) toast('Automações ativas e primeira cópia feita.'); else err.textContent = authHint_(b.error || b.emailError);
      loadAutomation_(); renderNotifyLog_();
    });
  }).catch(function(){ btn.disabled = false; err.textContent = 'Erro de ligação.'; });
});


/* ============================================================
   MENU RETRÁTIL, INÍCIO E "IR PARA…"
   ============================================================ */
var NAV_KEY = 'cte-nav';
function setNavCollapsed_(c, persist){
  var shell = document.getElementById('scr-admin-dash');
  shell.classList.toggle('collapsed', c);
  document.getElementById('nav-collapse').setAttribute('aria-expanded', c ? 'false' : 'true');
  if (persist){ try{ localStorage.setItem(NAV_KEY, c ? 'collapsed' : 'open'); } catch(e){} }
}
function initNav_(){
  var saved = null;
  try{ saved = localStorage.getItem(NAV_KEY); } catch(e){}
  setNavCollapsed_(saved ? saved === 'collapsed' : window.innerWidth < 1100, false);
}
document.getElementById('nav-collapse').addEventListener('click', function(){
  setNavCollapsed_(!document.getElementById('scr-admin-dash').classList.contains('collapsed'), true);
});

function goTab_(name){
  var b = document.querySelector('#admin-root .tab-btn[data-tab="' + name + '"]');
  if (b) b.click();
}
function setCnt_(id, n){
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = n > 99 ? '99+' : String(n);
  el.classList.toggle('hidden', !n);
}
function updateNavCounters_(){
  if (!dashCache) return;
  setCnt_('cnt-stock', dashCache.stock.filter(isLowStock_).length);
  setCnt_('cnt-fb', (dashCache.feedback || []).filter(function(f){ return f.estado === 'novo'; }).length);
  setCnt_('cnt-dmg', (dashCache.damaged || []).filter(isDmgOpen_).length);
  setCnt_('cnt-req', (dashCache.requests || []).filter(function(r){ return r.estado === 'pendente'; }).length);
}

function renderHomeTab(){
  if (!dashCache) return;
  var low = dashCache.stock.filter(isLowStock_);
  var out = dashCache.outstanding || [];
  var dmg = (dashCache.damaged || []).filter(isDmgOpen_);
  document.getElementById('home-low').textContent = low.length;
  document.getElementById('home-out').textContent = out.length;
  document.getElementById('home-dmg').textContent = dmg.length;
  var bk = (_automation && _automation.backup && _automation.backup.lastAt) ? fmtDateTime(_automation.backup.lastAt) : '—';
  document.getElementById('home-bk').textContent = bk;
  var late = out.filter(function(o){ return o.atraso; });
  var preq = (dashCache.requests || []).filter(function(r){ return r.estado === 'pendente'; });
  document.getElementById('home-late').textContent = late.length;
  document.getElementById('home-req').textContent = preq.length;
  document.getElementById('home-late').parentNode.classList.toggle('warn', late.length > 0);
  document.getElementById('home-req').parentNode.classList.toggle('warn', preq.length > 0);
  document.querySelector('[data-go="stock"][data-low]').classList.toggle('warn', low.length > 0);
  document.querySelector('[data-go="dmg"]').classList.toggle('warn', dmg.length > 0);

  var wrap = document.getElementById('home-list');
  wrap.innerHTML = '';
  function section(title, lines, more){
    if (!lines.length) return;
    var h = document.createElement('h3'); h.textContent = title; wrap.appendChild(h);
    lines.slice(0, 5).forEach(function(l){
      var r = document.createElement('div'); r.className = 'home-row';
      var a = document.createElement('span'); a.textContent = l[0];
      var b = document.createElement('em'); b.textContent = l[1];
      r.appendChild(a); r.appendChild(b); wrap.appendChild(r);
    });
    if (lines.length > 5){ var m = document.createElement('div'); m.className = 'muted'; m.textContent = '… e mais ' + (lines.length - 5) + '.'; wrap.appendChild(m); }
  }
  section('Material em atraso', late.map(function(o){ return [o.itemNome + ' — ' + o.nomeUser, 'desde ' + fmtPrazo_(o.prazo)]; }));
  section('Pedidos de requisição por decidir', preq.map(function(r){ return [r.itemNome + ' — ' + r.nomeUser, r.dias + ' dias']; }));
  section('Stock baixo', low.map(function(i){ return [i.nome + ' — ' + i.armarioNome, fmtQty(i.saldo) + ' ' + unitLabel(i.unidade)]; }));
  section('Equipamento danificado por tratar', dmg.map(function(d){ return [d.itemNome + ' — ' + d.nomeUser, DMG_LABELS[d.estadoReparacao] || '']; }));
  section('Material por devolver', out.map(function(o){ return [o.itemNome + ' — ' + o.nomeUser, fmtQty(o.qty) + ' ' + unitLabel(o.unidade)]; }));
  if (!wrap.children.length){ var ok = document.createElement('p'); ok.className = 'muted'; ok.textContent = 'Tudo em ordem. Nada precisa de atenção.'; wrap.appendChild(ok); }
}
document.querySelectorAll('.home-tile').forEach(function(t){
  t.addEventListener('click', function(){
    goTab_(t.dataset.go);
    if (t.dataset.go === 'stock'){
      document.getElementById('stock-filter-low').checked = !!t.dataset.low;
      renderStockTab();
    }
    if (t.dataset.scroll){
      var el = document.getElementById(t.dataset.scroll);
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

/* ---- "Ir para…" ---- */
var GOTO_PAGES = [['home', 'Início'], ['stock', 'Stock atual'], ['req', 'Pedidos'], ['dmg', 'Danificados'], ['fb', 'Feedback'], ['rsv', 'Reservas'], ['hist', 'Histórico'], ['users', 'Utilizadores'], ['cabs', 'Valências & itens'], ['mob', 'Mobiliário'], ['pcs', 'Computadores'], ['charts', 'Gráficos'], ['settings', 'Definições']];
function gotoCandidates_(q){
  var f = fold(q).trim(), out = [];
  if (!f) return out;
  GOTO_PAGES.forEach(function(p){ if (fold(p[1]).indexOf(f) !== -1) out.push({ label: p[1], hint: 'página', tab: p[0] }); });
  if (dashCache){
    dashCache.cabinets.forEach(function(c){ if (fold(c.nome + ' ' + c.sala).indexOf(f) !== -1) out.push({ label: c.nome, hint: 'valência', tab: 'cabs', search: c.nome }); });
    dashCache.items.forEach(function(i){
      if (fold(i.nome).indexOf(f) === -1) return;
      var cab = dashCache.cabinets.filter(function(c){ return c.id === i.armarioId; })[0];
      out.push({ label: i.nome, hint: 'item · ' + (cab ? cab.nome : ''), tab: 'cabs', search: i.nome });
    });
    (dashCache.damaged || []).forEach(function(d){ if (fold(d.itemNome + ' ' + d.nomeUser).indexOf(f) !== -1) out.push({ label: d.itemNome + ' — ' + d.nomeUser, hint: 'danificado', tab: 'dmg', dmg: d.itemNome }); });
    (dashCache.salas || []).forEach(function(s){ if (fold(s.nome).indexOf(f) !== -1) out.push({ label: s.nome, hint: 'sala', tab: 'cabs', search: s.nome }); });
    dashCache.users.forEach(function(u){ if (fold(u.nome).indexOf(f) !== -1) out.push({ label: u.nome, hint: 'utilizador', tab: 'users' }); });
    (dashCache.mobiliario || []).forEach(function(m){ if (fold(m.nome + ' ' + m.sala).indexOf(f) !== -1) out.push({ label: m.nome, hint: 'mobiliário · ' + m.sala, tab: 'mob', mobq: m.nome }); });
  }
  return out.slice(0, 8);
}
function gotoPick_(c){
  goTab_(c.tab);
  if (c.search){ var s = document.getElementById('cabs-search'); s.value = c.search; s.dispatchEvent(new Event('input')); }
  if (c.mobq){ var mq = document.getElementById('mob-search'); mq.value = c.mobq; mq.dispatchEvent(new Event('input')); }
  if (c.dmg){ document.getElementById('dmg-filter-estado').value = ''; var d = document.getElementById('dmg-search'); d.value = c.dmg; d.dispatchEvent(new Event('input')); }
  var inp = document.getElementById('goto-input'); inp.value = ''; document.getElementById('goto-results').classList.add('hidden'); inp.blur();
}
function renderGoto_(){
  var box = document.getElementById('goto-results'), list = gotoCandidates_(document.getElementById('goto-input').value);
  box.innerHTML = '';
  if (!list.length){ box.classList.add('hidden'); return; }
  list.forEach(function(c){
    var b = document.createElement('button'); b.type = 'button';
    b.appendChild(document.createTextNode(c.label));
    var s = document.createElement('small'); s.textContent = c.hint; b.appendChild(s);
    b.addEventListener('mousedown', function(e){ e.preventDefault(); gotoPick_(c); });
    box.appendChild(b);
  });
  box.classList.remove('hidden');
}
(function(){
  var inp = document.getElementById('goto-input');
  inp.addEventListener('input', renderGoto_);
  inp.addEventListener('blur', function(){ setTimeout(function(){ document.getElementById('goto-results').classList.add('hidden'); }, 120); });
  inp.addEventListener('keydown', function(e){
    if (e.key === 'Enter'){ var l = gotoCandidates_(inp.value); if (l.length) gotoPick_(l[0]); e.preventDefault(); }
    else if (e.key === 'Escape'){ inp.value = ''; document.getElementById('goto-results').classList.add('hidden'); inp.blur(); }
  });
  document.addEventListener('keydown', function(e){
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.getElementById('scr-admin-dash').classList.contains('hidden')) return;
    var t = (e.target && e.target.tagName) || '';
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
    e.preventDefault(); inp.focus();
  });
})();


/* ============================================================
   PRAZOS DE DEVOLUÇÃO E PEDIDOS DE REQUISIÇÃO PROLONGADA
   ============================================================ */
function fmtPrazo_(iso){
  try{
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    var hm = d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === new Date().toDateString()) return 'hoje às ' + hm;
    return d.toLocaleDateString('pt-PT', { weekday: 'short', day: '2-digit', month: '2-digit' }) + ' às ' + hm;
  } catch(e){ return String(iso); }
}

function renderKioskNotices_(){
  var box = document.getElementById('kiosk-notices');
  box.innerHTML = '';
  if (!kioskData) return;
  function notice(text, cls){
    var n = document.createElement('div'); n.className = 'notice' + (cls ? ' ' + cls : ''); n.textContent = text; box.appendChild(n);
  }
  (kioskData.holdings || []).filter(function(h){ return h.atraso; }).forEach(function(h){
    notice('⏰ Em atraso: ' + fmtQty(h.qty) + ' ' + unitLabel(h.unidade) + ' de "' + h.nome + '" — devia ter sido devolvido até ' + fmtPrazo_(h.prazo) + '.', 'late');
  });
  (kioskData.pedidos || []).forEach(function(p){
    var base = fmtQty(p.quantidade) + ' ' + unitLabel(p.unidade) + ' de "' + p.itemNome + '" durante ' + p.dias + ' dias';
    if (p.estado === 'pendente') notice('⏳ Pedido pendente: ' + base + '. O responsável ainda não respondeu.');
    else if (p.estado === 'aceite') notice('✅ Pedido aceite: ' + base + '. Devolve até ' + fmtPrazo_(p.prazo) + '.' + (p.nota ? ' Nota: ' + p.nota : ''));
    else notice('❌ Pedido recusado: ' + base + '.' + (p.nota ? ' Nota: ' + p.nota : ''));
  });
}

function handleLoanRequestResult_(res){
  if (!res.ok){
    var m = { ja_pendente: 'Já tens um pedido pendente para este equipamento.', sem_stock: 'Não há equipamento suficiente disponível.',
              dias_invalidos: 'Indica entre 2 e 30 dias.', detalhes_em_falta: 'Escreve o motivo do pedido.', quantidade_invalida: 'Indica uma quantidade válida.' };
    toast(m[res.error] || 'Não foi possível enviar o pedido. Tenta outra vez.');
    return;
  }
  handleActionResult({ ok: true }, 'O responsável vai analisar o pedido. Quando voltares a entrar, vês aqui a resposta.');
  document.getElementById('done-msg').textContent = 'Pedido enviado!';
}

/* ---- painel: pedidos ---- */
var REQ_LABELS = { pendente: 'Pendente', aceite: 'Aceite', recusado: 'Recusado' };
function renderRequestsTab(){
  if (!dashCache) return;
  var tbody = document.querySelector('#req-table tbody');
  tbody.innerHTML = '';
  var list = dashCache.requests || [];
  var f = document.getElementById('req-filter-estado').value;
  var q = fold(document.getElementById('req-search').value).trim();
  var pend = list.filter(function(r){ return r.estado === 'pendente'; }).length;
  document.getElementById('req-summary').textContent = pend + ' pendente' + (pend === 1 ? '' : 's') + ' · ' + list.length + ' no total';
  var rows = list.filter(function(r){
    if (f && r.estado !== f) return false;
    if (q && fold([r.nomeUser, r.itemNome, r.armarioNome, r.motivo, r.nota].join(' ')).indexOf(q) === -1) return false;
    return true;
  });
  if (!rows.length){
    var tr0 = document.createElement('tr'), td0 = document.createElement('td');
    td0.colSpan = 8; td0.className = 'muted'; td0.textContent = list.length ? 'Sem resultados com estes filtros.' : 'Ainda não há pedidos.';
    tr0.appendChild(td0); tbody.appendChild(tr0); return;
  }
  rows.forEach(function(r){
    var tr = document.createElement('tr');
    tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>';
    if (r.estado === 'pendente') tr.className = 'low';
    tr.children[0].textContent = fmtDateTime(r.criadoEm);
    tr.children[1].textContent = r.nomeUser + ' (' + roleLabel(r.role) + ')';
    tr.children[2].textContent = r.itemNome + ' — ' + r.armarioNome;
    tr.children[3].textContent = fmtQty(r.quantidade) + ' ' + unitLabel(r.unidade);
    tr.children[4].textContent = r.dias + ' dias';
    tr.children[5].textContent = r.motivo;
    tr.children[5].style.cssText = 'max-width:280px;white-space:normal';
    var st = document.createElement('div'); st.textContent = REQ_LABELS[r.estado] || r.estado; st.style.fontWeight = '600';
    tr.children[6].appendChild(st);
    if (r.estado === 'aceite' && r.prazo){ var p = document.createElement('div'); p.className = 'muted'; p.textContent = 'devolver até ' + fmtPrazo_(r.prazo); tr.children[6].appendChild(p); }
    if (r.nota){ var n = document.createElement('div'); n.className = 'muted'; n.style.whiteSpace = 'normal'; n.textContent = 'Nota: ' + r.nota; tr.children[6].appendChild(n); }
    if (r.estado === 'pendente'){
      var ok = document.createElement('button'); ok.className = 'btn'; ok.type = 'button'; ok.textContent = 'Aceitar'; ok.style.cssText = 'margin-top:0;padding:6px 12px;font-size:12px';
      var no = document.createElement('button'); no.className = 'btn danger'; no.type = 'button'; no.textContent = 'Recusar'; no.style.cssText = 'margin:0 0 0 6px;padding:6px 12px;font-size:12px';
      ok.addEventListener('click', function(){
        if (!confirm('Aceitar o pedido de ' + r.nomeUser + '?\nFica registada a requisição de ' + fmtQty(r.quantidade) + ' ' + unitLabel(r.unidade) + ' de "' + r.itemNome + '", a devolver até ' + fmtPrazo_(r.prazoPrevisto) + '.')) return;
        decideRequest_(r, true, '');
      });
      no.addEventListener('click', function(){
        var nota = prompt('Motivo da recusa (opcional — a pessoa recebe-o por email, se tiver email):', '');
        if (nota === null) return;
        decideRequest_(r, false, nota);
      });
      tr.children[7].appendChild(ok); tr.children[7].appendChild(no);
    } else tr.children[7].textContent = r.decididoEm ? fmtDateTime(r.decididoEm) : '—';
    tbody.appendChild(tr);
  });
}
function decideRequest_(r, aceitar, nota){
  r.estado = aceitar ? 'aceite' : 'recusado'; r.nota = nota || '';
  renderAllAdminTabs();
  toast(aceitar ? 'Pedido aceite: requisição registada.' : 'Pedido recusado.');
  gsRunQ('api_adminDecideRequest', adminState.token, r.id, aceitar, nota).then(function(res){
    if (!res.ok){
      var m = { sem_stock: 'Já não há equipamento suficiente disponível.', ja_decidido: 'Este pedido já foi decidido.', utilizador_inativo: 'O utilizador está desativado.' };
      toast(m[res.error] || 'Não foi possível concluir.');
    }
    syncDashboard_(); // traz o prazo e o stock reais
  }).catch(function(){ toast('Sem ligação — a repor o estado real.'); syncDashboard_(); });
}
['req-filter-estado', 'req-search'].forEach(function(id){
  document.getElementById(id).addEventListener('input', renderRequestsTab);
  document.getElementById(id).addEventListener('change', renderRequestsTab);
});


/* PDF-START */
/* ============================================================
   PDF DOS MOVIMENTOS (gerado no browser, sem serviços externos)
   A4 horizontal, tipo de letra Helvetica (embutido em qualquer leitor de PDF)
   ============================================================ */
var PDF_W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
var PDF_W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
function pdfCharW_(ch, bold){
  var c = ch.charCodeAt(0), t = bold ? PDF_W_BOLD : PDF_W_REG;
  if (c >= 32 && c <= 126) return t[c - 32];
  if (ch === '\u2014') return 1000;
  if (ch === '\u2013') return 556;
  if (ch === '\u00B7') return 278;
  if (ch === '\u2022') return 350;
  if (ch === '\u2026') return 1000;
  var b = ch.normalize ? ch.normalize('NFD').charAt(0) : ch; // á → a (as larguras são iguais às da letra base)
  var bc = b.charCodeAt(0);
  if (bc >= 32 && bc <= 126) return t[bc - 32];
  return 556;
}
function pdfStrW_(s, bold, size){ var w = 0; for (var i = 0; i < s.length; i++) w += pdfCharW_(s.charAt(i), bold); return w * size / 1000; }
var PDF_WINANSI = { '\u20AC': 128, '\u2026': 133, '\u2018': 145, '\u2019': 146, '\u201C': 147, '\u201D': 148, '\u2022': 149, '\u2013': 150, '\u2014': 151 };
function pdfEnc_(s){
  var out = '';
  for (var i = 0; i < s.length; i++){
    var ch = s.charAt(i), c = s.charCodeAt(i);
    if (PDF_WINANSI[ch]) out += String.fromCharCode(PDF_WINANSI[ch]);
    else if (c >= 32 && c <= 126 || c >= 160 && c <= 255) out += ch;
    else out += '?';
  }
  return out;
}
function pdfEsc_(s){ return pdfEnc_(s).replace(/([\\()])/g, '\\$1'); }
function pdfNum_(n){ return (Math.round(n * 100) / 100).toString(); }
function pdfRgb_(hex){
  var h = hex.replace('#', '');
  return pdfNum_(parseInt(h.substr(0, 2), 16) / 255) + ' ' + pdfNum_(parseInt(h.substr(2, 2), 16) / 255) + ' ' + pdfNum_(parseInt(h.substr(4, 2), 16) / 255);
}
function pdfWrap_(s, bold, size, maxW){
  var lines = [], words = String(s == null ? '' : s).replace(/\s+/g, ' ').trim().split(' '), cur = '';
  if (words.length === 1 && words[0] === '') return [''];
  words.forEach(function(w){
    while (pdfStrW_(w, bold, size) > maxW){          // palavra maior do que a coluna: parte-a
      var k = w.length; while (k > 1 && pdfStrW_(w.substr(0, k), bold, size) > maxW) k--;
      if (cur){ lines.push(cur); cur = ''; }
      lines.push(w.substr(0, k)); w = w.substr(k);
    }
    var t = cur ? cur + ' ' + w : w;
    if (pdfStrW_(t, bold, size) <= maxW) cur = t; else { lines.push(cur); cur = w; }
  });
  if (cur) lines.push(cur);
  return lines;
}

function PdfDoc_(w, h){ this.w = w; this.h = h; this.pages = []; this.cur = null; }
PdfDoc_.prototype.addPage = function(){ this.cur = []; this.pages.push(this.cur); return this.cur; };
PdfDoc_.prototype.rect = function(x, y, w, h, fill, page){
  (page || this.cur).push(pdfRgb_(fill) + ' rg ' + pdfNum_(x) + ' ' + pdfNum_(this.h - y - h) + ' ' + pdfNum_(w) + ' ' + pdfNum_(h) + ' re f');
};
PdfDoc_.prototype.line = function(x1, y1, x2, y2, color, width, page){
  (page || this.cur).push(pdfRgb_(color) + ' RG ' + pdfNum_(width || 0.5) + ' w ' + pdfNum_(x1) + ' ' + pdfNum_(this.h - y1) + ' m ' + pdfNum_(x2) + ' ' + pdfNum_(this.h - y2) + ' l S');
};
// y = linha de base (a contar do topo). align: 'left' | 'right' | 'center'
PdfDoc_.prototype.text = function(x, y, s, o, page){
  o = o || {}; var size = o.size || 9, bold = !!o.bold;
  var w = pdfStrW_(s, bold, size), px = x;
  if (o.align === 'right') px = x - w; else if (o.align === 'center') px = x - w / 2;
  (page || this.cur).push('BT /' + (bold ? 'F2' : 'F1') + ' ' + pdfNum_(size) + ' Tf ' + pdfRgb_(o.color || '#1D2433') + ' rg ' + pdfNum_(px) + ' ' + pdfNum_(this.h - y) + ' Td (' + pdfEsc_(s) + ') Tj ET');
};
PdfDoc_.prototype.build = function(title){
  var objs = [], n = this.pages.length, kids = [];
  var firstPage = 6;
  for (var i = 0; i < n; i++) kids.push((firstPage + 2 * i) + ' 0 R');
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>';
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  var d = new Date(), p2 = function(x){ return (x < 10 ? '0' : '') + x; };
  objs[5] = '<< /Title (' + pdfEsc_(title) + ') /Producer (Inventario CTE) /CreationDate (D:' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds()) + ') >>';
  for (var j = 0; j < n; j++){
    var content = this.pages[j].join('\n');
    objs[firstPage + 2 * j] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + this.w + ' ' + this.h + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + (firstPage + 2 * j + 1) + ' 0 R >>';
    objs[firstPage + 2 * j + 1] = '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream';
  }
  var out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', offs = [];
  for (var k = 1; k < objs.length; k++){ offs[k] = out.length; out += k + ' 0 obj\n' + objs[k] + '\nendobj\n'; }
  var xref = out.length;
  out += 'xref\n0 ' + objs.length + '\n0000000000 65535 f \n';
  for (var m = 1; m < objs.length; m++) out += ('0000000000' + offs[m]).slice(-10) + ' 00000 n \n';
  out += 'trailer\n<< /Size ' + objs.length + ' /Root 1 0 R /Info 5 0 R >>\nstartxref\n' + xref + '\n%%EOF';
  return out;
};

var PDF_C = { accent: '#1F3A93', ink: '#1D2433', soft: '#5E6574', line: '#DADFEA', zebra: '#F3F5FB', head: '#1F3A93', danger: '#B3341E', ok: '#0B6B4F', warn: '#9A5B00' };
function pdfDate_(iso){
  var d = new Date(iso); if (isNaN(d.getTime())) return '—';
  var p = function(x){ return (x < 10 ? '0' : '') + x; };
  return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function pdfQty_(n, u){ return (Math.round((Number(n) || 0) * 100) / 100).toString().replace('.', ',') + ' ' + (u === 'ml' ? 'ml' : u === 'g' ? 'g' : 'un'); }
function pdfTipo_(t){ return t === 'consumo' ? 'Consumo' : t === 'levantamento' ? 'Requisição' : t === 'reposicao' ? 'Reposição' : 'Devolução'; }
function pdfTipoCor_(t){ return t === 'consumo' ? '#9A5B00' : t === 'levantamento' ? '#1F3A93' : t === 'reposicao' ? '#0B6B4F' : '#434B5E'; }
function pdfHora_(iso){ var d = new Date(iso); if (isNaN(d.getTime())) return ''; var q = function(x){ return (x < 10 ? '0' : '') + x; }; return q(d.getHours()) + ':' + q(d.getMinutes()); }
function pdfOrigem_(o){ return o === 'admin' ? 'feita pelo administrador' : 'normal'; }
function pdfPerfil_(r){
  if (r === 'professor') return 'Professor';
  if (r === 'admin') return 'Administração';
  if (r === 'coordenador_junior') return 'Coordenador Júnior';
  if (r === 'coordenador_cte') return 'Coordenação CTE';
  return 'Aluno';
}
function pdfFunc_(f){ return f === 'sim' ? 'continua funcional' : f === 'parcial' ? 'funciona com problemas' : f === 'nao' ? 'deixou de funcionar' : ''; }

// recs: movimentos (mais antigos primeiro). meta: { filters: [texto...], ficha: bool }
function buildHistoryPdf_(recs, meta){
  meta = meta || {};
  var PW = 842, PH = 595, M = 36, CW = PW - 2 * M;
  var doc = new PdfDoc_(PW, PH);
  var gen = pdfDate_(new Date().toISOString());
  var title = meta.ficha ? 'Ficha de movimento' : 'Histórico de movimentos';
  var FOOT = PH - 40;

  function frame(first){
    doc.addPage();
    doc.rect(0, 0, PW, first ? 8 : 4, PDF_C.accent);
    if (first){
      doc.text(M, 34, 'INVENTÁRIO CTE', { size: 9, bold: true, color: PDF_C.accent });
      doc.text(M, 58, title, { size: 22, bold: true });
      doc.text(M, 74, 'CTE — Centro Tecnológico Especializado · AgEÍlhavo', { size: 9, color: PDF_C.soft });
      doc.text(PW - M, 34, 'Gerado em ' + gen, { size: 8.5, color: PDF_C.soft, align: 'right' });
      return 90;
    }
    doc.text(M, 24, 'Inventário CTE — ' + title, { size: 8.5, bold: true, color: PDF_C.soft });
    doc.text(PW - M, 24, 'Gerado em ' + gen, { size: 8, color: PDF_C.soft, align: 'right' });
    return 36;
  }

  var y = frame(true);

  /* ---------- ficha de um só movimento ---------- */
  if (meta.ficha && recs.length === 1){
    var m = recs[0];
    var campos = [
      ['Data e hora', pdfDate_(m.timestamp)], ['Tipo de movimento', pdfTipo_(m.tipo)], ['Valência', m.armarioNome || '—'], ['Item', m.itemNome || '—'],
      ['Quantidade', pdfQty_(m.quantidade, m.unidade)], ['Pessoa', (m.nomeUser || '—') + ' (' + pdfPerfil_(m.role) + ')']
    ];
    if (m.tipo === 'levantamento' && m.prazo) campos.push(['Devolver até', pdfDate_(m.prazo)]);
    if (m.estado === 'danificado'){
      campos.push(['Estado', 'Danificado']);
      if (m.danoMarcadoEm) campos.push(['Assinalado', 'às ' + pdfHora_(m.danoMarcadoEm) + ', depois da devolução ' + pdfOrigem_(m.devolucaoOrigem) + ' das ' + pdfHora_(m.timestamp)]);
      campos.push(['Continua funcional?', pdfFunc_(m.danoFuncional) || '—']);
      campos.push(['Como ficou danificado', m.danoComo || '—']);
      campos.push(['O que aconteceu', m.danoOcorrencia || '—']);
    } else if (m.estado === 'reposto_admin') campos.push(['Estado', 'Reposto pelo administrador']);
    else if (m.tipo === 'devolucao') campos.push(['Estado', 'Devolvido normalmente']);
    y += 8;
    campos.forEach(function(c, i){
      var lines = pdfWrap_(c[1], false, 12, CW - 190);
      var h = Math.max(30, lines.length * 15 + 14);
      if (i % 2 === 0) doc.rect(M, y, CW, h, PDF_C.zebra);
      doc.text(M + 14, y + 19, c[0], { size: 10, bold: true, color: PDF_C.soft });
      lines.forEach(function(l, k){ doc.text(M + 190, y + 20 + k * 15, l, { size: 12, bold: i === 1 || (c[0] === 'Estado' && c[1] === 'Danificado'), color: (c[0] === 'Estado' && c[1] === 'Danificado') ? PDF_C.danger : PDF_C.ink }); });
      doc.line(M, y + h, M + CW, y + h, PDF_C.line, 0.5);
      y += h;
    });
  } else {
    /* ---------- filtros e resumo ---------- */
    var fl = pdfWrap_('Filtros: ' + ((meta.filters && meta.filters.length) ? meta.filters.join(' · ') : 'nenhum (todos os movimentos)'), false, 8.5, CW);
    fl.forEach(function(l, i){ doc.text(M, y + 10 + i * 11, l, { size: 8.5, color: PDF_C.soft }); });
    y += fl.length * 11 + 8;
    var cnt = function(t){ return recs.filter(function(r){ return r.tipo === t; }).length; };
    var dmg = recs.filter(function(r){ return r.estado === 'danificado'; }).length;
    var boxes = [['Total', recs.length, PDF_C.accent], ['Consumos', cnt('consumo'), '#9A5B00'], ['Requisições', cnt('levantamento'), '#1F3A93'], ['Devoluções', cnt('devolucao'), '#434B5E'], ['Reposições', cnt('reposicao'), '#0B6B4F'], ['Danificados', dmg, dmg ? PDF_C.danger : '#434B5E']];
    var gap = 8, bw = (CW - gap * 5) / 6;
    boxes.forEach(function(b, i){
      var bx = M + i * (bw + gap);
      doc.rect(bx, y, bw, 40, PDF_C.zebra); doc.rect(bx, y, 3, 40, b[2]);
      doc.text(bx + 12, y + 20, String(b[1]), { size: 16, bold: true, color: b[2] });
      doc.text(bx + 12, y + 33, b[0], { size: 8, color: PDF_C.soft });
    });
    y += 40 + 14;

    /* ---------- tabela ---------- */
    var cols = [['Data e hora', 78], ['Valência', 88], ['Item', 122], ['Tipo', 62], ['Quantidade', 58], ['Pessoa', 104], ['Perfil', 56], ['Estado / detalhes', 202]];
    var tot = cols.reduce(function(s, c){ return s + c[1]; }, 0), k = CW / tot, xs = [], acc = M;
    cols.forEach(function(c){ xs.push(acc); acc += c[1] * k; c.w = c[1] * k; });
    var PAD = 5, FS = 8, LH = 10;
    var drawHead = function(){
      doc.rect(M, y, CW, 20, PDF_C.head);
      cols.forEach(function(c, i){ doc.text(xs[i] + PAD, y + 13.5, c[0], { size: 8.5, bold: true, color: '#FFFFFF' }); });
      y += 20;
    };
    drawHead();
    if (!recs.length){
      doc.text(M + PAD, y + 22, 'Sem registos para os critérios escolhidos.', { size: 10, color: PDF_C.soft });
    }
    recs.forEach(function(r, idx){
      // texto de cada coluna (várias linhas se for preciso)
      var est = [];
      if (r.estado === 'danificado'){
        est.push({ t: 'Danificado', bold: true, color: PDF_C.danger, size: FS });
        if (r.danoMarcadoEm) pdfWrap_('Assinalado às ' + pdfHora_(r.danoMarcadoEm) + ' (devolução ' + pdfOrigem_(r.devolucaoOrigem) + ' às ' + pdfHora_(r.timestamp) + ')', false, 7, cols[7].w - 2 * PAD).forEach(function(l){ est.push({ t: l, size: 7, color: PDF_C.soft }); });
        if (r.danoFuncional) pdfWrap_('Funcional: ' + pdfFunc_(r.danoFuncional), false, 7, cols[7].w - 2 * PAD).forEach(function(l){ est.push({ t: l, size: 7, color: PDF_C.soft }); });
        if (r.danoComo) pdfWrap_('Dano: ' + r.danoComo, false, 7, cols[7].w - 2 * PAD).forEach(function(l){ est.push({ t: l, size: 7, color: PDF_C.soft }); });
        if (r.danoOcorrencia) pdfWrap_('O que aconteceu: ' + r.danoOcorrencia, false, 7, cols[7].w - 2 * PAD).forEach(function(l){ est.push({ t: l, size: 7, color: PDF_C.soft }); });
      } else if (r.estado === 'reposto_admin') est.push({ t: 'Reposto pelo administrador', color: PDF_C.ok, size: FS });
      else if (r.tipo === 'levantamento' && r.prazo) est.push({ t: 'Devolver até ' + pdfDate_(r.prazo), color: PDF_C.soft, size: FS });
      else est.push({ t: r.tipo === 'devolucao' ? 'ok' : '—', color: PDF_C.soft, size: FS });
      var cells = [
        [{ t: pdfDate_(r.timestamp), size: FS }],
        pdfWrap_(r.armarioNome || '—', false, FS, cols[1].w - 2 * PAD).map(function(l){ return { t: l, size: FS }; }),
        pdfWrap_(r.itemNome || '—', false, FS, cols[2].w - 2 * PAD).map(function(l){ return { t: l, size: FS }; }),
        [{ t: pdfTipo_(r.tipo), size: FS, bold: true, color: pdfTipoCor_(r.tipo) }],
        [{ t: pdfQty_(r.quantidade, r.unidade), size: FS }],
        pdfWrap_(r.nomeUser || '—', false, FS, cols[5].w - 2 * PAD).map(function(l){ return { t: l, size: FS }; }),
        [{ t: pdfPerfil_(r.role), size: FS, color: PDF_C.soft }],
        est
      ];
      var lines = Math.max.apply(null, cells.map(function(c){ return c.reduce(function(s, x){ return s + (x.size < FS ? 9 : LH); }, 0); }));
      var rh = lines + 2 * PAD - 1;
      if (y + rh > FOOT){ frame(false); y = 36; drawHead(); }
      if (idx % 2 === 1) doc.rect(M, y, CW, rh, PDF_C.zebra);
      cells.forEach(function(c, i){
        var cy = y + PAD + 7;
        c.forEach(function(x){ doc.text(xs[i] + PAD, cy, x.t, { size: x.size, bold: x.bold, color: x.color }); cy += (x.size < FS ? 9 : LH); });
      });
      doc.line(M, y + rh, M + CW, y + rh, PDF_C.line, 0.4);
      y += rh;
    });
  }

  /* ---------- rodapé com "Página x de y" em todas as páginas ---------- */
  var N = doc.pages.length;
  doc.pages.forEach(function(pg, i){
    doc.line(M, PH - 32, PW - M, PH - 32, PDF_C.line, 0.6, pg);
    doc.text(M, PH - 20, 'Inventário CTE · CTE — Centro Tecnológico Especializado · AgEÍlhavo', { size: 7.5, color: PDF_C.soft }, pg);
    doc.text(PW - M, PH - 20, 'Página ' + (i + 1) + ' de ' + N, { size: 8, bold: true, color: PDF_C.soft, align: 'right' }, pg);
  });
  return doc.build(title + ' - Inventario CTE');
}
function pdfBytes_(str){ var b = new Uint8Array(str.length); for (var i = 0; i < str.length; i++) b[i] = str.charCodeAt(i) & 255; return b; }
/* PDF-END */

/* ============================================================
   FEEDBACK (painel de administração)
   ============================================================ */
var FB_TIPOS = { danificado: 'Equipamento danificado', melhoria: 'Sugestão de melhoria', aquisicao: 'Sugestão de aquisição', outro: 'Outro' };
var FB_ESTADOS = { novo: 'Novo', visto: 'Visto', tratado: 'Tratado' };
function renderFbTab_(){
  if (!dashCache) return;
  var tbody = document.querySelector('#fb-table tbody');
  tbody.innerHTML = '';
  var list = dashCache.feedback || [];
  var f = document.getElementById('fb-filter-estado').value;
  var q = fold(document.getElementById('fb-search').value).trim();
  var novos = list.filter(function(x){ return x.estado === 'novo'; }).length;
  document.getElementById('fb-summary').textContent = novos + ' novo' + (novos === 1 ? '' : 's') + ' · ' + list.length + ' no total';
  var rows = list.filter(function(x){
    if (f && x.estado !== f) return false;
    if (q && fold([x.nomeUser, x.itemNome, x.armarioNome, x.mensagem, FB_TIPOS[x.tipo]].join(' ')).indexOf(q) === -1) return false;
    return true;
  });
  if (!rows.length){
    var tr0 = document.createElement('tr'), td0 = document.createElement('td');
    td0.colSpan = 6; td0.className = 'muted'; td0.textContent = list.length ? 'Sem resultados com estes filtros.' : 'Ainda não há feedback.';
    tr0.appendChild(td0); tbody.appendChild(tr0); return;
  }
  rows.forEach(function(x){
    var tr = document.createElement('tr');
    tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td><td></td>';
    if (x.estado === 'novo') tr.className = 'low';
    tr.children[0].textContent = fmtDateTime(x.criadoEm);
    tr.children[1].textContent = x.nomeUser;
    tr.children[2].textContent = FB_TIPOS[x.tipo] || x.tipo;
    tr.children[3].textContent = [x.armarioNome, x.itemNome].filter(Boolean).join(' — ') || '—';
    tr.children[4].textContent = x.mensagem;
    tr.children[4].style.cssText = 'max-width:360px;white-space:normal';
    var sel = document.createElement('select'); sel.style.cssText = 'margin:0;min-width:110px';
    Object.keys(FB_ESTADOS).forEach(function(k){ var o = document.createElement('option'); o.value = k; o.textContent = FB_ESTADOS[k]; sel.appendChild(o); });
    sel.value = x.estado;
    sel.addEventListener('change', function(){
      x.estado = sel.value;
      renderAllAdminTabs();
      toast('Estado atualizado.');
      bgRun_('api_adminSetFeedbackState', adminState.token, x.id, x.estado);
    });
    tr.children[5].appendChild(sel);
    tbody.appendChild(tr);
  });
}
['fb-filter-estado', 'fb-search'].forEach(function(id){
  document.getElementById(id).addEventListener('input', renderFbTab_);
  document.getElementById(id).addEventListener('change', renderFbTab_);
});
document.getElementById('prof-link-copy').addEventListener('click', function(){
  var t = document.getElementById('prof-link').textContent;
  try{ navigator.clipboard.writeText(t).then(function(){ toast('Link copiado.'); }, function(){ toast('Seleciona e copia o link manualmente.'); }); }
  catch(e){ toast('Seleciona e copia o link manualmente.'); }
});

/* ============================================================
   ÁREA DO PROFESSOR (?prof=1)
   ============================================================ */
var profState = { token: '', data: null };
var profIdleTimer = null;
function profResetIdle_(){ clearTimeout(profIdleTimer); if (profState.token) profIdleTimer = setTimeout(profLogout_, 20 * 60 * 1000); }
['click', 'touchstart', 'keydown'].forEach(function(evt){ document.addEventListener(evt, function(){ if (profState.token) profResetIdle_(); }); });

function bootProf_(){
  document.getElementById('kiosk-root').classList.add('hidden');
  document.getElementById('prof-root').classList.remove('hidden');
}
function profLogout_(){
  var t = profState.token;
  profState.token = ''; profState.data = null; clearTimeout(profIdleTimer);
  if (t) gsRunQ('api_profLogout', t).catch(function(){});
  document.getElementById('scr-prof-dash').classList.add('hidden');
  document.getElementById('scr-prof-login').classList.remove('hidden');
  document.getElementById('prof-pin').value = '';
}
function profExpired_(){ toast('Sessão expirada. Entra outra vez.'); profLogout_(); }

function profLogin_(){
  var pinEl = document.getElementById('prof-pin'), err = document.getElementById('prof-login-error'), btn = document.getElementById('prof-login-submit');
  var pin = pinEl.value.trim();
  err.textContent = '';
  if (pin.length < 4){ err.textContent = 'PIN demasiado curto.'; return; }
  btn.disabled = true;
  gsRun('api_profLogin', pin).then(function(res){
    btn.disabled = false;
    if (res.locked){ err.textContent = 'Demasiadas tentativas erradas. Tenta outra vez daqui a ' + (res.lockSeconds || 60) + 's.'; return; }
    if (res.inativo){ err.textContent = 'Este utilizador está desativado. Fala com o responsável.'; pinEl.value = ''; return; }
    if (res.naoProfessor){ err.textContent = 'Esta área é só para professores.'; pinEl.value = ''; return; }
    if (!res.ok){
      err.textContent = res.attemptsLeft ? 'PIN não reconhecido. Restam ' + res.attemptsLeft + ' tentativa' + (res.attemptsLeft === 1 ? '' : 's') + '.' : 'PIN não reconhecido.';
      pinEl.value = ''; return;
    }
    profState.token = res.token;
    pinEl.value = '';
    document.getElementById('scr-prof-login').classList.add('hidden');
    document.getElementById('scr-prof-dash').classList.remove('hidden');
    var tb = document.getElementById('theme-toggle'), slot = document.getElementById('prof-theme-slot');
    if (slot && tb.parentNode !== slot){ slot.appendChild(tb); tb.classList.add('in-menu'); }
    profResetIdle_();
    loadProf_();
  }).catch(function(){ btn.disabled = false; err.textContent = 'Erro de ligação. Tenta outra vez.'; });
}
document.getElementById('prof-login-submit').addEventListener('click', profLogin_);
document.getElementById('prof-pin').addEventListener('keydown', function(e){ if (e.key === 'Enter') profLogin_(); });
document.getElementById('prof-logout').addEventListener('click', profLogout_);

document.querySelectorAll('#prof-root .tab-btn').forEach(function(btn){
  btn.addEventListener('click', function(){
    document.querySelectorAll('#prof-root .tab-btn').forEach(function(b){ b.classList.toggle('active', b === btn); });
    document.querySelectorAll('#prof-root .panel').forEach(function(p){ p.classList.toggle('active', p.id === 'ptab-' + btn.dataset.tab); });
    document.getElementById('prof-title').textContent = btn.dataset.label || '';
    if (btn.dataset.tab === 'hist') loadProfHist_();
    if (window.scrollTo) window.scrollTo(0, 0);
  });
});

function loadProf_(){
  return gsRunQ('api_profData', profState.token).then(function(d){
    if (!d.ok){ profExpired_(); return; }
    profState.data = d;
    document.getElementById('prof-user').textContent = 'Olá, ' + d.user.nome;
    renderProfHome_(); renderProfInv_(); renderProfRes_(); renderProfMine_(); renderProfDmg_(); renderProfFb_();
  }).catch(function(){ toast('Erro de ligação.'); });
}

function profGoTab_(name){
  var b = document.querySelector('#prof-root .tab-btn[data-tab="' + name + '"]');
  if (b) b.click();
}
function renderProfInv_(){
  var d = profState.data; if (!d) return;
  var selCab = document.getElementById('prof-cab'), prev = selCab.value;
  selCab.innerHTML = '<option value="">Todas as valências</option>';
  d.cabinets.forEach(function(c){ var o = document.createElement('option'); o.value = c.id; o.textContent = c.nome + ' — ' + c.sala; selCab.appendChild(o); });
  if (prev && d.cabinets.some(function(c){ return c.id === prev; })) selCab.value = prev;
  var q = fold(document.getElementById('prof-search').value).trim();
  var cat = document.getElementById('prof-cat').value, cab = selCab.value;
  var onlyAv = document.getElementById('prof-avail').checked, onlyFav = document.getElementById('prof-fav').checked;
  var favs = {}; d.favoritos.forEach(function(i){ favs[i] = true; });
  var list = d.items.filter(function(it){
    if (cab && it.armarioId !== cab) return false;
    if (cat && it.categoria !== cat) return false;
    if (onlyAv && it.saldo <= 0) return false;
    if (onlyFav && !favs[it.id]) return false;
    if (q && fold(it.nome + ' ' + it.armarioNome + ' ' + it.sala).indexOf(q) === -1) return false;
    return true;
  }).sort(function(a, b){ return ((favs[b.id] ? 1 : 0) - (favs[a.id] ? 1 : 0)) || fold(a.nome).localeCompare(fold(b.nome)); });
  document.getElementById('prof-summary').textContent = list.length + ' resultado' + (list.length === 1 ? '' : 's') + (list.length > 100 ? ' — a mostrar os primeiros 100; refina a pesquisa.' : '');

  var rec = document.getElementById('prof-recent'); rec.innerHTML = '';
  if (!q && !cat && !cab && !onlyAv && !onlyFav && d.recentes.length){
    var g = document.createElement('div'); g.className = 'prof-grid';
    d.recentes.forEach(function(r){
      var it = d.items.filter(function(x){ return x.id === r.itemId; })[0];
      if (it) g.appendChild(buildProfCard_(it, d, r.qty));
    });
    if (g.children.length){
      var h = document.createElement('h3'); h.textContent = 'Requisitar de novo'; rec.appendChild(h); rec.appendChild(g);
      var h2 = document.createElement('h3'); h2.textContent = 'Todo o inventário'; rec.appendChild(h2);
    }
  }
  var wrap = document.getElementById('prof-items');
  wrap.innerHTML = '';
  if (!list.length){ var e = document.createElement('p'); e.className = 'muted'; e.textContent = 'Nenhum item encontrado.'; wrap.appendChild(e); return; }
  list.slice(0, 100).forEach(function(it){ wrap.appendChild(buildProfCard_(it, d)); });
}
['prof-fav'].forEach(function(id){
  document.getElementById(id).addEventListener('change', renderProfInv_);
});

function profAfterMove_(res, okMsg){
  if (!res.ok){
    if (res.error === 'sessao_invalida'){ profExpired_(); return; }
    var m = { sem_stock: 'Já não há equipamento suficiente disponível.', prazo_invalido: 'A hora escolhida já passou. Escolhe outra.', dias_invalidos: 'Indica um número de dias válido.',
              quantidade_invalida: 'Indica uma quantidade válida.', utilizador_inativo: 'O teu acesso está desativado.',
              excede_posse: 'Não tens essa quantidade na tua posse.', detalhes_em_falta: 'Preenche as perguntas sobre o dano.',
              reservado: 'Este equipamento está reservado por outra pessoa nesse período.', nada_por_devolver: 'Já não tens este material por devolver.' };
    toast(m[res.error] || 'Não foi possível registar. Tenta outra vez.');
    if (res.error === 'sem_stock' || res.error === 'prazo_invalido' || res.error === 'excede_posse') loadProf_();
    return;
  }
  toast(okMsg);
  playConfirmSound();
  loadProf_();
}

function buildProfCard_(it, d, defQty){
  var card = document.createElement('div');
  card.className = 'item-card'; card.style.margin = '0';
  card.innerHTML = '<div class="row1"><b></b><span class="badge cat"></span></div><div class="muted loc"></div><div class="saldo"></div>';
  card.querySelector('b').textContent = it.nome;
  card.querySelector('.badge').textContent = it.categoria === 'consumivel' ? 'consumível' : 'equipamento';
  card.querySelector('.loc').textContent = '📍 ' + it.armarioNome + ' — ' + it.sala;
  card.querySelector('.saldo').textContent = 'Disponível: ' + fmtQty(it.saldo) + ' ' + unitLabel(it.unidade) + (it.indisponivel > 0 ? ' · ' + fmtQty(it.indisponivel) + ' indisponível (danificado)' : '');

  var fav = document.createElement('button'); fav.type = 'button'; fav.className = 'btn secondary';
  fav.style.cssText = 'margin:0;padding:2px 9px;font-size:16px;min-height:0';
  var isFav = d.favoritos.indexOf(it.id) !== -1;
  fav.textContent = isFav ? '★' : '☆'; fav.title = isFav ? 'Retirar dos favoritos' : 'Adicionar aos favoritos'; fav.setAttribute('aria-label', fav.title);
  fav.addEventListener('click', function(){
    gsRunQ('api_profToggleFavorito', profState.token, it.id).then(function(res){
      if (!res.ok){ if (res.error === 'sessao_invalida') profExpired_(); else toast('Não foi possível guardar o favorito.'); return; }
      var k = d.favoritos.indexOf(it.id);
      if (res.fav && k === -1) d.favoritos.push(it.id); else if (!res.fav && k !== -1) d.favoritos.splice(k, 1);
      renderProfInv_();
    }).catch(function(){ toast('Erro de ligação.'); });
  });
  card.querySelector('.row1').appendChild(fav);
  (it.reservas || []).forEach(function(r){
    var l = document.createElement('div'); l.className = 'muted';
    l.textContent = '📅 Reservado' + (r.meu ? ' (por ti)' : '') + ': ' + fmtQty(r.qty) + ' un · ' + fmtDateTime(r.inicio) + ' → ' + fmtDateTime(r.fim);
    card.appendChild(l);
  });

  if (it.categoria === 'consumivel'){
    var row = document.createElement('div'); row.className = 'qty-row';
    var inp = document.createElement('input'); inp.type = 'number'; inp.min = '0'; inp.step = (it.unidade === 'un' ? '1' : 'any'); inp.placeholder = 'Quantidade (' + unitLabel(it.unidade) + ')';
    var b = document.createElement('button'); b.className = 'btn'; b.type = 'button'; b.textContent = 'Registar consumo';
    b.addEventListener('click', function(){
      var q = Number(inp.value);
      if (!q || q <= 0){ toast('Indica uma quantidade válida.'); return; }
      if (q > it.saldo && !confirm('Vais consumir mais do que o saldo disponível (' + fmtQty(it.saldo) + ' ' + unitLabel(it.unidade) + '). Confirmas?')) return;
      gsRun('api_profConsumo', profState.token, it.id, q).then(function(res){
        profAfterMove_(res, 'Registaste ' + fmtQty(q) + ' ' + unitLabel(it.unidade) + ' de "' + it.nome + '".');
      }).catch(function(){ toast('Erro de ligação. Tenta outra vez.'); });
    });
    row.appendChild(inp); row.appendChild(b); card.appendChild(row);
    return card;
  }

  var slots = (d.slots || []).filter(function(s){ return new Date(s.iso).getTime() > Date.now(); });
  if (!slots.length) slots = d.slots || [];
  var def = slots.filter(function(s){ return /fim da aula/.test(s.label); })[0] || slots[0];
  var lab = document.createElement('label'); lab.textContent = 'Devolver';
  var sel = document.createElement('select');
  slots.forEach(function(s){ var o = document.createElement('option'); o.value = s.iso; o.textContent = (d.slotDay || 'hoje') + ' · ' + s.label + (def && s.iso === def.iso ? '  ·  sugerido' : ''); sel.appendChild(o); });
  var oD = document.createElement('option'); oD.value = 'dias'; oD.textContent = 'Vários dias…'; sel.appendChild(oD);
  if (def) sel.value = def.iso;
  sel.disabled = it.saldo <= 0;
  var diasWrap = document.createElement('div'); diasWrap.className = 'hidden';
  var diasLab = document.createElement('label'); diasLab.textContent = 'Durante quantos dias? (devolves no fim do dia escolar do último dia)';
  var diasIn = document.createElement('input'); diasIn.type = 'number'; diasIn.min = '1'; diasIn.max = '365'; diasIn.step = '1'; diasIn.value = '2';
  diasWrap.appendChild(diasLab); diasWrap.appendChild(diasIn);
  sel.addEventListener('change', function(){ diasWrap.classList.toggle('hidden', sel.value !== 'dias'); });
  card.appendChild(lab); card.appendChild(sel); card.appendChild(diasWrap);

  var row2 = document.createElement('div'); row2.className = 'qty-row';
  var qIn = document.createElement('input'); qIn.type = 'number'; qIn.min = '1'; qIn.step = '1'; qIn.max = String(Math.max(Math.floor(it.saldo), 0));
  qIn.placeholder = 'Quantidade (un)'; qIn.value = it.saldo > 0 ? String(Math.max(1, Math.min(Math.floor(defQty || 1), Math.floor(it.saldo)))) : ''; qIn.disabled = it.saldo <= 0;
  var qBtn = document.createElement('button'); qBtn.className = 'btn'; qBtn.type = 'button'; qBtn.textContent = 'Requisitar'; qBtn.disabled = it.saldo <= 0;
  qBtn.addEventListener('click', function(){
    var q = Math.floor(Number(qIn.value));
    if (!q || q <= 0){ toast('Indica uma quantidade válida.'); return; }
    if (q > it.saldo){ toast('Só há ' + fmtQty(it.saldo) + ' ' + unitLabel(it.unidade) + ' disponível.'); return; }
    var dias = 0, prazo = sel.value;
    if (sel.value === 'dias'){
      dias = Math.floor(Number(diasIn.value)); prazo = '';
      if (!dias || dias < 1 || dias > 365){ toast('Indica um número de dias entre 1 e 365.'); return; }
    } else if (!prazo){ toast('Escolhe até quando precisas do equipamento.'); return; }
    gsRun('api_profRequisitar', profState.token, it.id, q, prazo, dias).then(function(res){
      profAfterMove_(res, 'Requisitaste ' + fmtQty(q) + ' un de "' + it.nome + '". Devolve até ' + fmtPrazo_(res.prazo || prazo) + '.');
    }).catch(function(){ toast('Erro de ligação. Tenta outra vez.'); });
  });
  row2.appendChild(qIn); row2.appendChild(qBtn); card.appendChild(row2);
  var rsvBtn = document.createElement('button'); rsvBtn.type = 'button'; rsvBtn.className = 'btn secondary'; rsvBtn.style.marginTop = '10px';
  rsvBtn.textContent = '📅 Reservar para outra data';
  rsvBtn.addEventListener('click', function(){ document.getElementById('pres-item').value = it.id; profGoTab_('res'); });
  card.appendChild(rsvBtn);
  if (it.saldo <= 0){ var w = document.createElement('p'); w.className = 'muted'; w.textContent = 'Sem stock disponível de momento.'; card.appendChild(w); }
  return card;
}
['prof-search', 'prof-cab', 'prof-cat', 'prof-avail'].forEach(function(id){
  document.getElementById(id).addEventListener('input', renderProfInv_);
  document.getElementById(id).addEventListener('change', renderProfInv_);
});

function renderProfMine_(){
  var d = profState.data; if (!d) return;
  var wrap = document.getElementById('prof-mine'); wrap.innerHTML = '';
  var bar = document.getElementById('prof-mine-bar');
  var cnt = document.getElementById('pcnt-mine');
  cnt.textContent = String(d.holdings.length); cnt.classList.toggle('hidden', !d.holdings.length);
  if (!d.holdings.length){
    bar.classList.add('hidden');
    var e = document.createElement('p'); e.className = 'muted'; e.textContent = 'Não tens nenhum material requisitado.'; wrap.appendChild(e); return;
  }
  bar.classList.remove('hidden');
  var states = [], groups = {}, order = [];
  d.holdings.forEach(function(h){ if (!groups[h.armarioNome]){ groups[h.armarioNome] = []; order.push(h.armarioNome); } groups[h.armarioNome].push(h); });

  var allCb = document.getElementById('pm-all'), batchBtn = document.getElementById('pm-batch');
  function updateBar(){
    var n = states.filter(function(s){ return s.cb.checked; }).length;
    batchBtn.disabled = !n; batchBtn.textContent = '↩️ Devolver selecionados (' + n + ')';
    allCb.checked = n > 0 && n === states.length;
  }
  allCb.checked = false;
  allCb.onchange = function(){ states.forEach(function(s){ s.cb.checked = allCb.checked; }); updateBar(); };
  batchBtn.onclick = function(){
    var sel = states.filter(function(s){ return s.cb.checked; }), lista = [];
    if (!sel.length) return;
    for (var i = 0; i < sel.length; i++){
      var s = sel[i], q = Math.floor(Number(s.qIn.value));
      if (!q || q <= 0 || q > s.h.qty){ toast('Confirma a quantidade de "' + s.h.nome + '".'); return; }
      var dano = s.dmgCheck.checked, det = null;
      if (dano){ det = s.form.readDetails(); if (!det) return; }
      lista.push({ itemId: s.h.id, quantidade: q, danificado: dano, detalhes: det });
    }
    if (!confirm('Devolver ' + lista.length + ' item(ns)?' + (lista.some(function(x){ return x.danificado; }) ? '\nOs assinalados como danificados avisam o responsável.' : ''))) return;
    gsRun('api_profDevolverVarios', profState.token, lista).then(function(res){
      if (!res.ok){ if (res.error === 'sessao_invalida') profExpired_(); else toast('Não foi possível devolver.'); return; }
      var falhas = res.results.filter(function(r){ return !r.ok; }).length;
      toast(res.feitos + ' devolvido(s)' + (falhas ? ' · ' + falhas + ' falharam (confirma a lista).' : '.'));
      if (res.feitos) playConfirmSound();
      loadProf_();
    }).catch(function(){ toast('Erro de ligação. Confirma a lista antes de repetir.'); });
  };

  order.forEach(function(name){
    var groupStates = [];
    var gh = document.createElement('label');
    gh.style.cssText = 'display:flex;align-items:center;gap:8px;margin:16px 0 4px;font-weight:600;text-transform:none;font-size:14px';
    var gcb = document.createElement('input'); gcb.type = 'checkbox'; gcb.style.width = 'auto';
    gh.appendChild(gcb); gh.appendChild(document.createTextNode('📍 ' + name + ' — selecionar todas'));
    wrap.appendChild(gh);
    groups[name].forEach(function(h, idx){
      var st = { h: h };
      var row = document.createElement('div'); row.className = 'hold-card';
      row.style.flexDirection = 'column'; row.style.alignItems = 'stretch';
      var top = document.createElement('label'); top.style.cssText = 'display:flex;align-items:flex-start;gap:8px;margin:0;text-transform:none;font-size:14px;font-weight:400;color:var(--ink)';
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.style.cssText = 'width:auto;margin-top:4px'; cb.addEventListener('change', updateBar);
      st.cb = cb; top.appendChild(cb);
      var box = document.createElement('div');
      var b = document.createElement('b'); b.textContent = h.nome;
      box.appendChild(b); box.appendChild(document.createTextNode(' — ' + fmtQty(h.qty) + ' ' + unitLabel(h.unidade)));
      if (h.prazo){
        var pz = document.createElement('div'); pz.className = 'muted';
        pz.textContent = (h.atraso ? '⏰ Em atraso — devia ter sido devolvido até ' : 'Devolver até ') + fmtPrazo_(h.prazo);
        if (h.atraso){ pz.style.color = 'var(--danger)'; pz.style.fontWeight = '600'; }
        box.appendChild(pz);
      }
      top.appendChild(box); row.appendChild(top);

      var qr = document.createElement('div'); qr.className = 'qty-row';
      var qIn = document.createElement('input'); qIn.type = 'number'; qIn.min = '1'; qIn.step = '1'; qIn.max = String(Math.floor(h.qty)); qIn.value = String(Math.floor(h.qty));
      qIn.setAttribute('aria-label', 'Quantidade a devolver'); st.qIn = qIn;
      var btn = document.createElement('button'); btn.className = 'btn amber'; btn.type = 'button'; btn.textContent = '↩️ Devolver';
      var ext = document.createElement('button'); ext.className = 'btn secondary'; ext.type = 'button'; ext.textContent = '⏱ Prolongar';
      qr.appendChild(qIn); qr.appendChild(btn); qr.appendChild(ext); row.appendChild(qr);

      var extForm = document.createElement('div'); extForm.className = 'loan-form hidden';
      extForm.innerHTML = '<label>Acrescentar quantos dias? (1 a 365)</label><input type="number" class="ext-dias" min="1" max="365" step="1" value="1"><button class="btn block ext-ok" type="button">Confirmar prolongamento</button>';
      ext.addEventListener('click', function(){ extForm.classList.toggle('hidden'); });
      extForm.querySelector('.ext-ok').addEventListener('click', function(){
        var dias = Math.floor(Number(extForm.querySelector('.ext-dias').value));
        if (!dias || dias < 1 || dias > 365){ toast('Indica entre 1 e 365 dias.'); return; }
        gsRun('api_profProlongar', profState.token, h.id, dias).then(function(res){
          profAfterMove_(res, 'Prazo prolongado até ' + fmtPrazo_(res.prazo) + '.');
        }).catch(function(){ toast('Erro de ligação. Tenta outra vez.'); });
      });
      row.appendChild(extForm);

      var dmgLabel = document.createElement('label'); dmgLabel.className = 'dmg-toggle';
      var dmgCheck = document.createElement('input'); dmgCheck.type = 'checkbox'; dmgLabel.appendChild(dmgCheck);
      var dmgText = document.createElement('span'); dmgText.textContent = '⚠️ Este equipamento está danificado / partido'; dmgLabel.appendChild(dmgText);
      row.appendChild(dmgLabel);
      var form = makeDamageForm_('p' + name.length + '-' + idx + '-' + h.id.slice(0, 4)); row.appendChild(form);
      dmgCheck.addEventListener('change', function(){ form.classList.toggle('hidden', !dmgCheck.checked); });
      st.dmgCheck = dmgCheck; st.form = form;

      btn.addEventListener('click', function(){
        var q = Math.floor(Number(qIn.value));
        if (!q || q <= 0){ toast('Indica uma quantidade válida.'); return; }
        if (q > h.qty){ toast('Só tens ' + fmtQty(h.qty) + ' ' + unitLabel(h.unidade) + ' em teu nome.'); return; }
        var dano = dmgCheck.checked, det = null;
        if (dano){ det = form.readDetails(); if (!det) return; }
        gsRun('api_profDevolver', profState.token, h.id, q, dano, det).then(function(res){
          profAfterMove_(res, 'Devolveste ' + fmtQty(q) + ' ' + unitLabel(h.unidade) + ' de "' + h.nome + '"' + (dano ? ' (assinalado como danificado — o responsável vai ser avisado).' : '.'));
        }).catch(function(){ toast('Erro de ligação. Tenta outra vez.'); });
      });
      states.push(st); groupStates.push(st);
      wrap.appendChild(row);
    });
    gcb.addEventListener('change', function(){ groupStates.forEach(function(s){ s.cb.checked = gcb.checked; }); updateBar(); });
  });
  updateBar();
}

function renderProfDmg_(){
  var d = profState.data; if (!d) return;
  var tbody = document.querySelector('#pdmg-table tbody'); tbody.innerHTML = '';
  if (!d.danificados.length){
    var tr0 = document.createElement('tr'), td0 = document.createElement('td'); td0.colSpan = 5; td0.className = 'muted'; td0.textContent = 'Ainda não assinalaste nenhum equipamento como danificado.';
    tr0.appendChild(td0); tbody.appendChild(tr0); return;
  }
  d.danificados.forEach(function(x){
    var tr = document.createElement('tr'); tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td>';
    tr.children[0].textContent = fmtDateTime(x.timestamp);
    tr.children[1].textContent = x.itemNome + ' — ' + x.armarioNome;
    tr.children[2].textContent = fmtQty(x.quantidade) + ' ' + unitLabel(x.unidade);
    tr.children[3].textContent = DMG_LABELS[x.estadoReparacao] || x.estadoReparacao;
    tr.children[4].textContent = x.nota || '—'; tr.children[4].style.cssText = 'max-width:260px;white-space:normal';
    tbody.appendChild(tr);
  });
}

/* ---- início do professor ---- */
function renderProfHome_(){
  var d = profState.data; if (!d) return;
  var now = Date.now(), today = new Date().toDateString();
  var late = d.holdings.filter(function(h){ return h.atraso; });
  var todayList = d.holdings.filter(function(h){ return !h.atraso && h.prazo && new Date(h.prazo).toDateString() === today; });
  var res = d.reservas.filter(function(r){ return r.estado === 'ativa' && new Date(r.fim).getTime() > now; }).sort(function(a, b){ return String(a.inicio).localeCompare(String(b.inicio)); });
  document.getElementById('phome-late').textContent = late.length;
  document.getElementById('phome-today').textContent = todayList.length;
  document.getElementById('phome-res').textContent = res.length;
  document.getElementById('phome-mine').textContent = d.holdings.length;
  document.getElementById('phome-late').parentNode.classList.toggle('warn', late.length > 0);
  var wrap = document.getElementById('phome-list'); wrap.innerHTML = '';
  function section(title, lines){
    if (!lines.length) return;
    var h = document.createElement('h3'); h.textContent = title; wrap.appendChild(h);
    lines.slice(0, 6).forEach(function(l){
      var r = document.createElement('div'); r.className = 'home-row';
      var a = document.createElement('span'); a.textContent = l[0];
      var b = document.createElement('em'); b.textContent = l[1];
      r.appendChild(a); r.appendChild(b); wrap.appendChild(r);
    });
  }
  var recente = function(iso){ var t = new Date(iso).getTime(); return iso && !isNaN(t) && now - t < 14 * 86400000; };
  section('Material em atraso', late.map(function(h){ return [h.nome + ' — ' + h.armarioNome, 'desde ' + fmtPrazo_(h.prazo)]; }));
  section('Termina hoje', todayList.map(function(h){ return [h.nome + ' — ' + h.armarioNome, fmtPrazo_(h.prazo)]; }));
  section('Reservas', res.map(function(r){ return [fmtQty(r.quantidade) + ' un de ' + r.itemNome, fmtDateTime(r.inicio)]; }));
  section('Equipamento danificado: novidades', d.danificados.filter(function(x){ return x.estadoReparacao !== 'por_avaliar' && recente(x.atualizadoEm); })
    .map(function(x){ return [x.itemNome, DMG_LABELS[x.estadoReparacao] || x.estadoReparacao]; }));
  section('O teu feedback: novidades', d.feedback.filter(function(f){ return f.estado !== 'novo' && recente(f.atualizadoEm); })
    .map(function(f){ return [(FB_TIPOS[f.tipo] || f.tipo) + (f.itemNome ? ' — ' + f.itemNome : ''), FB_ESTADOS[f.estado] || f.estado]; }));
  if (!wrap.children.length){ var ok = document.createElement('p'); ok.className = 'muted'; ok.textContent = 'Tudo em ordem. Nada precisa de atenção.'; wrap.appendChild(ok); }
}
document.querySelectorAll('#prof-root .home-tile').forEach(function(t){ t.addEventListener('click', function(){ profGoTab_(t.dataset.pgo); }); });

/* ---- reservas do professor ---- */
function renderProfRes_(){
  var d = profState.data; if (!d) return;
  var sel = document.getElementById('pres-item'), prev = sel.value;
  sel.innerHTML = '';
  d.items.filter(function(i){ return i.categoria === 'equipamento'; }).sort(function(a, b){ return fold(a.nome).localeCompare(fold(b.nome)); }).forEach(function(i){
    var o = document.createElement('option'); o.value = i.id; o.textContent = i.nome + ' — ' + i.armarioNome; sel.appendChild(o);
  });
  if (prev && d.items.some(function(i){ return i.id === prev; })) sel.value = prev;
  var tbody = document.querySelector('#pres-table tbody'); tbody.innerHTML = '';
  if (!d.reservas.length){
    var tr0 = document.createElement('tr'), td0 = document.createElement('td'); td0.colSpan = 5; td0.className = 'muted'; td0.textContent = 'Ainda não tens reservas.';
    tr0.appendChild(td0); tbody.appendChild(tr0); return;
  }
  d.reservas.forEach(function(r){
    var ef = (r.estado === 'ativa' && new Date(r.fim).getTime() < Date.now()) ? 'terminada' : r.estado;
    var tr = document.createElement('tr'); tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td>';
    tr.children[0].textContent = r.itemNome + ' — ' + r.armarioNome;
    tr.children[1].textContent = fmtQty(r.quantidade) + ' ' + unitLabel(r.unidade);
    tr.children[2].textContent = fmtDateTime(r.inicio) + ' → ' + fmtDateTime(r.fim);
    tr.children[3].textContent = ef.charAt(0).toUpperCase() + ef.slice(1);
    if (ef === 'ativa'){
      var c = document.createElement('button'); c.type = 'button'; c.className = 'btn danger'; c.textContent = 'Cancelar'; c.style.cssText = 'margin:0;padding:4px 10px;font-size:12px';
      c.addEventListener('click', function(){
        if (!confirm('Cancelar a reserva de "' + r.itemNome + '"?')) return;
        gsRun('api_profCancelarReserva', profState.token, r.id).then(function(res){
          if (!res.ok){ if (res.error === 'sessao_invalida') profExpired_(); else toast('Não foi possível cancelar.'); return; }
          toast('Reserva cancelada.'); loadProf_();
        }).catch(function(){ toast('Erro de ligação.'); });
      });
      tr.children[4].appendChild(c);
    }
    tbody.appendChild(tr);
  });
}
document.getElementById('pres-send').addEventListener('click', function(){
  var btn = this, err = document.getElementById('pres-error'); err.textContent = '';
  var item = document.getElementById('pres-item').value, qty = Math.floor(Number(document.getElementById('pres-qty').value));
  var ini = document.getElementById('pres-ini').value, fim = document.getElementById('pres-fim').value;
  if (!item){ err.textContent = 'Escolhe o equipamento.'; return; }
  if (!qty || qty <= 0){ err.textContent = 'Indica uma quantidade válida.'; return; }
  if (!ini || !fim){ err.textContent = 'Indica o início e o fim da reserva.'; return; }
  var di = new Date(ini), df = new Date(fim);
  if (isNaN(di.getTime()) || isNaN(df.getTime()) || df <= di){ err.textContent = 'O fim tem de ser depois do início.'; return; }
  btn.disabled = true;
  gsRun('api_profReservar', profState.token, item, qty, di.toISOString(), df.toISOString(), document.getElementById('pres-motivo').value.trim()).then(function(res){
    btn.disabled = false;
    if (!res.ok){
      if (res.error === 'sessao_invalida'){ profExpired_(); return; }
      var m = { sem_disponibilidade: 'Não há unidades suficientes nesse período (livres: ' + (res.livres || 0) + ').', inicio_passado: 'O início já passou.',
                datas_invalidas: 'Datas inválidas (a reserva pode ir até 1 ano).', quantidade_invalida: 'Indica uma quantidade válida.', so_equipamento: 'Só se reserva equipamento.' };
      err.textContent = m[res.error] || 'Não foi possível reservar. Tenta outra vez.'; return;
    }
    document.getElementById('pres-motivo').value = '';
    toast('Reserva registada.'); loadProf_();
  }).catch(function(){ btn.disabled = false; err.textContent = 'Erro de ligação. Confirma em "As minhas reservas" antes de repetir.'; });
});

/* ---- histórico pessoal ---- */
var profHist = [];
function loadProfHist_(){
  gsRunQ('api_profHistory', profState.token).then(function(res){
    if (!res.ok){ profExpired_(); return; }
    profHist = res.movimentos; renderProfHist_();
  }).catch(function(){ toast('Erro de ligação.'); });
}
function profHistFiltered_(){
  var q = fold(document.getElementById('phist-search').value).trim();
  var from = document.getElementById('phist-from').value, to = document.getElementById('phist-to').value, tipo = document.getElementById('phist-tipo').value;
  return profHist.filter(function(m){
    if (tipo && m.tipo !== tipo) return false;
    if (from && (m.timestamp || '') < from) return false;
    if (to && (m.timestamp || '') > to + 'T23:59:59') return false;
    if (q && fold(m.itemNome + ' ' + m.armarioNome).indexOf(q) === -1) return false;
    return true;
  });
}
function renderProfHist_(){
  var rows = profHistFiltered_();
  document.getElementById('phist-summary').textContent = rows.length + ' registo' + (rows.length === 1 ? '' : 's') + (rows.length > 300 ? ' (a mostrar os 300 mais recentes; a exportação leva todos)' : '');
  var tbody = document.querySelector('#phist-table tbody'); tbody.innerHTML = '';
  if (!rows.length){
    var tr0 = document.createElement('tr'), td0 = document.createElement('td'); td0.colSpan = 6; td0.className = 'muted'; td0.textContent = 'Sem registos.';
    tr0.appendChild(td0); tbody.appendChild(tr0); return;
  }
  rows.slice(0, 300).forEach(function(m){
    var tr = document.createElement('tr'); tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td><td></td>';
    tr.children[0].textContent = fmtDateTime(m.timestamp);
    tr.children[1].textContent = m.armarioNome; tr.children[2].textContent = m.itemNome;
    tr.children[3].textContent = tipoLabel(m.tipo);
    tr.children[4].textContent = fmtQty(m.quantidade) + ' ' + unitLabel(m.unidade);
    if (m.estado === 'danificado') tr.children[5].innerHTML = '<span class="badge low">danificado</span>';
    else if (m.tipo === 'levantamento' && m.prazo) tr.children[5].textContent = 'até ' + fmtPrazo_(m.prazo);
    else tr.children[5].textContent = m.tipo === 'devolucao' ? 'ok' : '—';
    tbody.appendChild(tr);
  });
}
['phist-search', 'phist-from', 'phist-to', 'phist-tipo'].forEach(function(id){
  document.getElementById(id).addEventListener('input', renderProfHist_);
  document.getElementById(id).addEventListener('change', renderProfHist_);
});
document.getElementById('phist-csv').addEventListener('click', function(){
  var rows = profHistFiltered_();
  if (!rows.length){ toast('Não há registos para exportar.'); return; }
  var out = [['Data/Hora', 'Valência', 'Item', 'Tipo', 'Quantidade', 'Unidade', 'Estado', 'Devolver até']];
  rows.slice().reverse().forEach(function(m){ out.push([m.timestamp, m.armarioNome, m.itemNome, tipoLabel(m.tipo), m.quantidade, unitLabel(m.unidade), m.estado || '', m.prazo || '']); });
  var csv = '\uFEFF' + out.map(function(r){ return r.map(function(v){ return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(','); }).join('\r\n');
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'meu-historico-cte.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
});
document.getElementById('phist-pdf').addEventListener('click', function(){
  var rows = profHistFiltered_();
  if (!rows.length){ toast('Não há registos para exportar.'); return; }
  var f = [], dt = function(v){ return v ? v.split('-').reverse().join('/') : ''; };
  var from = document.getElementById('phist-from').value, to = document.getElementById('phist-to').value, tp = document.getElementById('phist-tipo');
  if (tp.value) f.push('Tipo: ' + tp.options[tp.selectedIndex].textContent);
  if (from && to) f.push('Período: ' + dt(from) + ' a ' + dt(to)); else if (from) f.push('Desde ' + dt(from)); else if (to) f.push('Até ' + dt(to));
  var q = document.getElementById('phist-search').value.trim(); if (q) f.push('Pesquisa: "' + q + '"');
  var bytes;
  try{ bytes = pdfBytes_(buildHistoryPdf_(rows.slice().reverse(), { filters: f, ficha: false })); }
  catch(e){ toast('Não foi possível gerar o PDF.'); return; }
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  a.download = 'meu-historico-cte-' + new Date().toISOString().slice(0, 10) + '.pdf';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  toast('PDF gerado.');
});

/* ---- painel de administração: reservas ---- */
function renderRsvTab_(){
  if (!dashCache) return;
  var tbody = document.querySelector('#rsv-table tbody'); tbody.innerHTML = '';
  var list = (dashCache.reservas || []).map(function(r){
    r._ef = (r.estado === 'ativa' && new Date(r.fim).getTime() < Date.now()) ? 'terminada' : r.estado; return r;
  });
  var f = document.getElementById('rsv-filter-estado').value, q = fold(document.getElementById('rsv-search').value).trim();
  var ativas = list.filter(function(r){ return r._ef === 'ativa'; }).length;
  document.getElementById('rsv-summary').textContent = ativas + ' ativa' + (ativas === 1 ? '' : 's') + ' · ' + list.length + ' no total';
  var rows = list.filter(function(r){
    if (f && r._ef !== f) return false;
    if (q && fold([r.nomeUser, r.itemNome, r.armarioNome, r.motivo].join(' ')).indexOf(q) === -1) return false;
    return true;
  });
  if (!rows.length){
    var tr0 = document.createElement('tr'), td0 = document.createElement('td'); td0.colSpan = 7; td0.className = 'muted'; td0.textContent = list.length ? 'Sem resultados com estes filtros.' : 'Ainda não há reservas.';
    tr0.appendChild(td0); tbody.appendChild(tr0); return;
  }
  rows.forEach(function(r){
    var tr = document.createElement('tr'); tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td><td></td><td></td>';
    tr.children[0].textContent = r.nomeUser;
    tr.children[1].textContent = r.itemNome + ' — ' + r.armarioNome;
    tr.children[2].textContent = fmtQty(r.quantidade) + ' ' + unitLabel(r.unidade);
    tr.children[3].textContent = fmtDateTime(r.inicio) + ' → ' + fmtDateTime(r.fim);
    tr.children[4].textContent = r.motivo || '—'; tr.children[4].style.cssText = 'max-width:240px;white-space:normal';
    tr.children[5].textContent = r._ef.charAt(0).toUpperCase() + r._ef.slice(1);
    if (r._ef === 'ativa'){
      var c = document.createElement('button'); c.type = 'button'; c.className = 'btn danger'; c.textContent = 'Cancelar'; c.style.cssText = 'margin:0;padding:4px 10px;font-size:12px';
      c.addEventListener('click', function(){
        if (!confirm('Cancelar a reserva de ' + r.nomeUser + ' (' + r.itemNome + ')?')) return;
        r.estado = 'cancelada';
        renderAllAdminTabs();
        toast('Reserva cancelada.');
        bgRun_('api_adminCancelarReserva', adminState.token, r.id);
      });
      tr.children[6].appendChild(c);
    }
    tbody.appendChild(tr);
  });
}
['rsv-filter-estado', 'rsv-search'].forEach(function(id){
  document.getElementById(id).addEventListener('input', renderRsvTab_);
  document.getElementById(id).addEventListener('change', renderRsvTab_);
});

function renderProfFb_(){
  var d = profState.data; if (!d) return;
  var sel = document.getElementById('pfb-cab'), prev = sel.value;
  sel.innerHTML = '<option value="">—</option>';
  d.cabinets.forEach(function(c){ var o = document.createElement('option'); o.value = c.id; o.textContent = c.nome + ' — ' + c.sala; sel.appendChild(o); });
  if (prev && d.cabinets.some(function(c){ return c.id === prev; })) sel.value = prev;
  var tbody = document.querySelector('#pfb-table tbody'); tbody.innerHTML = '';
  if (!d.feedback.length){
    var tr0 = document.createElement('tr'), td0 = document.createElement('td'); td0.colSpan = 5; td0.className = 'muted'; td0.textContent = 'Ainda não enviaste feedback.';
    tr0.appendChild(td0); tbody.appendChild(tr0); return;
  }
  d.feedback.forEach(function(x){
    var tr = document.createElement('tr'); tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td>';
    tr.children[0].textContent = fmtDateTime(x.criadoEm);
    tr.children[1].textContent = FB_TIPOS[x.tipo] || x.tipo;
    tr.children[2].textContent = [x.armarioNome, x.itemNome].filter(Boolean).join(' — ') || '—';
    tr.children[3].textContent = x.mensagem; tr.children[3].style.cssText = 'max-width:320px;white-space:normal';
    tr.children[4].textContent = FB_ESTADOS[x.estado] || x.estado;
    tbody.appendChild(tr);
  });
}
document.getElementById('pfb-send').addEventListener('click', function(){
  var btn = this, err = document.getElementById('pfb-error');
  var msg = document.getElementById('pfb-msg').value.trim();
  err.textContent = '';
  if (msg.length < 5){ err.textContent = 'Escreve a mensagem (mínimo 5 carateres).'; return; }
  btn.disabled = true;
  gsRun('api_profSendFeedback', profState.token, document.getElementById('pfb-tipo').value, document.getElementById('pfb-cab').value,
        document.getElementById('pfb-item').value.trim(), msg).then(function(res){
    btn.disabled = false;
    if (!res.ok){
      if (res.error === 'sessao_invalida'){ profExpired_(); return; }
      err.textContent = res.error === 'mensagem_curta' ? 'Escreve a mensagem (mínimo 5 carateres).' : 'Não foi possível enviar. Tenta outra vez.';
      return;
    }
    document.getElementById('pfb-msg').value = ''; document.getElementById('pfb-item').value = '';
    toast('Feedback enviado. Obrigado!');
    loadProf_();
  }).catch(function(){ btn.disabled = false; err.textContent = 'Erro de ligação. Confirma em "Os meus envios" antes de repetir.'; });
});

/* ============================================================
   MOBILIÁRIO (inventário fixo — só administração), organizado por sala
   ============================================================ */
var MOB_LABELS = { bom: 'Bom', razoavel: 'Razoável', mau: 'Mau / a substituir' };
function mobSave_(m){
  bgRun_('api_adminMobUpdate', adminState.token, m.id, m.salaId, m.nome, m.quantidade, m.estado, m.notas || '');
}
function fillSalaSelect_(sel, salas, firstLabel){
  var prev = sel.value;
  sel.innerHTML = firstLabel ? '<option value="">' + firstLabel + '</option>' : '';
  salas.forEach(function(s){ var o = document.createElement('option'); o.value = s.id; o.textContent = s.nome; sel.appendChild(o); });
  if (prev && salas.some(function(s){ return s.id === prev; })) sel.value = prev;
}
function renderMobTab_(){
  if (!dashCache) return;
  var list = dashCache.mobiliario || [];
  var salas = (dashCache.salas || []).slice().sort(function(x, y){ return fold(x.nome).localeCompare(fold(y.nome)); });
  fillSalaSelect_(document.getElementById('mob-sala'), salas, '');
  var fs = document.getElementById('mob-filter-sala');
  fillSalaSelect_(fs, salas, 'Todas');
  document.getElementById('mob-add').disabled = !salas.length;
  var err = document.getElementById('mob-error');
  if (!salas.length) err.textContent = 'Ainda não há salas. Cria primeiro uma sala em "Valências & itens".'; else if (/Cria primeiro/.test(err.textContent)) err.textContent = '';

  var q = fold(document.getElementById('mob-search').value).trim();
  var fSala = fs.value, fEst = document.getElementById('mob-filter-estado').value;
  var rows = list.filter(function(m){
    if (fSala && m.salaId !== fSala) return false;
    if (fEst && m.estado !== fEst) return false;
    if (q && fold(m.nome + ' ' + m.sala + ' ' + (m.notas || '')).indexOf(q) === -1) return false;
    return true;
  }).sort(function(x, y){ return fold(x.sala).localeCompare(fold(y.sala)) || fold(x.nome).localeCompare(fold(y.nome)); });
  var units = rows.reduce(function(t, m){ return t + (Number(m.quantidade) || 0); }, 0);
  var nSalas = {}; rows.forEach(function(m){ nSalas[m.salaId] = true; });
  var maus = rows.filter(function(m){ return m.estado === 'mau'; }).length;
  var ns = Object.keys(nSalas).length;
  document.getElementById('mob-summary').textContent = rows.length + ' linha' + (rows.length === 1 ? '' : 's') + ' · ' + fmtQty(units) + ' unidades · ' + ns + ' sala' + (ns === 1 ? '' : 's') + (maus ? ' · ' + maus + ' a substituir' : '');

  var tbody = document.querySelector('#mob-table tbody'); tbody.innerHTML = '';
  if (!rows.length){
    var tr0 = document.createElement('tr'), td0 = document.createElement('td');
    td0.colSpan = 5; td0.className = 'muted'; td0.textContent = list.length ? 'Sem resultados com estes filtros.' : 'Ainda não há mobiliário registado.';
    tr0.appendChild(td0); tbody.appendChild(tr0); return;
  }
  var lastSala = null;
  rows.forEach(function(m){
    if (m.salaId !== lastSala){
      lastSala = m.salaId;
      var inSala = rows.filter(function(x){ return x.salaId === m.salaId; });
      var hr = document.createElement('tr'); hr.className = 'mob-sala-row';
      var hd = document.createElement('td'); hd.colSpan = 5;
      hd.textContent = '🏫 ' + m.sala + ' — ' + inSala.length + ' linha' + (inSala.length === 1 ? '' : 's') + ' · ' + fmtQty(inSala.reduce(function(t, x){ return t + (Number(x.quantidade) || 0); }, 0)) + ' unidades';
      hr.appendChild(hd); tbody.appendChild(hr);
    }
    var tr = document.createElement('tr');
    tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td>';
    if (m.estado === 'mau') tr.className = 'low';
    tr.children[0].textContent = m.nome;
    var qi = document.createElement('input'); qi.type = 'number'; qi.min = '1'; qi.step = '1'; qi.value = m.quantidade; qi.style.cssText = 'width:80px;margin:0';
    qi.setAttribute('aria-label', 'Quantidade de ' + m.nome);
    qi.addEventListener('change', function(){
      var n = Math.floor(Number(qi.value));
      if (!n || n < 1){ toast('Quantidade inválida.'); qi.value = m.quantidade; return; }
      m.quantidade = n; renderAllAdminTabs(); toast('Quantidade atualizada.'); mobSave_(m);
    });
    tr.children[1].appendChild(qi);
    var sel = document.createElement('select'); sel.style.cssText = 'margin:0;min-width:130px';
    Object.keys(MOB_LABELS).forEach(function(k){ var o = document.createElement('option'); o.value = k; o.textContent = MOB_LABELS[k]; sel.appendChild(o); });
    sel.value = m.estado;
    sel.addEventListener('change', function(){ m.estado = sel.value; renderAllAdminTabs(); toast('Estado atualizado.'); mobSave_(m); });
    tr.children[2].appendChild(sel);
    tr.children[3].textContent = m.notas || '—'; tr.children[3].style.cssText = 'max-width:260px;white-space:normal';
    var ac = tr.children[4]; ac.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;border-bottom:0';
    var mv = document.createElement('select'); mv.style.cssText = 'margin:0;width:auto;max-width:150px'; mv.title = 'Mudar para outra sala'; mv.setAttribute('aria-label', 'Mudar ' + m.nome + ' de sala');
    var o0 = document.createElement('option'); o0.value = ''; o0.textContent = 'Mover para…'; mv.appendChild(o0);
    salas.filter(function(s){ return s.id !== m.salaId; }).forEach(function(s){ var o = document.createElement('option'); o.value = s.id; o.textContent = s.nome; mv.appendChild(o); });
    mv.addEventListener('change', function(){
      var s = salas.filter(function(x){ return x.id === mv.value; })[0]; if (!s) return;
      m.salaId = s.id; m.sala = s.nome; renderAllAdminTabs(); toast('Movido para ' + s.nome + '.'); mobSave_(m);
    });
    var ed = document.createElement('button'); ed.type = 'button'; ed.className = 'btn secondary'; ed.textContent = '✎'; ed.title = 'Editar nome e notas'; ed.style.cssText = 'margin:0;padding:4px 9px;font-size:12px';
    ed.addEventListener('click', function(){
      var nome = prompt('Nome:', m.nome); if (nome === null) return;
      var notas = prompt('Notas (opcional):', m.notas || ''); if (notas === null) return;
      nome = nome.trim();
      if (!nome){ toast('O nome não pode ficar vazio.'); return; }
      m.nome = nome; m.notas = notas.trim();
      renderAllAdminTabs(); toast('Atualizado.'); mobSave_(m);
    });
    var del = document.createElement('button'); del.type = 'button'; del.className = 'btn danger'; del.textContent = '✕'; del.title = 'Eliminar'; del.style.cssText = 'margin:0;padding:4px 9px;font-size:12px';
    del.addEventListener('click', function(){
      if (!confirm('Eliminar "' + m.nome + '" (' + m.sala + ')?')) return;
      dashCache.mobiliario = dashCache.mobiliario.filter(function(x){ return x.id !== m.id; });
      renderAllAdminTabs(); toast('Eliminado.');
      bgRun_('api_adminMobDelete', adminState.token, [m.id]);
    });
    ac.appendChild(mv); ac.appendChild(ed); ac.appendChild(del);
    tbody.appendChild(tr);
  });
}
document.getElementById('mob-add').addEventListener('click', function(){
  var err = document.getElementById('mob-error'); err.textContent = '';
  var salaId = document.getElementById('mob-sala').value, nome = document.getElementById('mob-nome').value.trim();
  var qty = Math.floor(Number(document.getElementById('mob-qty').value));
  var est = document.getElementById('mob-estado').value, notas = document.getElementById('mob-notas').value.trim();
  var sala = (dashCache.salas || []).filter(function(s){ return s.id === salaId; })[0];
  if (!sala){ err.textContent = 'Escolhe a sala (cria-a primeiro em "Valências & itens").'; return; }
  if (!nome){ err.textContent = 'Escreve o nome do móvel.'; return; }
  if (!qty || qty < 1){ err.textContent = 'Indica uma quantidade válida.'; return; }
  var id = newClientId_();
  if (!dashCache.mobiliario) dashCache.mobiliario = [];
  dashCache.mobiliario.push({ id: id, salaId: sala.id, sala: sala.nome, nome: nome, quantidade: qty, estado: est, notas: notas, criadoEm: new Date().toISOString() });
  document.getElementById('mob-nome').value = ''; document.getElementById('mob-qty').value = '1'; document.getElementById('mob-notas').value = '';
  renderAllAdminTabs(); toast('Adicionado a ' + sala.nome + '.');
  bgRun_('api_adminMobCreate', adminState.token, sala.id, nome, qty, est, notas, id);
});
['mob-search', 'mob-filter-sala', 'mob-filter-estado'].forEach(function(id){
  document.getElementById(id).addEventListener('input', renderMobTab_);
  document.getElementById(id).addEventListener('change', renderMobTab_);
});
document.getElementById('mob-csv').addEventListener('click', function(){
  var list = (dashCache && dashCache.mobiliario) || [];
  if (!list.length){ toast('Não há nada para exportar.'); return; }
  var out = [['Sala', 'Móvel / equipamento', 'Quantidade', 'Estado', 'Notas']];
  list.slice().sort(function(x, y){ return fold(x.sala).localeCompare(fold(y.sala)) || fold(x.nome).localeCompare(fold(y.nome)); })
    .forEach(function(m){ out.push([m.sala, m.nome, m.quantidade, MOB_LABELS[m.estado] || m.estado, m.notas || '']); });
  var csv = '\uFEFF' + out.map(function(r){ return r.map(function(v){ return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(','); }).join('\r\n');
  var el = document.createElement('a');
  el.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  el.download = 'mobiliario-cte.csv';
  document.body.appendChild(el); el.click(); document.body.removeChild(el);
});

/* ============================================================
   COMPUTADORES — postos de trabalho e etiquetas QR (Fase 3)
   ============================================================ */
var PC_ESTADOS_LABEL = { ativo: 'Ativo', inativo: 'Inativo', manutencao: 'Em manutenção' };

function pcUrlComputador_(id){ return (dashCache && dashCache.appUrl ? dashCache.appUrl : '') + '?pc=' + encodeURIComponent(id); }
function pcUrlSala_(id){ return (dashCache && dashCache.appUrl ? dashCache.appUrl : '') + '?sala=' + encodeURIComponent(id); }

function pcQrSvg_(url, cellSize){
  var qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  return qr.createSvgTag(cellSize || 4, 0);
}

// Monta as etiquetas na área de impressão e chama a caixa de diálogo de impressão.
// itens: [{ nome, sub, url }]
function pcImprimirEtiquetas_(itens){
  if (!itens || !itens.length){ toast('Não há nada para imprimir.'); return; }
  var area = document.getElementById('print-area');
  area.innerHTML = '';
  itens.forEach(function(it){
    var d = document.createElement('div'); d.className = 'pc-label' + (it.grande ? ' grande' : '');
    var n = document.createElement('div'); n.className = 'nome'; n.textContent = it.nome; d.appendChild(n);
    var q = document.createElement('div'); q.className = 'qr';
    try{ q.innerHTML = pcQrSvg_(it.url, 4); }catch(e){ /* sem QR: a etiqueta sai só com o nome */ }
    d.appendChild(q);
    var s = document.createElement('div'); s.className = 'sub'; s.textContent = it.sub || ''; d.appendChild(s);
    area.appendChild(d);
  });
  window.print();
}

function pcFillSalas_(id, comTodas, salas){
  var el = document.getElementById(id);
  if (!el) return;
  var atual = el.value;
  el.innerHTML = '';
  if (comTodas){ var o0 = document.createElement('option'); o0.value = ''; o0.textContent = 'Todas'; el.appendChild(o0); }
  (salas || []).forEach(function(s){
    var o = document.createElement('option'); o.value = s.id; o.textContent = s.nome; el.appendChild(o);
  });
  if (atual && (salas || []).some(function(s){ return s.id === atual; })) el.value = atual;
}

function pcFiltrados_(){
  var q = fold(document.getElementById('pc-search').value).trim();
  var sala = document.getElementById('pc-filter-sala').value;
  var est = document.getElementById('pc-filter-estado').value;
  return ((dashCache && dashCache.computadores) || []).filter(function(c){
    if (sala && c.salaId !== sala) return false;
    if (est && c.estado !== est) return false;
    if (q && fold(c.nome + ' ' + c.sala).indexOf(q) === -1) return false;
    return true;
  });
}

function renderPcsTab(data){
  if (!data) return;

  // Aviso: QR gerados a partir do link de teste (/dev) não abrem em telemóveis.
  var base = String(data.appUrl || '');
  var aviso = document.getElementById('pc-aviso');
  if (/\/dev(\?|$)/.test(base)){
    aviso.className = 'notice late';
    aviso.innerHTML = '⚠️ <b>Os QR estão a apontar para o link de teste (<code>/dev</code>)</b>, que só abre na tua conta Google. Abre o painel pelo link publicado (termina em <code>/exec</code>) e volta a gerar/imprimir — ou preenche <b>appUrlBase</b> na folha <b>Config</b> com o link publicado.';
  } else if (!base){
    aviso.className = 'notice late';
    aviso.textContent = '⚠️ Não foi possível determinar o link da aplicação. Os QR podem não abrir noutros dispositivos.';
  } else {
    aviso.className = 'notice hidden';
    aviso.textContent = '';
  }
  var lb = document.getElementById('pc-link-base');
  if (lb) lb.textContent = base ? ('Link que vai dentro dos QR: ' + base) : '';

  pcFillSalas_('pc-sala', false, data.salas);
  pcFillSalas_('pc-filter-sala', true, data.salas);
  pcFillSalas_('pc-mesa-sala', false, data.salas);

  var lista = pcFiltrados_();
  var tbody = document.querySelector('#pc-table tbody');
  tbody.innerHTML = '';

  lista.forEach(function(c){
    var tr = document.createElement('tr');
    tr.innerHTML = '<td></td><td></td><td></td><td></td>';
    tr.children[0].textContent = c.nome;
    tr.children[1].textContent = c.sala || '—';

    var sel = document.createElement('select');
    sel.style.cssText = 'margin:0;width:auto;min-width:130px';
    Object.keys(PC_ESTADOS_LABEL).forEach(function(k){
      var o = document.createElement('option'); o.value = k; o.textContent = PC_ESTADOS_LABEL[k]; sel.appendChild(o);
    });
    sel.value = c.estado;
    sel.addEventListener('change', function(){
      c.estado = sel.value;
      renderAllAdminTabs();
      bgRun_('api_adminSetComputadorEstado', adminState.token, c.id, sel.value);
    });
    tr.children[2].appendChild(sel);

    var ac = tr.children[3];
    ac.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;border-bottom:0';

    var qrBtn = document.createElement('button');
    qrBtn.type = 'button'; qrBtn.className = 'btn secondary'; qrBtn.textContent = '▦';
    qrBtn.title = 'Ver / imprimir o QR deste computador';
    qrBtn.style.cssText = 'margin:0;padding:4px 9px;font-size:12px';
    qrBtn.addEventListener('click', function(){
      var existe = tr.nextElementSibling;
      if (existe && existe.classList.contains('pc-qrow')){ existe.parentNode.removeChild(existe); return; }
      var linha = document.createElement('tr'); linha.className = 'pc-qrow';
      var cel = document.createElement('td'); cel.colSpan = 4;
      var url = pcUrlComputador_(c.id);
      var box = document.createElement('div'); box.className = 'qr-box open';
      try{ box.insertAdjacentHTML('afterbegin', pcQrSvg_(url, 5)); }catch(e){ box.textContent = 'Não foi possível gerar o QR.'; }
      var link = document.createElement('div'); link.className = 'link'; link.textContent = url; box.appendChild(link);
      var pr = document.createElement('button'); pr.type = 'button'; pr.className = 'btn'; pr.textContent = '🖨 Imprimir esta etiqueta';
      pr.addEventListener('click', function(){ pcImprimirEtiquetas_([{ nome: c.nome, sub: c.sala, url: url }]); });
      box.appendChild(pr);
      cel.appendChild(box); linha.appendChild(cel);
      tr.parentNode.insertBefore(linha, tr.nextSibling);
    });
    ac.appendChild(qrBtn);

    var del = document.createElement('button');
    del.type = 'button'; del.className = 'btn danger'; del.textContent = '✕'; del.title = 'Eliminar';
    del.style.cssText = 'margin:0;padding:4px 9px;font-size:12px';
    del.addEventListener('click', function(){
      if (!confirm('Eliminar "' + c.nome + '"? O histórico de utilizações mantém-se.')) return;
      dashCache.computadores = dashCache.computadores.filter(function(x){ return x.id !== c.id; });
      renderAllAdminTabs();
      bgRun_('api_adminDeleteComputador', adminState.token, c.id);
    });
    ac.appendChild(del);

    tbody.appendChild(tr);
  });

  var total = (data.computadores || []).length;
  document.getElementById('pc-summary').textContent = lista.length + ' de ' + total + ' computador(es)' +
    (total === 0 ? ' — cria os postos no cartão acima.' : '.');

  pcHistInit_();
}

/* ---- histórico de utilização e aberturas ---- */
var pcHist = { de: '', ate: '', sessoes: [], aberturas: [], carregado: false, aCarregar: false };
var PC_MOTIVO_FIM = {
  horario: 'Fim do período', mudou_computador: 'Mudou de computador',
  outro_aluno: 'Outro aluno', manual: 'Terminada pelo aluno', fecho_sala: 'Fecho da sala'
};

function pcDataISO_(d){
  var p = function(n){ return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function pcHistInit_(){
  var de = document.getElementById('pch-de'), ate = document.getElementById('pch-ate');
  if (!de || !ate) return;
  if (!de.value){
    // setDate (em vez de subtrair milissegundos) para não errar um dia nas mudanças de hora.
    var hoje = new Date();
    var inicio = new Date();
    inicio.setDate(inicio.getDate() - 6);
    de.value = pcDataISO_(inicio);
    ate.value = pcDataISO_(hoje);
  }
  if (!pcHist.carregado && !pcHist.aCarregar) pcHistCarregar_();
}

function pcHistCarregar_(){
  var de = document.getElementById('pch-de').value, ate = document.getElementById('pch-ate').value;
  if (!de || !ate) return;
  if (ate < de){ toast('A data final é anterior à inicial.'); return; }
  pcHist.aCarregar = true;
  document.getElementById('pch-resumo').textContent = 'A carregar…';
  gsRunQ('api_adminPcHistorico', adminState.token, de, ate).then(function(res){
    pcHist.aCarregar = false;
    if (!res || !res.ok){ document.getElementById('pch-resumo').textContent = 'Não foi possível carregar o histórico.'; return; }
    pcHist.de = res.de; pcHist.ate = res.ate;
    pcHist.sessoes = res.sessoes || [];
    pcHist.aberturas = res.aberturas || [];
    pcHist.carregado = true;
    pcHistPreencherFiltros_();
    pcHistRender_();
  }).catch(function(){
    pcHist.aCarregar = false;
    document.getElementById('pch-resumo').textContent = 'Erro de ligação.';
  });
}

function pcHistPreencherFiltros_(){
  [['pch-sala', 'sala', 'Todas'], ['pch-pc', 'computador', 'Todos']].forEach(function(cfg){
    var el = document.getElementById(cfg[0]);
    if (!el) return;
    var atual = el.value;
    var vals = {};
    pcHist.sessoes.forEach(function(s){ if (s[cfg[1]]) vals[s[cfg[1]]] = true; });
    el.innerHTML = '<option value="">' + cfg[2] + '</option>';
    Object.keys(vals).sort().forEach(function(v){
      var o = document.createElement('option'); o.value = v; o.textContent = v; el.appendChild(o);
    });
    el.value = atual;
  });
}

function pcHistFiltradas_(){
  var q = fold(document.getElementById('pch-q').value).trim();
  var sala = document.getElementById('pch-sala').value;
  var pc = document.getElementById('pch-pc').value;
  var est = document.getElementById('pch-estado').value;
  return pcHist.sessoes.filter(function(s){
    if (sala && s.sala !== sala) return false;
    if (pc && s.computador !== pc) return false;
    if (est && s.estado !== est) return false;
    if (q && fold(s.aluno + ' ' + s.computador + ' ' + s.sala).indexOf(q) === -1) return false;
    return true;
  });
}

function pcHoraCurta_(iso){
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  var p = function(n){ return (n < 10 ? '0' : '') + n; };
  return p(d.getDate()) + '/' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function pcHistRender_(){
  var tb = document.querySelector('#pch-table tbody');
  var lista = pcHistFiltradas_();
  tb.innerHTML = '';
  lista.forEach(function(s){
    var tr = document.createElement('tr');
    tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td><td></td><td></td>';
    tr.children[0].textContent = pcHoraCurta_(s.inicio).split(' ')[0];
    tr.children[1].textContent = pcHoraCurta_(s.inicio).split(' ')[1] || '';
    tr.children[2].textContent = s.fim ? pcHoraCurta_(s.fim).split(' ')[1] : (s.estado === 'ativa' ? 'em curso' : '—');
    tr.children[3].textContent = s.aluno;
    tr.children[4].textContent = s.computador;
    tr.children[5].textContent = s.sala;
    tr.children[6].textContent = s.estado === 'ativa' ? '—' : (PC_MOTIVO_FIM[s.motivoFim] || s.motivoFim || '—');
    if (s.estado === 'ativa') tr.className = 'new-user';
    tb.appendChild(tr);
  });
  var ativas = lista.filter(function(s){ return s.estado === 'ativa'; }).length;
  document.getElementById('pch-resumo').textContent =
    lista.length + ' sessão(ões) entre ' + pcHist.de + ' e ' + pcHist.ate +
    (ativas ? ' · ' + ativas + ' em curso' : '') +
    (pcHist.sessoes.length >= 3000 ? ' · limite de 3000 registos atingido' : '') + '.';

  var tab = document.querySelector('#pab-table tbody');
  tab.innerHTML = '';
  pcHist.aberturas.forEach(function(a){
    var tr = document.createElement('tr');
    tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td><td></td><td></td>';
    tr.children[0].textContent = pcHoraCurta_(a.inicio).split(' ')[0];
    tr.children[1].textContent = a.sala;
    tr.children[2].textContent = a.motivo || '—';
    tr.children[3].textContent = a.abriu || '—';
    tr.children[4].textContent = pcHoraCurta_(a.inicio).split(' ')[1] || '';
    tr.children[5].textContent = a.fimPrevisto ? pcHoraCurta_(a.fimPrevisto).split(' ')[1] : '—';
    tr.children[6].textContent = a.fimEfetivo ? pcHoraCurta_(a.fimEfetivo).split(' ')[1] : (a.estado === 'aberta' ? 'em aberto' : '—');
    tab.appendChild(tr);
  });
  document.getElementById('pab-resumo').textContent = pcHist.aberturas.length + ' abertura(s) no mesmo período.';
}

function pcHistCsv_(){
  var lista = pcHistFiltradas_();
  if (!lista.length){ toast('Não há registos para exportar.'); return; }
  var linhas = [['Data', 'Início', 'Fim', 'Aluno', 'Perfil', 'Computador', 'Sala', 'Estado', 'Terminou por']];
  lista.forEach(function(s){
    linhas.push([
      pcHoraCurta_(s.inicio).split(' ')[0],
      pcHoraCurta_(s.inicio).split(' ')[1] || '',
      s.fim ? pcHoraCurta_(s.fim).split(' ')[1] : '',
      s.aluno, s.alunoRole, s.computador, s.sala,
      s.estado === 'ativa' ? 'em curso' : 'terminada',
      s.estado === 'ativa' ? '' : (PC_MOTIVO_FIM[s.motivoFim] || s.motivoFim || '')
    ]);
  });
  var csv = '\uFEFF' + linhas.map(function(r){
    return r.map(function(v){ return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(',');
  }).join('\r\n');
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'utilizacao-computadores-' + pcHist.de + '_' + pcHist.ate + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

['pch-de', 'pch-ate'].forEach(function(id){
  document.getElementById(id).addEventListener('change', function(){ pcHist.carregado = false; pcHistCarregar_(); });
});
['pch-q', 'pch-sala', 'pch-pc', 'pch-estado'].forEach(function(id){
  document.getElementById(id).addEventListener('input', function(){ if (pcHist.carregado) pcHistRender_(); });
  document.getElementById(id).addEventListener('change', function(){ if (pcHist.carregado) pcHistRender_(); });
});
document.getElementById('pch-csv').addEventListener('click', pcHistCsv_);

document.getElementById('pc-criar').addEventListener('click', function(){
  var btn = this;
  var err = document.getElementById('pc-error');
  var res = document.getElementById('pc-resultado');
  err.textContent = ''; res.textContent = '';
  var salaId = document.getElementById('pc-sala').value;
  var prefixo = document.getElementById('pc-prefixo').value;
  var digitos = document.getElementById('pc-digitos').value;
  var de = document.getElementById('pc-de').value;
  var ate = document.getElementById('pc-ate').value;
  if (!salaId){ err.textContent = 'Escolhe a sala.'; return; }
  btn.disabled = true;
  gsRun('api_adminCreateComputadores', adminState.token, salaId, prefixo, de, ate, digitos).then(function(r){
    btn.disabled = false;
    if (!r.ok){
      err.textContent = r.error === 'intervalo_invalido' ? 'Intervalo inválido: inteiros, “De” ≤ “Até” e no máximo 200 de cada vez.' :
        r.error === 'sala_invalida' ? 'Sala inválida.' : 'Não foi possível criar os computadores.';
      return;
    }
    res.textContent = r.criados + ' computador(es) criado(s)' +
      (r.ignorados && r.ignorados.length ? ' · já existiam: ' + r.ignorados.join(', ') : '') + '.';
    toast(r.criados + ' computador(es) criado(s).');
    refreshDashboard(true);
  }).catch(function(){ btn.disabled = false; err.textContent = 'Erro de ligação.'; });
});

['pc-search', 'pc-filter-sala', 'pc-filter-estado'].forEach(function(id){
  document.getElementById(id).addEventListener('input', function(){ renderPcsTab(dashCache); });
  document.getElementById(id).addEventListener('change', function(){ renderPcsTab(dashCache); });
});

document.getElementById('pc-imprimir-lista').addEventListener('click', function(){
  var lista = pcFiltrados_();
  if (!lista.length){ toast('Não há computadores para imprimir com estes filtros.'); return; }
  pcImprimirEtiquetas_(lista.map(function(c){ return { nome: c.nome, sub: c.sala, url: pcUrlComputador_(c.id) }; }));
});

document.getElementById('pc-mesa-gerar').addEventListener('click', function(){
  var err = document.getElementById('pc-mesa-error'); err.textContent = '';
  var salaId = document.getElementById('pc-mesa-sala').value;
  var sala = ((dashCache && dashCache.salas) || []).filter(function(s){ return s.id === salaId; })[0];
  if (!sala){ err.textContent = 'Escolhe a sala (cria-a primeiro em “Valências & itens”).'; return; }
  var url = pcUrlSala_(sala.id);
  var box = document.getElementById('pc-mesa-box');
  box.classList.add('open');
  box.innerHTML = '';
  try{ box.insertAdjacentHTML('afterbegin', pcQrSvg_(url, 6)); }catch(e){ box.textContent = 'Não foi possível gerar o QR.'; }
  var link = document.createElement('div'); link.className = 'link'; link.textContent = url; box.appendChild(link);
  var hint = document.createElement('p');
  hint.style.cssText = 'color:#1b2430;font-size:11px;margin-top:6px';
  hint.textContent = 'Imprime e cola na mesa do professor da ' + sala.nome + '.';
  box.appendChild(hint);
  var pr = document.createElement('button'); pr.type = 'button'; pr.className = 'btn'; pr.textContent = '🖨 Imprimir etiqueta';
  pr.addEventListener('click', function(){ pcImprimirEtiquetas_([{ nome: 'Mesa do professor', sub: sala.nome, url: url, grande: true }]); });
  box.appendChild(pr);
});

/* ============================================================
   ECRÃ DO POSTO DE TRABALHO (?pc=…)
   ============================================================ */
var pcState = { id: window.__PC_ID__ || '', info: null, pin: '', busy: false, sessao: null };

function pcHora_(iso){
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  var p = function(n){ return (n < 10 ? '0' : '') + n; };
  return p(d.getHours()) + ':' + p(d.getMinutes());
}

function pcPintarDots_(){
  var i = document.getElementById('pc-pin-input');
  if (i) i.value = pcState.pin;
}

function pcBloquearTeclado_(b){
  pcState.busy = b;
  var i = document.getElementById('pc-pin-input'), bt = document.getElementById('pc-pin-submit');
  if (i) i.disabled = b;
  if (bt) bt.disabled = b;
  if (!b && i){ try{ i.focus(); }catch(e){} }
  var h = document.getElementById('pc-pin-hint');
  if (h) h.textContent = b ? 'A verificar…' : 'Introduz o teu PIN para começar.';
}

function pcBuildTeclado_(){
  var i = document.getElementById('pc-pin-input');
  if (!i || i.dataset.pronto) return;
  i.addEventListener('input', function(){
    var v = i.value.replace(/\D/g, '').slice(0, 8);
    if (v !== i.value) i.value = v;
    pcState.pin = v;
  });
  i.addEventListener('keydown', function(e){ if (e.key === 'Enter'){ e.preventDefault(); pcSubmeter_(); } });
  document.getElementById('pc-pin-submit').addEventListener('click', pcSubmeter_);
  i.dataset.pronto = '1';
}

function pcEstadoTexto_(info){
  var partes = [];
  if (info.periodo){
    var et = (info.periodo.etiquetas || []).join(' · ');
    partes.push('Aula em curso até ' + info.periodo.fim + (et ? ' (' + et + ')' : ''));
  } else if (info.aberta){
    partes.push('Sala aberta até ' + pcHora_(info.fimPrevisto));
  } else {
    partes.push('Sala fechada — pede a um professor ou ao coordenador do CTE para abrir.');
  }
  if (info.ocupadoPor) partes.push('Em uso por ' + info.ocupadoPor + '.');
  return partes.join(' ');
}

function pcBoot_(){
  show('scr-pc');
  document.getElementById('pc-nome').textContent = 'A carregar…';
  document.getElementById('pc-sala-nome').textContent = '';
  document.getElementById('pc-pin-bloco').classList.add('hidden'); // só aparece depois de ler o posto
  document.getElementById('pc-ok').classList.add('hidden');
  var est0 = document.getElementById('pc-estado'); est0.className = 'notice'; est0.textContent = 'A ler o estado da sala…';
  gsRunQ('api_pcInfo', pcState.id).then(function(info){
    if (!info || !info.ok){
      document.getElementById('pc-nome').textContent = 'Computador';
      var est = document.getElementById('pc-estado');
      est.className = 'notice late';
      est.textContent = (info && info.error === 'computador_nao_encontrado') ? 'Este QR não corresponde a nenhum computador conhecido.'
        : (info && info.error === 'modulo_inativo') ? 'O registo de utilização está desligado.'
        : 'Não foi possível ler este posto. Tenta outra vez.';
      document.getElementById('pc-pin-bloco').classList.add('hidden');
      document.getElementById('pc-ok').classList.add('hidden');
      return;
    }
    pcState.info = info;
    document.getElementById('pc-nome').textContent = info.computador.nome;
    document.getElementById('pc-sala-nome').textContent = info.computador.sala || '';
    var est2 = document.getElementById('pc-estado');
    est2.textContent = pcEstadoTexto_(info);
    est2.className = 'notice' + ((!info.periodo && !info.aberta) ? ' late' : '');
    document.getElementById('pc-ok').classList.add('hidden');
    document.getElementById('pc-pin-bloco').classList.remove('hidden');
    document.getElementById('pc-erro').textContent = '';
    pcState.pin = '';
    pcPintarDots_();
    pcBuildTeclado_();
    pcBloquearTeclado_(false);
  }).catch(function(){
    document.getElementById('pc-nome').textContent = 'Computador';
    var est3 = document.getElementById('pc-estado');
    est3.className = 'notice late';
    est3.textContent = 'Erro de ligação. Tenta outra vez.';
  });
}

function pcSubmeter_(){
  if (pcState.busy) return;
  var pi = document.getElementById('pc-pin-input'); if (pi) pcState.pin = pi.value.replace(/\D/g, '');
  var erro = document.getElementById('pc-erro');
  erro.textContent = '';
  if (pcState.pin.length < 4){ erro.textContent = 'PIN demasiado curto.'; return; }
  var info = pcState.info || {};
  if (info.ocupadoPor && !confirm('Este computador está a ser usado por ' + info.ocupadoPor + '.\n\nContinuar? A sessão dessa pessoa termina.')) return;
  pcBloquearTeclado_(true);
  gsRun('api_pcAbrirSessao', pcState.id, pcState.pin).then(function(res){
    pcBloquearTeclado_(false);
    if (!res.ok){
      pcState.pin = ''; pcPintarDots_();
      if (res.locked){ erro.textContent = 'Demasiadas tentativas. Tenta daqui a ' + (res.lockSeconds || 60) + 's.'; return; }
      if (res.attemptsLeft){ erro.textContent = 'PIN não reconhecido. Restam ' + res.attemptsLeft + ' tentativa' + (res.attemptsLeft === 1 ? '' : 's') + '.'; return; }
      var m = {
        sem_periodo: 'Esta sala está fechada. Pede a um professor ou ao coordenador do CTE para abrir a sala.',
        sem_janela: 'O período autorizado já terminou.',
        computador_indisponivel: 'Este computador está fora de serviço.',
        perfil_sem_sessao: 'Só os alunos registam a utilização do computador.',
        ocupado: 'O sistema está ocupado. Tenta outra vez.',
        modulo_inativo: 'O registo de utilização está desligado.'
      };
      erro.textContent = m[res.error] || 'Não foi possível iniciar a sessão.';
      return;
    }
    pcState.sessao = res.sessao;
    document.getElementById('pc-pin-bloco').classList.add('hidden');
    document.getElementById('pc-ok').classList.remove('hidden');
    document.getElementById('pc-ok-msg').textContent = res.renovada ? 'Sessão renovada.' : 'Sessão iniciada.';
    var sub = 'Termina automaticamente às ' + pcHora_(res.sessao.fimPrevisto) + '.';
    if (res.encerradas && res.encerradas.length) sub += ' A tua sessão anterior noutro computador foi fechada.';
    document.getElementById('pc-ok-sub').textContent = sub;
    playConfirmSound();
  }).catch(function(){
    pcBloquearTeclado_(false);
    erro.textContent = 'Erro de ligação. Tenta outra vez.';
  });
}

function pcTerminar_(){
  var btn = document.getElementById('pc-terminar');
  if (!pcState.pin){ pcBoot_(); return; }
  btn.disabled = true;
  gsRun('api_pcFecharSessao', pcState.id, pcState.pin).then(function(){
    btn.disabled = false;
    pcState.pin = '';
    pcBoot_();
  }).catch(function(){ btn.disabled = false; });
}

document.getElementById('pc-terminar').addEventListener('click', pcTerminar_);

/* ============================================================
   ECRÃ DA MESA DO PROFESSOR (?sala=…)
   ============================================================ */
var salaState = { id: window.__SALA_ID__ || '', info: null, pin: '', token: '', busy: false, login: null };

function salaPintarDots_(){
  var i = document.getElementById('sala-pin-input');
  if (i) i.value = salaState.pin;
}

function salaBuildTeclado_(){
  var i = document.getElementById('sala-pin-input');
  if (!i || i.dataset.pronto) return;
  i.addEventListener('input', function(){
    var v = i.value.replace(/\D/g, '').slice(0, 8);
    if (v !== i.value) i.value = v;
    salaState.pin = v;
  });
  i.addEventListener('keydown', function(e){ if (e.key === 'Enter'){ e.preventDefault(); salaSubmeter_(); } });
  document.getElementById('sala-pin-submit').addEventListener('click', salaSubmeter_);
  i.dataset.pronto = '1';
}

var SALA_MOTIVOS_TXT = {
  aula_em_curso: 'Há uma aula a decorrer nesta sala — não é preciso abrir.',
  fora_do_horario: 'Fora do horário permitido para o teu perfil.',
  fora_do_clube: 'Os coordenadores júnior só abrem a sala durante clubes/oficinas.',
  fim_de_semana: 'Ao fim de semana só a coordenação do CTE abre a sala.',
  sem_janela: 'Já não há tempo útil para abrir a sala.',
  sem_permissao: 'O teu perfil não pode abrir salas.',
  modulo_inativo: 'O módulo está desligado.'
};

function salaEstadoTexto_(info){
  var p = [];
  if (info.aberta){
    p.push('Aberta por ' + (info.abertura.por || '—') + (info.abertura.motivo ? ' (' + info.abertura.motivo + ')' : '') +
      ' até ' + pcHora_(info.abertura.fimPrevisto) + '.');
  } else if (info.periodo){
    var et = (info.periodo.etiquetas || []).join(' · ');
    p.push('Aula em curso até ' + info.periodo.fim + (et ? ' (' + et + ')' : '') + '.');
  } else {
    p.push('Sala fechada.');
  }
  if (info.sessoes && info.sessoes.length){
    p.push(info.sessoes.length + (info.sessoes.length === 1 ? ' sessão ativa: ' : ' sessões ativas: ') +
      info.sessoes.map(function(s){ return s.computador + ' (' + s.aluno + ')'; }).join(', ') + '.');
  }
  return p.join(' ');
}

function salaBoot_(){
  show('scr-sala');
  document.getElementById('sala-nome').textContent = 'A carregar…';
  salaState.pin = '';
  salaState.token = '';
  document.getElementById('sala-form').classList.add('hidden');
  document.getElementById('sala-ok').classList.add('hidden');
  document.getElementById('sala-pin-bloco').classList.add('hidden'); // só aparece depois de ler a sala
  document.getElementById('sala-erro').textContent = '';
  var est0 = document.getElementById('sala-estado'); est0.className = 'notice'; est0.textContent = 'A ler o estado da sala…';
  gsRunQ('api_salaInfo', salaState.id).then(function(info){
    if (!info || !info.ok){
      document.getElementById('sala-nome').textContent = 'Sala';
      document.getElementById('sala-estado').textContent = (info && info.error === 'sala_invalida') ? 'Este QR não corresponde a nenhuma sala.' : 'Não foi possível ler a sala.';
      document.getElementById('sala-estado').className = 'notice late';
      document.getElementById('sala-pin-bloco').classList.add('hidden');
      return;
    }
    salaState.info = info;
    document.getElementById('sala-nome').textContent = info.sala.nome;
    var est = document.getElementById('sala-estado');
    est.textContent = salaEstadoTexto_(info);
    est.className = 'notice' + (info.aberta ? '' : ' late');
    document.getElementById('sala-pin-bloco').classList.remove('hidden');
    salaPintarDots_();
    salaBuildTeclado_();
    salaState.busy = false;
  }).catch(function(){
    document.getElementById('sala-nome').textContent = 'Sala';
    document.getElementById('sala-estado').textContent = 'Erro de ligação.';
    document.getElementById('sala-estado').className = 'notice late';
  });
}

function salaSubmeter_(){
  if (salaState.busy) return;
  var si = document.getElementById('sala-pin-input'); if (si) salaState.pin = si.value.replace(/\D/g, '');
  var erro = document.getElementById('sala-erro');
  erro.textContent = '';
  if (salaState.pin.length < 4){ erro.textContent = 'PIN demasiado curto.'; return; }
  salaState.busy = true;
  gsRun('api_salaLogin', salaState.id, salaState.pin).then(function(res){
    salaState.busy = false;
    if (!res.ok){
      salaState.pin = ''; salaPintarDots_();
      if (res.locked){ erro.textContent = 'Demasiadas tentativas. Tenta daqui a ' + (res.lockSeconds || 60) + 's.'; return; }
      if (res.attemptsLeft){ erro.textContent = 'PIN não reconhecido. Restam ' + res.attemptsLeft + ' tentativa' + (res.attemptsLeft === 1 ? '' : 's') + '.'; return; }
      erro.textContent = 'Não foi possível entrar.';
      return;
    }
    salaState.token = res.token;
    salaState.login = res;
    var info = salaState.info || {};
    var pode = res.podeAbrir;
    var aberta = !!(info.aberta);
    if (!pode && !aberta){
      erro.textContent = SALA_MOTIVOS_TXT[res.motivo] || 'Não podes abrir a sala agora.';
      salaState.pin = ''; salaPintarDots_();
      return;
    }
    document.getElementById('sala-pin-bloco').classList.add('hidden');
    document.getElementById('sala-form').classList.remove('hidden');
    document.getElementById('sala-form-erro').textContent = '';

    // lista de motivos
    var sel = document.getElementById('sala-motivo');
    sel.innerHTML = '';
    (info.motivos || []).forEach(function(m){ var o = document.createElement('option'); o.value = m; o.textContent = m; sel.appendChild(o); });

    // horas de fecho: de 15 em 15 min, do próximo quarto de hora até ao limite
    var selH = document.getElementById('sala-fecho');
    selH.innerHTML = '';
    var agora = pcMinutos_(res.agoraLocal);
    var max = pcMinutos_(res.fimMaximo);
    var marcado = false;
    function addHora(min){
      var o = document.createElement('option');
      o.value = pcHHMM_(min); o.textContent = pcHHMM_(min);
      if (!marcado && min >= agora + 60){ o.selected = true; marcado = true; }
      selH.appendChild(o);
    }
    for (var t = Math.ceil((agora + 1) / 15) * 15; t <= max; t += 15) addHora(t);
    // O limite pode não cair num quarto de hora (ex.: 23:59) — acrescenta-o.
    if (!selH.options.length || pcMinutos_(selH.options[selH.options.length - 1].value) < max) addHora(max);
    if (!marcado) selH.options[selH.options.length - 1].selected = true;

    document.getElementById('sala-abrir').classList.toggle('hidden', !pode);
    document.getElementById('sala-fechar').classList.toggle('hidden', !aberta);
    document.getElementById('sala-form-info').textContent = aberta
      ? 'A sala já está aberta. Podes fechá-la agora ou substituir a abertura.'
      : 'Podes abrir até às ' + res.fimMaximo + '.';
  }).catch(function(){
    salaState.busy = false;
    erro.textContent = 'Erro de ligação. Tenta outra vez.';
  });
}

function pcMinutos_(h){ var m = /^(\d{1,2}):(\d{2})$/.exec(String(h || '')); return m ? (Number(m[1]) * 60 + Number(m[2])) : 0; }
function pcHHMM_(min){ var p = function(n){ return (n < 10 ? '0' : '') + n; }; return p(Math.floor(min / 60)) + ':' + p(min % 60); }

function salaAbrir_(){
  var btn = document.getElementById('sala-abrir');
  var erro = document.getElementById('sala-form-erro');
  erro.textContent = '';
  btn.disabled = true;
  var motivo = document.getElementById('sala-motivo').value;
  var fecho = document.getElementById('sala-fecho').value;
  gsRun('api_salaAbrir', salaState.token, motivo, fecho).then(function(res){
    btn.disabled = false;
    if (!res.ok){
      var m = {
        motivo_em_falta: 'Escolhe o motivo.',
        motivo_invalido: 'Motivo inválido.',
        fecho_no_passado: 'A hora de fecho já passou.',
        fecho_demasiado_tarde: 'A hora de fecho é depois do limite' + (res.fimMaximo ? ' (' + res.fimMaximo + ')' : '') + '.',
        aula_em_curso: 'Há uma aula a decorrer — a sala já está em utilização.',
        fora_do_horario: 'Fora do horário permitido.',
        fora_do_clube: 'Só durante clubes/oficinas.',
        sem_permissao: 'O teu perfil não pode abrir salas.',
        sessao_invalida: 'Sessão expirada. Introduz o PIN outra vez.',
        ocupado: 'O sistema está ocupado. Tenta outra vez.'
      };
      erro.textContent = m[res.error] || 'Não foi possível abrir a sala.';
      if (res.error === 'sessao_invalida') salaBoot_();
      return;
    }
    document.getElementById('sala-form').classList.add('hidden');
    document.getElementById('sala-ok').classList.remove('hidden');
    document.getElementById('sala-ok-msg').textContent = 'Sala aberta.';
    document.getElementById('sala-ok-sub').textContent = res.abertura.motivo + ' · fecha às ' + pcHora_(res.abertura.fimPrevisto) + '. Podes fechar antes, voltando a ler este QR.';
    playConfirmSound();
  }).catch(function(){ btn.disabled = false; erro.textContent = 'Erro de ligação. Tenta outra vez.'; });
}

function salaFechar_(){
  var btn = document.getElementById('sala-fechar');
  var erro = document.getElementById('sala-form-erro');
  erro.textContent = '';
  if (!confirm('Fechar a sala agora? As sessões ativas terminam.')) return;
  btn.disabled = true;
  gsRun('api_salaFechar', salaState.token).then(function(res){
    btn.disabled = false;
    if (!res.ok){
      erro.textContent = res.error === 'sem_permissao_fechar' ? 'Só quem abriu a sala (ou a coordenação) a pode fechar.'
        : res.error === 'sem_abertura' ? 'A sala já não está aberta.' : 'Não foi possível fechar.';
      return;
    }
    document.getElementById('sala-form').classList.add('hidden');
    document.getElementById('sala-ok').classList.remove('hidden');
    document.getElementById('sala-ok-msg').textContent = 'Sala fechada.';
    document.getElementById('sala-ok-sub').textContent = res.sessoesFechadas
      ? res.sessoesFechadas + ' sessão(ões) terminada(s).'
      : 'Não havia sessões ativas.';
  }).catch(function(){ btn.disabled = false; erro.textContent = 'Erro de ligação. Tenta outra vez.'; });
}

document.getElementById('sala-abrir').addEventListener('click', salaAbrir_);
document.getElementById('sala-fechar').addEventListener('click', salaFechar_);
document.getElementById('sala-voltar').addEventListener('click', salaBoot_);

/* ============================================================
   ARRANQUE — só agora, com tudo já definido acima
   ============================================================ */
var ICON_SUN = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
var ICON_MOON = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 13a9 9 0 11-10-10 7 7 0 0010 10z"/></svg>';
function currentTheme(){ return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }
function applyTheme(t){
  document.documentElement.setAttribute('data-theme', t);
  try{ localStorage.setItem('cte-theme', t); } catch(e){ /* sem armazenamento: vale só nesta sessão */ }
  var b = document.getElementById('theme-toggle');
  if (b){
    b.innerHTML = (t === 'dark' ? ICON_MOON : ICON_SUN) + '<span class="lbl">Tema ' + (t === 'dark' ? 'escuro' : 'claro') + '</span><span class="sw"></span>';
    b.title = t === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro';
    b.setAttribute('aria-label', b.title);
  }
}
applyTheme(currentTheme());
document.getElementById('theme-toggle').addEventListener('click', function(){
  applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
});

if (window.__IS_ADMIN__){
  document.getElementById('kiosk-root').classList.add('hidden');
  document.getElementById('admin-root').classList.remove('hidden');
  bootAdmin();
} else if (window.__IS_PROF__){
  bootProf_();
} else if (window.__PC_ID__){
  pcBoot_();
} else if (window.__SALA_ID__){
  salaBoot_();
} else {
  bootKiosk();
}

})();
