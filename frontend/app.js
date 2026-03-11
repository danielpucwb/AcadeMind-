/**
 * app.js — SPA AcadeMind
 *
 * Roteamento via hash: #home | #disciplina?id=... | #logs
 * Sem dependências externas — vanilla JS puro.
 *
 * Módulos:
 *   API      — wrapper fetch para a API REST
 *   Toast    — notificações de feedback
 *   Modal    — diálogo genérico com suporte a ESC
 *   App      — roteador e controlador de views
 *   Views    — renderiza cada "página"
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
      opts.body = body;
    }
    const res = await fetch(BASE + path, opts);
    if (!res.ok) {
      let msg = `Erro ${res.status}`;
      try { const j = await res.json(); msg = j.detail || j.erro || msg; } catch (_) {}
      throw new Error(msg);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  return {
    get:    (path)       => req('GET',    path),
    post:   (path, body) => req('POST',   path, body),
    put:    (path, body) => req('PUT',    path, body),
    patch:  (path, body) => req('PATCH',  path, body),
    delete: (path)       => req('DELETE', path),
    upload: (path, form) => req('POST',   path, form, true),
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
   Modal — diálogo genérico (fecha com ESC, click no overlay, botão ×)
   ============================================================ */
const Modal = (() => {
  const overlay  = () => document.getElementById('modal-overlay');
  const conteudo = () => document.getElementById('modal-conteudo');

  function abrir(html) {
    conteudo().innerHTML = html;
    overlay().classList.remove('hidden');
    // Foca o primeiro input/textarea/select para acessibilidade
    setTimeout(() => {
      const first = conteudo().querySelector('input, textarea, select, button');
      first?.focus();
    }, 60);
  }

  function fechar() {
    overlay().classList.add('hidden');
    conteudo().innerHTML = '';
  }

  // ESC fecha o modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay().classList.contains('hidden')) fechar();
  });

  return { abrir, fechar };
})();

/* ============================================================
   Estado global — evita passar dados via atributos inline (XSS-safe)
   ============================================================ */
const Estado = {
  disciplinaEmEdicao: null,  // objeto Disciplina completo durante edição
};

/* ============================================================
   Utilitários
   ============================================================ */
function _esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _icone_tipo(tipo) {
  const map = { VIDEO: '🎬', AUDIO: '🎵', PDF: '📄', DOCUMENTO: '📝', TXT: '📃' };
  return map[tipo] || '📁';
}

function _badge_status(status) {
  const cls = {
    PENDENTE:    'badge-pendente',
    PROCESSANDO: 'badge-processando',
    CONCLUIDO:   'badge-concluido',
    ERRO:        'badge-erro',
  }[status] || 'badge-pendente';
  const label = {
    PENDENTE:    'Pendente',
    PROCESSANDO: 'Processando…',
    CONCLUIDO:   'Concluído',
    ERRO:        'Erro',
  }[status] || status;
  return `<span class="badge ${cls}">${label}</span>`;
}

