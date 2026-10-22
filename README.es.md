<p align="center">
  <a href="README.md">English</a> · <a href="README.ko.md">한국어</a> · <a href="README.ja.md">日本語</a> · <a href="README.zh-CN.md">简体中文</a> · <b>Español</b>
</p>

<h1 align="center">site2api</h1>

<p align="center"><b>Convierte las aplicaciones web que usas en herramientas MCP para tu agente.</b><br>
Graba algunas acciones, genera un servidor MCP local y verifica sus herramientas de lectura en el sitio real.</p>

<p align="center">
  <a href="https://github.com/flyingsquirrel0419/site2api/actions/workflows/ci.yml"><img src="https://github.com/flyingsquirrel0419/site2api/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-6d4aff" alt="Licencia MIT"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A522.12-339933?logo=node.js&logoColor=white" alt="Node 22.12+">
  <img src="https://img.shields.io/badge/MCP-server-1c2030" alt="MCP">
  <img src="https://img.shields.io/badge/Agent%20Skills-Claude%20Code%20%C2%B7%20Cursor%20%C2%B7%20Codex-1c2030" alt="Agent Skills">
</p>

<p align="center">
  <img src="docs/assets/demo.gif" alt="Las peticiones grabadas de una aplicación web se convierten en tres herramientas MCP conectadas a un agente" width="860">
  <br><sub>De peticiones del navegador a herramientas que tu agente puede llamar. <a href="docs/assets/demo.mp4">Ver el video en HD</a>.</sub>
</p>

## Por qué site2api

Muchas aplicaciones web usan API JSON o GraphQL desde su propio frontend, pero no ofrecen una API pública para las funciones que necesitas. Un agente puede manejar el navegador en cada tarea, aunque así depende siempre de interacciones con la interfaz.

site2api graba esas peticiones mientras usas la aplicación. Identifica operaciones, deduce los esquemas de entrada y rastrea el origen de valores como los identificadores de pedidos. Después genera un servidor MCP local. Antes de generarlo, llama a las operaciones de lectura elegibles en el sitio real y comprueba sus respuestas frente a la grabación.

**Ideal para:** aplicaciones web con API JSON o GraphQL, paneles, herramientas internas que tienes permiso para usar e interfaces de búsqueda. No es adecuado para sitios que solo devuelven HTML o que bloquean el acceso desde un navegador normal.

## Inicio rápido

Necesitas Node.js 22.12 o posterior y Chrome instalado. Si no tienes Chrome, instala Playwright Chromium una vez con `npx playwright install chromium`.

```bash
npx site2api run https://app.example.com
```

Se abre un perfil de navegador dedicado. Inicia sesión si hace falta, utiliza cada función que quieras convertir en herramienta al menos dos veces con entradas distintas y pulsa Enter. El comando graba, analiza, verifica las operaciones de lectura y genera un servidor autónomo en `out/mcp/`. Si no has configurado un proveedor LLM, usa nombres de herramientas heurísticos que puedes mejorar más adelante.

```text
out/
├── report.md       # operaciones y relaciones entre entradas
├── verify.json     # éxito, aviso, fallo u omisión por operación de lectura
└── mcp/
    ├── server.mjs  # servidor con el SDK de MCP incluido
    ├── tools.json  # definiciones de herramientas
    └── mcp.json    # configuración del cliente
```

Registra el servidor en un cliente MCP. Por ejemplo, con Claude Code:

```bash
claude mcp add app -e SITE2API_COOKIE='<Cookie header>' -- node /absolute/path/to/out/mcp/server.mjs
```

Configura solo las credenciales que indique el `out/mcp/README.md` generado. Para otros clientes, consulta [el servidor generado](docs/generated-server.md). Puedes grabar sin pantalla mediante un [script de captura](docs/capture-scripts.md) o importar un HAR de DevTools.

### Usarlo con un agente de programación

Copia [`skills/site2api`](skills/site2api) en `.claude/skills/` o `.agents/skills/` de tu proyecto y pídele:

> Crea un servidor MCP para https://app.example.com. Necesito búsqueda, mis pedidos y el detalle de cada pedido.

La skill guía al agente por la grabación, los nombres, la verificación y la generación. Como usa tu agente de programación actual, esta vía no necesita una clave de API LLM adicional. Más información en [Uso desde tu agente](docs/agents.md).

## Qué ofrece el servidor generado

