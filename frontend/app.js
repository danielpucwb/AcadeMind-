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

  function abrir(html, xl = false) {
    conteudo().innerHTML = html;
    const box = overlay().querySelector('.modal-box');
    if (box) box.style.maxWidth = xl ? '700px' : '';
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

/* Extensões aceitas no frontend (espelho do backend _EXT_TIPO) */
const _EXTS_VALIDAS = new Set([
  'mp4','mkv','avi','mov','webm','m4v',          // vídeo
  'mp3','wav','m4a','ogg','flac','aac',           // áudio
  'docx','pptx','xlsx','doc','ppt','xls',         // Office
  'odt','odp','ods',                              // LibreOffice
  'pdf','txt','md',                               // diretos
]);

/* Tamanho máximo frontend (10 GB, replicado do default do backend) */
let _TAMANHO_MAX_FRONTEND = 10 * 1024 ** 3;

// Carrega o tamanho máximo da config ao iniciar
fetch('/api/v1/config/').then(r => r.json()).then(cfg => {
  if (cfg && cfg.tamanho_max_bytes) _TAMANHO_MAX_FRONTEND = cfg.tamanho_max_bytes;
}).catch(() => {});

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
    // Atualiza destaque do nav e breadcrumb
    _atualizarNav(rota);
    _atualizarBreadcrumb(rota, params);

    try {
      switch (rota) {
        case 'home':       await Views.home();                  break;
        case 'disciplina': await Views.disciplina(params.id);  break;
        case 'logs':       await Views.logs();                  break;
        case 'config':     await Views.config();               break;
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

  function _atualizarNav(rota) {
    const mapa = { home: 'nav-disciplinas', logs: 'nav-logs', config: 'nav-config', disciplina: 'nav-disciplinas' };
    ['nav-disciplinas', 'nav-logs', 'nav-config'].forEach(id => {
      document.getElementById(id)?.classList.remove('ativo');
    });
    const ativo = mapa[rota] || 'nav-disciplinas';
    document.getElementById(ativo)?.classList.add('ativo');
  }

  function _atualizarBreadcrumb(rota, params) {
    const bar = document.getElementById('breadcrumb-bar');
    if (!bar) return;
    const crumbs = { home: null, logs: 'Logs & Auditoria', config: 'Configurações', disciplina: null };
    if (rota === 'home') {
      bar.classList.add('hidden');
      document.title = 'AcadeMind — Orientador Acadêmico';
      return;
    }
    if (rota === 'disciplina') {
      bar.classList.add('hidden'); // será atualizado dentro de Views.disciplina
      return;
    }
    const label = crumbs[rota];
    if (label) {
      bar.innerHTML = `<span class="bc-link" onclick="App.navegar('home')">Início</span>
        <span class="bc-sep">›</span><span class="bc-atual">${_esc(label)}</span>`;
      bar.classList.remove('hidden');
      document.title = `AcadeMind — ${label}`;
    } else {
      bar.classList.add('hidden');
    }
  }

  window.addEventListener('hashchange', renderizar);
  window.addEventListener('DOMContentLoaded', () => {
    renderizar();
    // Ctrl+N — nova disciplina na tela home
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'n' && !e.shiftKey) {
        const { rota } = _parseHash();
        if (rota === 'home') {
          e.preventDefault();
          novaDisciplina();
        }
      }
    });
  });

  return { navegar };
})();

/* ============================================================
   Views — funções que renderizam cada página
   ============================================================ */