function _data_curta(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
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
    root().innerHTML = `
      <div class="loading-inicial">
        <div class="spinner"></div>
        <p>Carregando…</p>
      </div>`;
    try {
      switch (rota) {
        case 'home':       await Views.home();                  break;
        case 'disciplina': await Views.disciplina(params.id);  break;
        case 'logs':       await Views.logs();                  break;
        default:           await Views.home();
      }
    } catch (err) {
      root().innerHTML = `
        <div class="estado-vazio">
          <div class="icone">⚠️</div>
          <p>${_esc(err.message)}</p>
          <button class="btn btn-secundario" onclick="App.navegar('home')">← Voltar ao início</button>
        </div>`;
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

    let conteudo = '';
    if (disciplinas.length === 0) {
      conteudo = `
        <div class="estado-vazio">
          <div class="icone">📚</div>
          <p><strong>Nenhuma disciplina cadastrada.</strong></p>
          <p>Comece criando uma para organizar seus materiais.</p>
          <button class="btn btn-primario" onclick="novaDisciplina()">+ Nova Disciplina</button>
        </div>`;
    } else {
      const cards = disciplinas.map(d => _cardDisciplina(d)).join('');
      conteudo = `<div class="grid-disciplinas">${cards}</div>`;
    }

    root().innerHTML = `
      <div class="secao-header">
        <h1 class="secao-titulo">Disciplinas</h1>
        <button class="btn btn-primario" onclick="novaDisciplina()">+ Nova Disciplina</button>
      </div>
      ${conteudo}`;
  }

  function _cardDisciplina(d) {
    return `
      <div class="card-disciplina" role="article" aria-label="${_esc(d.nome)}">
        <div class="card-disciplina-corpo" onclick="App.navegar('disciplina', {id:'${_esc(d.id)}'})">
          <div class="nome">${_esc(d.nome)}</div>
          ${d.codigo ? `<div class="codigo">${_esc(d.codigo)}</div>` : ''}
          ${d.descricao ? `<div class="descricao">${_esc(d.descricao)}</div>` : ''}
          <div class="data-criacao">Criada em ${_data_curta(d.criado_em)}</div>
        </div>
        <div class="rodape">
          <button class="btn btn-sm btn-primario"
            onclick="App.navegar('disciplina', {id:'${_esc(d.id)}'})">
            Abrir →
          </button>
          <div class="rodape-acoes">
            <button class="btn btn-sm btn-secundario"
              onclick="event.stopPropagation(); editarDisciplina(${JSON.stringify(_esc(d.id))})">
              ✏️ Editar
            </button>
            <button class="btn btn-sm btn-perigo"
              onclick="event.stopPropagation(); excluirDisciplina(${JSON.stringify(_esc(d.id))}, ${JSON.stringify(_esc(d.nome))})">
              🗑
            </button>
          </div>
        </div>
      </div>`;
  }

  /* ── DISCIPLINA: detalhe com materiais e consolidados ── */
  async function disciplina(id) {
    if (!id) { App.navegar('home'); return; }
    const disc = await API.get(`/disciplinas/${id}`);

    root().innerHTML = `
      <div class="breadcrumb">
        <span onclick="App.navegar('home')">Disciplinas</span> › <strong>${_esc(disc.nome)}</strong>
      </div>
      <div class="secao-header">
        <div>
          <h1 class="secao-titulo">${_esc(disc.nome)}</h1>
          ${disc.codigo ? `<div style="font-size:.85rem;color:var(--cinza-400);font-family:var(--fonte-mono)">${_esc(disc.codigo)}</div>` : ''}
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secundario"
            onclick="editarDisciplina(${JSON.stringify(_esc(disc.id))})">
            ✏️ Editar
          </button>
          <button class="btn btn-perigo"
            onclick="excluirDisciplina(${JSON.stringify(_esc(disc.id))}, ${JSON.stringify(_esc(disc.nome))})">
            🗑 Excluir
          </button>
        </div>
      </div>

      <div class="tabs">
        <button class="tab-btn ativo" id="tab-materiais" onclick="trocarTab('materiais')">
          📁 Materiais (${disc.materiais.length})
        </button>
        <button class="tab-btn" id="tab-consolidados" onclick="trocarTab('consolidados')">
          🗂 Consolidados (${disc.consolidados.length})
        </button>
      </div>

      <div id="painel-materiais">${_renderMateriais(disc.materiais, disc.id)}</div>
      <div id="painel-consolidados" style="display:none">
        ${_renderConsolidados(disc.consolidados, disc.id)}
      </div>`;

    // SSE para materiais em processamento
    disc.materiais
      .filter(m => m.status === 'PROCESSANDO')
      .forEach(m => _iniciarSSE(m.id, disc.id));
  }

  function _renderMateriais(materiais, discId) {
    const addBtn = `
      <button class="btn btn-primario" onclick="abrirUpload(${JSON.stringify(_esc(discId))})">
        ⬆ Enviar Arquivo
      </button>`;

    if (materiais.length === 0) {
      return `
        <div class="estado-vazio">
          <div class="icone">📂</div>
          <p>Nenhum material enviado ainda.</p>
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
            ${m.status === 'PROCESSANDO' ? `
              <div class="barra-progresso-container">
                <div class="barra-progresso" style="width:60%"></div>
              </div>` : ''}
            ${m.erro_mensagem ? `
              <span style="color:var(--cor-erro);font-size:.75rem">⚠ ${_esc(m.erro_mensagem)}</span>` : ''}
          </div>
        </div>
        <div class="material-acoes">
          ${m.status === 'PENDENTE' && m.tipo !== 'TXT'
            ? `<button class="btn btn-sm btn-primario"
                onclick="transcrever(${JSON.stringify(_esc(discId))},${JSON.stringify(_esc(m.id))})">
                ▶ Processar
              </button>` : ''}
          ${m.status === 'ERRO'
            ? `<button class="btn btn-sm btn-secundario"
                onclick="transcrever(${JSON.stringify(_esc(discId))},${JSON.stringify(_esc(m.id))})">
                ↺ Tentar novamente
              </button>` : ''}
          <button class="btn btn-sm btn-perigo"
            onclick="excluirMaterial(${JSON.stringify(_esc(discId))},${JSON.stringify(_esc(m.id))},${JSON.stringify(_esc(m.nome_original))})">
            🗑
          </button>
        </div>
      </div>`).join('');

    return `
      <div style="display:flex;justify-content:flex-end;margin-bottom:12px">${addBtn}</div>
      <div class="lista-materiais">${items}</div>`;
  }

  function _renderConsolidados(consolidados, discId) {
    const addBtn = `
      <button class="btn btn-primario" onclick="novoConsolidado(${JSON.stringify(_esc(discId))})">
        + Gerar Consolidado
      </button>`;

    if (consolidados.length === 0) {
      return `
        <div class="estado-vazio">
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
          <div class="material-meta">
            ${c.tipo} · ${c.materiais_ids.length} materiais · ${_data(c.criado_em)}
          </div>
        </div>
        <div class="material-acoes">
          <button class="btn btn-sm btn-perigo"
            onclick="excluirConsolidado(${JSON.stringify(_esc(discId))},${JSON.stringify(_esc(c.id))},${JSON.stringify(_esc(c.nome))})">
            🗑
          </button>
        </div>
      </div>`).join('');

    return `
      <div style="display:flex;justify-content:flex-end;margin-bottom:12px">${addBtn}</div>
      <div class="lista-materiais">${rows}</div>`;
  }

  /* ── LOGS: auditoria ── */
  async function logs() {
    root().innerHTML = `
      <div class="secao-header">
        <h1 class="secao-titulo">Log de Auditoria</h1>
      </div>
      <div class="card">
        <p style="color:var(--cinza-500)">
          Os logs de auditoria são gravados em <code>logs/audit.log</code> na raiz do projeto.<br>
          Um endpoint de consulta será adicionado em versão futura.
        </p>
      </div>`;
  }

  return { home, disciplina, logs };
})();

