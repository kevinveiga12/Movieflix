# MovieFlix — aplicativos

Três clientes, um único backend. Nenhum banco novo, nenhuma autenticação
paralela: os apps falam com a mesma API e o mesmo Supabase do site.

```
mobile/
├── android/   Kotlin + Jetpack Compose   → celular Android
└── ios/       Swift + SwiftUI            → iPhone
tv/
└── android/   Kotlin + Compose for TV    → Android TV / Google TV / TV Box
```

## O que cada app faz

| Recurso | Mobile | TV |
|---|---|---|
| Login, cadastro, recuperação de senha | ✅ | ✅ |
| Catálogo de filmes e séries | ✅ | ✅ |
| Busca | ✅ | ✅ |
| Detalhes, temporadas, episódios | ✅ | ✅ |
| Player | ✅ | ✅ |
| Favoritos | ✅ | ✅ |
| Histórico / continuar assistindo | ✅ | ✅ |
| Planos e assinatura | ✅ | ✅ |
| Navegação por controle remoto | — | ✅ |

## Identidade visual

Mesma paleta do site (`src/styles/global.css`):

| Token | Valor |
|---|---|
| Vermelho da marca | `#DF0A15` |
| Vermelho claro | `#FF2D2D` |
| Roxo de destaque | `#8B5CF6` |
| Fundo | `#0A0A0F` |
| Card | `#17171F` |
| Texto | `#FFFFFF` / `#9A9AAB` |

Tipografia: **Bebas Neue** para títulos de marca, **Inter** para o resto —
as mesmas do site. Cards de pôster em 2:3, fileiras horizontais, banner de
destaque no topo.

## Integração

Todos os apps usam os endpoints que o site já expõe:

| Recurso | Endpoint |
|---|---|
| Catálogo | `GET /api/catalog/movies`, `/api/catalog/series` |
| Busca | `GET /api/catalog/search?q=` |
| Gêneros | `GET /api/catalog/genres` |
| Temporadas / episódios | `GET /api/db/series/:id/episodes` |
| Login / cadastro / recuperação | `POST /api/auth/*` |
| Autorização de reprodução | `POST /api/playback/authorize` |
| Situação do plano | `GET /api/subscription` |
| Planos e preços | `GET /api/plans` |
| Favoritos / histórico | Supabase direto (`favorites`, `watch_history`) com RLS |

Favoritar no celular aparece no site e na TV porque é a **mesma linha** no
Supabase. O mesmo vale para o histórico.

## Segurança

- Nenhuma chave privada nos apps. Só a URL e a chave **anon** do Supabase,
  que são públicas por design e protegidas por RLS.
- Tokens no **Keychain** (iOS) e no **EncryptedSharedPreferences** (Android).
- Quem libera conteúdo é o servidor: `app_metadata` + `created_at`, nunca o
  que o app afirma.
- Nenhum app contorna DRM, verificação anti-bot ou restrição de terceiros.

## Compilar

- Android mobile → [`mobile/android/BUILD.md`](mobile/android/BUILD.md)
- Android TV → [`tv/android/BUILD.md`](tv/android/BUILD.md)
- iOS → [`mobile/ios/BUILD.md`](mobile/ios/BUILD.md)

## Estado real

| Item | Estado |
|---|---|
| Código Android mobile | escrito, **não compilado** (sem SDK neste ambiente) |
| Código Android TV | escrito, **não compilado** |
| Código iOS | escrito, **não compilado** (sem macOS) |
| Testado em aparelho | **não** — nenhum dispositivo disponível |
| APK publicado | **não** — depende do build na sua máquina |
| Página de downloads | adaptada, com detecção de ambiente testada |

Nenhum app está "pronto para produção" até ser compilado e testado em
aparelho real. O que existe aqui é código-fonte completo e o processo de
build documentado.

## Plataformas futuras

A arquitetura separa a camada de dados (`Models`, `APIClient`) da interface,
então portar para outra plataforma significa reescrever só as telas. Não há
implementação de Fire TV, Samsung Tizen, LG webOS ou Apple tvOS — apenas
caminho aberto para isso.
