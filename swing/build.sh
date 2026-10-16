#!/bin/sh
# Compila o agente com o JDK 8 (bytecode 1.6, roda em qualquer JVM >= 6). JDK=<raiz do JDK 8>
set -e
JDK="${JDK:?defina JDK com a raiz de um JDK 8 (ex.: JDK=/usr/lib/jvm/java-8-openjdk-amd64)}"
cd "$(dirname "$0")"
rm -rf out && mkdir -p out/classes
"$JDK/bin/javac" -source 1.6 -target 1.6 -nowarn -cp "$JDK/lib/tools.jar" -d out/classes src/mcp/*.java
printf 'Premain-Class: mcp.SwingAgent\nAgent-Class: mcp.SwingAgent\n' > out/manifest.txt
"$JDK/bin/jar" cfm swing-agent.jar out/manifest.txt -C out/classes .