/* ============================================================
   Tabs (acessível via onclick inline)
   ============================================================ */
function trocarTab(tab) {
  ['materiais', 'consolidados'].forEach(t => {
    document.getElementById(`painel-${t}`).style.display = t === tab ? 'block' : 'none';
    document.getElementById(`tab-${t}`).classList.toggle('ativo', t === tab);
  });
}

/* ============================================================
   Disciplinas — CRUD
   ============================================================ */

/* ── Nova disciplina ── */
function novaDisciplina() {
  Estado.disciplinaEmEdicao = null;
  Modal.abrir(`
    <h2 class="modal-titulo">Nova Disciplina</h2>
    <div class="form-grupo">
      <label for="disc-nome">Nome <span style="color:var(--cor-erro)">*</span></label>
      <input id="disc-nome" placeholder="Ex: Metodologia da Pesquisa" autocomplete="off" />
    </div>
    <div class="form-grupo">
      <label for="disc-codigo">Código</label>
      <input id="disc-codigo" placeholder="Ex: MET501" autocomplete="off" />
    </div>
    <div class="form-grupo">
      <label for="disc-desc">Descrição</label>
      <textarea id="disc-desc" placeholder="Opcional — breve resumo da disciplina"></textarea>
    </div>
    <div class="modal-acoes">
      <button class="btn btn-secundario" onclick="Modal.fechar()">Cancelar</button>
      <button class="btn btn-primario" onclick="salvarDisciplina()">Criar Disciplina</button>
    </div>
  `);
  document.getElementById('disc-nome')?.focus();
}

