#!/bin/sh
# Zabija wyłącznie serwer next uruchomiony z /workspace/wt/auth (po cwd procesu).
for d in /proc/[0-9]*; do
  [ "$(readlink $d/cwd 2>/dev/null)" = "/workspace/wt/auth" ] || continue
  c=$(tr '\0' ' ' < $d/cmdline 2>/dev/null)
  case "$c" in next-server*|*"/next start"*|"npm exec next start"*|"node "*"next start"*) kill ${d#/proc/} 2>/dev/null && echo "killed ${d#/proc/} $c";; esac
done; true
