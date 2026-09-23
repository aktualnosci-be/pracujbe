#!/bin/bash
for p in $(ls /proc | grep -E '^[0-9]+$'); do
  [ "$(readlink /proc/$p/cwd 2>/dev/null)" = /workspace/wt/shell ] || continue
  c=$(cat /proc/$p/comm 2>/dev/null)
  case "$c" in "next-server"*|"npm exec next s"*) kill $p 2>/dev/null;; sh) grep -q "next start -p 3207" /proc/$p/cmdline 2>/dev/null && kill $p;; esac
done
sleep 1; true
