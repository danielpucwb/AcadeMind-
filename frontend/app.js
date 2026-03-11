/**
 * app.js — SPA AcadeMind
 *
 * Roteamento via hash: #home | #disciplina?id=... | #logs
 * Sem dependências externas — vanilla JS puro.
 *
 * Módulos:
 *   API      — wrapper fetch + XHR upload com progresso
 *   Toast    — notificações de feedback
 *   Modal    — diálogo genérico com suporte a ESC
 *   WS       — gerencia conexões WebSocket de progresso por material
 *   App      — roteador e controlador de views
 *   Views    — renderiza cada "página"
 */

'use strict';

/* ============================================================
   API — wrapper fetch + XHR para upload com progresso
   ============================================================ */
const API = (() => {
  const BASE = '/api/v1';

  async function req(method, path, body) {
    const opts = { method, headers: {} };
    if (body instanceof FormData) {
      opts.body = body;
    } else if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
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

  /**
   * Upload via XHR para obter eventos de progresso reais.
   * onProgresso(pct: number) é chamado a cada tick de progresso.
   */
  function uploadXHR(path, formData, onProgresso) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', BASE + path);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgresso(Math.round(e.loaded / e.total * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch { reject(new Error('Resposta inválida do servidor.')); }
        } else {
          try {
            const j = JSON.parse(xhr.responseText);
            reject(new Error(j.detail || j.erro || `Erro ${xhr.status}`));
          } catch { reject(new Error(`Erro ${xhr.status}`)); }
        }
      };
      xhr.onerror = () => reject(new Error('Falha de conexão ao enviar arquivo.'));
      xhr.send(formData);
    });
  }

  return {
    get:       (path)       => req('GET',    path),
    post:      (path, body) => req('POST',   path, body),
    put:       (path, body) => req('PUT',    path, body),
    patch:     (path, body) => req('PATCH',  path, body),
    delete:    (path)       => req('DELETE', path),
    uploadXHR,
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
    setTimeout(() => {
      const first = conteudo().querySelector('input, textarea, select, button');
      first?.focus();
    }, 60);
  }

  function fechar() {
    overlay().classList.add('hidden');
    conteudo().innerHTML = '';
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay().classList.contains('hidden')) fechar();
  });

  return { abrir, fechar };
})();

/* ============================================================
   WS — gerencia conexões WebSocket de progresso por material
   ============================================================ */
