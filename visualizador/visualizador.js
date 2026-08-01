// ═══════════════════════════════════════════════════════════════════════════
// VISUALIZADOR DE MAPAS DO POKEWG
//
// Isto e SO O DESENHO DO CENARIO, extraido do cliente do jogo (app/play/MapView.tsx).
// Nao ha combate, captura, PvP, boss, chat, montaria nem GM aqui - e proposital.
// O "boneco" na tela e uma SONDA de teste: existe so pra voce ver quem fica na
// frente e quem fica atras. Ele nao e o jogador e nao faz nada alem de andar.
//
// A matematica de posicao dos tiles e IDENTICA a do jogo. Se voce mudar o
// draworder.json e ficar certo aqui, fica certo la.
// ═══════════════════════════════════════════════════════════════════════════

// NEM A REGRA DE ORDEM NEM O LACO DE DESENHO MORAM MAIS AQUI:
//
//   ordem-de-desenho.js  a regra de QUEM COBRE QUEM (modulo puro, sem canvas)
//   cena.js              o LACO: carga, atlas, telhado escondido, canvas por andar
//
// Os dois sao compartilhados — o cliente do jogo usa a regra, e o editor de mapa
// usa o laco. Este arquivo cuida so do que e DESTA PAGINA: a sonda, o painel, o
// inspetor de tile e as propostas de reclassificacao.
import {
  TILE, IGNORE, P_SONDA,
  cena, pegaTile, classeDe, retangulo, solido,
  carregarSuporte, carregarMapa as cenaCarregarMapa,
  aplicarReclassificacao, telhadosEscondidos, invalidar,
  desenharCena, chaveDeAtor,
  desenharColisao, desenharGrade, desenharSpawns,
} from './cena.js';

const CORES = {
  top: '#58c4ff',
  toppers: '#9b7cff',
  bottom: '#ff5f5f',
  borders: '#ffb347',
  onbottom: '#ffe066',
  mid: '#7ec8a0',
};

// camera / sonda
let escala = 1.6, camX = 0, camY = 0, seguir = true;
let sonda = { x: 0, y: 0, rx: 0, ry: 0, t0: 0, dur: 0, dir: 'down' };
let atravessar = false;
const teclas = Object.create(null);

// propostas de reclassificacao (o trabalho do dev)
let propostas = new Map(); // id -> 'top' | 'bottom' | 'mid'

const tela = document.getElementById('tela');
const ctx = tela.getContext('2d');
let tileSelecionado = null;
let dbgQ = [];   // a lista de pecas do ultimo quadro, devolvida pelo motor

// ── util ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

function carregando(txt, erro) {
  const el = $('carregando');
  el.classList.toggle('on', !!txt);
  el.classList.toggle('erro', !!erro);
  $('carregando-txt').innerHTML = txt || '';
}

// candidato pelo criterio do laudo: sobe acima do proprio tile, nao e chao,
// e nao esta classificado como topo. Deveria passar na frente de quem esta atras.
function ehCandidato(id) {
  const a = cena.assets[id];
  return !!a && !a.isGround && a.height > TILE && !cena.TOP_ORIG.has(id);
}
// candidato que ainda esta como "deitado no chao" = o caso da arara da loja
function ehCritico(id) {
  return ehCandidato(id) && cena.BOT_ORIG.has(id);
}

// aplica (ou nao) as propostas por cima da classificacao original
function recalcularConjuntos() {
  aplicarReclassificacao($('c-propostas').checked ? propostas : null);
}

// ── carga de um mapa ──────────────────────────────────────────────────────
async function carregarMapa(slug) {
  let mp;
  try {
    mp = await cenaCarregarMapa(slug, carregando);
  } catch (e) {
    if (e.semAtlas) {
      carregando(
        `Nenhuma página de atlas encontrada.<br><br>Rode:<br><code>npm run fetch-assets</code>`,
        true
      );
    } else {
      carregando(
        `O mapa <b>${slug}</b> não está baixado.<br><br>` +
          `Rode no terminal:<br><code>npm run fetch-assets -- ${slug}</code><br><br>` +
          `(ou <code>npm run fetch-assets -- --todos</code> pra baixar os 325)`,
        true
      );
    }
    throw e;
  }

  // posicao inicial da sonda: o `start` do spawn-config; se for solido, o centro do walk
  let px = cena.inicio?.x ?? 0, py = cena.inicio?.y ?? 0;
  if (solido(px, py)) {
    if (cena.WALK) {
      px = Math.round((cena.WALK[0] + cena.WALK[2]) / 2);
      py = Math.round((cena.WALK[1] + cena.WALK[3]) / 2);
    }
    if (solido(px, py)) {
      busca: for (let r = 0; r < 200; r++)
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++)
            if (!solido(px + dx, py + dy)) { px += dx; py += dy; break busca; }
    }
  }
  sonda = { x: px, y: py, rx: px, ry: py, t0: 0, dur: 0, dir: 'down' };
  seguir = true;
  invalidar();

  atualizarMeta(mp);
  carregando('');
}

