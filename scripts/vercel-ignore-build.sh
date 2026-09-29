#!/usr/bin/env bash
# Vercel "Ignored Build Step" (vercel.json → ignoreCommand).
# Exit 0 = SKIP the deployment, exit 1 = BUILD it.
#
# Skips a deployment only when every file changed since the last deployment
# is documentation, tests or editor config — nothing the running app uses.
# Anything else (or anything we can't be sure about) builds, so a real
# change is never skipped by mistake.
set -u

# Compare with the commit Vercel last deployed for this branch, so a push
# of several commits is judged as a whole. Vercel sets
# VERCEL_GIT_PREVIOUS_SHA; if it is missing or not in the (shallow) clone,
# build — never guess.
BASE="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -z "$BASE" ] || ! git cat-file -e "${BASE}^{commit}" 2>/dev/null; then
  echo "No previous deployment to compare with, building."
  exit 1
fi

CHANGED=$(git diff --name-only "$BASE" HEAD)
if [ -z "$CHANGED" ]; then
  echo "No file changes, building anyway (e.g. a manual redeploy)."
  exit 1
fi

while IFS= read -r file; do
  case "$file" in
    docs/* | e2e/* | tests/* | .claude/* | .github/* | *.md | *.test.ts | *.test.tsx) ;;
    *)
      echo "App change ($file), building."
      exit 1
      ;;
  esac
done <<< "$CHANGED"

echo "Only docs/tests/CI files changed, skipping this deployment."
exit 0
