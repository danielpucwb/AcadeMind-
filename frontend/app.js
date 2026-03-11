/**
 * app.js — SPA AcadeMind
 *
 * Roteamento simples via hash (#home, #disciplina/:id, #logs).
 * Sem dependências externas — vanilla JS puro.
 *
 * Módulos:
 *   API      — wrapper para chamadas à API REST
 *   Toast    — notificações de feedback
 *   Modal    — diálogo genérico
 *   App      — roteador e controlador de views
 *   Views    — funções que renderizam cada "página"
 */

'use strict';

/* ============================================================
   API — wrapper fetch
   ============================================================ */
const API = (() => {
  const BASE = '/api/v1';

  async function req(method, path, body, isForm = false) {
    const opts = { method, headers: {} };
    if (body && !isForm) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    } else if (body instanceof FormData) {
      opts.body = body; // fetch define Content-Type multipart automaticamente
    }
    const res = await fetch(BASE + path, opts);
    if (!res.ok) {
      let msg = `Erro ${res.status}`;
      try { const j = await res.json(); msg = j.detail || j.erro || msg; } catch (_) {}
      throw new Error(msg);
    }
    // 204 No Content
    if (res.status === 204) return null;
    return res.json();
  }

  return {
    get:    (path)          => req('GET', path),
    post:   (path, body)    => req('POST', path, body),
    patch:  (path, body)    => req('PATCH', path, body),
    delete: (path)          => req('DELETE', path),
    upload: (path, form)    => req('POST', path, form, true),
  };
})();

/* ============================================================
   Toast — notificações flutuantes
   ============================================================ */
const Toast = (() => {
  const container = () => document.getElementById('toast-container');

  function mostrar(msg, tipo = 'info', duracao = 4000) {
    const el = document.createElement('div');
    el.className = `toast toast-${tipo}`;
    const icones = { sucesso: '✓', erro: '✕', info: 'ℹ', aviso: '⚠' };
    el.innerHTML = `<span>${icones[tipo] || 'ℹ'}</span><span>${_esc(msg)}</span>`;
    container().appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity .3s';
      setTimeout(() => el.remove(), 300);
    }, duracao);
  }

  return {
    sucesso: (m, d) => mostrar(m, 'sucesso', d),
    erro:    (m, d) => mostrar(m, 'erro', d || 6000),
    info:    (m, d) => mostrar(m, 'info', d),
    aviso:   (m, d) => mostrar(m, 'aviso', d),
  };
})();

/* ============================================================
   Modal — diálogo genérico
   ============================================================ */
const Modal = (() => {
  const overlay  = () => document.getElementById('modal-overlay');
  const conteudo = () => document.getElementById('modal-conteudo');

  function abrir(html) {
    conteudo().innerHTML = html;
    overlay().classList.remove('hidden');
  }

  function fechar() {
    overlay().classList.add('hidden');
    conteudo().innerHTML = '';
  }

  return { abrir, fechar };
})();

/* ============================================================
   Utilitários
   ============================================================ */
function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _icone_tipo(tipo) {
  const map = { VIDEO: '🎬', AUDIO: '🎵', PDF: '📄', DOCUMENTO: '📝', TXT: '📃' };
  return map[tipo] || '📁';
}

function _badge_status(status) {
  const cls = {
    PENDENTE: 'badge-pendente',
    PROCESSANDO: 'badge-processando',
    CONCLUIDO: 'badge-concluido',
    ERRO: 'badge-erro',
  }[status] || 'badge-pendente';
  const label = { PENDENTE: 'Pendente', PROCESSANDO: 'Processando…', CONCLUIDO: 'Concluído', ERRO: 'Erro' }[status] || status;
  return `<span class="badge ${cls}">${label}</span>`;
}

function _data(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR');
}

/* ============================================================
   App — roteador principal
   ============================================================ */
