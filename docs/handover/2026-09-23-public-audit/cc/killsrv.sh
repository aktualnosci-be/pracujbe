#!/bin/sh
for p in $(pgrep -f "next-server|next start" ); do
  if [ -r /proc/$p/cwd ] && [ "$(readlink /proc/$p/cwd)" = "/workspace/wt/city" ]; then kill $p; fi
done
exit 0
