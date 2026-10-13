// La limite mémoire QuickJS borne-t-elle la mémoire linéaire wasm ? Et un plafond dur
// (WebAssembly.Memory { maximum }) passé à la variante ?
import { newQuickJSWASMModuleFromVariant, newVariant, shouldInterruptAfterDeadline } from 'quickjs-emscripten-core'

const probes: Record<string, string> = {
  'tableaux denses': `const a = []; while (true) a.push(new Array(100000).fill(a.length))`,
  'objets': `const a = []; let i = 0; while (true) a.push({ i: i++, s: 'x' + i })`,
  'chaînes': `const a = []; let i = 0; while (true) a.push('abcdefghij'.repeat(100) + i++)`,
  'ArrayBuffer': `const a = []; while (true) a.push(new ArrayBuffer(1 << 20))`,
}
void (async () => {
  const base = (await import('@jitl/quickjs-wasmfile-release-sync')).default
  for (const cap of [null, 128]) {
    for (const [name, code] of Object.entries(probes)) {
      const variant = cap ? newVariant(base, { wasmMemory: new WebAssembly.Memory({ initial: 256, maximum: cap * 16 }) }) : base
      const qjs = await newQuickJSWASMModuleFromVariant(variant)
      const rt = qjs.newRuntime()
      rt.setMemoryLimit(64 * 1024 * 1024)
      rt.setMaxStackSize(256 * 1024)
      rt.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + 5000))
      const vm = rt.newContext()
      const t = performance.now()
      let res: string
      try {
        const r = vm.evalCode(code, 'x.js', { type: 'global' })
        res = r.error ? String((vm.dump(r.error) as { message?: string }).message) : 'ok'
        ;(r.error ?? r.value).dispose()
      } catch (e) { res = 'EXCEPTION HÔTE ' + String(e).slice(0, 80) }
      const wasmMb = qjs.getWasmMemory().buffer.byteLength / 1048576
      let reuse = 'ok'
      try { vm.dispose(); rt.dispose(); const rt2 = qjs.newRuntime(); const v2 = rt2.newContext(); v2.unwrapResult(v2.evalCode('1')).dispose(); v2.dispose(); rt2.dispose() } catch { reuse = 'MODULE MORT' }
      console.log(`plafond ${cap ?? 'aucun'} Mo | ${name} | ${Math.round(performance.now() - t)} ms | ${res} | mémoire wasm ${wasmMb} Mo | réutilisation ${reuse}`)
    }
  }
})()
