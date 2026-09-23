#!/bin/bash
# usage: neg.sh <spec> — builds current tree and runs spec
cd /workspace/wt/shell
bash /tmp/claude-0/-workspace-pracujbe/27ac77b3-7ae4-53c9-8e96-07974b43b582/scratchpad/audit/shell/stop.sh
flock /tmp/claude-0/-workspace-pracujbe/27ac77b3-7ae4-53c9-8e96-07974b43b582/scratchpad/locks/build.lock npm run build > /tmp/claude-0/-workspace-pracujbe/27ac77b3-7ae4-53c9-8e96-07974b43b582/scratchpad/audit/shell/build.log 2>&1 || { tail -30 /tmp/claude-0/-workspace-pracujbe/27ac77b3-7ae4-53c9-8e96-07974b43b582/scratchpad/audit/shell/build.log; exit 1; }
curl -s -o /dev/null localhost:3207 && { echo "SERVER STILL RUNNING"; exit 1; }
WT=/workspace/wt/shell PORT=3207 npx playwright test --config /workspace/wt/pw.config.mjs "$@" 2>&1 | grep -E "passed|failed|✘|Error:|›.*(chromium)" | tail -25
bash /tmp/claude-0/-workspace-pracujbe/27ac77b3-7ae4-53c9-8e96-07974b43b582/scratchpad/audit/shell/stop.sh