const App = (() => {
  const root = () => document.getElementById('app');

  function navegar(rota, params = {}) {
    const paramsStr = new URLSearchParams(params).toString();
    window.location.hash = paramsStr ? `#${rota}?${paramsStr}` : `#${rota}`;
  }

  function _parseHash() {
    const hash = window.location.hash.slice(1) || 'home';
    const [rota, query] = hash.split('?');
    const params = Object.fromEntries(new URLSearchParams(query || ''));
    return { rota, params };
  }

  async function renderizar() {
    const { rota, params } = _parseHash();
    root().innerHTML = '<div class="loading-inicial"><div class="spinner"></div><p>Carregando…</p></div>';
    try {
      switch (rota) {
        case 'home':         await Views.home();                              break;
        case 'disciplina':   await Views.disciplina(params.id);              break;
        case 'logs':         await Views.logs();                              break;
        default:             await Views.home();
      }
    } catch (err) {
      root().innerHTML = `<div class="estado-vazio"><div class="icone">⚠️</div><p>${_esc(err.message)}</p></div>`;
    }
  }

  window.addEventListener('hashchange', renderizar);
  window.addEventListener('DOMContentLoaded', renderizar);

  return { navegar };
})();

/* ============================================================
   Views — funções que renderizam cada página
   ============================================================ */
