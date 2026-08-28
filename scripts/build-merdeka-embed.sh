#!/usr/bin/env bash
set -euo pipefail

npx --yes esbuild@0.25.9 src/embed/merdeka-webflow.tsx \
  --bundle \
  --format=iife \
  --platform=browser \
  --target=es2020 \
  --jsx=automatic \
  --alias:next/image=./src/embed/NextImage.tsx \
  --alias:@=./src \
  --loader:.module.css=local-css \
  --outdir=public/merdeka-promo-embed/v1 \
  --entry-names=app \
  --legal-comments=none \
  --minify
