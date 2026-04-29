#!/usr/bin/env bash
set -euo pipefail

# Сборка образа: тег <IMAGE_NAME>:<версия>, затем тот же образ как <IMAGE_NAME>:latest.
# Версия: переменная IMAGE_VERSION, иначе поле version из package.json.
# Имя образа: переменная IMAGE_NAME, иначе joposcragent/web-front.
# Доп. аргументы передаются в docker build (например --build-arg VITE_...=...).

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
cd "${repo_root}"

image_name="${IMAGE_NAME:-joposcragent/crawler-headhunter}"
version="${IMAGE_VERSION:-$(node -p "require('./package.json').version")}"
tag_versioned="${image_name}:${version}"

docker build -t "${tag_versioned}" "$@" .
docker tag "${tag_versioned}" "${image_name}:latest"

printf 'Образ: %s и %s:latest\n' "${tag_versioned}" "${image_name}"
