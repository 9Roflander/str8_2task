const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isWatch = process.argv.includes('--watch');

// Ensure dist directory exists
if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist');
}

// Copy static files
const staticFiles = [
    { src: 'manifest.json', dest: 'dist/manifest.json' },
    { src: 'src/popup/popup.html', dest: 'dist/popup.html' }
];

staticFiles.forEach(({ src, dest }) => {
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log(`Copied ${src} to ${dest}`);
    }
});

// Copy icons directory
if (fs.existsSync('icons')) {
    const iconsDir = 'dist/icons';
    if (!fs.existsSync(iconsDir)) {
        fs.mkdirSync(iconsDir, { recursive: true });
    }
    fs.readdirSync('icons').forEach(file => {
        fs.copyFileSync(
            path.join('icons', file),
            path.join(iconsDir, file)
        );
    });
    console.log('Copied icons directory');
}

// Build configuration
const buildOptions = {
    entryPoints: [
        'src/background/index.js',
        'src/content/index.js',
        'src/popup/popup.js'
    ],
    bundle: true,
    outdir: 'dist',
    sourcemap: true,
    platform: 'browser',
    target: 'chrome96',
    format: 'iife',
    logLevel: 'info'
};

async function build() {
    try {
        if (isWatch) {
            const ctx = await esbuild.context(buildOptions);
            await ctx.watch();
            console.log('Watching for changes...');
        } else {
            await esbuild.build(buildOptions);
            console.log('Build complete!');
        }
    } catch (error) {
        console.error('Build failed:', error);
        process.exit(1);
    }
}

build();