function atualizarMeta(mp) {
  const info = cena.indiceMapas.find((m) => m.slug === cena.slug) || {};
  const n = cena.nomes.get(cena.slug);
  $('meta-mapa').innerHTML =
    `${n ? `<b>${n.nome}</b> · ${n.area}${n.nivel ? ' · nível ' + n.nivel : ''}<br>` : ''}` +
    `${mp.tiles.length.toLocaleString('pt-BR')} tiles · groundZ ${cena.GZ} · z ${cena.minZ}–${cena.maxZ}<br>` +
    `andável ${cena.WALK ? cena.WALK.join(', ') : '—'}<br>` +
    `${cena.spawns.length} ponto(s) de spawn` +
    (info.noFloorCover ? ' · <i>sem floor-cover</i>' : '');

  // qualidade do spawn: ponto em tile bloqueado nunca nasce bicho no jogo.
  // Sao os pontos que aparecem em VERMELHO no mapa.
  const presos = cena.spawns.filter((s) => solido(s.x, s.y));
  $('aviso-spawn').innerHTML = cena.spawns.length
    ? presos.length
      ? `<span style="color:#ff6b6b">⚠ ${presos.length} de ${cena.spawns.length} spawn(s) em tile bloqueado</span> — em vermelho no mapa.`
      : `<span style="color:#7ec8a0">✓ todos os ${cena.spawns.length} spawns caem em tile andável.</span>`
    : 'Este mapa não tem arquivo de spawn (cidade / arena).';
}

// ── a sonda ───────────────────────────────────────────────────────────────
// Boneco chapado desenhado a mao (nenhum sprite do jogo). So serve pra voce ver
// quem passa na frente e quem passa atras.
function desenharSonda(fx, fy) {
  const x = fx * TILE + TILE / 2;
  const y = fy * TILE + TILE;
  ctx.save();
  // sombra no chao
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath();
  ctx.ellipse(x, y - 2, 11, 4.5, 0, 0, 7);
  ctx.fill();
  // corpo
  ctx.fillStyle = '#e8c88a';
  ctx.strokeStyle = '#2a1d08';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x - 8, y - 34, 16, 26, 5);
  ctx.fill();
  ctx.stroke();
  // cabeca
  ctx.beginPath();
  ctx.arc(x, y - 39, 7, 0, 7);
  ctx.fillStyle = '#f3ddb2';
  ctx.fill();
  ctx.stroke();
  // "olhos" indicando a direcao
  const dx = sonda.dir === 'left' ? -3 : sonda.dir === 'right' ? 3 : 0;
  const dy = sonda.dir === 'up' ? -2 : 1;
  ctx.fillStyle = '#2a1d08';
  ctx.beginPath();
  ctx.arc(x + dx - 2, y - 39 + dy, 1.3, 0, 7);
  ctx.arc(x + dx + 2, y - 39 + dy, 1.3, 0, 7);
  ctx.fill();
  ctx.restore();
}

// ── movimento da sonda ────────────────────────────────────────────────────
const MOVE_MS = 240;
function passo(agora) {
  if (sonda.dur > 0) {
    if (agora - sonda.t0 >= sonda.dur) { sonda.dur = 0; sonda.rx = sonda.x; sonda.ry = sonda.y; }
    else return;
  }
  let dx = 0, dy = 0;
  if (teclas.ArrowUp || teclas.w) dy = -1;
  else if (teclas.ArrowDown || teclas.s) dy = 1;
  else if (teclas.ArrowLeft || teclas.a) dx = -1;
  else if (teclas.ArrowRight || teclas.d) dx = 1;
  if (!dx && !dy) return;
  sonda.dir = dx < 0 ? 'left' : dx > 0 ? 'right' : dy < 0 ? 'up' : 'down';
  const nx = sonda.x + dx, ny = sonda.y + dy;
  if (!atravessar && solido(nx, ny)) return;
  sonda.rx = sonda.x;
  sonda.ry = sonda.y;
  sonda.x = nx;
  sonda.y = ny;
  sonda.t0 = agora;
  sonda.dur = teclas.Shift ? MOVE_MS / 2.2 : MOVE_MS;
  seguir = true;
}

