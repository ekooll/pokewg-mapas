// ═══════════════════════════════════════════════════════════════════════════
// CENA — o motor de desenho do cenário, sem UI.
//
// Isto é o LAÇO DE DESENHO extraído do visualizador (que por sua vez saiu do
// cliente do jogo, app/play/MapView.tsx): carregar dado, decodificar atlas,
// esconder telhado, e pintar um canvas por andar na ordem certa.
//
// POR QUE ESTE ARQUIVO EXISTE. A regra de QUEM COBRE QUEM já mora num módulo
// puro (`ordem-de-desenho.js`), justamente para não haver duas cópias dela. Mas
// a regra sozinha não desenha nada: o que faz o telhado ficar inteiro é o LAÇO —
// um andar de cada vez, banda chão na varredura, banda item ordenada, os andares
// de cima colados por último. Enquanto esse laço vivia dentro do visualizador,
// qualquer outra ferramenta (o editor de mapa) tinha que copiá-lo — e a cópia
// envelhece. Já envelheceu: o editor antigo ainda somava `elev + ex` (a peça se
// levantava sozinha) e ordenava só por `ty`. O que se montava lá não era o que o
// jogo desenhava.
//
// Quem usa isto: `visualizador.js` (a sonda e o painel de propostas) e o editor
// de mapa. Nenhum dos dois reimplementa desenho.
//
// NÃO HÁ DOM AQUI ALÉM DO CANVAS. Nada de `document.getElementById`: o que era
// leitura de checkbox virou campo do objeto de opções. Quem tem checkbox é a
// página, não o motor.
// ═══════════════════════════════════════════════════════════════════════════
import {
  TILE, IGNORE, P_SONDA, SALTO_ITEM,
  profundidade, emitirTile,
} from './ordem-de-desenho.js';

export { TILE, IGNORE, P_SONDA, SALTO_ITEM, profundidade, emitirTile };

// ═══ ORDEM DE DESENHO ═══════════════════════════════════════════════════════
// Cada ANDAR z e desenhado inteiro, do mais fundo (maxZ) pro mais alto (minZ).
// Um andar tem duas bandas:
//
//   CHAO  (o campo chao + tudo que esta em BOTTOM)
//         pintada na ordem de VARREDURA, no fundo do andar. Nao e ordenada de
//         proposito — ver o comentario em desenharTile().
//   ITEM  (mid e top) + os atores (sonda, boneco do editor)
//         ordenada por  chave = profundidade(tx,ty) + prioridade + SALTO_ITEM
//
// O SALTO_ITEM poe a banda item inteira acima da banda chao do MESMO andar, sem
// disputa por y. Prioridade dentro da banda item:
//   objeto comum 0.3  <  sonda 0.4  <  topo (telhado/copa) 0.6
//
// O 0.4 da SONDA veio junto com a formula nova de profundidade, copiado do
// P_CRIATURA do PIW — antes era 0.5. Medido no PWG antes de ficar
// (ferramentas/mede-sonda.py), porque numero emprestado de outro jogo nao vale
// como verdade aqui: os dois valores caem no intervalo aberto (0.3, 0.6), e a
// chave de item so sobe de 0,001 em 0,001 dentro do tile, entao so um tile com
// mais de 100 pecas conseguiria cair entre 0.4 e 0.5. A maior pilha dos 330
// mapas publicados tem 33 pecas (cerulean, tile -45,8,7), em 8.188.199 tiles.
// 0.4 e 0.5 dao a MESMA ordem em todo o jogo — o 0.4 nao muda pixel, so alinha
// o nome do numero com o do PIW.

// A profundidade usa as DUAS coordenadas. O andar de cima e desenhado deslocado
// em x E y (fo = (z-GZ)*32 nas duas), entao a profundidade tem que andar na mesma
// diagonal — ordenar so por y deixa a parede do fundo cobrir a peca da frente.
// O 4*tx e o desempate lateral; 4096 e' folga pra ele nunca alcancar a linha
// seguinte.

