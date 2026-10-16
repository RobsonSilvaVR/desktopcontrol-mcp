# desktopcontrol-mcp

Servidor MCP (stdio) que controla janelas da máquina onde roda — **Windows** e **Linux (X11)** — com um **agente JVM** para aplicações Java Swing.

## Instalação (um comando)
Requer Node 18+.
```
claude mcp add desktopcontrol-mcp -- npx -y github:RobsonSilvaVR/desktopcontrol-mcp
```
Diagnóstico do que falta na máquina:
```
npx -y github:RobsonSilvaVR/desktopcontrol-mcp --doctor
```

### Linux
Precisa de sessão X11 e dos pacotes `xdotool`, `xclip` e `maim` (ou ImageMagick). O `--doctor` mostra o comando exato. Nada é instalado automaticamente.
```
sudo apt install xdotool xclip maim
```
Sem tela (servidor): instale `xvfb` e habilite `MCP_ENABLE_LAUNCH=1`; a tool `launch_app` sobe um Xvfb e abre o programa nele. Wayland puro não é suportado.

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
- **Linux**: `xdotool` + `maim`/`import` + `xclip`. Testado apenas com testes unitários.
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