const Views = (() => {
  const root = () => document.getElementById('app');

  /* ── HOME: lista de disciplinas ── */
  async function home() {
    document.title = 'AcadeMind — Orientador Acadêmico';
    root().innerHTML = `
      <div class="secao-header">
        <div class="skeleton-block" style="height:32px;width:160px"></div>
        <div class="skeleton-block" style="height:36px;width:140px"></div>
      </div>
      <div class="grid-disciplinas">
        ${[1,2,3].map(() => `<div class="card-disciplina skeleton-block" style="height:140px"></div>`).join('')}
      </div>`;

    const disciplinas = await API.get('/disciplinas/');

    document.title = `AcadeMind — ${disciplinas.length} disciplina(s)`;

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

    // Skeleton enquanto carrega
    root().innerHTML = `
      <div class="skeleton-block" style="height:36px;width:280px;margin-bottom:16px"></div>
      <div class="skeleton-block" style="height:56px;margin-bottom:12px"></div>
      <div class="skeleton-block" style="height:320px"></div>`;

    const disc = await API.get(`/disciplinas/${id}`);

    // Breadcrumb e título
    const bar = document.getElementById('breadcrumb-bar');
    if (bar) {
      bar.innerHTML = `
        <span class="bc-link" onclick="App.navegar('home')">Disciplinas</span>
        <span class="bc-sep">›</span>
        <span class="bc-atual">${_esc(disc.nome)}</span>`;
      bar.classList.remove('hidden');
    }
    document.title = `AcadeMind — ${disc.nome}`;

    root().innerHTML = `
      <div class="secao-header"  style="padding-top:0">
      <div class="secao-header" style="padding-top:0">
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
    const emProcessamento = disc.materiais.filter(
      m => m.status === 'PROCESSANDO' || m.status === 'PENDENTE'
    );
    emProcessamento.forEach(m => WS.conectar(m.id));

    // Título dinâmico quando há processamento em curso
    if (emProcessamento.length > 0) {
      document.title = `AcadeMind — Processando ${emProcessamento.length} arquivo(s)…`;
    }
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
        🗂 Gerar Consolidado
      </button>`;

    if (consolidados.length === 0) {
      return `
        <div class="estado-vazio">
          <div class="icone">🗂</div>
          <p>Nenhum arquivo consolidado gerado.</p>
          ${addBtn}
        </div>`;
    }

    const rows = consolidados.map(c => {
      const badgeCls = c.tipo === 'PDF' ? 'badge-tipo-pdf' : 'badge-tipo-txt';
      const tam = _fmt_tamanho(c.tamanho_bytes);
      return `
        <div class="item-material">
          <span class="material-icone">${c.tipo === 'PDF' ? '📑' : '📄'}</span>
          <div class="material-info">
            <div class="material-nome" title="${_esc(c.nome)}">${_esc(c.nome)}</div>
            <div class="material-meta">
              <span class="badge-tipo-cons ${badgeCls}">${c.tipo}</span>
              <span class="material-tipo-label">${c.materiais_ids.length} material(is)</span>
              <span style="color:var(--cinza-300)">·</span>
              <span style="font-size:.72rem;color:var(--cinza-400)">${_data_curta(c.criado_em)}</span>
              <span style="font-size:.72rem;color:var(--cinza-400);margin-left:4px">${tam}</span>
            </div>
          </div>
          <div class="material-acoes">
            <a class="btn btn-sm btn-secundario"
               href="/api/v1/consolidados/${_esc(c.id)}/download"
               download="${_esc(c.nome)}"
               title="Baixar arquivo consolidado">⬇ Baixar</a>
            <button class="btn btn-sm btn-perigo"
              onclick="excluirConsolidado(${JSON.stringify(_esc(c.id))},${JSON.stringify(_esc(c.nome))})">
              🗑
            </button>
          </div>
        </div>`;
    }).join('');

    return `
      <div style="display:flex;justify-content:flex-end;margin-bottom:12px">${addBtn}</div>
      <div class="lista-materiais">${rows}</div>`;
  }

  /* ── LOGS: auditoria ── */
  async function logs() {
    root().innerHTML = `
      <div class="secao-header">
        <h1 class="secao-titulo">Logs &amp; Auditoria</h1>
      </div>
      <div class="log-filtros skeleton-block" style="height:56px"></div>
      <div class="skeleton-block" style="height:320px;margin-top:12px"></div>`;
    await renderizarLogs(LogsView._filtros, LogsView._page);
  }

  /* ── CONFIG: configurações ── */
  async function config() {
    root().innerHTML = `
      <div class="secao-header"><h1 class="secao-titulo">Configurações</h1></div>
      <div class="skeleton-block" style="height:400px"></div>`;

    let cfg, sistema;
    try {
      [cfg, sistema] = await Promise.all([
        API.get('/config/'),
        API.get('/config/sistema'),
      ]);
    } catch (e) {
      root().innerHTML = `<div class="estado-vazio"><p>Erro ao carregar configurações: ${_esc(e.message)}</p></div>`;
      return;
    }

    const cudaLabel = sistema.cuda
      ? `<span class="badge badge-concluido">CUDA ativo ✓</span> ${_esc(sistema.cuda_info)}`
      : `<span class="badge badge-pendente">CPU</span> ${_esc(sistema.cuda_info)}`;
    const ffmpegLabel = sistema.ffmpeg
      ? `<span class="badge badge-concluido">FFmpeg ✓</span>`
      : `<span class="badge badge-erro">FFmpeg não encontrado ✕</span>`;
    const libreLabel = sistema.libreoffice
      ? `<span class="badge badge-concluido">LibreOffice ✓</span>`
      : `<span class="badge badge-aviso">LibreOffice não encontrado ⚠</span>`;

    const modelOpts = (cfg.modelos_disponiveis || [])
      .map(m => {
        const info = cfg.modelos_info?.[m] || {};
        const descr = info.qualidade ? ` — ${info.qualidade}, ~${info.vram_gb}GB VRAM` : '';
        const rec = m === 'large-v3' ? ' (Recomendado)' : '';
        return `<option value="${_esc(m)}" ${m === cfg.whisper_model ? 'selected' : ''}>${_esc(m)}${_esc(descr)}${_esc(rec)}</option>`;
      }).join('');

    root().innerHTML = `
      <div class="secao-header"><h1 class="secao-titulo">Configurações</h1></div>

      <div class="config-grid">

        <div class="card config-card">
          <h2 class="config-secao-titulo">🖥 Sistema detectado</h2>
          <table class="tabela-config-sistema">
            <tr><td>GPU / Aceleração</td><td>${cudaLabel}</td></tr>
            <tr><td>FFmpeg</td><td>${ffmpegLabel}</td></tr>
            <tr><td>LibreOffice</td><td>${libreLabel}</td></tr>
            <tr>
              <td>Diretório de armazenamento</td>
              <td><code style="font-size:.8rem">${_esc(sistema.storage_dir)}</code></td>
            </tr>
          </table>
        </div>

        <div class="card config-card">
          <h2 class="config-secao-titulo">🎙 Modelo Whisper</h2>
          <p style="font-size:.82rem;color:var(--cinza-500);margin-bottom:12px">
            <strong>large-v3</strong> é recomendado para melhor qualidade. Requer ~10 GB de VRAM.<br>
            Modelos menores transcrevem mais rápido com menor precisão.
          </p>
          <div class="form-grupo">
            <label for="cfg-modelo">Modelo ativo</label>
            <select id="cfg-modelo">${modelOpts}</select>
          </div>
          <div class="modal-acoes" style="margin-top:8px">
            <button class="btn btn-primario" onclick="salvarConfig()">Salvar modelo</button>
            <button class="btn btn-secundario" id="btn-testar-transcricao"
              onclick="testarTranscricao()">🔊 Testar transcrição</button>
          </div>
          <div id="cfg-resultado-teste" style="margin-top:12px"></div>
        </div>

        <div class="card config-card">
          <h2 class="config-secao-titulo">📦 Tamanho máximo de upload</h2>
          <div class="form-grupo">
            <label for="cfg-tam-max">Limite por arquivo (GB)</label>
            <input type="number" id="cfg-tam-max" min="0.1" max="100" step="0.5"
              value="${(cfg.tamanho_max_bytes / 1024**3).toFixed(0)}" />
          </div>
          <div class="modal-acoes" style="margin-top:8px">
            <button class="btn btn-primario" onclick="salvarConfig()">Salvar limite</button>
          </div>
        </div>

      </div>`;
  }

  return { home, disciplina, logs: () => logs(), config };
})();