// ── estado ────────────────────────────────────────────────────────────────
// UM objeto vivo, exportado. Quem consome lê `cena.GZ`, `cena.assets`, etc. —
// nunca guarda cópia dos conjuntos (TOP/BOTTOM são TROCADOS por
// `aplicarReclassificacao()`, não mutados).
export const cena = {
  base: '',               // prefixo das URLs de dado (o editor pode montar noutro caminho)

  assets: {},             // manifest.assets: id -> { width, height, isGround, frameCount, frames[] }
  paginas: [],            // manifest.categories['map-items'].pages
  disp: {},               // offsets.disp: id -> [dx, dy]  (deslocamento de desenho do sprite)
  elev: {},               // offsets.elev: id -> px        (altura que o item empilha)
  draworder: null,        // arquivo cru (usado no export do visualizador)
  CLASSE: new Map(),      // id -> 'top'|'toppers'|'bottom'|'borders'|'onbottom'
  TOP_ORIG: new Set(),    // top + toppers
  BOT_ORIG: new Set(),    // bottom + borders + onbottom
  BORDERS: new Set(),     // so borders — decide quem achata na banda de baixo
  TOP: new Set(),         // efetivos = originais + reclassificacoes aplicadas
  BOTTOM: new Set(),
  BLOCK: new Set(),       // collision.blocking
  TABELA: {},             // o que ordem-de-desenho.js precisa

  indiceMapas: [],        // dados/maps-index.json
  nomes: new Map(),       // slug -> { nome, area, nivel } (de map-markers.json)

  slug: null,
  mapa: null,             // o JSON cru do mapa (o editor edita ISTO)
  tileAt: new Map(),      // "x,y,z" -> tile
  shadowMap: new Map(),   // "x,y" (chao coberto) -> tiles de telhado que o cobrem
  GZ: 7, minZ: 0, maxZ: 11,
  minX: 0, minY: 0, maxX: 0, maxY: 0,
  NOCOVER: false,         // _meta.noFloorCover: mapa que nunca esconde telhado
  WALK: null,             // _meta.walk = [minX, minY, maxX, maxY] andavel
  spawns: [],             // pontos de spawn do dados/spawns/<slug>.json
  inicio: null,           // spawn.start
  paginasImg: new Map(),  // indice da pagina -> canvas ja decodificado
};

let esconderCache = { x: NaN, y: NaN, ligado: null, set: new Set() };

// ── util ──────────────────────────────────────────────────────────────────
export const chave3 = (x, y, z) => x + ',' + y + ',' + z;
export const pegaTile = (x, y, z) => cena.tileAt.get(chave3(x, y, z));

async function json(url) {
  const r = await fetch(cena.base + url);
  if (!r.ok) throw Object.assign(new Error(`${r.status} em ${url}`), { status: r.status, url });
  return r.json();
}

export function classeDe(id) {
  return cena.CLASSE.get(id) || 'mid';
}

// O que o modulo de ordem precisa. Sao referencias vivas: TOP e BOTTOM sao
// trocados por aplicarReclassificacao() quando as propostas mudam, entao a tabela
// e' remontada la. Nao guarde copias disto.
function montarTabela() {
  cena.TABELA = {
    assets: cena.assets, TOP: cena.TOP, BOTTOM: cena.BOTTOM, BORDERS: cena.BORDERS,
    BLOCK: cena.BLOCK, elev: cena.elev, disp: cena.disp,
  };
}

// ── carga dos arquivos de suporte ─────────────────────────────────────────
export async function carregarSuporte(aviso = () => {}) {
  aviso('Carregando manifest, draworder, offsets e colisão…');
  const [mf, of_, dr, co, idx] = await Promise.all([
    json('/dados/map/manifest.json'),
    json('/dados/map/offsets.json'),
    json('/dados/map/draworder.json'),
    json('/dados/map/collision.json'),
    json('/dados/maps-index.json'),
  ]);
  const mk = await json('/dados/map-markers.json').catch(() => ({ hunts: [] }));

  cena.assets = mf.assets;
  cena.paginas = Object.values(mf.categories)[0].pages;
  cena.disp = of_.disp || {};
  cena.elev = of_.elev || {};
  cena.draworder = dr;
  cena.BLOCK = new Set(co.blocking || []);
  cena.indiceMapas = idx;
  for (const h of mk.hunts || []) cena.nomes.set(h.slug, { nome: h.name, area: h.area, nivel: h.level });

  // prioridade top > toppers > bottom > borders > onbottom (um id pode estar em mais de uma lista)
  cena.CLASSE = new Map();
  for (const nome of ['top', 'toppers', 'bottom', 'borders', 'onbottom']) {
    for (const id of dr[nome] || []) if (!cena.CLASSE.has(id)) cena.CLASSE.set(id, nome);
  }
  cena.TOP_ORIG = new Set([...(dr.top || []), ...(dr.toppers || [])]);
  cena.BOT_ORIG = new Set([...(dr.bottom || []), ...(dr.borders || []), ...(dr.onbottom || [])]);
  cena.BORDERS = new Set(dr.borders || []);
  aplicarReclassificacao();
}

