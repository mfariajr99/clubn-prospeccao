# Club’n · Prospecção de leads e campanhas

Uma aplicação web para cadastrar e importar prospects, organizar leads, criar campanhas e abrir o WhatsApp de cada contato com uma mensagem personalizada. **Cada mensagem é aberta individualmente por um clique do operador.** O sistema não tem fila de mensagens, envio em lote, agendamento nem worker de envio.

## Stack

| Camada | Tecnologia |
| --- | --- |
| Web | React 19 + TypeScript + Vite, React Router, CSS próprio (tokens da marca Club’n), ícones Lucide, fonte Montserrat |
| API | Node 20+ · Express 5 · Zod |
| Banco | SQLite (better-sqlite3) com migrations versionadas em `server/db/migrations.ts` |
| Planilhas | SheetJS (`xlsx`), executado num Web Worker no navegador |
| Testes | Vitest + Testing Library (jsdom) + Supertest; Playwright (desktop e mobile) |

## Como executar

```bash
npm install
npm run db:migrate          # cria data/clubn.db
npm run db:seed             # opcional: dados de demonstração 100% fictícios (use -- --reset para recriar)
npm run dev                 # API em :3333 e web em http://localhost:5173
```

Para produção:

```bash
npm run build               # checagem de tipos + build web (dist/) + build da API (dist-server/)
npm start                   # serve API e front-end em http://localhost:3333
```

### Variáveis de ambiente (opcionais)

| Variável | Padrão | Uso |
| --- | --- | --- |
| `PORT` | `3333` | Porta da API |
| `DATABASE_FILE` | `data/clubn.db` | Arquivo SQLite |
| `PREVIEW_TTL_DAYS` | `7` | Validade do cache das prévias |
| `PREVIEW_REFRESH_COOLDOWN_SECONDS` | `60` | Intervalo mínimo entre atualizações manuais da mesma prévia |
| `PREVIEW_SCREENSHOTS` | `off` | `on` ativa a captura visual com Chromium headless (Playwright) |
| `PREVIEW_CHROMIUM_PATH` | — | Caminho do Chromium, quando não estiver no local padrão do Playwright |
| `PREVIEW_STORAGE_DIR` | `data/screenshots` | Onde as capturas são guardadas |

## Publicação (GitHub + Render)

1. Envie o projeto para um repositório **privado** no GitHub (sem `node_modules`, `dist*` e `data`).
2. No Render: **New → Blueprint** → escolha o repositório. O `render.yaml` cria o serviço web (plano pago) com disco persistente de 1 GB para o banco.
3. Quando o Render pedir, defina `APP_PASSWORD` (senha de acesso da equipe). `SESSION_SECRET` é gerado automaticamente.
4. Após o deploy, abra o endereço `.onrender.com`, entre com a senha e adicione os operadores em **Operador → + Adicionar operador**.

Com `APP_PASSWORD` definido, toda a API exige login (cookie de sessão HttpOnly, 14 dias, tentativas limitadas). Sem ele (desenvolvimento local), o acesso é livre.

## Verificação

```bash
npm run lint
npm run typecheck
npm test                    # 102 testes: domínio, API, SSRF, planilhas e componentes
npm run test:e2e            # build + Playwright em desktop (1440px) e mobile (Pixel 7)
```

## Menu e telas

- **Visão geral**: métricas calculadas com os dados do banco.
- **Campanhas**: Criar campanha · Consultar campanhas · Iniciar campanhas.
- **Leads**: Cadastrar lead · Importar prospects (com o histórico de lotes) · Consultar leads.

## Regras principais

- **WhatsApp**: `https://wa.me/<número>?text=<mensagem codificada>` é aberto por `window.open(url, "_blank", "noopener,noreferrer")` no clique. Depois do clique, o sistema registra somente o evento **“WhatsApp aberto”**, e só quando o status atual é “Não contatado”. Todos os outros status são alterados manualmente e ficam no histórico, com o status anterior, o novo status, a data, o usuário, a campanha e uma observação. Um número inválido nunca abre o WhatsApp.
- **Leads e prospects** ficam na mesma tabela (`leads`). Os registros importados entram com o status cadastral “Prospect”, o lote, o arquivo, a data e o usuário.
- **Importação**: arquivo → mapeamento de colunas → validação e prévia (`/api/imports/analyze`, que não grava nada) → decisão sobre duplicidades → confirmação (`/api/imports/commit`) → resultado, com relatório CSV. Linhas inválidas não bloqueiam as válidas. Os duplicados são detectados pelo WhatsApp normalizado (na planilha, na base e em lotes anteriores) e por nome + cidade + UF. Um registro existente nunca é sobrescrito sem a escolha explícita do usuário.
- **Prévias**: são geradas no backend e somente quando o operador clica em “Ver prévia”. Ficam em cache por 7 dias, com status e limite de atualização manual, e capturas simultâneas do mesmo endereço são evitadas. A proteção contra SSRF inclui:
  - apenas http e https, sem credenciais e em portas 80, 443, 8080 ou 8443;
  - bloqueio de localhost, `.local` e `.internal`, IPs privados, loopback, link-local, metadados de nuvem e faixas IPv6 equivalentes;
  - validação de DNS com **o IP validado fixado na conexão**, o que impede DNS rebinding;
  - nova validação a cada redirecionamento, com no máximo 4;
  - timeout, limite de tamanho e nenhum download que não seja HTML;
  - metadados sanitizados.
- **Instagram, Facebook, TikTok e Google Maps** não são acessados automaticamente: não há scraping, login ou cookies. A prévia usa a imagem de capa cadastrada ou um card com o perfil e o botão “Abrir no Instagram”.
- **Avaliação de potencial**: é sempre manual. Cada lead tem uma avaliação geral e pode ter uma por campanha.

## Migrations

`server/db/migrations.ts` contém a migration `001 initial_schema`, com as tabelas `users`, `leads`, `lead_links`, `import_batches`, `import_batch_items`, `campaigns`, `campaign_leads`, `contact_history`, `link_previews` e `prospect_evaluations`. As migrations são aplicadas em transação e registradas em `schema_migrations`. Uma alteração futura deve entrar como uma nova migration, sem editar a existente.

## Limitações conhecidas

- **Autenticação**: o acesso é protegido por uma senha única da equipe (`APP_PASSWORD`). O operador responsável é escolhido no topo da tela (sem senha individual). Para login individual por pessoa, é preciso evoluir para contas de usuário.
- **Instagram e outras redes**: só as vias oficiais são permitidas. A API oficial ou o oEmbed exigem um app aprovado pela Meta e um token, que não estão configurados. Por isso o sistema usa a imagem de capa manual ou um card.
- **Captura visual**: vem desativada por padrão. Para ligar, é preciso ter o Chromium do Playwright instalado (`npx playwright install chromium`) e definir `PREVIEW_SCREENSHOTS=on`. O navegador de captura valida cada requisição contra as regras de SSRF, mas não consegue fixar o IP resolvido como a busca de metadados faz.
- **Proxy corporativo**: a busca de prévias conecta direto ao site, sem passar por `HTTP(S)_PROXY`.
- **SheetJS**: o npm só publica a versão 0.18.5, que tem alertas de segurança conhecidos. A leitura das planilhas roda isolada num Web Worker do próprio navegador do usuário, com limite de 10 MB e 10.000 linhas. Para eliminar o alerta, instale a versão oficial mais recente: `npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.