async function salvarDisciplina() {
  const nome   = document.getElementById('disc-nome')?.value.trim();
  const codigo = document.getElementById('disc-codigo')?.value.trim() || null;
  const desc   = document.getElementById('disc-desc')?.value.trim() || null;

  if (!nome) {
    _marcarErro('disc-nome', 'O nome é obrigatório.');
    return;
  }

  const btn = document.querySelector('.modal-acoes .btn-primario');
  _setBtnLoading(btn, true);

  try {
    await API.post('/disciplinas/', { nome, codigo, descricao: desc });
    Toast.sucesso('Disciplina criada com sucesso!');
    Modal.fechar();
    App.navegar('home');
  } catch (e) {
    Toast.erro(e.message);
  } finally {
    _setBtnLoading(btn, false);
  }
}

/* ── Editar disciplina ── */
async function editarDisciplina(id) {
  // Busca o objeto atual — usa o cache da listagem ou faz uma requisição
  let disc;
  try {
    disc = await API.get(`/disciplinas/${id}`);
  } catch (e) {
    Toast.erro('Não foi possível carregar a disciplina.');
    return;
  }
  Estado.disciplinaEmEdicao = disc;

  Modal.abrir(`
    <h2 class="modal-titulo">Editar Disciplina</h2>
    <div class="form-grupo">
      <label for="edit-nome">Nome <span style="color:var(--cor-erro)">*</span></label>
      <input id="edit-nome" autocomplete="off" />
    </div>
    <div class="form-grupo">
      <label for="edit-codigo">Código</label>
      <input id="edit-codigo" autocomplete="off" />
    </div>
    <div class="form-grupo">
      <label for="edit-desc">Descrição</label>
      <textarea id="edit-desc"></textarea>
    </div>
    <div class="modal-acoes">
      <button class="btn btn-secundario" onclick="Modal.fechar()">Cancelar</button>
      <button class="btn btn-primario" onclick="salvarEdicaoDisciplina()">Salvar Alterações</button>
    </div>
  `);

  // Preenche os campos de forma segura (via .value, nunca via innerHTML)
  document.getElementById('edit-nome').value  = disc.nome    ?? '';
  document.getElementById('edit-codigo').value = disc.codigo ?? '';
  document.getElementById('edit-desc').value   = disc.descricao ?? '';
  document.getElementById('edit-nome').focus();
}

async function salvarEdicaoDisciplina() {
  const disc = Estado.disciplinaEmEdicao;
  if (!disc) { Modal.fechar(); return; }

  const nome   = document.getElementById('edit-nome')?.value.trim();
  const codigo = document.getElementById('edit-codigo')?.value.trim() || null;
  const desc   = document.getElementById('edit-desc')?.value.trim() || null;

  if (!nome) {
    _marcarErro('edit-nome', 'O nome é obrigatório.');
    return;
  }

  const btn = document.querySelector('.modal-acoes .btn-primario');
  _setBtnLoading(btn, true);

  try {
    // PUT para substituição completa, conforme REST
    await API.put(`/disciplinas/${disc.id}`, { nome, codigo, descricao: desc });
    Toast.sucesso('Disciplina atualizada com sucesso!');
    Modal.fechar();
    Estado.disciplinaEmEdicao = null;
    // Reload da view atual (mantém a rota)
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } catch (e) {
    Toast.erro(e.message);
  } finally {
    _setBtnLoading(btn, false);
  }
}