| Función | Cómo funciona |
|---|---|
| **Solo las entradas necesarias** | Los valores que no cambian entre las muestras grabadas pasan a ser valores por defecto, no argumentos obligatorios. |
| **Herramientas encadenables** | Las descripciones indican el origen de cada entrada, como un `orderId` en los resultados de `list_orders`. |
| **Autenticación** | El servidor lee cookies de sesión, tokens Bearer y claves de API de variables de entorno; puede obtener y renovar tokens CSRF registrados. |
| **Escrituras controladas** | Las herramientas de escritura quedan excluidas por defecto. Incluso con `--allow-writes`, cada llamada requiere `confirm: true`. |
| **Salida local** | `server.mjs` incluye el SDK de MCP y se ejecuta con Node.js sin instalar dependencias adicionales en `out/mcp/`. |

Las etapas completas se describen en [Cómo funciona](docs/how-it-works.md).

## Verifica antes de conectar

```text
✅ list_orders      HTTP 200
🟡 search_stories   HTTP 200, but missing: /processingTimingsMS/fetch/total
❌ get_product      /price: expected number, got string
⏭  get_invoice      needs input: invoiceId
```

`site2api verify out` llama a las operaciones de lectura en el sitio real y compara las respuestas con los esquemas grabados. **Éxito** significa que coinciden; **aviso**, que los tipos coinciden pero faltan campos presentes en todas las muestras; **fallo**, que hay un estado inesperado o un esquema distinto; **omisión**, que falta una entrada o credencial. `verify` nunca llama a operaciones de escritura ni de inicio de sesión. `generate --only-verified` incluye las herramientas de lectura con éxito o aviso. Consulta [Verificación](docs/verify.md).

## Seguridad y alcance

Usa site2api solo con cuentas y datos a los que tengas autorización de acceso, y de acuerdo con las condiciones del sitio.

- **Mantén privada la grabación original.** El HAR puede contener credenciales de sesión. Si no eliges `--discard-har`, permanece en un directorio local accesible solo para tu usuario. No lo subas al repositorio ni lo compartas.
- **Los archivos generados excluyen los valores de las credenciales capturadas.** Las especificaciones, informes, anotaciones, resultados de verificación y archivos del servidor se comprueban frente a las huellas de las credenciales antes de escribirse. El servidor en ejecución las lee de su entorno.
- **Las escrituras son opcionales.** `verify` nunca las ejecuta, y cada llamada a una herramienta de escritura generada exige `confirm: true`.
- **No sirve para evadir bloqueos ni rastrear en masa.** site2api no sortea CAPTCHAs o protecciones contra bots, no usa plugins sigilosos ni rota proxies.

El comando opcional `infer` envía al proveedor LLM configurado nombres de operaciones y estructuras de datos, no los valores grabados. site2api no tiene telemetría. Consulta el [modelo de seguridad](docs/security.md) para conocer el flujo de datos y sus límites.

## Preguntas frecuentes

**¿Necesito una clave de API LLM?** No para `run` con nombres heurísticos ni para la Agent Skill con tu agente de programación. El comando opcional `infer` requiere configurar un proveedor.

**¿Qué hago si caduca la sesión?** Actualiza la credencial en el entorno del servidor; no hace falta generarlo de nuevo.

**¿Qué pasa si cambia el sitio?** Ejecuta `site2api verify out` para identificar las herramientas afectadas y vuelve a grabar y generar si es necesario.

**¿Qué clientes son compatibles?** Cualquier cliente MCP que pueda iniciar un servidor stdio, incluidos Claude Code, Cursor, Codex y Claude Desktop. Consulta la [configuración de clientes](docs/generated-server.md).

## Documentación

[Primeros pasos](docs/getting-started.md) ·
[Referencia de la CLI](docs/cli.md) ·
[Scripts de captura](docs/capture-scripts.md) ·
[Uso desde tu agente](docs/agents.md) ·
[Verificación](docs/verify.md) ·
[Servidor generado](docs/generated-server.md) ·
[Cómo funciona](docs/how-it-works.md) ·
[Modelo de seguridad](docs/security.md)

## Desarrollo

```bash
pnpm install
pnpm test
pnpm demo
pnpm build && node dist/cli.js run http://localhost:4317 --script demo/shop/capture.mjs
```

La animación de demostración es un proyecto de [HyperFrames](https://github.com/heygen-com/hyperframes) en `demo/motion/`. Para contribuir, consulta [CONTRIBUTING.md](CONTRIBUTING.md), el [código de conducta](CODE_OF_CONDUCT.md), la [política de seguridad](SECURITY.md) y el [registro de cambios](CHANGELOG.md).

## Licencia

MIT