/**
 * Reaplica a classificação original mais as mudanças propostas por quem usa.
 * `mudancas` é um Map id -> 'top' | 'bottom' | 'mid'; sem argumento, volta ao
 * draworder cru. Invalida o offscreen — os andares precisam ser repintados.
 */
export function aplicarReclassificacao(mudancas = null) {
  cena.TOP = new Set(cena.TOP_ORIG);
  cena.BOTTOM = new Set(cena.BOT_ORIG);
  if (mudancas) {
    for (const [id, para] of mudancas) {
      cena.TOP.delete(id);
      cena.BOTTOM.delete(id);
      if (para === 'top') cena.TOP.add(id);
      else if (para === 'bottom') cena.BOTTOM.add(id);
    }
  }
  montarTabela();  // TOP/BOTTOM sao objetos novos — a tabela do modulo aponta pros antigos
  invalidar();     // invalida o offscreen
}

// ── carga de um mapa ──────────────────────────────────────────────────────
export async function carregarMapa(slug, aviso = () => {}) {
  aviso(`Carregando <b>${slug}</b>…`);
  const mp = await json('/dados/map/' + slug + '.json');
  adotarMapa(slug, mp);

  // spawns (arquivo separado; cidade nao tem)
  cena.spawns = [];
  cena.inicio = null;
  try {
    const sp = await json('/dados/spawns/' + slug + '.json');
    cena.spawns = sp.spawns || [];
    cena.inicio = sp.start || null;
  } catch { /* mapa sem config de spawn */ }

  aviso(`Carregando sprites de <b>${slug}</b>…`);
  const { usadas, faltando } = await carregarAtlasDoMapa(mp);
  // NENHUMA pagina carregou = o atlas nao foi baixado. Falhar aqui e melhor que
  // desenhar um mapa vazio e deixar a pessoa procurando defeito no mapa.
  if (usadas && faltando.length === usadas) {
    throw Object.assign(new Error('sem atlas'), { semAtlas: true });
  }
  aviso('');
  return mp;
}

/**
 * Indexa um mapa JÁ CARREGADO (o editor cria mapa novo em memória, sem fetch).
 * Depois de mexer nos tiles, chame `reindexar()`.
 */
export function adotarMapa(slug, mp) {
  cena.slug = slug;
  cena.mapa = mp;
  cena.GZ = mp._meta?.groundZ ?? 7;
  cena.NOCOVER = !!mp._meta?.noFloorCover;
  cena.WALK = Array.isArray(mp._meta?.walk) ? mp._meta.walk : null;
  reindexar();
}

/**
 * Reconstrói os índices a partir de `cena.mapa.tiles`. É a única porta de
 * entrada depois de uma edição: mexeu no tile, chame isto (ou `tocarTile`).
 */
export function reindexar() {
  const mp = cena.mapa;
  cena.tileAt = new Map();
  const zs = new Set();
  cena.minX = cena.minY = cena.maxX = cena.maxY = 0;
  for (const t of mp.tiles) {
    cena.tileAt.set(chave3(t[0], t[1], t[2]), t);
    zs.add(t[2]);
    if (t[0] < cena.minX) cena.minX = t[0];
    if (t[1] < cena.minY) cena.minY = t[1];
    if (t[0] > cena.maxX) cena.maxX = t[0];
    if (t[1] > cena.maxY) cena.maxY = t[1];
  }
  cena.minZ = Math.min(...zs);
  cena.maxZ = Math.max(...zs);

  // shadowMap do floor-cover: um telhado em z<GZ e desenhado deslocado (GZ-z) tiles
  // pra cima-esquerda, entao ele "cobre" o chao em (x-(GZ-z), y-(GZ-z)).
  cena.shadowMap = new Map();
  for (const t of mp.tiles) {
    const z = t[2];
    if (z < cena.GZ && t[3]) {
      const k = t[0] - (cena.GZ - z) + ',' + (t[1] - (cena.GZ - z));
      let a = cena.shadowMap.get(k);
      if (!a) cena.shadowMap.set(k, (a = []));
      a.push(t);
    }
  }
  esconderCache = { x: NaN, y: NaN, ligado: null, set: new Set() };
  invalidar();
}

