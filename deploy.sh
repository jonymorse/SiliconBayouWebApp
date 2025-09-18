#!/bin/bash

# Quick deploy script for GitHub Pages
echo "🔨 Building project..."
npm run build

echo "📦 Adding changes to git..."
git add .

echo "💬 Enter commit message:"
read commit_message

echo "📝 Committing changes..."
git commit -m "$commit_message"

echo "🚀 Pushing to GitHub..."
git push 

echo "✅ Deployed! Check https://jonymorse.github.io/SiliconBayouWebApp/ in 3-5 minutes"