// ── laco de desenho ───────────────────────────────────────────────────────
// O quadro inteiro do CENARIO sai de uma chamada a desenharCena(). O que sobra
// aqui e o que e da pagina: mover a sonda, seguir com a camera e pintar overlay.
let ultimoFps = 0, quadros = 0, fps = 0;

function desenhar(agora) {
  requestAnimationFrame(desenhar);
  if (!cena.slug) return;
  passo(agora);

  // posicao interpolada da sonda (desliza entre tiles)
  const k = sonda.dur > 0 ? Math.min(1, (agora - sonda.t0) / sonda.dur) : 1;
  const fx = sonda.rx + (sonda.x - sonda.rx) * k;
  const fy = sonda.ry + (sonda.y - sonda.ry) * k;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const larg = Math.round(innerWidth * dpr), alt = Math.round(innerHeight * dpr);
  if (tela.width !== larg || tela.height !== alt) {
    tela.width = larg; tela.height = alt;
    tela.style.width = innerWidth + 'px';
    tela.style.height = innerHeight + 'px';
    invalidar();
  }

  if (seguir) {
    camX = (fx + 0.5) * TILE - tela.width / (2 * escala);
    camY = (fy + 0.5) * TILE - tela.height / (2 * escala);
  }
  // snap da camera a pixel inteiro de tela: mata o tremor do nearest com zoom fracionario
  camX = Math.round(camX * escala) / escala;
  camY = Math.round(camY * escala) / escala;

  const depurar = $('c-categorias').checked || $('c-candidatos').checked;

  const q = desenharCena(ctx, tela, agora, {
    camX, camY, escala,
    esconder: telhadosEscondidos(sonda.x, sonda.y, $('c-telhado').checked),
    chaveExtra: sonda.x + ',' + sonda.y,
    depurar,
    atores: $('c-sonda').checked
      ? [{ k: chaveDeAtor(fx, fy, P_SONDA), desenhar: () => desenharSonda(fx, fy) }]
      : [],
    entreChaoEItens: $('c-colisao').checked
      ? (c, j) => desenharColisao(c, j.vx0, j.vy0, j.vx1, j.vy1)
      : null,
  });
  dbgQ = q.dbgQ;

  // ── overlays de depuracao ──
  if (depurar) desenharOverlayItens();
  if ($('c-grade').checked) desenharGrade(ctx, q.vx0, q.vy0, q.vx1, q.vy1, escala);
  if ($('c-spawns').checked) desenharSpawns(ctx, escala);
  if (tileSelecionado) desenharSelecao();

  quadros++;
  if (agora - ultimoFps > 500) { fps = Math.round((quadros * 1000) / (agora - ultimoFps)); quadros = 0; ultimoFps = agora; }
  $('hud').textContent =
    `${cena.slug}  ·  sonda ${sonda.x},${sonda.y}  ·  z ${cena.GZ}  ·  zoom ${escala.toFixed(2)}×  ·  ${fps} fps` +
    (atravessar ? '  ·  atravessando paredes' : '');
}