/* ── Excluir disciplina ── */
function excluirDisciplina(id, nome) {
  Modal.abrir(`
    <h2 class="modal-titulo">Excluir Disciplina</h2>
    <div style="background:var(--cor-erro-bg);border:1px solid #fecaca;border-radius:var(--raio);padding:14px;margin-bottom:16px">
      <strong style="color:var(--cor-erro)">⚠ Atenção: esta ação é irreversível.</strong><br>
      <span style="font-size:.875rem;color:var(--cinza-600)">
        Todos os materiais, arquivos de transcrição e consolidados de
        <strong>${_esc(nome)}</strong> serão permanentemente removidos.
      </span>
    </div>
    <p style="font-size:.9rem;color:var(--cinza-600)">Digite o nome da disciplina para confirmar:</p>
    <div class="form-grupo" style="margin-top:8px">
      <input id="confirma-nome" placeholder="${_esc(nome)}" autocomplete="off" />
    </div>
    <div class="modal-acoes">
      <button class="btn btn-secundario" onclick="Modal.fechar()">Cancelar</button>
      <button class="btn btn-perigo" id="btn-confirma-excluir"
        onclick="confirmarExclusaoDisciplina(${JSON.stringify(id)}, ${JSON.stringify(nome)})">
        Excluir permanentemente
      </button>
    </div>
  `);
  document.getElementById('confirma-nome')?.focus();
}

async function confirmarExclusaoDisciplina(id, nome) {
  const input = document.getElementById('confirma-nome')?.value.trim();
  if (input !== nome) {
    _marcarErro('confirma-nome', 'O nome não confere. Digite exatamente como exibido.');
    return;
  }

  const btn = document.getElementById('btn-confirma-excluir');
  _setBtnLoading(btn, true);

  try {
    await API.delete(`/disciplinas/${id}`);
    Toast.sucesso(`Disciplina "${nome}" excluída.`);
    Modal.fechar();
    App.navegar('home');
  } catch (e) {
    Toast.erro(e.message);
    _setBtnLoading(btn, false);
  }
}

/* ============================================================
   Materiais
   ============================================================ */

/* ── Upload de arquivo ── */
function abrirUpload(discId) {
  Modal.abrir(`
    <h2 class="modal-titulo">Enviar Material</h2>
    <div class="zona-upload" id="zona-drop" onclick="document.getElementById('file-input').click()">
      <div class="icone-upload">📁</div>
      <strong>Clique para selecionar</strong>
      <p>ou arraste e solte aqui</p>
      <p style="font-size:.78rem;margin-top:8px">Vídeo, Áudio, PDF, DOCX, PPTX, XLSX, TXT</p>
      <input type="file" id="file-input"
        accept=".mp4,.mkv,.avi,.mov,.webm,.m4v,.mp3,.wav,.m4a,.ogg,.flac,.aac,.pdf,.docx,.pptx,.xlsx,.doc,.ppt,.xls,.txt,.md" />
    </div>
    <div id="upload-status" style="margin-top:12px;display:none">
      <div class="barra-progresso-container">
        <div class="barra-progresso" id="upload-barra" style="width:0%"></div>
      </div>
      <p id="upload-msg" style="font-size:.85rem;margin-top:6px;color:var(--cinza-500)">Enviando…</p>
    </div>
    <div class="modal-acoes">
      <button class="btn btn-secundario" onclick="Modal.fechar()">Fechar</button>
    </div>
  `);

  document.getElementById('file-input').addEventListener('change', e => {
    enviarArquivo(discId, e.target.files);
  });

  const zona = document.getElementById('zona-drop');
  zona.addEventListener('dragover',  e => { e.preventDefault(); zona.classList.add('drag-over'); });
  zona.addEventListener('dragleave', ()  => zona.classList.remove('drag-over'));
  zona.addEventListener('drop', e => {
    e.preventDefault();
    zona.classList.remove('drag-over');
    enviarArquivo(discId, e.dataTransfer.files);
  });
}