/* ============================================================
   LogsView — estado de filtros/paginação de logs (módulo global)
   ============================================================ */
const LogsView = {
  _filtros: {},
  _page: 1,
  _refreshTimer: null,

  _lerFiltros() {
    return {
      entidade:     document.getElementById('fil-entidade')?.value  || '',
      status:       document.getElementById('fil-status')?.value    || '',
      data_inicial: document.getElementById('fil-data-ini')?.value  || '',
      data_final:   document.getElementById('fil-data-fim')?.value  || '',
    };
  },

  aplicar() {
    this._filtros = this._lerFiltros();
    this._page = 1;
    App.navegar('logs');
  },

  paginar(pag) {
    this._page = pag;
    App.navegar('logs');
  },

  limpar() {
    this._filtros = {};
    this._page = 1;
    App.navegar('logs');
  },

  agendarRefresh() {
    clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(async () => {
      const hash = window.location.hash.slice(1) || 'home';
      if (!hash.startsWith('logs')) return;
      await renderizarLogs(this._filtros, this._page);
      this.agendarRefresh();
    }, 10_000);
  },
};

/* ============================================================
   renderizarLogs — módulo-nível para compartilhar com LogsView
   ============================================================ */
async function renderizarLogs(filtros = {}, page = 1) {
  const root = document.getElementById('app');
  const params = new URLSearchParams({ page, limit: 50 });
  if (filtros.entidade)     params.set('entidade',     filtros.entidade);
  if (filtros.status)       params.set('status',       filtros.status);
  if (filtros.data_inicial) params.set('data_inicial', filtros.data_inicial);
  if (filtros.data_final)   params.set('data_final',   filtros.data_final);

  const [itens, totObj] = await Promise.all([
    API.get(`/logs/?${params}`),
    API.get(`/logs/total?${params}`),
  ]);
  const total = totObj?.total ?? itens.length;
  const totalPags = Math.max(1, Math.ceil(total / 50));

  const exportParams = new URLSearchParams(params);
  exportParams.delete('page'); exportParams.delete('limit');

  const filEnt = filtros.entidade || '';
  const filSts = filtros.status || '';

  root.innerHTML = `
    <div class="secao-header">
      <h1 class="secao-titulo">Logs &amp; Auditoria</h1>
      <div style="display:flex;gap:8px">
        <a class="btn btn-secundario"
           href="/api/v1/logs/exportar?formato=txt&${exportParams}"
           download="academind_logs.txt">⬇ TXT</a>
        <a class="btn btn-secundario"
           href="/api/v1/logs/exportar?formato=json&${exportParams}"
           download="academind_logs.json">⬇ JSON</a>
      </div>
    </div>

    <div class="log-filtros">
      <select id="fil-entidade" onchange="LogsView.aplicar()">
        <option value="">Todas as entidades</option>
        <option value="Disciplina"${filEnt === 'Disciplina' ? ' selected' : ''}>Disciplina</option>
        <option value="Material"${filEnt === 'Material' ? ' selected' : ''}>Material</option>
        <option value="Consolidado"${filEnt === 'Consolidado' ? ' selected' : ''}>Consolidado</option>
        <option value="Sistema"${filEnt === 'Sistema' ? ' selected' : ''}>Sistema</option>
      </select>
      <select id="fil-status" onchange="LogsView.aplicar()">
        <option value="">Todos os status</option>
        <option value="OK"${filSts === 'OK' ? ' selected' : ''}>✅ OK</option>
        <option value="ERRO"${filSts === 'ERRO' ? ' selected' : ''}>❌ Erro</option>
        <option value="INFO"${filSts === 'INFO' ? ' selected' : ''}>ℹ Info</option>
      </select>
      <input type="date" id="fil-data-ini" title="Data inicial"
        value="${_esc(filtros.data_inicial || '')}" onchange="LogsView.aplicar()" />
      <input type="date" id="fil-data-fim" title="Data final"
        value="${_esc(filtros.data_final || '')}" onchange="LogsView.aplicar()" />
      <button class="btn btn-sm btn-secundario" onclick="LogsView.limpar()">✕ Limpar</button>
    </div>

    <div class="log-info-bar">
      ${total} registro(s) · Página ${page} de ${totalPags}
    </div>

    ${itens.length === 0
      ? `<div class="estado-vazio"><div class="icone">📋</div><p>Nenhum log para os filtros selecionados.</p></div>`
      : `<div class="tabela-logs-wrapper">
           <table class="tabela-logs">
             <thead>
               <tr>
                 <th style="width:150px">Timestamp</th>
                 <th>Entidade</th>
                 <th>Ação</th>
                 <th style="width:70px">Status</th>
                 <th style="width:80px"></th>
               </tr>
             </thead>
             <tbody>${itens.map(_renderLinhaLog).join('')}</tbody>
           </table>
         </div>`
    }

    <div class="paginacao">
      <button class="btn btn-sm btn-secundario" ${page <= 1 ? 'disabled' : ''}
        onclick="LogsView.paginar(${page - 1})">← Anterior</button>
      <span style="font-size:.85rem;color:var(--cinza-500)">${page} / ${totalPags}</span>
      <button class="btn btn-sm btn-secundario" ${page >= totalPags ? 'disabled' : ''}
        onclick="LogsView.paginar(${page + 1})">Próxima →</button>
    </div>`;

  LogsView._filtros = filtros;
  LogsView._page = page;
  LogsView.agendarRefresh();
}

