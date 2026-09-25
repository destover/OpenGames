$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$source = Join-Path $root 'connect\.build\llama.cpp'
New-Item -ItemType Directory -Path (Join-Path $root 'connect\.build') -Force | Out-Null
if (-not (Test-Path (Join-Path $source '.git'))) { git clone https://github.com/ggml-org/llama.cpp.git $source }
git -C $source fetch --depth 1 origin 308883b335798865e73f8fee0d9a5fbfa13c8480
git -C $source checkout --detach 308883b335798865e73f8fee0d9a5fbfa13c8480
$build = Join-Path $source 'build-opengames'
cmake -S $source -B $build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF -DGGML_CUDA=OFF -DGGML_VULKAN=OFF -DLLAMA_CURL=OFF -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_SERVER=ON
cmake --build $build --config Release --target llama-server --parallel
$server = Join-Path $build 'bin\Release\llama-server.exe'
if (-not (Test-Path $server)) { $server = Join-Path $build 'bin\llama-server.exe' }
Copy-Item $server (Join-Path $root 'connect\src-tauri\binaries\llama-server-x86_64-pc-windows-msvc.exe') -Force
cargo build --release --manifest-path (Join-Path $root 'connect-cli\Cargo.toml')
$dist = Join-Path $root 'connect-cli\dist'
New-Item -ItemType Directory -Path $dist -Force | Out-Null
Copy-Item (Join-Path $root 'connect-cli\target\release\opengames-connect-cli.exe') (Join-Path $dist 'opengames-connect-cli-x86_64-pc-windows-msvc.exe') -Force
Copy-Item $server (Join-Path $dist 'llama-server.exe') -Force
Copy-Item (Join-Path $root 'connect\src-tauri\binaries\LLAMA_LICENSE') $dist -Force
Copy-Item (Join-Path $root 'connect\src-tauri\binaries\QWEN_LICENSE') $dist -Force
Compress-Archive -Path (Join-Path $dist '*') -DestinationPath (Join-Path $root 'connect-cli\OpenGames-Connect-CLI-0.1.4-windows-x64.zip') -Force
Push-Location (Join-Path $root 'connect')
try { npm ci; npm run tauri -- build --bundles nsis } finally { Pop-Location }