// ── overlays desta pagina ─────────────────────────────────────────────────
function desenharOverlayItens() {
  const porCategoria = $('c-categorias').checked;
  const soCandidatos = $('c-candidatos').checked;
  ctx.save();
  ctx.lineWidth = 1;
  for (const it of dbgQ) {
    const a = cena.assets[it.id];
    if (!a) continue;
    const cand = ehCandidato(it.id);
    if (soCandidatos && !cand) continue;
    const r = retangulo(it.id, it.tx, it.ty, it.tz, it.ex);
    if (soCandidatos) {
      const crit = ehCritico(it.id);
      ctx.strokeStyle = crit ? '#ff3b3b' : '#ff9f43';
      ctx.fillStyle = crit ? 'rgba(255,59,59,.22)' : 'rgba(255,159,67,.12)';
      ctx.lineWidth = crit ? 2 : 1;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    } else if (porCategoria) {
      const cor = propostas.has(it.id) && $('c-propostas').checked ? '#ffffff' : CORES[classeDe(it.id)];
      ctx.strokeStyle = cor;
      ctx.globalAlpha = 0.85;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = cor;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

function desenharSelecao() {
  ctx.save();
  ctx.strokeStyle = '#e8c88a';
  ctx.lineWidth = 2 / escala;
  ctx.strokeRect(tileSelecionado.x * TILE, tileSelecionado.y * TILE, TILE, TILE);
  ctx.restore();
}

// ── inspetor de tile ──────────────────────────────────────────────────────
function inspecionar(tx, ty) {
  tileSelecionado = { x: tx, y: ty };
  const alvo = $('inspetor');
  const partes = [];
  const zs = [];
  for (let z = cena.maxZ; z >= cena.minZ; z--) if (pegaTile(tx, ty, z)) zs.push(z);
  if (!zs.length) {
    alvo.innerHTML = `<div class="dica">${tx}, ${ty} — sem tile (fora do mapa).</div>`;
    return;
  }
  partes.push(`<div class="dica">tile <b>${tx}, ${ty}</b> · andares: ${zs.join(', ')} · ${solido(tx, ty) ? 'BLOQUEADO' : 'andável'}</div>`);
  for (const z of zs) {
    const t = pegaTile(tx, ty, z);
    partes.push(`<div class="dica" style="margin:6px 0 3px">z = ${z}${z === cena.GZ ? ' (chão)' : z < cena.GZ ? ' (andar acima)' : ' (subsolo)'}</div>`);
    if (t[3]) partes.push(linhaItem(t[3], true));
    for (const it of t[4] || []) partes.push(linhaItem(it[0], false));
  }
  alvo.innerHTML = partes.join('');
  for (const b of alvo.querySelectorAll('button[data-id]')) {
    b.onclick = () => {
      const id = Number(b.dataset.id);
      const para = b.dataset.para;
      if (propostas.get(id) === para) propostas.delete(id);
      else propostas.set(id, para);
      salvarPropostas();
      recalcularConjuntos();
      renderPropostas();
      inspecionar(tx, ty);
    };
  }
}

function linhaItem(id, ehChao) {
  const a = cena.assets[id];
  if (!a) return `<div class="linha"><span class="id">${id}</span><span class="dim">sem asset no manifest</span></div>`;
  const cls = classeDe(id);
  const prop = propostas.get(id);
  const cand = ehCandidato(id);
  const crit = ehCritico(id);
  const ign = IGNORE.has(id);
  return (
    `<div class="linha${ehChao ? ' chao' : ''}">` +
    `<span class="id">${id}</span>` +
    `<span class="tag" style="background:${CORES[cls]}22;color:${CORES[cls]}">${cls}</span>` +
    `<span class="dim">${a.width}×${a.height}${a.isGround ? ' chão' : ''}${cena.BLOCK.has(id) ? ' 🚧' : ''}${(cena.elev[id] || 0) ? ' elev' + cena.elev[id] : ''}${a.frameCount > 1 ? ' ▶' + a.frameCount : ''}${ign ? ' ignorado' : ''}</span>` +
    (ehChao
      ? ''
      : `<span class="acoes">` +
        `<button data-id="${id}" data-para="top" class="${prop === 'top' ? 'ativo' : ''}" title="passar a desenhar na frente de quem está atrás">top</button>` +
        `<button data-id="${id}" data-para="mid" class="${prop === 'mid' ? 'ativo' : ''}" title="objeto comum (entra na fila y-ordenada)">mid</button>` +
        `<button data-id="${id}" data-para="bottom" class="${prop === 'bottom' ? 'ativo' : ''}" title="deitado no chão, sempre atrás">bottom</button>` +
        `</span>`) +
    `</div>` +
    (crit ? `<div class="alerta">↑ candidato crítico: ${a.height}px de altura mas está em <code>${cls}</code> → nunca cobre a sonda</div>` : cand && !ehChao ? `<div class="alerta" style="color:#ffcf8b">↑ candidato: altura ${a.height}px fora de <code>top</code></div>` : '')
  );
}

// ── propostas ─────────────────────────────────────────────────────────────
const CHAVE_LS = 'pokewg-mapas:propostas';

function carregarPropostas() {
  try {
    propostas = new Map(JSON.parse(localStorage.getItem(CHAVE_LS) || '[]'));
  } catch { propostas = new Map(); }
}
function salvarPropostas() {
  localStorage.setItem(CHAVE_LS, JSON.stringify([...propostas]));
}
function renderPropostas() {
  $('n-propostas').textContent = propostas.size;
  const lista = [...propostas].sort((a, b) => a[0] - b[0]);
  $('lista-propostas').innerHTML = lista.length
    ? lista
        .map(
          ([id, para]) =>
            `<div><b>${id}</b><span class="dim">${classeDe(id)} →</span><span class="para">${para}</span><button data-rm="${id}" title="remover">✕</button></div>`
        )
        .join('')
    : '<div class="dica">Nenhuma ainda. Clique num tile e use os botões top / mid / bottom.</div>';
  for (const b of $('lista-propostas').querySelectorAll('button[data-rm]')) {
    b.onclick = () => {
      propostas.delete(Number(b.dataset.rm));
      salvarPropostas();
      recalcularConjuntos();
      renderPropostas();
    };
  }
}

// gera o draworder.json completo com as propostas aplicadas
function draworderCorrigido() {
  const novo = JSON.parse(JSON.stringify(cena.draworder));
  const listas = ['top', 'toppers', 'bottom', 'borders', 'onbottom'];
  for (const [id, para] of propostas) {
    for (const l of listas) novo[l] = (novo[l] || []).filter((v) => v !== id);
    if (para === 'top') novo.top.push(id);
    else if (para === 'bottom') novo.bottom.push(id);
    // 'mid' = fora de todas as listas
  }
  for (const l of listas) if (novo[l]) novo[l] = [...new Set(novo[l])].sort((a, b) => a - b);
  return novo;
}

function baixar(nome, texto) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texto], { type: 'application/json' }));
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// promocao em lote: todos os candidatos VISIVEIS no mapa atual que sejam 64x64 E
// bloqueiem passagem (o filtro composto que o proprio laudo recomenda pra evitar
// o falso-positivo do "sprite alto porem achatado").
function promoverEmLote() {
  const vistos = new Set();
  for (const t of cena.tileAt.values()) for (const it of t[4] || []) vistos.add(it[0]);
  let n = 0;
  for (const id of vistos) {
    const a = cena.assets[id];
    if (!a || !ehCandidato(id)) continue;
    if (a.width !== 64 || a.height !== 64 || !cena.BLOCK.has(id)) continue;
    propostas.set(id, 'top');
    n++;
  }
  salvarPropostas();
  recalcularConjuntos();
  renderPropostas();
  alert(`${n} id(s) promovido(s) para top neste mapa (64×64 + bloqueiam passagem).\n\nOlhe na tela antes de exportar.`);
}

