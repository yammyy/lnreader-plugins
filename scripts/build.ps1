# -------------------------------
# Get version
# -------------------------------
$version = node -e "console.log(require('./package.json').version);"
$dist = "plugins/v$version"

echo "Building plugins locally (v$version)"
echo "Output directory: $dist"

# -------------------------------
# Clean previous build artifacts
# -------------------------------
if (Test-Path ".js") {
    echo "Cleaning .js directory"
    Remove-Item -Recurse -Force ".js"
}

if (Test-Path ".dist") {
    echo "Cleaning .dist directory"
    Remove-Item -Recurse -Force ".dist"
}

# -------------------------------
# Build pipeline
# -------------------------------
npm run build:multisrc

echo "Compiling TypeScript..."
npx tsc --project tsconfig.production.json

npm run build:manifest

# -------------------------------
# Validate manifest output
# -------------------------------
if (-not (Test-Path ".dist") -or -not (Get-ChildItem -Path ".dist" -Force)) {
    echo "❌ ERROR: Manifest generation failed - .dist is missing or empty"
    exit 1
}

# -------------------------------
# Legacy compatibility copy
# -------------------------------
echo "Copying .js/plugins -> .js/src/plugins"

New-Item -ItemType Directory -Force -Path ".js/src" | Out-Null
Copy-Item -Path ".js/plugins" -Destination ".js/src/plugins" -Recurse -Force

# -------------------------------
# Optional: versioned local output
# -------------------------------
if (Test-Path $dist) {
    echo "Removing previous $dist"
    Remove-Item -Recurse -Force $dist
}

New-Item -ItemType Directory -Force -Path $dist | Out-Null
Copy-Item -Path ".dist/*" -Destination $dist -Recurse -Force

echo "✅ Local build completed successfully"
