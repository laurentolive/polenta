// REPL driver for the Polenta Electron desktop app.
// Windows-authored (no xvfb/tmux needed — real desktop session). On headless
// Linux, prefix the launch with `xvfb-run -a` and set DISPLAY; everything else
// is platform-agnostic (Playwright's _electron talks to the app over CDP).
// Reads commands from stdin, one per line: `launch`, `ss <name>`, `click <sel>`,
// `click-text <text>`, `focus <sel> [index]`, `type <text>`, `press <key>`,
// `wait <sel>`, `eval <js>`, `text [sel]`, `windows`, `stub-dialogs <openPath> <savePath>`, `quit`.
import { _electron as electron } from 'playwright-core'
import * as readline from 'node:readline'
import * as fs from 'node:fs'
import * as path from 'node:path'

const APP_DIR = path.resolve(import.meta.dirname, '../../..') // apps/desktop
const SHOT_DIR = process.env.SCREENSHOT_DIR || 'C:/tmp/shots'
fs.mkdirSync(SHOT_DIR, { recursive: true })

let app = null
let page = null

const electronBin = process.platform === 'darwin'
  ? path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : process.platform === 'win32'
    ? path.join(APP_DIR, 'node_modules/electron/dist/electron.exe')
    : path.join(APP_DIR, 'node_modules/electron/dist/electron')

const COMMANDS = {
  async launch() {
    if (app) return console.log('already launched')
    const userDataDir = process.env.ELECTRON_USER_DATA_DIR
    // Gotcha (Windows): the app path must come FIRST, flags after. With
    // `--no-sandbox` (or any flag) before the app path, electron.exe prints
    // "bad option: --no-sandbox" and refuses to start — confirmed by
    // launching the binary directly outside Playwright to see the real error
    // (Playwright only reports the generic "Process failed to launch!").
    const args = [APP_DIR, '--no-sandbox']
    // Isolate from the developer's real Polenta profile (auth.json, recents,
    // keytar-backed tokens) — without this, a test run silently mutates the
    // same userData dir as a normal `pnpm dev` on this machine.
    if (userDataDir) args.push(`--user-data-dir=${userDataDir}`)
    // Gotcha: this driver itself runs under an Electron-based host (VS Code /
    // Claude Code), which sets ELECTRON_RUN_AS_NODE=1 in the ambient env. If
    // inherited, the launched app's electron.exe also runs as plain Node —
    // `require('electron').app` comes back undefined and the main process
    // crashes on `electron.app.whenReady()`. Must be stripped, not just left
    // unset, since `...process.env` copies it in first.
    const env = { ...process.env, DISPLAY: process.env.DISPLAY || ':99' }
    delete env.ELECTRON_RUN_AS_NODE
    app = await electron.launch({
      executablePath: electronBin,
      args,
      env,
      timeout: 30_000,
    })
    await new Promise((r) => setTimeout(r, 4_000))
    page = app.windows().find((w) => !w.url().startsWith('devtools://')) ?? (await app.firstWindow())
    console.log('launched.', app.windows().length, 'windows:')
    for (const w of app.windows()) console.log(' ', w.url())
  },

  async ss(name) {
    if (!page) return console.log('ERROR: launch first')
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + '.png')
    await page.screenshot({ path: f })
    console.log('screenshot:', f)
  },

  async click(sel) {
    if (!page) return console.log('ERROR: launch first')
    const r = await page.evaluate((s) => {
      const el = document.querySelector(s)
      if (!el) return 'NOT_FOUND'
      el.click()
      return 'OK'
    }, sel)
    console.log('click', sel, '->', r)
  },

  // Real Playwright mouse click (genuine mousedown/mouseup at the element's screen
  // coordinates) — unlike `click`, which uses DOM `.click()` and has no clientX/clientY,
  // this is needed for ProseMirror editors that resolve cursor position via posAtCoords.
  async pwclick(sel) {
    if (!page) return console.log('ERROR: launch first')
    try {
      await page.click(sel, { timeout: 5000 })
      console.log('pwclick', sel, '-> OK')
    } catch (e) {
      console.log('pwclick', sel, '-> ERROR:', e.message)
    }
  },

  async 'click-text'(text) {
    if (!page) return console.log('ERROR: launch first')
    const r = await page.evaluate((t) => {
      const els = [...document.querySelectorAll('button, a, [role="button"]')]
      const el = els.find((e) => e.textContent?.trim() === t) ?? els.find((e) => e.textContent?.includes(t))
      if (!el) return 'NOT_FOUND'
      el.click()
      return 'OK: ' + el.tagName
    }, text)
    console.log('click-text', JSON.stringify(text), '->', r)
  },

  async focus(arg) {
    if (!page) return console.log('ERROR: launch first')
    const parts = arg.split(/\s+/)
    const index = /^\d+$/.test(parts[parts.length - 1]) ? Number(parts.pop()) : 0
    const sel = parts.join(' ')
    const r = await page.evaluate(
      ({ s, i }) => {
        const el = document.querySelectorAll(s)[i]
        if (!el) return 'NOT_FOUND'
        el.focus()
        return 'OK'
      },
      { s: sel, i: index },
    )
    console.log('focus', sel, index, '->', r)
  },

  async type(text) {
    if (page) await page.keyboard.type(text, { delay: 20 })
  },
  async press(key) {
    if (page) await page.keyboard.press(key)
  },

  async wait(sel) {
    if (!page) return console.log('ERROR: launch first')
    try {
      await page.waitForSelector(sel, { timeout: 10_000 })
      console.log('found:', sel)
    } catch {
      console.log('TIMEOUT:', sel)
    }
  },

  async eval(expr) {
    if (!page) return console.log('ERROR: launch first')
    try {
      console.log(JSON.stringify(await page.evaluate(expr)))
    } catch (e) {
      console.log('ERROR:', e.message)
    }
  },

  async text(sel) {
    if (!page) return console.log('ERROR: launch first')
    console.log(
      await page.evaluate((s) => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)', sel || null),
    )
  },

  async windows() {
    if (!app) return console.log('ERROR: launch first')
    for (const w of app.windows()) console.log(' ', w.url())
  },

  // Stubs the native folder/save dialogs in the MAIN process so UI flows that
  // trigger dialog.showOpenDialog/showSaveDialog resolve instantly instead of
  // popping a real OS modal Playwright cannot see or click.
  async 'stub-dialogs'(arg) {
    if (!app) return console.log('ERROR: launch first')
    const [openPath, savePath] = arg.split(/\s+/)
    await app.evaluate(
      ({ dialog }, { openPath, savePath }) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [openPath] })
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: savePath })
      },
      { openPath, savePath },
    )
    console.log('stubbed dialogs: open ->', openPath, ' save ->', savePath)
  },

  async sleep(ms) {
    await new Promise((r) => setTimeout(r, Number(ms) || 1000))
  },

  async quit() {
    if (app) await app.close().catch(() => {})
    app = null
    page = null
  },
  help() {
    console.log('commands:', Object.keys(COMMANDS).join(', '))
  },
}