const Views = (() => {
  const root = () => document.getElementById('app');

  /* ── HOME: lista de disciplinas ── */
  async function home() {
    const disciplinas = await API.get('/disciplinas/');

    let cardsHTML = '';
    if (disciplinas.length === 0) {
      cardsHTML = `<div class="estado-vazio">
        <div class="icone">📚</div>
        <p>Nenhuma disciplina cadastrada ainda.</p>
        <p>Clique em <strong>Nova Disciplina</strong> para começar.</p>
      </div>`;
    } else {
      cardsHTML = `<div class="grid-disciplinas">` +
        disciplinas.map(d => `
          <div class="card-disciplina" onclick="App.navegar('disciplina', {id:'${_esc(d.id)}'})">
            <div class="nome">${_esc(d.nome)}</div>
            ${d.codigo ? `<div class="codigo">${_esc(d.codigo)}</div>` : ''}
            ${d.descricao ? `<div class="descricao">${_esc(d.descricao)}</div>` : ''}
            <div class="rodape">
              <button class="btn btn-sm btn-secundario" onclick="event.stopPropagation(); editarDisciplina('${d.id}', '${_esc(d.nome)}', '${_esc(d.codigo||'')}', '${_esc(d.descricao||'')}')">✏️ Editar</button>
              <button class="btn btn-sm btn-perigo" onclick="event.stopPropagation(); excluirDisciplina('${d.id}', '${_esc(d.nome)}')">🗑</button>
            </div>
          </div>
        `).join('') +
      `</div>`;
    }

    root().innerHTML = `
      <div class="secao-header">
        <h1 class="secao-titulo">Disciplinas</h1>
        <button class="btn btn-primario" onclick="novaDisciplina()">+ Nova Disciplina</button>
      </div>
      ${cardsHTML}
    `;
  }

  /* ── DISCIPLINA: detalhe com materiais e consolidados ── */
  async function disciplina(id) {
    if (!id) { App.navegar('home'); return; }
    const disc = await API.get(`/disciplinas/${id}`);

    root().innerHTML = `
      <div class="breadcrumb">
        <span onclick="App.navegar('home')">Disciplinas</span> › ${_esc(disc.nome)}
      </div>
      <div class="secao-header">
        <h1 class="secao-titulo">${_esc(disc.nome)}</h1>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secundario" onclick="editarDisciplina('${disc.id}','${_esc(disc.nome)}','${_esc(disc.codigo||'')}','${_esc(disc.descricao||'')}')">✏️ Editar</button>
          <button class="btn btn-perigo" onclick="excluirDisciplina('${disc.id}','${_esc(disc.nome)}')">🗑 Excluir</button>
        </div>
      </div>

      <div class="tabs">
        <button class="tab-btn ativo" id="tab-materiais" onclick="trocarTab('materiais')">📁 Materiais (${disc.materiais.length})</button>
        <button class="tab-btn" id="tab-consolidados" onclick="trocarTab('consolidados')">🗂 Consolidados (${disc.consolidados.length})</button>
      </div>

      <div id="painel-materiais">${renderMateriais(disc.materiais, disc.id)}</div>
      <div id="painel-consolidados" style="display:none">${renderConsolidados(disc.consolidados, disc.id, disc.materiais)}</div>
    `;

    // Inicia polling de progresso para materiais em processamento
    disc.materiais
      .filter(m => m.status === 'PROCESSANDO')
      .forEach(m => iniciarSSE(m.id, disc.id));
  }

  function renderMateriais(materiais, discId) {
    const addBtn = `<button class="btn btn-primario" onclick="abrirUpload('${discId}')">⬆ Enviar Arquivo</button>`;

    if (materiais.length === 0) {
      return `<div class="estado-vazio">
        <div class="icone">📂</div>
        <p>Nenhum material enviado.</p>
        ${addBtn}
      </div>`;
    }

    const items = materiais.map(m => `
      <div class="item-material" id="material-${m.id}">
        <span class="material-icone">${_icone_tipo(m.tipo)}</span>
        <div class="material-info">
          <div class="material-nome">${_esc(m.nome_original)}</div>
          <div class="material-meta">
            ${_badge_status(m.status)}
            ${m.status === 'PROCESSANDO' ? '<div class="barra-progresso-container"><div class="barra-progresso" style="width:60%"></div></div>' : ''}
            ${m.erro_mensagem ? `<span style="color:var(--cor-erro);font-size:.75rem">⚠ ${_esc(m.erro_mensagem)}</span>` : ''}
          </div>
        </div>
        <div class="material-acoes">
          ${m.status === 'PENDENTE' && m.tipo !== 'TXT' ? `<button class="btn btn-sm btn-primario" onclick="transcrever('${discId}','${m.id}')">▶ Processar</button>` : ''}
          ${m.status === 'ERRO' ? `<button class="btn btn-sm btn-aviso" onclick="transcrever('${discId}','${m.id}')">↺ Tentar novamente</button>` : ''}
          <button class="btn btn-sm btn-perigo" onclick="excluirMaterial('${discId}','${m.id}','${_esc(m.nome_original)}')">🗑</button>
        </div>
      </div>
    `).join('');

    return `
      <div style="display:flex;justify-content:flex-end;margin-bottom:12px">${addBtn}</div>
      <div class="lista-materiais">${items}</div>
    `;
  }

  function renderConsolidados(consolidados, discId, materiais) {
    const addBtn = `<button class="btn btn-primario" onclick="novoConsolidado('${discId}')">+ Gerar Consolidado</button>`;

    if (consolidados.length === 0) {
      return `<div class="estado-vazio">
        <div class="icone">🗂</div>
        <p>Nenhum arquivo consolidado gerado.</p>
        ${addBtn}
      </div>`;
    }

    const rows = consolidados.map(c => `
      <div class="item-material">
        <span class="material-icone">${c.tipo === 'PDF' ? '📄' : '📃'}</span>
        <div class="material-info">
          <div class="material-nome">${_esc(c.nome)}</div>
          <div class="material-meta">${c.tipo} · ${c.materiais_ids.length} materiais · ${_data(c.criado_em)}</div>
        </div>
        <div class="material-acoes">
          <button class="btn btn-sm btn-perigo" onclick="excluirConsolidado('${discId}','${c.id}','${_esc(c.nome)}')">🗑</button>
        </div>
      </div>
    `).join('');

    return `
      <div style="display:flex;justify-content:flex-end;margin-bottom:12px">${addBtn}</div>
      <div class="lista-materiais">${rows}</div>
    `;
  }

  /* ── LOGS: tabela de auditoria ── */
  async function logs() {
    // Não há endpoint de listagem de logs na API v1 por padrão,
    // mas o arquivo audit.log pode ser exibido via leitura futura.
    // Por ora, mostra mensagem informativa.
    root().innerHTML = `
      <div class="secao-header">
        <h1 class="secao-titulo">Log de Auditoria</h1>
      </div>
      <div class="card">
        <p style="color:var(--cinza-500)">Os logs de auditoria são gravados em <code>logs/audit.log</code> na raiz do projeto.<br>
        Um endpoint de consulta será adicionado em versão futura.</p>
      </div>
    `;
  }

  return { home, disciplina, logs };
})();

