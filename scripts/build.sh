#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
dist_dir="$project_dir/dist"

rm -rf "$dist_dir"
mkdir -p "$dist_dir/assets"

cp "$project_dir/index.html" "$dist_dir/index.html"
cp "$project_dir/styles.css" "$dist_dir/styles.css"
cp "$project_dir/script.js" "$dist_dir/script.js"
cp "$project_dir/favicon.png" "$dist_dir/favicon.png"
cp "$project_dir/apple-touch-icon.png" "$dist_dir/apple-touch-icon.png"
cp -R "$project_dir/assets/." "$dist_dir/assets/"
rm -f "$dist_dir/assets/"*.md

echo "Built static site in $dist_dir"
