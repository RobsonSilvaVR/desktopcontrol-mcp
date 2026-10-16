# desktopcontrol-mcp

Servidor MCP (stdio) que controla janelas da máquina onde roda — **Windows** e **Linux (X11)** — com um **agente JVM** para aplicações Java Swing.

## Requisitos
Instale antes de pedir a instalação do MCP:

| | Windows | Linux |
|---|---|---|
| Node.js | 18 ou superior | 18 ou superior |
| Claude Code | instalado | instalado |
| Sistema | Windows 10/11 com PowerShell 5.1 (já incluso) | sessão X11 (Wayland puro não é suportado) |
| Pacotes | nenhum | `sudo apt install xdotool xclip maim` |
| Sem tela (servidor) | — | `sudo apt install xvfb openbox` (o `openbox` é necessário para o Java receber teclado) |
| Apps Java Swing (opcional) | JDK (não só JRE) | JDK (não só JRE) |

Para conferir o que falta, depois de clonar: `node server.mjs --doctor`.

## Instalação
Com os requisitos cumpridos, cole este prompt no Claude Code (Windows ou Linux):
```
Instale o MCP desktopcontrol-mcp: https://github.com/RobsonSilvaVR/desktopcontrol-mcp
Clone o repositório em uma pasta fixa (ex.: ~/mcp/desktopcontrol-mcp), rode `npm install` dentro dela e registre com `claude mcp add desktopcontrol-mcp -- node <caminho absoluto>/server.mjs`. Se esta máquina não tiver tela, adicione `-e MCP_ENABLE_LAUNCH=1`.
Depois rode `node <caminho>/server.mjs --doctor` e `claude mcp list`, e me diga se preciso reiniciar o Claude Code.
```
Manualmente:
```
git clone https://github.com/RobsonSilvaVR/desktopcontrol-mcp
cd desktopcontrol-mcp && npm install
node server.mjs --doctor
claude mcp add desktopcontrol-mcp -- node "$(pwd)/server.mjs"
```
No Windows (PowerShell) troque a última linha por `claude mcp add desktopcontrol-mcp -- node "$PWD\server.mjs"`. Para atualizar: `git pull && npm install`.

> Não use `npx github:...` no registro: ele refaz o download a cada início (~95 s no Windows) e o Claude Code desiste do servidor após 30 s.

### Linux sem tela
O `launch_app` (habilitado por `MCP_ENABLE_LAUNCH=1`) sobe um Xvfb com o `openbox` e abre o programa nele.

## Tools
Genéricas: `list_apps list_windows screenshot click type_text press_key hotkey paste_text scroll drag` (e `launch_app`, opt-in).
Swing: `swing_tree swing_click swing_set_text swing_focus swing_key swing_type swing_cells`.

## Configuração
| Variável | Efeito |
|---|---|
| `MCP_ALLOWED_APPS=java,notepad` | Restringe os apps controláveis por nome de processo. Vazia (padrão) = todos. `java` libera todos os apps Java. |
| `MCP_ENABLE_LAUNCH=1` | Habilita a tool `launch_app` (executa programas). Desligada por padrão. |
| `JAVA_HOME` | JVM de reserva para anexar o agente Swing. |
| `MCP_SWING_TMPDIR` | Pasta do arquivo de porta do agente, se o app usar outro `java.io.tmpdir`. |

> Este MCP controla teclado e mouse da máquina. Use `MCP_ALLOWED_APPS` quando o agente não for totalmente confiável.

## Como funciona
- **Windows**: `vendor/orca/runtime.ps1` (UI Automation + Win32, do projeto [Orca](https://github.com/stablyai/orca), MIT) em modo `-Serve`, com patch para teclas F1–F12.
- **Linux**: `xdotool` + `maim`/`import` + `xclip`. Validado em Ubuntu 24.04 (Xvfb + openbox) com apps Swing em Java 8 e 11.
- **Swing**: `swing/swing-agent.jar` abre um socket local (127.0.0.1, token em `java.io.tmpdir/mcp-swing-<pid>.json`), lê a árvore de componentes e injeta eventos na EDT **sem depender de foco do SO nem de acessibilidade**. Sem foco, a tecla é entregue direto aos `KeyEventDispatcher` do app.

### Agente Swing
- Anexo automático na 1ª chamada `swing_*` pela Attach API, usando a JVM do próprio app (JDK 8 precisa do `tools.jar`, ou seja, JDK e não JRE) e, se falhar, o `JAVA_HOME`.
- Alternativa sem anexo: iniciar o app com `-javaagent:<caminho>/swing/swing-agent.jar`.
- `swing_tree` com `onlyText=true` serve de "leitura de tela".
- JDK 16+ pode exigir `--add-opens java.desktop/java.awt=ALL-UNNAMED` para a entrega de teclas sem foco.

## Desenvolvimento
```
npm install
JDK=/caminho/do/jdk8 npm run build    # recompila swing/swing-agent.jar
npm test
node examples/swing-keys.mjs <pid> F1 Escape
```

## Licença
MIT. O arquivo `vendor/orca/runtime.ps1` é do projeto Orca (MIT, Lovecast Inc.), com alteração local — ver `vendor/orca/LICENSE`.
