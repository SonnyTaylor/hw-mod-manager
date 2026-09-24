#!/usr/bin/env node
/**
 * hw — Happy Wheels mod development CLI
 *
 * Commands:
 *   hw patch [path]        Patch game (fuse, asar, mod host)
 *   hw restore [path]      Restore original game
 *   hw status              Show patch status
 *   hw launch              Kill any running instance and launch the game
 *   hw log                 Show the mod host log
 *   hw dev [name...]       Full dev cycle: patch + launch + log (optionally only one mod)
 *   hw new <name>          Scaffold a new mod in mods/
 *   hw install <name>      Copy a mod from project mods/ into the game
 *   hw list                List project mods and installed mods
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const GAME_PATH = process.env.HW_GAME_PATH
    || ['C:/SteamLibrary/steamapps/common/Happy Wheels', 'C:/Program Files (x86)/Steam/steamapps/common/Happy Wheels']
        .find(p => fs.existsSync(path.join(p, 'Happy Wheels.exe')))
    || 'C:/SteamLibrary/steamapps/common/Happy Wheels';
const GAME_EXE = path.join(GAME_PATH, 'Happy Wheels.exe');
const MODS_LOG = path.join(GAME_PATH, 'mods', 'hw-mod-host.log');
const PROJECT_MODS = path.join(PROJECT_ROOT, 'mods');
const GAME_MODS = path.join(GAME_PATH, 'mods');

function die(msg) {
    console.error('❌ ' + msg);
    process.exit(1);
}

function killGame() {
    try {
        execSync('taskkill /IM "Happy Wheels.exe" /F', { stdio: 'pipe' });
        console.log('🛑 Killed running instance');
        // Give Windows a beat to release file locks
        execSync('sleep 2', { shell: 'bash', stdio: 'ignore' });
    } catch (e) {
        // No instance running — fine
    }
}

function launchGame() {
    if (!fs.existsSync(GAME_EXE)) die(`Game not found at ${GAME_EXE}`);
    spawn(GAME_EXE, [], { detached: true, stdio: 'ignore' }).unref();
    console.log('🚀 Launched Happy Wheels');
}

const commands = {
    patch(args) {
        execSync(`node "${path.join(__dirname, 'patch-game.js')}" patch ${args[0] || ''}`, { stdio: 'inherit' });
    },

    restore(args) {
        execSync(`node "${path.join(__dirname, 'patch-game.js')}" restore ${args[0] || ''}`, { stdio: 'inherit' });
    },

    status(args) {
        execSync(`node "${path.join(__dirname, 'patch-game.js')}" status ${args[0] || ''}`, { stdio: 'inherit' });
    },

    launch() {
        killGame();
        launchGame();
    },

    log() {
        if (!fs.existsSync(MODS_LOG)) die('No mod log yet — launch the game first (hw dev)');
        console.log(fs.readFileSync(MODS_LOG, 'utf8'));
    },

    // The main dev loop: patch, launch, wait for load, show log.
    dev(args) {
        console.log('🔁 Dev cycle: patch → launch → wait → log\n');
        killGame();
        execSync(`node "${path.join(__dirname, 'patch-game.js')}"`, { stdio: 'inherit' });
        // auto-sync shared libs so the loop always runs fresh lib code
        try { commands['install-libs'](); } catch (e) {}
        launchGame();
        console.log('⏳ Waiting 20s for game load...');
        setTimeout(() => {
            console.log('\n──── mod host log ────');
            if (fs.existsSync(MODS_LOG)) console.log(fs.readFileSync(MODS_LOG, 'utf8'));
            else console.log('(no log written — game may not have loaded)');
            process.exit(0);
        }, 20000);
    },

    new(args) {
        const name = args[0];
        if (!name) die('Usage: hw new <mod-name>');
        const slug = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
        const modDir = path.join(PROJECT_MODS, slug);
        if (fs.existsSync(modDir)) die(`Mod already exists: ${modDir}`);

        fs.mkdirSync(modDir, { recursive: true });
        fs.writeFileSync(path.join(modDir, 'mod.json'), JSON.stringify({
            name,
            version: '0.1.0',
            description: 'TODO',
            author: '',
            tags: []
        }, null, 4) + '\n');

        fs.writeFileSync(path.join(modDir, 'mod.js'), `/**
 * ${name}
 */
(function () {
    'use strict';
    const HW = window.__HW__;

    HW.onReady(function () {
        HW.log('${name}', 'loaded!');
    });
})();
`);
        console.log(`✨ Created mods/${slug}/ (mod.json + mod.js)`);
        console.log(`   Install with: hw install ${slug}`);
    },

    install(args) {
        const name = args[0];
        if (!name) die('Usage: hw install <mod-folder-name>');
        const src = path.join(PROJECT_MODS, name);
        if (!fs.existsSync(src)) die(`No such mod in project: ${src}`);
        fs.cpSync(src, path.join(GAME_MODS, name), { recursive: true });
        console.log(`📦 Installed ${name} → game mods/`);
    },

    // Copy shared libs (mods/_lib/*.js) into the game.
    'install-libs'() {
        const src = path.join(PROJECT_MODS, '_lib');
        if (!fs.existsSync(src)) die('No mods/_lib/ in project');
        fs.cpSync(src, path.join(GAME_MODS, '_lib'), { recursive: true });
        console.log(`📚 Installed libs → game mods/_lib/ (${fs.readdirSync(src).join(', ')})`);
    },

    list() {
        const fmt = (dir, label) => {
            if (!fs.existsSync(dir)) return console.log(`${label}: (missing)`);
            const dirs = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory());
            console.log(`${label}: ${dirs.length ? dirs.map(d => d.name).join(', ') : '(none)'}`);
        };
        fmt(PROJECT_MODS, '📁 project mods/');
        fmt(GAME_MODS, '📁 game mods/  ');
    }
};

const [cmd, ...args] = process.argv.slice(2);
if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(`hw — Happy Wheels mod dev CLI

  hw patch              patch the game
  hw restore            restore original game
  hw status             patch status
  hw launch             kill + relaunch game
  hw log                show mod host log
  hw dev                patch + launch + show log (main dev loop)
  hw new <name>         scaffold a new mod
  hw install <name>     copy project mod into game
  hw install-libs       copy shared libs (mods/_lib) into game
  hw list               list mods`);
    process.exit(0);
}

if (!commands[cmd]) die(`Unknown command: ${cmd}. Try: node tools/hw.js help`);
commands[cmd](args);