async function enviarArquivo(discId, files) {
  if (!files || files.length === 0) return;
  const file = files[0];

  const statusEl = document.getElementById('upload-status');
  const barra    = document.getElementById('upload-barra');
  const msg      = document.getElementById('upload-msg');

  if (statusEl) {
    statusEl.style.display = 'block';
    barra.style.width = '30%';
    barra.style.background = 'var(--cor-primaria)';
    msg.textContent = `Enviando "${file.name}"…`;
  }

  const form = new FormData();
  form.append('arquivo', file);

  try {
    await API.upload(`/disciplinas/${discId}/materiais/upload`, form);
    if (barra) barra.style.width = '100%';
    if (msg)   msg.textContent = '✓ Enviado com sucesso!';
    Toast.sucesso(`"${file.name}" enviado.`);
    setTimeout(() => {
      Modal.fechar();
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }, 800);
  } catch (e) {
    if (barra) { barra.style.width = '100%'; barra.style.background = 'var(--cor-erro)'; }
    if (msg)   msg.textContent = `Erro: ${e.message}`;
    Toast.erro(e.message);
  }
}

/* ── Transcrever/processar material ── */
async function transcrever(discId, matId) {
  try {
    await API.post(`/disciplinas/${discId}/materiais/${matId}/transcrever`);
    Toast.info('Processamento iniciado em background.');
    _iniciarSSE(matId, discId);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } catch (e) {
    Toast.erro(e.message);
  }
}

/* ── SSE: atualizações de progresso em tempo real ── */
function _iniciarSSE(matId, discId) {
  const url = `/api/v1/disciplinas/${discId}/materiais/${matId}/progresso`;
  const es  = new EventSource(url);

  es.onmessage = (evt) => {
    let data;
    try { data = JSON.parse(evt.data); } catch (_) { return; }

    if (data.status === 'CONCLUIDO' || data.status === 'ERRO' || data.status === 'REMOVIDO') {
      es.close();
      setTimeout(() => window.dispatchEvent(new HashChangeEvent('hashchange')), 400);
    }
  };

  es.onerror = () => es.close();
}

/* ── Excluir material ── */
function excluirMaterial(discId, matId, nome) {
  Modal.abrir(`
    <h2 class="modal-titulo">Excluir Material</h2>
    <p>Remover <strong>${_esc(nome)}</strong>?<br>
    O arquivo físico e a transcrição (se houver) também serão deletados.</p>
    <div class="modal-acoes">
      <button class="btn btn-secundario" onclick="Modal.fechar()">Cancelar</button>
      <button class="btn btn-perigo"
        onclick="confirmarExclusaoMaterial(${JSON.stringify(discId)},${JSON.stringify(matId)})">
        Excluir
      </button>
    </div>
  `);
}

async function confirmarExclusaoMaterial(discId, matId) {
  try {
    await API.delete(`/disciplinas/${discId}/materiais/${matId}`);
    Toast.sucesso('Material excluído.');
    Modal.fechar();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } catch (e) {
    Toast.erro(e.message);
  }
}

/* ============================================================
   Consolidados
   ============================================================ */

