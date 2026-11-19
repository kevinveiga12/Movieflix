# Deploy na Velixir — diagnóstico e runbook

Este documento registra o diagnóstico do deploy da MovieFlix na Velixir e o
procedimento seguro para publicar novas releases sem tocar em produção.

## Sintomas observados

- Painel da Velixir: `Build Status: FAILED`, com
  `Response status code does not indicate success: 404 (Not Found).`
- Aviso no release: "The source for this release is no longer stored. Older
  uploads are removed once an app's sources pass 1 GB, and this one was removed
  on 19 Nov 2026."
- O botão "Copy log" devolve apenas a mensagem HTTP 404.

## O que foi descartado com evidência

| Suspeita | Verificação | Resultado |
| --- | --- | --- |
| Código quebrado | `npm ci --include=dev`, `tsc --noEmit`, `npm run build` | passam (build em ~7 s) |
| Node/config | `nixpacks.toml` fixa `nodejs_22`, `npm ci --include=dev`, `npm run build` | igual à versão que funcionava |
| Repositório privado/inacessível | tarball público do commit baixa (30,7 MB) | acessível |
| Integração GitHub desligada | status `velixir/movieflix` é postado pelo `velixir-deploy[bot]` em cada push | ativa |
| Tamanho do envio | 58 MB → 30 MB não mudou o resultado | não é o gatilho isolado |

## A produção está atualmente desatualizada

`GET /api/catalog/posters` (rota criada no commit `1ae9849`) responde
`404 Cannot GET` em https://movieflix.velixir.run — ou seja, o processo em
produção roda código **anterior** a esse commit. O `dist/` do site não muda
nesse commit, por isso comparar o hash do bundle não revela a defasagem;
a rota de API revela.

## Leitura do erro 404

O 404 não é do site nem do build de código: é da **leitura do arquivo de
fonte do release** no armazenamento da Velixir, no momento em que o build vai
buscá-lo. O painel diz explicitamente que a fonte daquele release foi removida
pela política de retenção (1 GB por app, ~30 MB por envio).

Isso explica os dois padrões vistos:

1. Falhas intermitentes com configuração idêntica — o release antigo é purgado
   e o build enfileirado não encontra mais o arquivo.
2. Falha imediata ao repetir "Deploy latest commit" no mesmo commit — o release
   já existente perdeu a fonte e não é reenviado.

## Procedimento seguro de publicação

Nunca apagar o app, nunca recriar o projeto. Sempre:

1. Rodar as verificações locais:
   ```bash
   npm ci --include=dev
   npx tsc --noEmit
   npm run build
   ```
2. Publicar por um caminho que **reenvie a fonte** (CLI `velixir deploy` no
   diretório do projeto, ou um commit novo que dispare o App), em vez de repetir
   o deploy do mesmo release.
3. Confirmar que o release novo ficou saudável **antes** de considerar pronto:
   ```bash
   curl -s https://movieflix.velixir.run/api/health
   curl -s -o /dev/null -w '%{http_code}\n' \
     'https://movieflix.velixir.run/api/catalog/posters?ids=550'
   ```
   A segunda chamada só responde `200` quando o código publicado inclui o
   commit `1ae9849` ou posterior — é o marcador de versão usado neste projeto.
4. Se o release falhar, ler o log de build pelo id do release
   (`GET /api/v1/releases/{id}/build-log`) antes de tentar de novo.

## Retenção de fontes

Cada envio guarda um arquivo de ~30 MB (o repositório compactado tem 30,7 MB;
descompactado, 55 MB, dos quais ~20 MB são APKs em `public/apk/` e ~27 MB são
os catálogos JSON em `public/filmes/`). Com o teto de 1 GB, o pool comporta
cerca de 33 releases. Reduzir o pacote desacelera o problema, mas não substitui
publicar por um caminho que reenvie a fonte.