function _renderLinhaLog(log) {
  const ts = new Date(log.criado_em).toLocaleString('pt-BR');
  const cls = { OK: 'badge-concluido', ERRO: 'badge-erro', INFO: 'badge-pendente' }[log.status] || '';
  const det = log.detalhes ? JSON.stringify(log.detalhes, null, 2) : '{}';
  const detId = `log-det-${log.id}`;
  return `
    <tr>
      <td style="font-size:.74rem;font-family:var(--fonte-mono);white-space:nowrap">${_esc(ts)}</td>
      <td>
        <span style="font-size:.8rem">${_esc(log.entidade)}</span>
        ${log.entidade_id
          ? `<br><span style="font-size:.68rem;color:var(--cinza-400);font-family:var(--fonte-mono)">${_esc(log.entidade_id.slice(0,8))}…</span>`
          : ''}
      </td>
      <td style="font-size:.82rem">${_esc(log.acao)}</td>
      <td><span class="badge ${cls}" style="font-size:.68rem">${_esc(log.status)}</span></td>
      <td>
        <button class="btn btn-sm btn-secundario" style="font-size:.7rem;padding:2px 6px"
          onclick="document.getElementById('${detId}').classList.toggle('visivel')">
          Detalhes
        </button>
        <pre class="log-detalhe" id="${detId}">${_esc(det)}</pre>
      </td>
    </tr>`;
}

