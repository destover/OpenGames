#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
source_dir="$root/connect/.build/llama.cpp"
mkdir -p "$root/connect/.build"
if [[ ! -d "$source_dir/.git" ]]; then git clone https://github.com/ggml-org/llama.cpp.git "$source_dir"; fi
git -C "$source_dir" fetch --depth 1 origin 308883b335798865e73f8fee0d9a5fbfa13c8480
git -C "$source_dir" checkout --detach 308883b335798865e73f8fee0d9a5fbfa13c8480
cmake -S "$source_dir" -B "$source_dir/build-opengames" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF -DGGML_CUDA=OFF -DGGML_VULKAN=OFF -DLLAMA_CURL=OFF -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_SERVER=ON
cmake --build "$source_dir/build-opengames" --config Release --target llama-server --parallel
install -m 755 "$source_dir/build-opengames/bin/llama-server" "$root/connect/src-tauri/binaries/llama-server-x86_64-unknown-linux-gnu"
cargo build --release --manifest-path "$root/connect-cli/Cargo.toml"
mkdir -p "$root/connect-cli/dist"
install -m 755 "$root/connect-cli/target/release/opengames-connect-cli" "$root/connect-cli/dist/opengames-connect-cli-x86_64-unknown-linux-gnu"
install -m 755 "$source_dir/build-opengames/bin/llama-server" "$root/connect-cli/dist/llama-server"
cp "$root/connect/src-tauri/binaries/LLAMA_LICENSE" "$root/connect/src-tauri/binaries/QWEN_LICENSE" "$root/connect-cli/dist/"
tar -czf "$root/connect-cli/OpenGames-Connect-CLI-0.1.4-linux-x64.tar.gz" -C "$root/connect-cli/dist" opengames-connect-cli-x86_64-unknown-linux-gnu llama-server LLAMA_LICENSE QWEN_LICENSE
cd "$root/connect"
npm ci
npm run tauri -- build --bundles appimage
