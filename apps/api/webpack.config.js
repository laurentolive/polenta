// webpack-node-externals is a dep of @nestjs/cli, available without explicit install
const nodeExternals = require('webpack-node-externals')

module.exports = (options) => ({
  ...options,
  externals: [
    nodeExternals({
      // Bundle @polenta/* workspace packages instead of loading them as TS at runtime
      allowlist: [/^@polenta\//],
    }),
  ],
})