/* ============================================================
   Configurações — salvar e testar transcrição
   ============================================================ */
async function salvarConfig() {
  const modelo    = document.getElementById('cfg-modelo')?.value;
  const tamGbStr  = document.getElementById('cfg-tam-max')?.value;
  const tamGb     = tamGbStr ? parseFloat(tamGbStr) : null;

  const payload = {};
  if (modelo)  payload.whisper_model   = modelo;
  if (tamGb)   payload.tamanho_max_gb  = tamGb;

  try {
    await API.patch('/config/', payload);
    // Atualiza limite de upload frontend
    if (tamGb) _TAMANHO_MAX_FRONTEND = tamGb * 1024 ** 3;
    Toast.sucesso('Configurações salvas.');
  } catch (e) {
    Toast.erro(e.message);
  }
}

async function testarTranscricao() {
  const btn = document.getElementById('btn-testar-transcricao');
  const resEl = document.getElementById('cfg-resultado-teste');
  _setBtnLoading(btn, true);
  if (resEl) resEl.innerHTML = `<p style="font-size:.82rem;color:var(--cinza-400)">Carregando modelo e transcrevendo (pode levar alguns segundos)…</p>`;

  try {
    const r = await API.post('/config/testar-transcricao');
    if (resEl) {
      if (r.sucesso) {
        resEl.innerHTML = `
          <div style="background:var(--cor-sucesso-bg);border:1px solid #bbf7d0;border-radius:var(--raio);padding:10px 14px;font-size:.82rem;color:var(--cor-sucesso)">
            ✅ Transcrição de teste concluída em <strong>${r.tempo_segundos}s</strong>
            · Idioma detectado: <strong>${_esc(r.idioma_detectado)}</strong>
            · Modelo: <strong>${_esc(r.modelo_usado)}</strong>
          </div>`;
      } else {
        resEl.innerHTML = `
          <div style="background:var(--cor-erro-bg);border:1px solid #fecaca;border-radius:var(--raio);padding:10px 14px;font-size:.82rem;color:var(--cor-erro)">
            ❌ Falha no teste: ${_esc(r.erro || r.mensagem)}
          </div>`;
      }
    }
  } catch (e) {
    if (resEl) resEl.innerHTML = `<p style="color:var(--cor-erro);font-size:.82rem">Erro: ${_esc(e.message)}</p>`;
  } finally {
    _setBtnLoading(btn, false);
  }
}

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

  // Validação frontend: extensão e tamanho
  const invalidos = [];
  for (const f of arr) {
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (!_EXTS_VALIDAS.has(ext)) {
      invalidos.push(`"${f.name}": extensão .${ext} não suportada.`);
    } else if (f.size > _TAMANHO_MAX_FRONTEND) {
      const limGB = (_TAMANHO_MAX_FRONTEND / 1024 ** 3).toFixed(0);
      invalidos.push(`"${f.name}": excede o limite de ${limGB} GB.`);
    }
  }
  if (invalidos.length > 0) {
    Toast.erro(invalidos.join('\n'), 8000);
    return;
  }

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
   Consolidados — modal com abas TXT / PDF / Gerados
   ============================================================ */

// Estado do modal de consolidação
const EstadoCons = {
  discId: null,
  disc: null,
};