async function novoConsolidado(discId) {
  const disc = await API.get(`/disciplinas/${discId}`);
  const concluidos = disc.materiais.filter(m => m.status === 'CONCLUIDO');

  if (concluidos.length === 0) {
    Toast.aviso('Nenhum material com status Concluído disponível para consolidar.');
    return;
  }

  Modal.abrir(`
    <h2 class="modal-titulo">Gerar Consolidado</h2>
    <div class="form-grupo">
      <label for="cons-nome">Nome do arquivo <span style="color:var(--cor-erro)">*</span></label>
      <input id="cons-nome" placeholder="Ex: Resumo Final Semestre" autocomplete="off" />
    </div>
    <div class="form-grupo">
      <label for="cons-tipo">Tipo de saída</label>
      <select id="cons-tipo">
        <option value="TXT">TXT — transcrições e textos concatenados</option>
        <option value="PDF">PDF — PDFs concatenados</option>
      </select>
    </div>
    <div class="form-grupo">
      <label>Materiais a incluir <span style="color:var(--cor-erro)">*</span></label>
      <div class="lista-check">
        ${concluidos.map(m => `
          <label class="item-check">
            <input type="checkbox" value="${_esc(m.id)}" />
            <span class="item-check-label">${_icone_tipo(m.tipo)} ${_esc(m.nome_original)}</span>
          </label>`).join('')}
      </div>
    </div>
    <div class="modal-acoes">
      <button class="btn btn-secundario" onclick="Modal.fechar()">Cancelar</button>
      <button class="btn btn-primario" onclick="gerarConsolidado(${JSON.stringify(discId)})">
        Gerar
      </button>
    </div>
  `);
  document.getElementById('cons-nome')?.focus();
}

async function gerarConsolidado(discId) {
  const nome = document.getElementById('cons-nome')?.value.trim();
  const tipo = document.getElementById('cons-tipo')?.value;
  const selecionados = [
    ...document.querySelectorAll('.lista-check input:checked')
  ].map(c => c.value);

  if (!nome) { _marcarErro('cons-nome', 'Informe o nome do consolidado.'); return; }
  if (selecionados.length === 0) { Toast.aviso('Selecione ao menos um material.'); return; }

  const btn = document.querySelector('.modal-acoes .btn-primario');
  _setBtnLoading(btn, true);

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
  } catch (e) {
    Toast.erro(e.message);
    _setBtnLoading(btn, false);
  }
}

function excluirConsolidado(discId, consId, nome) {
  Modal.abrir(`
    <h2 class="modal-titulo">Excluir Consolidado</h2>
    <p>Remover <strong>${_esc(nome)}</strong>? O arquivo gerado será deletado.</p>
    <div class="modal-acoes">
      <button class="btn btn-secundario" onclick="Modal.fechar()">Cancelar</button>
      <button class="btn btn-perigo"
        onclick="confirmarExclusaoConsolidado(${JSON.stringify(discId)},${JSON.stringify(consId)})">
        Excluir
      </button>
    </div>
  `);
}

async function confirmarExclusaoConsolidado(discId, consId) {
  try {
    await API.delete(`/disciplinas/${discId}/consolidados/${consId}`);
    Toast.sucesso('Consolidado excluído.');
    Modal.fechar();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } catch (e) {
    Toast.erro(e.message);
  }
}

/* ============================================================
   Helpers de UI
   ============================================================ */

/** Marca um campo com erro e exibe mensagem abaixo */
function _marcarErro(inputId, mensagem) {
  const input = document.getElementById(inputId);
  if (!input) { Toast.aviso(mensagem); return; }
  input.style.borderColor = 'var(--cor-erro)';
  input.focus();
  // Remove mensagem de erro anterior se existir
  input.parentElement.querySelector('.erro-campo')?.remove();
  const span = document.createElement('span');
  span.className = 'erro-campo';
  span.style.cssText = 'color:var(--cor-erro);font-size:.78rem;margin-top:2px';
  span.textContent = mensagem;
  input.parentElement.appendChild(span);
  input.addEventListener('input', () => {
    input.style.borderColor = '';
    span.remove();
  }, { once: true });
}

/** Estado de loading em botão */
function _setBtnLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  if (loading) {
    btn.dataset.textoOriginal = btn.textContent;
    btn.textContent = 'Aguarde…';
  } else {
    btn.textContent = btn.dataset.textoOriginal || btn.textContent;
  }
}