// pre-carrega as paginas de atlas usadas por este mapa (senao os tiles "piscam")
export async function carregarAtlasDoMapa(mp) {
  const usadas = new Set();
  for (const t of mp.tiles) {
    const a0 = cena.assets[t[3]];
    if (a0) for (const f of a0.frames) usadas.add(f.page);
    for (const it of t[4] || []) {
      const a = cena.assets[it[0]];
      if (a) for (const f of a.frames) usadas.add(f.page);
    }
  }
  const faltando = await carregarPaginas([...usadas]);
  return { usadas: usadas.size, faltando };
}

/** Garante que estas páginas de atlas estão decodificadas. Devolve as que faltaram. */
export async function carregarPaginas(indices) {
  const faltando = [];
  await Promise.all(
    indices.map(
      (i) =>
        new Promise((ok) => {
          if (cena.paginasImg.has(i)) return ok();
          const im = new Image();
          im.onload = () => { cena.paginasImg.set(i, paraCanvas(im)); ok(); };
          im.onerror = () => { faltando.push(cena.paginas[i].image.split('/').pop()); ok(); };
          im.src = cena.base + '/dados/atlas/' + cena.paginas[i].image.split('/').pop();
        })
    )
  );
  return faltando;
}

// webp/png decodificado 1x pra canvas: drawImage direto do <img> re-decodifica em
// alguns navegadores e engasga o frame (mesmo motivo do cliente).
function paraCanvas(im) {
  const c = document.createElement('canvas');
  c.width = im.naturalWidth;
  c.height = im.naturalHeight;
  c.getContext('2d').drawImage(im, 0, 0);
  return c;
}

// ── colisao ───────────────────────────────────────────────────────────────
export function solido(x, y) {
  if (cena.WALK && (x < cena.WALK[0] || y < cena.WALK[1] || x > cena.WALK[2] || y > cena.WALK[3])) return true;
  const t = pegaTile(x, y, cena.GZ);
  if (!t) return true;
  if (cena.BLOCK.has(t[3])) return true;
  for (const it of t[4] || []) if (cena.BLOCK.has(it[0])) return true;
  return false;
}

// telhados a esconder: SO os do predio em que o ator esta (flood-fill da sombra
// conectada). Vazio = nao esconde nada (ator na rua).
export function telhadosEscondidos(px, py, ligado = true) {
  if (esconderCache.x === px && esconderCache.y === py && esconderCache.ligado === ligado) return esconderCache.set;
  const esconder = new Set();
  if (!cena.NOCOVER && ligado && cena.shadowMap.has(px + ',' + py)) {
    const visto = new Set([px + ',' + py]);
    const pilha = [[px, py]];
    while (pilha.length) {
      const [x, y] = pilha.pop();
      for (const rt of cena.shadowMap.get(x + ',' + y) || []) esconder.add(chave3(rt[0], rt[1], rt[2]));
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        const nk = nx + ',' + ny;
        if (!visto.has(nk) && cena.shadowMap.has(nk)) { visto.add(nk); pilha.push([nx, ny]); }
      }
    }
  }
  esconderCache = { x: px, y: py, ligado, set: esconder };
  return esconder;
}

