<p align="center">
  <a href="README.md">English</a> · <a href="README.ko.md">한국어</a> · <a href="README.ja.md">日本語</a> · <a href="README.zh-CN.md">简体中文</a> · <b>Español</b>
</p>

<h1 align="center">site2api</h1>

<p align="center"><b>Convierte cualquier sitio web que uses en un servidor MCP verificado.</b><br>
Usa el sitio una vez. Tu agente obtiene herramientas reales para él, comprobadas contra el sitio en vivo.</p>

<p align="center">
  <a href="https://github.com/flyingsquirrel0419/site2api/actions/workflows/ci.yml"><img src="https://github.com/flyingsquirrel0419/site2api/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-6d4aff" alt="Licencia MIT"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A522.12-339933?logo=node.js&logoColor=white" alt="Node 22.12+">
  <img src="https://img.shields.io/badge/MCP-server-1c2030" alt="MCP">
  <img src="https://img.shields.io/badge/Agent%20Skills-Claude%20Code%20%C2%B7%20Cursor%20%C2%B7%20Codex-1c2030" alt="Agent Skills">
</p>

<p align="center">
  <img src="docs/assets/demo.gif" alt="Un haz de escáner recorre como rayos X una tarjeta de sitio web; sus llamadas ocultas a la API se convierten en tres herramientas verificadas que se conectan a un agente por MCP" width="860">
  <br><sub>Todo sitio web ya tiene una API. site2api la extrae, la verifica y se la entrega a tu agente. (<a href="docs/assets/demo.mp4">Video en HD</a>)</sub>
</p>

---

## El problema

La mayoría de los sitios que usas a diario no tienen API pública: tu tienda, el panel de tu banco, la
herramienta interna del trabajo, el foro que lees. Su propio frontend habla con una API privada
perfectamente válida, pero tu agente no puede verla. Así que extrae el HTML, o maneja un navegador clic a clic: lento,
frágil y caro.

**site2api observa esa API privada mientras usas el sitio y le entrega a tu agente un servidor MCP
para ella.** Deduce los endpoints, las entradas y de dónde salen, y el inicio de sesión, y luego
llama a cada herramienta de solo lectura contra el sitio en vivo antes de que llegues a usarla.

## Inicio rápido