async function novoConsolidado(discId) {
  let disc;
  try {
    disc = await API.get(`/disciplinas/${discId}`);
  } catch (e) {
    Toast.erro('Não foi possível carregar os materiais.');
    return;
  }

  EstadoCons.discId = discId;
  EstadoCons.disc   = disc;

  const txtElegiveis = disc.materiais.filter(m =>
    m.status === 'CONCLUIDO' && (
      m.tipo === 'TXT'
      || ((m.tipo === 'VIDEO' || m.tipo === 'AUDIO') && m.transcricao_caminho)
    )
  );

  const pdfElegiveis = disc.materiais.filter(m =>
    m.status === 'CONCLUIDO' && (
      m.tipo === 'PDF'
      || (m.tipo === 'DOCUMENTO' && m.transcricao_caminho)
    )
  );

  Modal.abrir(`
    <h2 class="modal-titulo" style="margin-bottom:12px">Consolidar Arquivos</h2>
      <div class="modal-tabs" id="cons-tabs">
        <button class="modal-tab-btn ativo" onclick="trocarTabCons('txt')">📄 Consolidar TXT</button>
        <button class="modal-tab-btn"       onclick="trocarTabCons('pdf')">📑 Consolidar PDF</button>
        <button class="modal-tab-btn"       onclick="trocarTabCons('gerados')">📋 Gerados (${disc.consolidados.length})</button>
      </div>

      <div id="cons-painel-txt">
        ${_renderPainelTxt(txtElegiveis, discId)}
      </div>
      <div id="cons-painel-pdf" style="display:none">
        ${_renderPainelPdf(pdfElegiveis, discId)}
      </div>
      <div id="cons-painel-gerados" style="display:none">
        ${_renderPainelGerados(disc.consolidados)}
      </div>

      <div class="modal-acoes" style="margin-top:8px">
        <button class="btn btn-secundario" onclick="Modal.fechar()">Fechar</button>
      </div>
  `, true);  // true = modal XL
}

function trocarTabCons(tab) {
  ['txt', 'pdf', 'gerados'].forEach((t, i) => {
    document.getElementById(`cons-painel-${t}`).style.display = t === tab ? 'block' : 'none';
    document.querySelectorAll('.modal-tab-btn')[i]?.classList.toggle('ativo', t === tab);
  });
}

// ── Painel TXT ──────────────────────────────────────────────
function _renderPainelTxt(elegiveis, discId) {
  if (elegiveis.length === 0) {
    return `<div class="estado-vazio" style="padding:24px 0">
      <div class="icone" style="font-size:2rem">📄</div>
      <p>Nenhum material com transcrição ou TXT disponível.</p>
      <p style="font-size:.82rem;color:var(--cinza-400)">
        Envie arquivos de vídeo, áudio ou TXT e aguarde o processamento.</p>
    </div>`;
  }

  return `
    <div class="lista-eleg" id="lista-eleg-txt">
      ${elegiveis.map(m => `
        <label class="eleg-item">
          <input type="checkbox" value="${_esc(m.id)}" />
          <div class="eleg-item-info">
            <div class="eleg-item-nome">${_esc(m.nome_original)}</div>
            <div class="eleg-item-meta">
              <span class="eleg-origem ${_origemClasse(m)}">${_origemLabel(m)}</span>
              ${_data_curta(m.criado_em)}
            </div>
          </div>
        </label>`).join('')}
    </div>
    <div class="form-grupo">
      <label for="cons-txt-nome">Nome do arquivo <span style="color:var(--cor-erro)">*</span></label>
      <input id="cons-txt-nome" placeholder="Ex: Resumo Final Semestre" autocomplete="off" />
    </div>
    <div id="cons-txt-resultado"></div>
    <button class="btn btn-primario" style="width:100%" id="btn-gerar-txt"
      onclick="gerarConsolidadoTxt(${JSON.stringify(discId)})">
      Gerar TXT Consolidado
    </button>`;
}

async function gerarConsolidadoTxt(discId) {
  const nome = document.getElementById('cons-txt-nome')?.value.trim();
  if (!nome) { _marcarErro('cons-txt-nome', 'Informe o nome do arquivo.'); return; }

  const ids = [...document.querySelectorAll('#lista-eleg-txt input:checked')].map(c => c.value);
  if (ids.length === 0) { Toast.aviso('Selecione ao menos um material.'); return; }

  const btn = document.getElementById('btn-gerar-txt');
  _setBtnLoading(btn, true);

  try {
    const res = await API.post(`/disciplinas/${discId}/consolidar/txt`, {
      nome, materiais_ids: ids,
    });
    _exibirResultadoCons('cons-txt-resultado', res);
    Toast.sucesso('TXT consolidado gerado!');
    _atualizarContagemGerados(discId);
  } catch (e) {
    Toast.erro(e.message);
  } finally {
    _setBtnLoading(btn, false);
  }
}

