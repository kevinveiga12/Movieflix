# QA — verificações desta correção

Dois problemas foram corrigidos e cada um tem uma verificação executável.

## 1. Botões da página de planos

```bash
npm run build
node qa/check-plan-buttons.mjs
```

Abre `/planos` num Chromium real em 360, 414, 768 e 1280 px de largura, com as
rotas de API respondidas localmente (Pix ligado, que é o estado em que o botão
"Pagar com Pix ou cartão de crédito" aparece). Para cada botão compara a caixa
do TEXTO com a caixa do BOTÃO e falha se qualquer letra sair do retângulo ou se
houver rolagem interna.

`qa/shot.mjs` gera as capturas em `qa/out/`.

## 2. Janela de atualização da MovieFlix TV

A regra de navegação vive em `UpdateNav.kt` (Kotlin puro, sem Android) e o teste
em `app/src/test/java/.../UpdateNavCheck.kt` roda a mesma lógica que a TV
executa, tecla por tecla: rolagem com ↑/↓, chegada aos botões, OK acionando o
elemento em foco, BACK opcional/obrigatório e o estado de download.

```bash
cd tv/android
./gradlew :app:compileDebugKotlin   # compila o app inteiro
```

O teste é um `main` sem dependências: compila com o `kotlinc` e roda com `java`.
