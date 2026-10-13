// Bac à sable côté renderer (option « exécution dans le renderer ») : cœur + variante wasm séparée.
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core'
import variant from '@jitl/quickjs-wasmfile-release-sync'

export const load = () => newQuickJSWASMModuleFromVariant(variant as never)