// ── Painel PDF ──────────────────────────────────────────────
function _renderPainelPdf(elegiveis, discId) {
  if (elegiveis.length === 0) {
    return `<div class="estado-vazio" style="padding:24px 0">
      <div class="icone" style="font-size:2rem">📑</div>
      <p>Nenhum material PDF ou documento convertido disponível.</p>
      <p style="font-size:.82rem;color:var(--cinza-400)">
        Envie arquivos PDF ou documentos Office e aguarde o processamento.</p>
    </div>`;
  }

  return `
    <div class="lista-eleg" id="lista-eleg-pdf">
      ${elegiveis.map(m => `
        <label class="eleg-item">
          <input type="checkbox" value="${_esc(m.id)}" />
          <div class="eleg-item-info">
            <div class="eleg-item-nome">${_esc(m.nome_original)}</div>
            <div class="eleg-item-meta">
              <span class="eleg-origem ${_origemClasse(m)}">${_origemLabel(m)}</span>
              ${_data_curta(m.criado_em)}
            </div>
          </div>
        </label>`).join('')}
    </div>
    <p style="font-size:.78rem;color:var(--cinza-400);margin-bottom:12px">
      ⏱ A geração do PDF pode demorar alguns segundos dependendo do tamanho dos arquivos.
    </p>
    <div class="form-grupo">
      <label for="cons-pdf-nome">Nome do arquivo <span style="color:var(--cor-erro)">*</span></label>
      <input id="cons-pdf-nome" placeholder="Ex: Material Completo Semestre" autocomplete="off" />
    </div>
    <div id="cons-pdf-resultado"></div>
    <button class="btn btn-primario" style="width:100%" id="btn-gerar-pdf"
      onclick="gerarConsolidadoPdf(${JSON.stringify(discId)})">
      Gerar PDF Consolidado
    </button>`;
}

async function gerarConsolidadoPdf(discId) {
  const nome = document.getElementById('cons-pdf-nome')?.value.trim();
  if (!nome) { _marcarErro('cons-pdf-nome', 'Informe o nome do arquivo.'); return; }

  const ids = [...document.querySelectorAll('#lista-eleg-pdf input:checked')].map(c => c.value);
  if (ids.length === 0) { Toast.aviso('Selecione ao menos um material.'); return; }

  const btn = document.getElementById('btn-gerar-pdf');
  _setBtnLoading(btn, true);

  try {
    const res = await API.post(`/disciplinas/${discId}/consolidar/pdf`, {
      nome, materiais_ids: ids,
    });
    _exibirResultadoCons('cons-pdf-resultado', res);
    Toast.sucesso('PDF consolidado gerado!');
    _atualizarContagemGerados(discId);
  } catch (e) {
    Toast.erro(e.message);
  } finally {
    _setBtnLoading(btn, false);
  }
}

