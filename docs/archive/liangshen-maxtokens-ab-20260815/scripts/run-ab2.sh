#!/bin/bash
TASK='Inspect the repository /Users/zcl/code/dsh-web-ui: list the top-level package directories under packages/ and report how many there are.'
mkdir -p /tmp/ls-ab2
for group in baseline cap; do
  if [ "$group" = "baseline" ]; then export LS_PRESET=liangshen-baseline; else export LS_PRESET=liangshen; fi
  for i in 1 2 3 4 5; do
    echo "[$group $i] start $(date +%H:%M:%S)"
    (cd /tmp && dsh --profile liangshen-headless "$TASK") > /tmp/ls-ab2/$group-$i.out 2>&1
    echo "[$group $i] exit=$? $(date +%H:%M:%S)"
  done
done
echo ALL_DONE
