#!/bin/bash
# This script ensures the project uses the correct Node.js version

if command -v nvm &> /dev/null; then
    echo "Using Node.js version specified in .nvmrc..."
    nvm use
else
    echo "nvm not found. Please install nvm or ensure you're using Node.js $(cat .nvmrc)"
    echo "Current Node.js version: $(node --version)"
fi