const WS = (() => {
  const _sockets = {};  // matId -> WebSocket
  const _retries = {};  // matId -> retry count

  function conectar(matId) {
    if (_sockets[matId]) return;
    _retries[matId] = 0;
    _abrirConexao(matId);
  }

  function _abrirConexao(matId) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws/materiais/${matId}/progresso`);
    _sockets[matId] = ws;

    ws.onmessage = (evt) => {
      try { _atualizar(matId, JSON.parse(evt.data)); } catch (_) {}
    };

    ws.onclose = () => {
      delete _sockets[matId];
      const retries = (_retries[matId] = (_retries[matId] || 0) + 1);
      // Auto-reconecta até 6 tentativas com backoff exponencial
      if (retries <= 6 && document.getElementById(`material-${matId}`)) {
        const delay = Math.min(500 * 2 ** (retries - 1), 16000);
        setTimeout(() => {
          if (!_sockets[matId] && document.getElementById(`material-${matId}`)) {
            _abrirConexao(matId);
          }
        }, delay);
      }
    };

    ws.onerror = () => ws.close();
  }

  function fechar(matId) {
    _sockets[matId]?.close();
    delete _sockets[matId];
    delete _retries[matId];
  }

  function fecharTodos() {
    Object.values(_sockets).forEach(ws => ws.close());
    for (const k in _sockets) delete _sockets[k];
    for (const k in _retries) delete _retries[k];
  }

  function _atualizar(matId, data) {
    const { status, progresso_pct, mensagem } = data;
    const item = document.getElementById(`material-${matId}`);
    if (!item) return;

    // Atualiza badge
    const badgeEl = item.querySelector('.badge');
    if (badgeEl) {
      const clsMap = { PROCESSANDO: 'badge-processando', CONCLUIDO: 'badge-concluido', ERRO: 'badge-erro' };
      const lblMap = { PROCESSANDO: 'Processando…', CONCLUIDO: 'Concluído', ERRO: 'Erro' };
      badgeEl.className = `badge ${clsMap[status] || 'badge-pendente'}`;
      badgeEl.textContent = lblMap[status] || status;
    }

    // Atualiza barra de progresso inline
    const meta = item.querySelector('.material-meta');
    let progDiv = item.querySelector('.progresso-material');

    if (status === 'PROCESSANDO' && meta) {
      if (!progDiv) {
        progDiv = document.createElement('div');
        progDiv.className = 'progresso-material';
        meta.after(progDiv);
      }
      const pct = progresso_pct ?? 5;
      progDiv.innerHTML = `
        <div class="barra-progresso-container">
          <div class="barra-progresso" style="width:${pct}%"></div>
        </div>
        <span class="progresso-msg">${_esc(mensagem || 'Processando…')} — ${pct}%</span>`;
    } else {
      progDiv?.remove();
    }

    // Ao concluir, fecha WS e recarrega a view
    if (status === 'CONCLUIDO' || status === 'ERRO') {
      fechar(matId);
      setTimeout(() => window.dispatchEvent(new HashChangeEvent('hashchange')), 600);
    }
  }

  return { conectar, fechar, fecharTodos };
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

function _icone_tipo_filename(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const map = {
    mp4:'🎬', mkv:'🎬', avi:'🎬', mov:'🎬', webm:'🎬', m4v:'🎬',
    mp3:'🎵', wav:'🎵', m4a:'🎵', ogg:'🎵', flac:'🎵', aac:'🎵',
    pdf:'📄',
    docx:'📝', pptx:'📝', xlsx:'📝', doc:'📝', ppt:'📝', xls:'📝',
    odt:'📝', odp:'📝', ods:'📝',
    txt:'📃', md:'📃',
  };
  return map[ext] || '📁';
}

function _label_tipo(tipo) {
  return { VIDEO: 'Vídeo', AUDIO: 'Áudio', PDF: 'PDF', DOCUMENTO: 'Documento', TXT: 'Texto' }[tipo] || tipo;
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
    WS.fecharTodos();  // Fecha WebSockets antes de renderizar nova view
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

  /* ── DISCIPLINA: materiais + consolidados ── */
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
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <button class="btn btn-secundario" onclick="App.navegar('home')">← Voltar</button>
          <button class="btn btn-secundario"
            onclick="novoConsolidado(${JSON.stringify(_esc(disc.id))})">
            🗂 Consolidar Arquivos
          </button>
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

    // Configura a zona de upload inline
    _setupZonaUploadInline(disc.id);

    // Conecta WS para materiais em processamento
    disc.materiais
      .filter(m => m.status === 'PROCESSANDO' || m.status === 'PENDENTE')
      .forEach(m => WS.conectar(m.id));
  }

  function _renderMateriais(materiais, discId) {
    const zonaUpload = `
      <div class="zona-upload-inline" id="zona-drop-inline"
        onclick="document.getElementById('file-input-inline').click()">
        <span class="icone-upload-sm">📁</span>
        <div class="texto-upload">
          <strong>Arraste arquivos aqui</strong>
          ou <span class="link-selecionar">clique para selecionar</span>
          <span class="tipos-aceitos">Vídeo · Áudio · PDF · Documentos Office (.docx/.pptx/.xlsx) · TXT</span>
        </div>
        <input type="file" id="file-input-inline" multiple
          accept=".mp4,.mkv,.avi,.mov,.webm,.m4v,.mp3,.wav,.m4a,.ogg,.flac,.aac,.pdf,.docx,.pptx,.xlsx,.doc,.ppt,.xls,.odt,.odp,.ods,.txt,.md" />
      </div>
      <div id="upload-progresso-outer" class="upload-progresso-outer" style="display:none">
        <div class="barra-progresso-container">
          <div class="barra-progresso" id="upload-barra-prog" style="width:0%"></div>
        </div>
        <span id="upload-msg-prog" class="progresso-msg">Enviando…</span>
      </div>
      <div id="upload-lista-inline" class="upload-lista" style="display:none"></div>`;

    if (materiais.length === 0) {
      return `
        <div style="padding:24px 0">
          ${zonaUpload}
          <div class="estado-vazio" style="padding:32px 0">
            <div class="icone">📂</div>
            <p>Nenhum material enviado ainda.</p>
          </div>
        </div>`;
    }

    const items = materiais.map(m => _renderItemMaterial(m, discId)).join('');
    return `
      <div>${zonaUpload}</div>
      <div class="lista-materiais">${items}</div>`;
  }

  function _renderItemMaterial(m, discId) {
    const processando = m.status === 'PROCESSANDO' || m.status === 'PENDENTE';
    const erro = m.status === 'ERRO';
    const concluido = m.status === 'CONCLUIDO';
    const temTranscricao = concluido
      && (m.tipo === 'VIDEO' || m.tipo === 'AUDIO')
      && m.transcricao_caminho;

    // Bloco de erro com toggle para detalhes técnicos
    let erroBlock = '';
    if (erro && m.erro_mensagem) {
      const detId = `err-det-${_esc(m.id)}`;
      erroBlock = `
        <div class="erro-material">
          <span class="erro-resumo">
            ⚠ ${_esc(m.erro_mensagem)}
            <button class="link-ver-log" onclick="toggleErroDetalhe('${detId}')">Ver log completo</button>
          </span>
          <pre id="${detId}" class="erro-detalhe">${_esc(m.erro_mensagem)}</pre>
        </div>`;
    }

    // Barra de progresso inicial para materiais em processamento
    const progressoBlock = processando ? `
      <div class="progresso-material" id="progresso-${_esc(m.id)}">
        <div class="barra-progresso-container">
          <div class="barra-progresso" style="width:5%"></div>
        </div>
        <span class="progresso-msg">Aguardando início do processamento…</span>
      </div>` : '';

    return `
      <div class="item-material" id="material-${_esc(m.id)}">
        <span class="material-icone">${_icone_tipo(m.tipo)}</span>
        <div class="material-info">
          <div class="material-nome" title="${_esc(m.nome_original)}">${_esc(m.nome_original)}</div>
          <div class="material-meta">
            ${_badge_status(m.status)}
            <span class="material-tipo-label">${_esc(_label_tipo(m.tipo))}</span>
            <span style="color:var(--cinza-300)">·</span>
            <span style="font-size:.72rem;color:var(--cinza-400)">${_data_curta(m.criado_em)}</span>
          </div>
          ${progressoBlock}
          ${erroBlock}
        </div>
        <div class="material-acoes">
          <a class="btn btn-sm btn-secundario"
            href="/api/v1/materiais/${_esc(m.id)}/download"
            download="${_esc(m.nome_original)}"
            title="Baixar arquivo original">⬇ Original</a>
          ${temTranscricao ? `
            <a class="btn btn-sm btn-secundario"
              href="/api/v1/materiais/${_esc(m.id)}/transcricao/download"
              download
              title="Baixar transcrição TXT">📄 Transcrição</a>` : ''}
          ${erro ? `
            <button class="btn btn-sm btn-secundario"
              onclick="reprocessarMaterial(${JSON.stringify(_esc(m.id))})">
              ↺ Tentar novamente
            </button>` : ''}
          <button class="btn btn-sm btn-perigo"
            ${processando ? 'disabled title="Aguarde o processamento terminar"' : ''}
            onclick="excluirMaterial(${JSON.stringify(_esc(discId))},${JSON.stringify(_esc(m.id))},${JSON.stringify(_esc(m.nome_original))})">
            🗑
          </button>
        </div>
      </div>`;
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

  document.getElementById('edit-nome').value   = disc.nome       ?? '';
  document.getElementById('edit-codigo').value = disc.codigo     ?? '';
  document.getElementById('edit-desc').value   = disc.descricao  ?? '';
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
    await API.put(`/disciplinas/${disc.id}`, { nome, codigo, descricao: desc });
    Toast.sucesso('Disciplina atualizada com sucesso!');
    Modal.fechar();
    Estado.disciplinaEmEdicao = null;
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
   Materiais — upload, progresso, exclusão, reprocessamento
   ============================================================ */

/**
 * Configura os event listeners da zona de upload inline após render.
 * Chamado por Views.disciplina após definir root().innerHTML.
 */
function _setupZonaUploadInline(discId) {
  const zona  = document.getElementById('zona-drop-inline');
  const input = document.getElementById('file-input-inline');
  if (!zona || !input) return;

  input.addEventListener('change', e => _onFilesSelected(discId, e.target.files));

  zona.addEventListener('dragover', e => {
    e.preventDefault();
    zona.classList.add('drag-over');
  });
  zona.addEventListener('dragleave', () => zona.classList.remove('drag-over'));
  zona.addEventListener('drop', e => {
    e.preventDefault();
    zona.classList.remove('drag-over');
    _onFilesSelected(discId, e.dataTransfer.files);
  });
}

function _onFilesSelected(discId, files) {
  if (!files || files.length === 0) return;
  const arr = Array.from(files);

  // Exibe lista de arquivos selecionados
  const listaEl = document.getElementById('upload-lista-inline');
  if (listaEl) {
    listaEl.style.display = 'flex';
    listaEl.innerHTML = arr.map((f, i) => `
      <div class="upload-arquivo-item" id="upload-arq-${i}">
        <span>${_icone_tipo_filename(f.name)}</span>
        <span class="upload-arquivo-nome" title="${_esc(f.name)}">${_esc(f.name)}</span>
        <span class="upload-arquivo-status">⏳</span>
      </div>`).join('');
  }

  _enviarArquivos(discId, arr);
}

async function _enviarArquivos(discId, files) {
  const progOuter = document.getElementById('upload-progresso-outer');
  const barra     = document.getElementById('upload-barra-prog');
  const msgEl     = document.getElementById('upload-msg-prog');
  const zona      = document.getElementById('zona-drop-inline');

  if (progOuter) progOuter.style.display = 'block';
  if (zona)      zona.style.pointerEvents = 'none';

  const form = new FormData();
  files.forEach(f => form.append('arquivos', f));

  try {
    const materiais = await API.uploadXHR(
      `/disciplinas/${discId}/materiais/upload`,
      form,
      (pct) => {
        if (barra)  barra.style.width = `${pct}%`;
        if (msgEl)  msgEl.textContent = `Enviando… ${pct}%`;
      },
    );

    // Marca todos como enviados
    files.forEach((_, i) => {
      const el = document.querySelector(`#upload-arq-${i} .upload-arquivo-status`);
      if (el) el.textContent = '✓';
    });

    if (barra) { barra.style.width = '100%'; barra.style.background = 'var(--cor-sucesso)'; }
    if (msgEl) msgEl.textContent = `${materiais.length} arquivo(s) enviado(s) com sucesso!`;

    Toast.sucesso(
      materiais.length === 1
        ? `"${files[0].name}" enviado. Processamento iniciado.`
        : `${materiais.length} arquivos enviados. Processamento iniciado.`,
    );

    setTimeout(() => window.dispatchEvent(new HashChangeEvent('hashchange')), 900);
  } catch (e) {
    if (barra) { barra.style.width = '100%'; barra.style.background = 'var(--cor-erro)'; }
    if (msgEl) msgEl.textContent = `Erro: ${e.message}`;
    if (zona)  zona.style.pointerEvents = '';
    Toast.erro(e.message);
  }
}

/* ── Reprocessar material com ERRO ── */
async function reprocessarMaterial(matId) {
  try {
    await API.post(`/materiais/${matId}/reprocessar`);
    Toast.info('Reprocessamento iniciado em background.');
    WS.conectar(matId);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } catch (e) {
    Toast.erro(e.message);
  }
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
    await API.delete(`/materiais/${matId}`);
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

/** Expande/colapsa os detalhes técnicos de um erro de material */
function toggleErroDetalhe(id) {
  document.getElementById(id)?.classList.toggle('visivel');
}

/** Marca um campo com erro e exibe mensagem abaixo */
function _marcarErro(inputId, mensagem) {
  const input = document.getElementById(inputId);
  if (!input) { Toast.aviso(mensagem); return; }
  input.style.borderColor = 'var(--cor-erro)';
  input.focus();
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
