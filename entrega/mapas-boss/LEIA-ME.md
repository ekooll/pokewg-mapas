# Mapas de boss — entrega de 06/08/2026

Quatro arenas de boss montadas por nós, prontas para o **servidor de teste**.
Folha visual: `mapas-boss.png`, nesta mesma pasta.

Todas seguem o mesmo molde, medido tile a tile no `map-boss-ocean`:
**57×57 · um andar · `groundZ` 7 · `walk` −28..28 · `center` 3000,3000.**

## Os quatro

| slug | tipo do boss | tiles | miolo | andáveis | estado |
|---|---|---|---|---|---|
| `map-boss-pedra` | ROCK/GROUND — Onix | 3.249 | 687 | 494 | **aprovado** |
| `map-boss-terra` | GROUND — Cubone/Marowak | 3.249 | 680 | 529 | **aprovado** |
| `map-boss-fantasma` | GHOST — Gengar | 3.249 | 1.252 | 797 | em revisão |
| `map-boss-fogo` | FIRE/FLYING — Charizard | 3.998 | 621 | 402 | em obra — a forma ainda é retangular |

As três posições de combate estão no `_meta` de cada um, na convenção do
`_arena-positions.json`:

```json
"bossPos":   {"x": 0, "y": -3},
"allyPos":   {"x": 0, "y":  0},
"playerPos": {"x": 0, "y":  3}
```

Conferido em todos: os três tiles são andáveis e se alcançam a pé.

## O que já está verificado

- **Zero peça sem arte.** Auditados contra o **manifest ao vivo do pokewg.com**
  (16.899 assets), não contra a cópia local, que está 798 ids atrasada.
- **Zero peça nossa.** Só ids que já existem no atlas do jogo — nada depende de
  empacotar arte nova. *(O `map-boss-ocean`, que é referência e não faz parte
  desta entrega, usa 3 peças nossas: `9000057`–`9000059`.)*
- **Zero tile ilhado** no `pedra`, `terra` e `fantasma`: todo o miolo é alcançável
  a partir da posição do jogador.
- Colisão coerente: obstáculo dentro da arena é sempre peça que **se vê** —
  nenhum bloqueio com aparência de chão.

## O que falta, e é do lado de vocês

**O servidor não conhece nenhum destes slugs.** Confirmado agora:
`/map/<slug>.json` devolve 404 para os quatro. O cliente só carrega mapa que o
servidor registra — sem isso os arquivos não fazem nada.

Vale notar que **nenhuma das 16 arenas do `maps/` também está no `/map/`
público** (`aquatica`, `arena_charizard`, `rattata_arena`… todas 404), enquanto
mapas de caça normais (`cerulean`, `gengar`, `cubone`) respondem 200. Se as
arenas entram por outra rota, é por ela que estes quatro precisam entrar.

## Onde estão

```
entrega/mapas-boss/map-boss-{pedra,terra,fantasma,fogo}.json
```

Cada um tem um plano legível que descreve o mapa em intenção — material,
proporções, densidade. Os planos ficam no nosso repo de geração; se for útil pra
vocês, a gente manda.

**O `map-boss-terra` é mantido à mão pelo Ekoo**, não sai de gerador: o muro de
crista e o `walk` `[-19,-15,21,7]` (41×23, encostando no penhasco) foram
desenhados por ele no editor.

## Um pedido pequeno, se der

No cliente, `visualizador.js:393` desenha a banda chão com `congelar` fixo:

```js
blit(t[3], tx, ty, tz, 0, agora, true); // chao congelado no frame 0
```

Isso deixa **todo** chão animado parado, inclusive o fundo do mar. No nosso motor
o `animar` virou `{ pecas, chao }`, onde `chao` aceita uma lista de ids —
está em `visualizador/cena.js` na branch `motor-cena` do fork.

A lista medida do que deveria andar tem **7 ids**: `23673` (o piso inteiro do
fundo do mar) e o kit de borda `25055`–`25060`. Os outros **85** chãos animados
do atlas continuam parados de propósito — lava e pântano tremendo atrapalham
mais do que ajudam.


---

## Nesta pasta

```
map-boss-pedra.json      Onix        · ROCK/GROUND
map-boss-terra.json      Cubone      · GROUND        (mantido a mao pelo Ekoo)
map-boss-fantasma.json   Gengar      · GHOST
map-boss-fogo.json       Charizard   · FIRE/FLYING   (falta acabamento)
mapas-boss.png           os quatro lado a lado
../chao-que-anima.json   os 7 ids do fundo do mar que deveriam animar
```