// ── desenho de um sprite ──────────────────────────────────────────────────
// A conta de posicao e IDENTICA a do cliente:
//   fo = (z - groundZ) * 32           -> andar acima do chao sobe/esquerda 1 tile por andar
//   dx = x*32 - (largura - 32) - disp[0] + fo
//   dy = y*32 - (altura  - 32) - disp[1] - (elev + empilhamento) + fo
export function retangulo(id, tx, ty, tz, ex) {
  const a = cena.assets[id];
  const d = cena.disp[id] || [0, 0];
  const fo = (tz - cena.GZ) * TILE;
  return {
    x: tx * TILE - (a.width - TILE) - d[0] + fo,
    // `ex` e a elevacao ACUMULADA das pecas desenhadas ANTES desta no tile. A
    // elevacao da PROPRIA peca nao levanta ela — so as que vierem depois.
    // Era `((elev[id]||0) + ex)`, que levantava a peca por ela mesma. No PIW,
    // placeSprite() recebe o acumulado e DEVOLVE a elevacao propria, e o
    // chamador soma depois: `r = min(32, r + placeSprite(d,n,i,a,r,x,t))`.
    // Com a formula antiga a mesa de 4 tiles do saguao do Centro Pokemon saia
    // com degrau: coluna esquerda (18273/18259, elev 6) 6px acima da direita
    // (18272/18260, elev 0). No jogo ao vivo ela e lisa.
    y: ty * TILE - (a.height - TILE) - d[1] - ex + fo,
    w: a.width,
    h: a.height,
  };
}

function quadro(a, agora, congelar) {
  return !congelar && a.frameCount > 1
    ? a.frames[Math.floor(agora / (a.frameDurationMs || 500)) % a.frameCount]
    : a.frames[0];
}

// desenha no CANVAS DO ANDAR. `destino` e o contexto do andar do tile — quem
// chama ja sabe em qual andar esta desenhando.
function blit(id, tx, ty, tz, ex, agora, congelar, destino) {
  if (!id || IGNORE.has(id)) return;
  const a = cena.assets[id];
  if (!a) return;
  const f = quadro(a, agora, congelar);
  const pg = cena.paginasImg.get(f.page);
  if (!pg) return;
  const r = retangulo(id, tx, ty, tz, ex);
  destino.drawImage(pg, f.x, f.y, f.w, f.h, r.x, r.y, f.w, f.h);
}

// espelho do blit desenhando DIRETO NA TELA — usado por quem entra na fila
// ordenada junto com os atores (objetos e topos)
function blitTela(ctx, id, tx, ty, tz, ex, agora) {
  if (!id || IGNORE.has(id)) return;
  const a = cena.assets[id];
  if (!a) return;
  const f = quadro(a, agora, false);
  const pg = cena.paginasImg.get(f.page);
  if (!pg) return;
  const r = retangulo(id, tx, ty, tz, ex);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(pg, f.x, f.y, f.w, f.h, r.x, r.y, f.w, f.h);
  ctx.imageSmoothingEnabled = false;
}

// ── UM OFFSCREEN POR ANDAR ────────────────────────────────────────────────
// Antes era um offscreen achatado com tudo dentro, mais uma fila global por y.
// Isso fazia a parede interna do terreo (y alto) desenhar por cima do telhado
// do andar de cima (y baixo): o interior do predio vazava pra laje.
//
// Agora cada andar tem o seu, colado na ordem do andar. Quem esta num andar mais
// alto NUNCA perde pra quem esta num andar mais baixo, independente de y — que e
// o unico jeito de o telhado ficar inteiro.
//
// O QUE PRECISA SER POR ANDAR E A ORDEM DE PINTURA, NAO O CANVAS.
// Colar N canvas em sequencia da exatamente o mesmo pixel que pintar os N, na
// mesma sequencia, dentro de um so. Entao continuam sendo DOIS offscreens, como
// ja eram — o que muda e o que entra em cada um e em que ordem:
//
//   mapCv  andares z >= GZ (subsolo e o chao), do mais fundo pro chao
//   topCv  andares z <  GZ (os pavimentos de cima), do mais baixo pro mais alto
//
// Dentro de CADA andar: primeiro a banda chao (ordem de varredura), depois a
// banda item (ordenada por profundidade). E por isso que a laje do andar de cima
// para de ser furada pela parede do terreo.
//
// Medido nos 325 mapas: uma janela chega a tocar 15 andares. Um canvas por andar
// seria 15 canvas de tela cheia — por isso dois, com a ordem certa dentro.
const mapCv = document.createElement('canvas');
const mctx = mapCv.getContext('2d');
const topCv = document.createElement('canvas');
const tctx = topCv.getContext('2d');
let chaveCache = '', mapOx = 0, mapOy = 0;
let objQ = [];  // banda ITEM do andar do chao: fila viva, desenhada junto com os atores
let itemQ = new Map(); // z -> banda ITEM dos demais andares
let dbgQ = [];  // mesma lista, mas com TUDO (inclusive chao/bottom), so pros overlays

