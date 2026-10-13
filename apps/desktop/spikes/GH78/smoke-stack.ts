// Débordement de pile : abort du module à la libération du runtime ? (variante × forme du code)
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core'

const forms: Record<string, string> = {
  'global, fonction déclarée': `function f() { return f() + 1 }; f()`,
  'global, try/catch interne': `function f() { return f() + 1 }; try { f() } catch (e) { 'attrapé: ' + e.message }`,
  'module, export default appelé': `export default function f() { return f() + 1 }; f()`,
}
void (async () => {
  for (const name of ['@jitl/quickjs-wasmfile-release-sync', '@jitl/quickjs-ng-wasmfile-release-sync']) {
    for (const [form, code] of Object.entries(forms)) {
      const qjs = await newQuickJSWASMModuleFromVariant((await import(name)).default)
      const rt = qjs.newRuntime()
      rt.setMaxStackSize(Number(process.env.STACK_KB ?? 256) * 1024) // STACK_KB=512 : débordement de la pile V8
      const vm = rt.newContext()
      const r = vm.evalCode(code, 'x.js', { type: code.includes('export') ? 'module' : 'global' })
      const res = r.error ? `erreur ${JSON.stringify(vm.dump(r.error)).slice(0, 80)}` : `ok ${JSON.stringify(vm.dump(r.value))}`
      ;(r.error ?? r.value).dispose()
      let disposed = 'dispose ok'
      try { vm.dispose(); rt.dispose() } catch (e) { disposed = 'ABORT au dispose' }
      let reusable = 'module réutilisable'
      try { const rt2 = qjs.newRuntime(); const vm2 = rt2.newContext(); vm2.unwrapResult(vm2.evalCode('1+1')).dispose(); vm2.dispose(); rt2.dispose() } catch { reusable = 'MODULE MORT' }
      console.log(name.replace('@jitl/', ''), '|', form, '|', res, '|', disposed, '|', reusable)
    }
  }
})()
