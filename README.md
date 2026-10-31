# Interface do Inventário CTE (site estático)

Esta pasta é a **interface** da aplicação, alojada fora do Google (ex.: GitHub Pages).
Fala com o Apps Script por `POST` (`{ metodo, args }` → `{ ok, dados }`).

## Ficheiros

| Ficheiro | O que é |
|---|---|
| `index.html` | a página (estrutura + estilos) |
| `app.js` | o cliente: quiosque, área do professor e painel |
| `qrlib.js` | gerador de QR Codes (biblioteca de terceiros, sem alterações) |
| `config.js` | **o único sítio a editar**: o endereço da aplicação |
| `manifest.webmanifest` | manifesto PWA (nome, ícones, cores) |
| `sw.js` | service worker: guarda o “casco” da aplicação para abrir com Wi‑Fi fraco; não interceta o POST para o Apps Script |
| `icon-64.png`, `icon-192.png`, `icon-512.png` | ícones da PWA (instalação/atalho), com fundo transparente |
| `apple-touch-icon.png` | ícone do atalho no iOS, com fundo transparente |
| `logo-cte.svg` | versão vetorial do símbolo (hexágono C) |
| `favicon.ico`, `favicon-32.png`, `favicon-16.png` | ícone da aba do browser (o 16 px é simplificado) |

## Publicar (GitHub Pages)

1. Edita `config.js` e coloca em `API_URL` o endereço `…/exec` da aplicação.
2. Cria um repositório **público** (ex.: `inventario-cte`).
3. Carrega **o conteúdo desta pasta** para a raiz do repositório
   (`index.html`, `app.js`, `qrlib.js`, `config.js`, `manifest.webmanifest`, `sw.js` e todos os ícones/favicons).
4. *Settings → Pages → Deploy from a branch → main / (root) → Save*.
5. Ao fim de ~1 minuto: `https://UTILIZADOR.github.io/inventario-cte/`
6. **Ao alterar `app.js`, `index.html`, `qrlib.js` ou os ícones**, sobe `CACHE_VERSAO` no início de `sw.js`
   (ex.: `cte-inventario-v4` → `cte-inventario-v5`). Sem isso, o browser pode continuar a servir
   a versão anterior a partir da cache do service worker.
7. Na folha de cálculo, em `Config`, coloca `appUrlBase` com esse endereço
   **com a barra final** (`https://UTILIZADOR.github.io/inventario-cte/`),
   para que os QR Codes passem a apontar para aqui.

## Regras que não podem ser quebradas

- `fetch` sempre com `Content-Type: text/plain;charset=utf-8` e `credentials: 'omit'`.
  **Isto não é estilo:** é o que evita o preflight de CORS e o envio de cookies Google.
- Nunca acrescentar cabeçalhos personalizados ao `fetch`.
- O corpo é JSON `{ "metodo": "api_x", "args": [ ... ] }`.

## O que nunca deve entrar neste repositório

- `Inventário CTE — dados.xlsx`, cópias de segurança, exports da folha `Config`
- Etiquetas ou PDFs com QR Codes (contêm endereços e identificadores)
- Capturas de ecrã do painel com dados de alunos

O código não contém segredos: os PINs e a password vivem na folha de cálculo.