/** Descarta os andares já pintados. Chame depois de qualquer edição no mapa. */
export function invalidar() {
  chaveCache = '';
}

// ── AS DUAS BANDAS DE UM ANDAR ────────────────────────────────────────────
// chao + BOTTOM  -> banda CHAO: pintada na ordem de varredura, no fundo do andar
// mid (0.3) e top (0.6) -> banda ITEM: ordenada por profundidade + prioridade
//
// Consequencia: qualquer id que esteja em bottom/borders/onbottom NUNCA cobre o
// ator, por mais alto que o sprite seja. E exatamente por isso que reclassificar
// os ids da lista de oclusao resolve a arara da loja de roupas, a arvore e o
// balcao - sem tocar em uma linha de codigo.
//
// A banda CHAO fica em ordem de VARREDURA de proposito, nao ordenada por
// profundidade. Peca larga de terreno (mancha de terra, transicao de grama) e
// desenhada a partir do canto superior-esquerdo dela; ordenar a banda chao por
// profundidade faz o capim do tile seguinte cobri-la. Medido no cerulean: 4.273
// pixels de terreno errado, e zero ganho de oclusao.
function desenharTile(t, agora, depurar, dest) {
  const tx = t[0], ty = t[1], tz = t[2];

  // A REGRA DE ORDEM VIVE EM ordem-de-desenho.js, nao aqui. Este arquivo so
  // decide ONDE pintar (canvas do andar x fila viva) e COMO (blit). O motivo de
  // a regra estar num modulo puro e' que o cliente do jogo
  // (app/play/MapView.tsx) precisa da MESMA regra — duas copias divergem, e
  // divergencia entre implementacoes ja custou um dia inteiro neste projeto.
  // banda ITEM. O andar do CHAO manda pra fila viva (objQ), que e desenhada na
  // tela junto com os atores; os outros andares mandam pra fila do proprio andar,
  // que e desenhada no canvas do andar.
  //
  // O subsolo (tz > GZ) tambem entra na fila do proprio andar. Ele nao vaza por
  // cima da rua porque o canvas dele e colado ANTES do canvas do chao — nao
  // porque ele fica fora da ordenacao.
  const naTela = tz === cena.GZ;
  let fila = objQ;
  if (!naTela) {
    fila = itemQ.get(tz);
    if (!fila) { fila = []; itemQ.set(tz, fila); }
  }

  emitirTile(t, cena.TABELA, (id, chao, p, ex, k) => {
    if (chao) {
      blit(id, tx, ty, tz, ex, agora, true, dest);
      if (depurar) dbgQ.push({ id, tx, ty, tz, ex, banda: 'chao' });
    } else {
      fila.push({ k, id, tx, ty, tz, ex });
      if (depurar) dbgQ.push({ id, tx, ty, tz, ex, banda: naTela ? 'fila' : 'andar' });
    }
  });
}

/**
 * O LAÇO DE DESENHO. Uma chamada pinta o quadro inteiro no `ctx` da tela.
 *
 * @param ctx    contexto 2d da tela
 * @param tela   o <canvas> (só para largura/altura em pixel de dispositivo)
 * @param agora  o timestamp do requestAnimationFrame (move as peças animadas)
 * @param op     {
 *   camX, camY, escala,        // câmera, em pixel de mundo
 *   esconder,                  // Set de chave3 — telhados a pular (telhadosEscondidos)
 *   depurar,                   // acumula dbgQ (custa; só quando um overlay usa)
 *   andarVisivel(z),           // opcional: false esconde o andar inteiro (camadas do editor)
 *   atores: [{ k, desenhar(ctx) }],   // entram na fila do andar do chão, ordenados por k
 *   entreChaoEItens(ctx),      // gancho: pintado depois do chão e antes da fila (colisão)
 * }
 * @returns { objQ, dbgQ, vx0, vy0, vx1, vy1 } — a janela em tiles e as filas do
 *          quadro, para quem quiser desenhar overlay por cima.
 */
