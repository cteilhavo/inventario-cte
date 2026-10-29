// ============================================================
//  Este ficheiro é a PONTE PARA O SERVIDOR.
//
//  window.API_URL  =  endereço do Google Apps Script (termina em /exec)
//
//  ⚠️  NÃO metas aqui o endereço do site (…github.io/…). Esse
//      endereço vai na folha de cálculo, em Config → appUrlBase,
//      e serve para os QR Codes apontarem para este site.
// ============================================================
window.API_URL = "https://script.google.com/macros/s/AKfycbxALPyrWLqj_c_Rtj9oE40OGs0e8IppPYC6FV-uhc5fqeysPm-d_rO4giAU_3Lp9tTv/exec";

// ---- verificação de segurança (não é preciso mexer) ----
(function () {
  var u = String(window.API_URL || '').trim();
  var erros = [];
  if (!/^https:\/\//.test(u)) erros.push('o valor tem de começar por https://');
  else if (u.indexOf('github.io') !== -1) erros.push('isto é o endereço do site, não o do servidor');
  else if (!/\/exec$/.test(u)) erros.push('tem de terminar em /exec (sem barra no fim)');
  else if (u.indexOf('script.google.com/macros/s/') === -1) erros.push('não parece um endereço do Google Apps Script');
  if (!erros.length) return;

  document.addEventListener('DOMContentLoaded', function () {
    var av = document.createElement('div');
    av.id = 'aviso-config';
    av.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#F4F4F1;color:#1D2433;' +
      'font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;padding:28px;overflow:auto';
    av.innerHTML = '<h2 style="margin:0 0 10px;font-size:20px">config.js está mal preenchido</h2>' +
      '<p style="margin:0 0 12px"><b>API_URL</b> = <code style="word-break:break-all">' + u.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</code></p>' +
      '<p style="margin:0 0 12px">Problema: <b>' + erros.join(' · ') + '</b>.</p>' +
      '<p style="margin:0 0 12px">Aqui vai o endereço do <b>Google Apps Script</b> (termina em <code>/exec</code>). ' +
      'O endereço do site (<code>…github.io/…</code>) vai na folha de cálculo, em <b>Config → appUrlBase</b>.</p>';
    document.body.appendChild(av);
  });
})();