/* ============================================================
   Ações globais (chamadas pelos onclick inline)
   ============================================================ */

/* ── Tabs ── */
function trocarTab(tab) {
  ['materiais', 'consolidados'].forEach(t => {
    document.getElementById(`painel-${t}`).style.display = t === tab ? 'block' : 'none';
    document.getElementById(`tab-${t}`).classList.toggle('ativo', t === tab);
  });
}

/* ── Nova disciplina ── */
function novaDisciplina() {
  Modal.abrir(`
    <h2 class="modal-titulo">Nova Disciplina</h2>
    <div class="form-grupo"><label>Nome *</label><input id="disc-nome" placeholder="Ex: Metodologia da Pesquisa" /></div>
    <div class="form-grupo"><label>Código</label><input id="disc-codigo" placeholder="Ex: MET501" /></div>
    <div class="form-grupo"><label>Descrição</label><textarea id="disc-desc" placeholder="Opcional"></textarea></div>
    <div class="modal-acoes">
      <button class="btn btn-secundario" onclick="Modal.fechar()">Cancelar</button>
      <button class="btn btn-primario" onclick="salvarDisciplina()">Salvar</button>
    </div>
  `);
  setTimeout(() => document.getElementById('disc-nome')?.focus(), 50);
}

async function salvarDisciplina() {
  const nome   = document.getElementById('disc-nome')?.value.trim();
  const codigo = document.getElementById('disc-codigo')?.value.trim() || null;
  const desc   = document.getElementById('disc-desc')?.value.trim() || null;
  if (!nome) { Toast.aviso('Informe o nome da disciplina.'); return; }
  try {
    await API.post('/disciplinas/', { nome, codigo, descricao: desc });
    Toast.sucesso('Disciplina criada com sucesso!');
    Modal.fechar();
    App.navegar('home');
  } catch (e) { Toast.erro(e.message); }
}

/* ── Editar disciplina ── */
function editarDisciplina(id, nome, codigo, desc) {
  Modal.abrir(`
    <h2 class="modal-titulo">Editar Disciplina</h2>
    <div class="form-grupo"><label>Nome *</label><input id="edit-nome" value="${_esc(nome)}" /></div>
    <div class="form-grupo"><label>Código</label><input id="edit-codigo" value="${_esc(codigo)}" /></div>
    <div class="form-grupo"><label>Descrição</label><textarea id="edit-desc">${_esc(desc)}</textarea></div>
    <div class="modal-acoes">
      <button class="btn btn-secundario" onclick="Modal.fechar()">Cancelar</button>
      <button class="btn btn-primario" onclick="atualizarDisciplina('${id}')">Salvar</button>
    </div>
  `);
}

async function atualizarDisciplina(id) {
  const nome   = document.getElementById('edit-nome')?.value.trim();
  const codigo = document.getElementById('edit-codigo')?.value.trim() || null;
  const desc   = document.getElementById('edit-desc')?.value.trim() || null;
  if (!nome) { Toast.aviso('Informe o nome.'); return; }
  try {
    await API.patch(`/disciplinas/${id}`, { nome, codigo, descricao: desc });
    Toast.sucesso('Disciplina atualizada!');
    Modal.fechar();
    // Reload da view atual
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } catch (e) { Toast.erro(e.message); }
}

/* ── Excluir disciplina ── */
function excluirDisciplina(id, nome) {
  Modal.abrir(`
    <h2 class="modal-titulo">Excluir Disciplina</h2>
    <p>Tem certeza que deseja excluir <strong>${_esc(nome)}</strong>?<br>
    Todos os materiais e consolidados associados serão removidos.</p>
    <div class="modal-acoes">
      <button class="btn btn-secundario" onclick="Modal.fechar()">Cancelar</button>
      <button class="btn btn-perigo" onclick="confirmarExclusaoDisciplina('${id}')">Excluir</button>
    </div>
  `);
}