export function desenharCena(ctx, tela, agora, op) {
  const { camX, camY, escala } = op;
  const esconder = op.esconder || new Set();
  const depurar = !!op.depurar;
  const andarVisivel = op.andarVisivel || (() => true);

  const vx0 = Math.floor(camX / TILE) - 2, vx1 = Math.ceil((camX + tela.width / escala) / TILE) + 2;
  const vy0 = Math.floor(camY / TILE) - 2, vy1 = Math.ceil((camY + tela.height / escala) / TILE) + 4;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, tela.width, tela.height);
  ctx.fillStyle = op.fundo || '#080c11';
  ctx.fillRect(0, 0, tela.width, tela.height);

  // ── FASE 1: um canvas por andar (escala 1, nitido) — so quando precisa ──
  const ox = vx0 * TILE, oy = vy0 * TILE;
  const cols = (vx1 - vx0 + 1) * TILE, linhas = (vy1 - vy0 + 1) * TILE;
  const chave = [vx0, vy0, vx1, vy1, op.chaveExtra ?? '', Math.floor(agora / 250), depurar].join(',');
  if (chave !== chaveCache) {
    for (const cv of [mapCv, topCv]) {
      if (cv.width !== cols) cv.width = cols;
      if (cv.height !== linhas) cv.height = linhas;
    }
    for (const c of [mctx, tctx]) {
      c.setTransform(1, 0, 0, 1, -ox, -oy);
      c.imageSmoothingEnabled = false;
      c.clearRect(ox, oy, cols, linhas);
    }
    objQ = [];
    itemQ = new Map();
    dbgQ = [];
    // span = andares acima do chao. Os telhados desses andares sao desenhados
    // deslocados pra cima-esquerda, entao iteramos tiles EXTRAS a baixo-direita
    // pra eles entrarem na janela.
    const span = Math.max(0, cena.GZ - cena.minZ);

    // UM ANDAR DE CADA VEZ, do mais fundo pro mais alto. Dentro do andar: a banda
    // chao na varredura, depois a banda item ordenada. Terminar o andar antes de
    // comecar o proximo e o que impede a parede do terreo de furar a laje de cima.
    for (let z = cena.maxZ; z >= cena.minZ; z--) {
      if (!andarVisivel(z)) continue;
      const dest = z < cena.GZ ? tctx : mctx;
      let temAlgo = false;
      for (let y = vy0; y <= vy1 + span; y++)
        for (let x = vx0; x <= vx1 + span; x++) {
          const t = pegaTile(x, y, z);
          if (!t) continue;
          if (z < cena.GZ && esconder.has(chave3(x, y, z))) continue; // telhado do predio do ator
          desenharTile(t, agora, depurar, dest);
          temAlgo = true;
        }
      if (!temAlgo) continue;
      // a banda item DESTE andar. O andar do chao e a excecao: a banda item dele
      // e a objQ, desenhada viva na FASE 3 pra intercalar com os atores.
      const lista = itemQ.get(z);
      if (!lista) continue;
      lista.sort((a, b) => a.k - b.k);
      for (const it of lista) blit(it.id, it.tx, it.ty, it.tz, it.ex, agora, false, dest);
    }

    chaveCache = chave;
    mapOx = ox;
    mapOy = oy;
  }

  // ── FASE 2: subsolo + andar do chao ──
  // O subsolo nao vaza por cima da rua porque foi pintado ANTES do chao no mesmo
  // canvas, nao porque ficou fora da ordenacao.
  ctx.setTransform(escala, 0, 0, escala, -camX * escala, -camY * escala);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(mapCv, mapOx, mapOy);

  // colisao vem logo depois do chao: objetos e atores desenham por cima
  if (op.entreChaoEItens) op.entreChaoEItens(ctx, { vx0, vy0, vx1, vy1 });

  // ── FASE 3: a banda ITEM do andar do chao + os atores ──
  ctx.imageSmoothingEnabled = false;
  const fila = [];
  for (const it of objQ) fila.push({ k: it.k, fn: () => blitTela(ctx, it.id, it.tx, it.ty, it.tz, it.ex, agora) });
  for (const a of op.atores || []) fila.push({ k: a.k, fn: () => a.desenhar(ctx) });
  fila.sort((a, b) => a.k - b.k).forEach((r) => r.fn());

  // ── FASE 3.5: os andares ACIMA do chao, por cima da fila ──
  // E aqui que o predio ganha a disputa contra o personagem: quem passa atras de
  // uma parede some, e o telhado cobre o interior visto de fora. Os telhados do
  // predio onde o ator esta ja ficaram de fora, porque o laco da FASE 1 pula
  // esses tiles (telhadosEscondidos).
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(topCv, mapOx, mapOy);
  ctx.imageSmoothingEnabled = false;

  return { objQ, dbgQ, vx0, vy0, vx1, vy1 };
}