// ── Painel Gerados ──────────────────────────────────────────
function _renderPainelGerados(consolidados) {
  if (consolidados.length === 0) {
    return `<div class="estado-vazio" style="padding:24px 0">
      <div class="icone" style="font-size:2rem">🗂</div>
      <p>Nenhum arquivo consolidado gerado ainda.</p>
    </div>`;
  }

  const linhas = consolidados.map(c => {
    const tamanho = _fmt_tamanho(c.tamanho_bytes);
    const badgeCls = c.tipo === 'PDF' ? 'badge-tipo-pdf' : 'badge-tipo-txt';
    return `
      <tr>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
            title="${_esc(c.nome)}">${_esc(c.nome)}</td>
        <td><span class="badge-tipo-cons ${badgeCls}">${c.tipo}</span></td>
        <td style="white-space:nowrap">${_data_curta(c.criado_em)}</td>
        <td style="white-space:nowrap">${tamanho}</td>
        <td>
          <div class="acoes-cell">
            <a class="btn btn-sm btn-secundario"
               href="/api/v1/consolidados/${_esc(c.id)}/download"
               download="${_esc(c.nome)}"
               title="Baixar arquivo">⬇</a>
            <button class="btn btn-sm btn-perigo"
              onclick="excluirConsolidado(${JSON.stringify(_esc(c.id))},${JSON.stringify(_esc(c.nome))})">
              🗑
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');

  return `
    <div style="overflow-x:auto">
      <table class="tabela-consolidados">
        <thead>
          <tr>
            <th>Nome</th><th>Tipo</th><th>Gerado em</th><th>Tamanho</th><th></th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>`;
}

// ── Helpers da consolidação ─────────────────────────────────

function _origemLabel(m) {
  if (m.tipo === 'TXT') return 'TXT Original';
  if (m.tipo === 'PDF') return 'PDF Original';
  if (m.tipo === 'VIDEO' || m.tipo === 'AUDIO') return 'Transcrição gerada';
  if (m.tipo === 'DOCUMENTO') return 'Documento convertido';
  return '';
}

function _origemClasse(m) {
  if (m.tipo === 'TXT' || m.tipo === 'PDF') return 'eleg-origem-original';
  if (m.tipo === 'VIDEO' || m.tipo === 'AUDIO') return 'eleg-origem-transcricao';
  return 'eleg-origem-convertido';
}

function _fmt_tamanho(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1024 ** 2)  return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3)  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function _exibirResultadoCons(containerId, res) {
  const el = document.getElementById(containerId);
  if (!el) return;

  let html = '';

  // Aviso de falhas parciais
  if (res.falhas && res.falhas.length > 0) {
    const itens = res.falhas.map(f => `<li><strong>${_esc(f.material)}</strong>: ${_esc(f.erro)}</li>`).join('');
    html += `
      <div class="aviso-falhas">
        <details>
          <summary>⚠ ${res.falhas.length} arquivo(s) não incluído(s) — clique para detalhes</summary>
          <ul>${itens}</ul>
        </details>
      </div>`;
  }

  // Preview TXT
  if (res.preview_txt) {
    html += `
      <p style="font-size:.8rem;color:var(--cinza-500);margin-bottom:4px">
        Prévia (primeiros 500 caracteres):
      </p>
      <pre class="preview-txt">${_esc(res.preview_txt)}</pre>`;
  }

  // Sucesso
  if (res.incluidos && res.incluidos.length > 0) {
    const tam = _fmt_tamanho(res.consolidado?.tamanho_bytes);
    html += `
      <div style="background:var(--cor-sucesso-bg);border:1px solid #bbf7d0;border-radius:var(--raio);padding:10px 14px;margin-top:10px;font-size:.82rem;color:var(--cor-sucesso)">
        ✓ ${res.incluidos.length} arquivo(s) incluído(s) · ${tam}
        <a class="btn btn-sm btn-secundario" style="margin-left:10px"
           href="/api/v1/consolidados/${_esc(res.consolidado.id)}/download"
           download="${_esc(res.consolidado.nome)}">⬇ Baixar</a>
      </div>`;
  }

  el.innerHTML = html;
}

async function _atualizarContagemGerados(discId) {
  try {
    const consolidados = await API.get(`/disciplinas/${discId}/consolidados`);
    // Atualiza a aba Gerados se estiver aberta
    const painel = document.getElementById('cons-painel-gerados');
    if (painel) painel.innerHTML = _renderPainelGerados(consolidados);
    // Atualiza o contador na aba
    const abas = document.querySelectorAll('.modal-tab-btn');
    if (abas[2]) abas[2].textContent = `📋 Gerados (${consolidados.length})`;
    // Atualiza o painel de consolidados na view principal
    const painelPrincipal = document.getElementById('painel-consolidados');
    if (painelPrincipal) {
      const { Views } = window;
      // Re-fetch the disc to get updated consolidados, but keep other elements intact
    }
  } catch (_) {}
}

function excluirConsolidado(consId, nome) {
  Modal.abrir(`
    <h2 class="modal-titulo">Excluir Consolidado</h2>
    <p>Remover <strong>${_esc(nome)}</strong>? O arquivo gerado será deletado.</p>
    <div class="modal-acoes">
      <button class="btn btn-secundario" onclick="abrirModalConsolidacao()">Cancelar</button>
      <button class="btn btn-perigo"
        onclick="confirmarExclusaoConsolidado(${JSON.stringify(consId)})">
        Excluir
      </button>
    </div>
  `);
}

async function confirmarExclusaoConsolidado(consId) {
  try {
    await API.delete(`/consolidados/${consId}`);
    Toast.sucesso('Consolidado excluído.');
    Modal.fechar();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } catch (e) {
    Toast.erro(e.message);
  }
}

function abrirModalConsolidacao() {
  if (EstadoCons.discId) novoConsolidado(EstadoCons.discId);
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