async function runLine(line) {
  const [cmd, ...rest] = line.trim().split(/\s+/)
  if (!cmd) return
  const fn = COMMANDS[cmd]
  if (!fn) return console.log('unknown:', cmd, '- try: help')
  try {
    await fn(rest.join(' '))
  } catch (e) {
    console.log('ERROR:', e.message)
  }
}

console.log('polenta-desktop driver - "help" for commands, "launch" to start')

if (process.stdin.isTTY) {
  // Interactive use: real REPL, one command per keystroke-Enter.
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'driver> ' })
  rl.prompt()
  rl.on('line', async (line) => {
    await runLine(line)
    if (line.trim() === 'quit') { rl.close(); return }
    rl.prompt()
  })
  rl.on('close', async () => { await COMMANDS.quit(); process.exit(0) })
} else {
  // Piped script (tmux send-keys, or `node driver.mjs < commands.txt`): the
  // input stream hits EOF almost immediately, well before slow commands like
  // `launch` resolve. readline's 'close' fires on that EOF regardless of our
  // own progress, and calling rl.prompt()/rl.close() afterward throws
  // ERR_USE_AFTER_CLOSE — so for this mode, skip readline entirely: buffer
  // the whole input first, then run each line sequentially with plain await.
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const lines = Buffer.concat(chunks).toString('utf-8').split(/\r?\n/)
  for (const line of lines) {
    if (!line.trim()) continue
    console.log('driver>', line)
    await runLine(line)
    if (line.trim() === 'quit') break
  }
  if (app) await COMMANDS.quit()
  process.exit(0)
}