/**
 * A chave de fila de um ator que anda em fração de tile (sonda, boneco, NPC).
 * A profundidade usa o tile INTEIRO em que ele está pisando, senão ele pisca de
 * banda no meio do passo.
 */
export function chaveDeAtor(fx, fy, p = P_SONDA) {
  return SALTO_ITEM + profundidade(Math.round(fx), Math.floor(fy + 1.5 - 0.64)) + p;
}

// ── overlays de mundo ─────────────────────────────────────────────────────
// Desenham no MESMO transform da cena (pixel de mundo). Servem tanto ao
// visualizador quanto ao editor — por isso moram aqui e não na página.
export function desenharColisao(ctx, vx0, vy0, vx1, vy1) {
  ctx.save();
  for (let y = vy0; y <= vy1; y++)
    for (let x = vx0; x <= vx1; x++) {
      if (!solido(x, y)) continue;
      const semChao = !pegaTile(x, y, cena.GZ);
      ctx.fillStyle = semChao ? 'rgba(20,20,30,.55)' : 'rgba(255,60,60,.28)';
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    }
  ctx.restore();
}

export function desenharGrade(ctx, vx0, vy0, vx1, vy1, escala) {
  ctx.save();
  ctx.strokeStyle = 'rgba(120,160,200,.18)';
  ctx.lineWidth = 1 / escala;
  ctx.beginPath();
  for (let x = vx0; x <= vx1; x++) { ctx.moveTo(x * TILE, vy0 * TILE); ctx.lineTo(x * TILE, vy1 * TILE); }
  for (let y = vy0; y <= vy1; y++) { ctx.moveTo(vx0 * TILE, y * TILE); ctx.lineTo(vx1 * TILE, y * TILE); }
  ctx.stroke();
  if (escala >= 1.2) {
    ctx.fillStyle = 'rgba(160,190,220,.55)';
    ctx.font = '7px monospace';
    for (let y = vy0; y <= vy1; y++)
      for (let x = vx0; x <= vx1; x++)
        if (x % 5 === 0 && y % 5 === 0) ctx.fillText(x + ',' + y, x * TILE + 2, y * TILE + 8);
  }
  ctx.restore();
}

export function desenharSpawns(ctx, escala) {
  ctx.save();
  for (const s of cena.spawns) {
    const cx = s.x * TILE + TILE / 2, cy = s.y * TILE + TILE / 2;
    const preso = solido(s.x, s.y); // spawn em tile bloqueado = bicho nunca nasce ali
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, 7);
    ctx.fillStyle = preso ? 'rgba(255,70,70,.35)' : 'rgba(90,200,255,.30)';
    ctx.fill();
    ctx.lineWidth = preso ? 2.2 : 1.6;
    ctx.strokeStyle = preso ? '#ff4646' : '#5ac8ff';
    ctx.stroke();
    if (escala >= 1.3) {
      ctx.font = 'bold 8px monospace';
      ctx.fillStyle = '#dff3ff';
      ctx.textAlign = 'center';
      ctx.fillText('#' + s.pokeId, cx, cy + 3);
      ctx.textAlign = 'left';
    }
  }
  if (cena.inicio) {
    const cx = cena.inicio.x * TILE + TILE / 2, cy = cena.inicio.y * TILE + TILE / 2;
    ctx.strokeStyle = '#7ec8a0';
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - 12, cy - 12, 24, 24);
    ctx.font = 'bold 8px monospace';
    ctx.fillStyle = '#7ec8a0';
    ctx.fillText('start', cx - 11, cy - 15);
  }
  ctx.restore();
}