async function confirmarExclusaoDisciplina(id) {
  try {
    await API.delete(`/disciplinas/${id}`);
    Toast.sucesso('Disciplina excluída.');
    Modal.fechar();
    App.navegar('home');
  } catch (e) { Toast.erro(e.message); }
}

/* ── Upload de material ── */
function abrirUpload(discId) {
  Modal.abrir(`
    <h2 class="modal-titulo">Enviar Material</h2>
    <div class="zona-upload" id="zona-drop" onclick="document.getElementById('file-input').click()">
      <div class="icone-upload">📁</div>
      <strong>Clique para selecionar</strong>
      <p>ou arraste e solte aqui</p>
      <p style="font-size:.78rem;margin-top:8px">Vídeo, Áudio, PDF, DOCX, PPTX, XLSX, TXT</p>
      <input type="file" id="file-input" onchange="enviarArquivo('${discId}', this.files)"
        accept=".mp4,.mkv,.avi,.mov,.webm,.m4v,.mp3,.wav,.m4a,.ogg,.flac,.aac,.pdf,.docx,.pptx,.xlsx,.doc,.ppt,.xls,.txt,.md" />
    </div>
    <div id="upload-status" style="margin-top:12px;display:none">
      <div class="barra-progresso-container"><div class="barra-progresso" id="upload-barra" style="width:0%"></div></div>
      <p id="upload-msg" style="font-size:.85rem;margin-top:6px;color:var(--cinza-500)">Enviando…</p>
    </div>
    <div class="modal-acoes">
      <button class="btn btn-secundario" onclick="Modal.fechar()">Fechar</button>
    </div>
  `);

  // Drag & drop
  const zona = document.getElementById('zona-drop');
  zona.addEventListener('dragover', e => { e.preventDefault(); zona.classList.add('drag-over'); });
  zona.addEventListener('dragleave', () => zona.classList.remove('drag-over'));
  zona.addEventListener('drop', e => {
    e.preventDefault();
    zona.classList.remove('drag-over');
    enviarArquivo(discId, e.dataTransfer.files);
  });
}

async function enviarArquivo(discId, files) {
  if (!files || files.length === 0) return;
  const file = files[0];

  const status = document.getElementById('upload-status');
  const barra  = document.getElementById('upload-barra');
  const msg    = document.getElementById('upload-msg');

  if (status) {
    status.style.display = 'block';
    barra.style.width = '30%';
    msg.textContent = `Enviando "${file.name}"…`;
  }

  const form = new FormData();
  form.append('arquivo', file);

  try {
    await API.upload(`/disciplinas/${discId}/materiais/upload`, form);
    if (barra) barra.style.width = '100%';
    if (msg) msg.textContent = 'Enviado com sucesso!';
    Toast.sucesso(`"${file.name}" enviado com sucesso.`);
    setTimeout(() => {
      Modal.fechar();
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }, 800);
  } catch (e) {
    if (barra) { barra.style.width = '100%'; barra.style.background = 'var(--cor-erro)'; }
    if (msg) msg.textContent = `Erro: ${e.message}`;
    Toast.erro(e.message);
  }
}

/* ── Processar/transcrever material ── */
async function transcrever(discId, matId) {
  try {
    await API.post(`/disciplinas/${discId}/materiais/${matId}/transcrever`);
    Toast.info('Processamento iniciado em background.');
    iniciarSSE(matId, discId);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } catch (e) { Toast.erro(e.message); }
}

/* ── SSE: polling de progresso ── */
function iniciarSSE(matId, discId) {
  const url = `/api/v1/disciplinas/${discId}/materiais/${matId}/progresso`;
  const es = new EventSource(url);

  es.onmessage = (evt) => {
    let data;
    try { data = JSON.parse(evt.data); } catch (_) { return; }

    const el = document.getElementById(`material-${matId}`);
    if (!el) { es.close(); return; }

    if (data.status === 'CONCLUIDO' || data.status === 'ERRO' || data.status === 'REMOVIDO') {
      es.close();
      // Reload para atualizar a view
      setTimeout(() => window.dispatchEvent(new HashChangeEvent('hashchange')), 500);
    }
  };

  es.onerror = () => es.close();
}