// ── UI ────────────────────────────────────────────────────────────────────
function montarLegenda() {
  $('legenda').innerHTML =
    Object.entries(CORES)
      .map(([k, v]) => `<i style="background:${v}"></i>${k}`)
      .join('<br>') +
    `<br><i style="background:#ff3b3b"></i>candidato crítico (está em bottom)` +
    `<br><i style="background:#ff9f43"></i>candidato` +
    `<br><i style="background:#ffffff"></i>com proposta sua`;
}

function montarListaMapas() {
  const sel = $('sel-mapa');
  const porArea = new Map();
  for (const m of cena.indiceMapas) {
    const n = cena.nomes.get(m.slug);
    const area = n?.area || (m.slug.startsWith('gym_') ? 'ginásios' : 'outros');
    if (!porArea.has(area)) porArea.set(area, []);
    porArea.get(area).push(m);
  }
  sel.innerHTML = [...porArea]
    .sort()
    .map(
      ([area, ms]) =>
        `<optgroup label="${area} (${ms.length})">` +
        ms
          .map((m) => {
            const n = cena.nomes.get(m.slug);
            return `<option value="${m.slug}">${n ? n.nome : m.slug}${n && n.nome.toLowerCase() !== m.slug ? ' — ' + m.slug : ''}</option>`;
          })
          .join('') +
        `</optgroup>`
    )
    .join('');
}