**Con tu agente de programación** (Claude Code, Cursor, Codex, … cualquier agente con
[Agent Skills](https://agentskills.io)): copia [`skills/site2api`](skills/site2api) en el
`.claude/skills/` o `.agents/skills/` de tu proyecto y pídele:

> Crea un servidor MCP para https://app.example.com. Quiero búsqueda, mis pedidos y el detalle de cada pedido.

La skill guía al agente para grabar, nombrar las herramientas, verificar y generar. No hace falta
clave de API: tu agente se encarga de pensar.

**Con un solo comando:**

```bash
npx site2api run https://app.example.com
```

Se abre una ventana del navegador. Inicia sesión, usa las funciones que quieras como herramientas (lo ideal es dos veces cada una) y pulsa
Enter. Obtienes `out/mcp/`, un servidor autocontenido:

```bash
claude mcp add app -e SITE2API_COOKIE='…' -- node out/mcp/server.mjs   # or use out/mcp/mcp.json
```

¿Sin pantalla, o en CI? Deja que un script maneje el navegador:
`npx site2api run https://app.example.com --script capture.mjs` ([scripts de captura](docs/capture-scripts.md)).

## Cómo funciona

<p align="center"><img src="docs/assets/flow.svg" alt="Grabar, normalizar, rastrear, inferir, verificar, generar" width="900"></p>

| | Etapa | Qué ocurre |
|---|---|---|
| 1 | **Grabar** | Un navegador con un perfil dedicado graba las llamadas a la API mientras tú (o un script) usas el sitio. O aporta un HAR de DevTools. |
| 2 | **Normalizar** | Descarta archivos estáticos y analítica, convierte `/orders/3f6c…` en `/orders/{orderId}`, fusiona esquemas JSON, separa operaciones GraphQL y detecta cookies, bearer tokens, cabeceras CSRF y claves de API. |
| 3 | **Rastrear** | Encuentra de dónde sale cada entrada: el id del pedido, de la lista de pedidos; el token CSRF, de `/api/session`. Determinista; sin LLM. |
| 4 | **Inferir** | Nombra las herramientas, escribe las descripciones y marca cada operación como lectura, escritura o autenticación. Lo hace tu agente de programación con la skill, o `site2api infer` llama a Claude o a cualquier API compatible con OpenAI. |
| 5 | **Verificar** | Llama a cada herramienta de solo lectura en el sitio en vivo y compara la respuesta con el esquema grabado. Las operaciones de escritura y de inicio de sesión nunca se llaman. |
| 6 | **Generar** | `server.mjs` + `tools.json` + `mcp.json`. Un solo archivo con el SDK de MCP incluido: `node server.mjs`, nada que instalar. |

Más: [cómo funciona](docs/how-it-works.md).

## Qué obtiene tu agente

- **Herramientas que se encadenan.** Las descripciones dicen de dónde salen las entradas ("use `orderId` from
  `list_orders` results"), así que los agentes llaman a `list_orders` → `get_order` sin adivinar.
- **Solo lo que importa como entrada.** Los valores que nunca cambiaron durante la grabación (una versión de cliente, un
  tamaño de página) pasan a ser valores por defecto. En hn.algolia.com, la herramienta de búsqueda pasó de 19 entradas obligatorias
  a 3.
- **El inicio de sesión, resuelto.** Las cookies de sesión, los bearer tokens y las claves de API salen de variables de
  entorno; los tokens CSRF se obtienen y renuevan automáticamente.
- **Escrituras tras una barrera.** Las herramientas que modifican datos quedan fuera salvo que pases
  `--allow-writes`, e incluso entonces cada llamada necesita `confirm: true`.
- **Errores claros.** Una sesión caducada lo dice. Un sitio inaccesible dice qué host y por qué.

Más: [el servidor generado](docs/generated-server.md).

## Verificado, no solo generado

```text
✅ list_orders                  HTTP 200
✅ get_order                    HTTP 200
🟡 search_stories               HTTP 200, but missing: /processingTimingsMS/fetch/total
❌ get_product                  /price: expected number, got string
```

`site2api verify` vuelve a ejecutar cada herramienta de lectura contra el sitio en vivo, con entradas tomadas de respuestas
enlazadas o de la grabación. **✅** coincide. **🟡** funciona, pero faltan algunos campos que siempre estaban presentes
(normalmente opcionales). **❌** cambió un tipo o el estado no era el esperado, así que probablemente la API
cambió. `generate --only-verified` conserva ✅ y 🟡. Ejecútalo de forma programada para detectar cambios en la
API. Más: [verify](docs/verify.md).

## Cómo se compara

| | Conversores HAR → OpenAPI | Agentes que manejan el navegador | **site2api** |
|---|---|---|---|
| Resultado | Un archivo OpenAPI | Clics, cada vez | **Un servidor MCP** |
| Velocidad por llamada | — | De segundos a minutos | **Una petición HTTP** |
| Sabe de dónde salen las entradas | No | Lo redescubre cada vez | **Sí, rastreado del tráfico** |
| Inicio de sesión, CSRF, claves de API | Cosa tuya | En cada ejecución | **Lo gestiona el servidor** |
| Comprobado contra el sitio en vivo | No | — | **Sí (`verify`)** |
| Necesita un LLM | No | En cada paso | **Solo para nombrar herramientas, opcional** |

## Principios

site2api es para **tus propias cuentas y tus propios datos**, dentro de los términos de servicio de cada sitio.

- **Sin almacenar credenciales.** Los valores de cookies, tokens y claves nunca llegan a la especificación, el informe,
  las anotaciones, los resultados de verify ni el servidor generado. Cada salida se comprueba contra hashes con sal
  de las credenciales vistas en la captura, y site2api se niega a escribir un archivo que contenga alguna.
- **Un navegador normal, a ritmo humano.** Lo manejes tú o un script: sin modo sigiloso, sin saltarse la
  detección de bots ni CAPTCHAs, sin rotación de proxies. Los scripts tienen un presupuesto de peticiones y una
  pausa mínima entre pasos. El scraping masivo no es un objetivo.
- **Las escrituras están desactivadas por defecto**, y `verify` nunca las llama.

Más: [modelo de seguridad](docs/security.md).

## Preguntas frecuentes

**¿Esto es scraping?** No. Llama a la misma API que llama el propio frontend del sitio, como tú, al
ritmo al que lo harías tú. No rastrea el sitio, y está pensado para tus propias cuentas.

**¿Y los sitios con CAPTCHAs o protección contra bots?** site2api no los esquiva. Si un
sitio bloquea un navegador normal, no encaja.

**¿Funciona en un servidor, sin pantalla?** Sí. Usa un script de captura (`--script`) para grabar
en modo headless, o aporta un HAR. Todos los demás pasos ya son headless.

**¿Qué sitios funcionan mejor?** Aplicaciones de una sola página que hablan JSON o GraphQL con su backend: tiendas,
paneles, herramientas SaaS, interfaces de búsqueda. Las páginas HTML renderizadas en el servidor no tienen API que encontrar.

**¿Qué pasa cuando el sitio cambia?** `verify` te dice qué herramientas se rompieron y cómo. Graba de nuevo
y regenera; lleva un minuto.

**¿Qué agentes pueden usar el servidor?** Cualquier cliente MCP: Claude Code, Cursor, Codex, Claude Desktop
y otros. `out/mcp/mcp.json` funciona tal cual en los clientes que leen el formato estándar `mcpServers`.

## Documentación

[Primeros pasos](docs/getting-started.md) ·
[Referencia de la CLI](docs/cli.md) ·
[Scripts de captura](docs/capture-scripts.md) ·
[Uso desde tu agente](docs/agents.md) ·
[Verify](docs/verify.md) ·
[El servidor generado](docs/generated-server.md) ·
[Cómo funciona](docs/how-it-works.md) ·
[Modelo de seguridad](docs/security.md)

## Desarrollo

```bash
pnpm install
pnpm test          # unit tests + MCP, verify and record end to end against the demo shop
pnpm demo          # the demo shop on :4317
pnpm build && node dist/cli.js run http://localhost:4317 --script demo/shop/capture.mjs
```

La demo es un proyecto de [HyperFrames](https://github.com/heygen-com/hyperframes) en `demo/motion/`; su README explica cómo volver a renderizarla. Para probar la skill en otro agente:
[docs/testing-skill.md](docs/testing-skill.md).

Las contribuciones son bienvenidas: consulta [CONTRIBUTING.md](CONTRIBUTING.md), el [código de conducta](CODE_OF_CONDUCT.md), [SECURITY.md](SECURITY.md) para informar de vulnerabilidades y el [registro de cambios](CHANGELOG.md).

## Licencia

MIT