/* ── Excluir material ── */
function excluirMaterial(discId, matId, nome) {
  Modal.abrir(`
    <h2 class="modal-titulo">Excluir Material</h2>
    <p>Remover <strong>${_esc(nome)}</strong>? O arquivo físico também será deletado.</p>
    <div class="modal-acoes">
      <button class="btn btn-secundario" onclick="Modal.fechar()">Cancelar</button>
      <button class="btn btn-perigo" onclick="confirmarExclusaoMaterial('${discId}','${matId}')">Excluir</button>
    </div>
  `);
}

async function confirmarExclusaoMaterial(discId, matId) {
  try {
    await API.delete(`/disciplinas/${discId}/materiais/${matId}`);
    Toast.sucesso('Material excluído.');
    Modal.fechar();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } catch (e) { Toast.erro(e.message); }
}

/* ── Novo consolidado ── */
async function novoConsolidado(discId) {
  const disc = await API.get(`/disciplinas/${discId}`);
  const concluidos = disc.materiais.filter(m => m.status === 'CONCLUIDO');

  if (concluidos.length === 0) {
    Toast.aviso('Nenhum material com status Concluído disponível para consolidar.');
    return;
  }

  const checkboxes = concluidos.map(m => `
    <label class="item-check">
      <input type="checkbox" value="${m.id}" data-tipo="${m.tipo}" />
      <span class="item-check-label">${_icone_tipo(m.tipo)} ${_esc(m.nome_original)}</span>
    </label>
  `).join('');

  Modal.abrir(`
    <h2 class="modal-titulo">Gerar Consolidado</h2>
    <div class="form-grupo">
      <label>Nome do arquivo *</label>
      <input id="cons-nome" placeholder="Ex: Resumo Final Semestre" />
    </div>
    <div class="form-grupo">
      <label>Tipo</label>
      <select id="cons-tipo">
        <option value="TXT">TXT (transcrições e textos)</option>
        <option value="PDF">PDF (PDFs concatenados)</option>
      </select>
    </div>
    <div class="form-grupo">
      <label>Materiais a incluir *</label>
      <div class="lista-check">${checkboxes}</div>
    </div>
    <div class="modal-acoes">
      <button class="btn btn-secundario" onclick="Modal.fechar()">Cancelar</button>
      <button class="btn btn-primario" onclick="gerarConsolidado('${discId}')">Gerar</button>
    </div>
  `);
}

async function gerarConsolidado(discId) {
  const nome = document.getElementById('cons-nome')?.value.trim();
  const tipo = document.getElementById('cons-tipo')?.value;
  const selecionados = [...document.querySelectorAll('.lista-check input:checked')].map(c => c.value);

  if (!nome) { Toast.aviso('Informe o nome do consolidado.'); return; }
  if (selecionados.length === 0) { Toast.aviso('Selecione ao menos um material.'); return; }

  try {
    await API.post(`/disciplinas/${discId}/consolidados`, {
      disciplina_id: discId,
      nome,
      tipo,
      materiais_ids: selecionados,
    });
    Toast.sucesso('Consolidado gerado com sucesso!');
    Modal.fechar();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } catch (e) { Toast.erro(e.message); }
}

/* ── Excluir consolidado ── */
function excluirConsolidado(discId, consId, nome) {
  Modal.abrir(`
    <h2 class="modal-titulo">Excluir Consolidado</h2>
    <p>Remover <strong>${_esc(nome)}</strong>?</p>
    <div class="modal-acoes">
      <button class="btn btn-secundario" onclick="Modal.fechar()">Cancelar</button>
      <button class="btn btn-perigo" onclick="confirmarExclusaoConsolidado('${discId}','${consId}')">Excluir</button>
    </div>
  `);
}

async function confirmarExclusaoConsolidado(discId, consId) {
  try {
    await API.delete(`/disciplinas/${discId}/consolidados/${consId}`);
    Toast.sucesso('Consolidado excluído.');
    Modal.fechar();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } catch (e) { Toast.erro(e.message); }
}

/* ── Expõe para onclick HTML ── */
window._esc = _esc;