function ligarEventos() {
  $('sel-mapa').onchange = async (e) => {
    try {
      await carregarMapa(e.target.value);
      localStorage.setItem('pokewg-mapas:ultimo', e.target.value);
    } catch { /* mensagem ja mostrada */ }
  };

  for (const id of ['c-sonda', 'c-telhado', 'c-spawns', 'c-grade', 'c-colisao', 'c-categorias', 'c-candidatos']) {
    $(id).onchange = () => { invalidar(); };
  }
  $('c-propostas').onchange = () => recalcularConjuntos();

  // pula a sonda de um ponto de spawn pro proximo (pra revisar posicionamento)
  let iSpawn = 0;
  $('btn-spawn').onclick = () => {
    if (!cena.spawns.length) return alert('Este mapa não tem pontos de spawn.');
    const s = cena.spawns[iSpawn % cena.spawns.length];
    iSpawn++;
    sonda = { x: s.x, y: s.y, rx: s.x, ry: s.y, t0: 0, dur: 0, dir: 'down' };
    seguir = true;
    invalidar();
    tileSelecionado = { x: s.x, y: s.y };
    inspecionar(s.x, s.y);
  };

  $('btn-lote').onclick = promoverEmLote;
  $('btn-exportar').onclick = () => {
    if (!propostas.size) return alert('Nenhuma proposta pra exportar.');
    baixar('draworder.json', JSON.stringify(draworderCorrigido()));
  };
  $('btn-patch').onclick = () => {
    if (!propostas.size) return alert('Nenhuma proposta pra exportar.');
    baixar(
      'propostas.json',
      JSON.stringify(
        {
          gerado: new Date().toISOString(),
          mapaDeReferencia: cena.slug,
          mudancas: [...propostas].sort((a, b) => a[0] - b[0]).map(([id, para]) => ({
            id,
            de: classeDe(id),
            para,
            tamanho: cena.assets[id] ? cena.assets[id].width + 'x' + cena.assets[id].height : null,
            bloqueia: cena.BLOCK.has(id),
          })),
        },
        null,
        1
      )
    );
  };
  $('btn-limpar').onclick = () => {
    if (propostas.size && !confirm(`Apagar as ${propostas.size} propostas?`)) return;
    propostas.clear();
    salvarPropostas();
    recalcularConjuntos();
    renderPropostas();
  };
  $('btn-recolher').onclick = () => $('painel').classList.toggle('recolhido');

  // teclado
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    teclas[e.key] = true;
    teclas[e.key.toLowerCase()] = true;
    if (e.key === 'c' || e.key === 'C') seguir = true;
    if (e.key === 'n' || e.key === 'N') atravessar = !atravessar;
    if (e.key === 'p' || e.key === 'P') $('painel').classList.toggle('recolhido');
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  });
  addEventListener('keyup', (e) => { teclas[e.key] = false; teclas[e.key.toLowerCase()] = false; });
  addEventListener('blur', () => { for (const k in teclas) teclas[k] = false; });

  // arrastar = mover camera livre; clique curto = inspecionar
  let arrastando = false, movido = 0, ax = 0, ay = 0;
  tela.addEventListener('pointerdown', (e) => {
    arrastando = true;
    movido = 0;
    ax = e.clientX;
    ay = e.clientY;
    tela.classList.add('arrastando');
    tela.setPointerCapture(e.pointerId);
  });
  tela.addEventListener('pointermove', (e) => {
    if (!arrastando) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const dx = (e.clientX - ax) * dpr, dy = (e.clientY - ay) * dpr;
    movido += Math.abs(dx) + Math.abs(dy);
    if (movido > 4) {
      seguir = false;
      camX -= dx / escala;
      camY -= dy / escala;
      ax = e.clientX;
      ay = e.clientY;
    }
  });
  tela.addEventListener('pointerup', (e) => {
    tela.classList.remove('arrastando');
    if (arrastando && movido <= 4) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const wx = (e.clientX * dpr) / escala + camX;
      const wy = (e.clientY * dpr) / escala + camY;
      inspecionar(Math.floor(wx / TILE), Math.floor(wy / TILE));
    }
    arrastando = false;
  });
  tela.addEventListener('wheel', (e) => {
    e.preventDefault();
    escala = Math.max(0.4, Math.min(4, escala - e.deltaY * 0.0016));
    invalidar();
  }, { passive: false });
}

// ── inicio ────────────────────────────────────────────────────────────────
(async function principal() {
  try {
    carregarPropostas();
    await carregarSuporte(carregando);
    recalcularConjuntos();
    montarLegenda();
    montarListaMapas();
    ligarEventos();
    renderPropostas();

    // escolhe o mapa: o ultimo usado, senao cerulean (o do laudo), senao o 1o baixado
    const salvo = localStorage.getItem('pokewg-mapas:ultimo');
    const tentativas = [salvo, 'cerulean', cena.indiceMapas[0]?.slug].filter(Boolean);
    for (const slug of tentativas) {
      try {
        $('sel-mapa').value = slug;
        await carregarMapa(slug);
        break;
      } catch { /* tenta o proximo */ }
    }
    requestAnimationFrame(desenhar);
  } catch (e) {
    console.error(e);
    carregando(
      `Falhou ao carregar os dados.<br><br><code>${e.message}</code><br><br>` +
        `Se for 404, provavelmente falta baixar:<br><code>npm run fetch-assets</code>`,
      true
    );
  }
})();
